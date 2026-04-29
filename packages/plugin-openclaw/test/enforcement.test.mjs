// Unit tests for the enforcement core. Pure-logic only — no real fs, no real
// agent runtime. Run with `node --test`. These cover the highest-value
// invariants of the workflow gate: deviation detection, transit hopping,
// and the namespace-stripping that broke between v0.3.7 and v0.3.10.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEnforcer } from "../enforcement.mjs";
import { freshState } from "../workflow.mjs";

// loadGraph() reads from disk and pre-computes _byId / _outgoing. For unit
// tests we want to hand-build graphs without I/O, so re-do that prep here.
function makeGraph(spec) {
  const graph = {
    max_reconsider_retries: 3,
    requires_approval: [],
    ...spec,
  };
  graph.edges = [...graph.edges].sort((a, b) =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
  );
  graph._byId = new Map(graph.nodes.map((n) => [n.id, n]));
  graph._outgoing = new Map();
  for (const e of graph.edges) {
    if (!graph._outgoing.has(e.from)) graph._outgoing.set(e.from, []);
    graph._outgoing.get(e.from).push(e.to);
  }
  return graph;
}

function makeStubLogger() {
  const events = [];
  return { events, append: (e) => events.push(e) };
}

function makeStubTelemetry() {
  const events = [];
  return { events, emit: (event, properties) => events.push({ event, properties }) };
}

function makeStubStderr() {
  const writes = [];
  return { writes, write: (s) => writes.push(s) };
}

// Linear:  A[read] -> B[write] -> C[]
function linearGraph() {
  return makeGraph({
    entry: "A",
    nodes: [
      { id: "A", purpose: "read config", allowed_tools: ["read"] },
      { id: "B", purpose: "write changes", allowed_tools: ["write"] },
      { id: "C", purpose: "done", allowed_tools: [] },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ],
  });
}

// Branching:  A[read] -> B[write],  A -> C[delete]
// From B, `delete` is in graphTools (so it's "ours") but unreachable.
function branchingGraph() {
  return makeGraph({
    entry: "A",
    nodes: [
      { id: "A", purpose: "start", allowed_tools: ["read"] },
      { id: "B", purpose: "writer", allowed_tools: ["write"] },
      { id: "C", purpose: "deleter", allowed_tools: ["delete"] },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "A", to: "C" },
    ],
  });
}

// Transit:  A[read] -> T[] -> B[write]
function transitGraph() {
  return makeGraph({
    entry: "A",
    nodes: [
      { id: "A", purpose: "read", allowed_tools: ["read"] },
      { id: "T", purpose: "think", allowed_tools: [] },
      { id: "B", purpose: "write", allowed_tools: ["write"] },
    ],
    edges: [
      { from: "A", to: "T" },
      { from: "T", to: "B" },
    ],
  });
}

test("allow: tool in current node's allowed_tools, no transition", () => {
  const graph = linearGraph();
  const state = freshState(graph);
  const logger = makeStubLogger();
  const { decide } = createEnforcer({ graph, state, runLogger: logger });

  const result = decide({ toolName: "read", params: { path: "/x" } });

  assert.deepEqual(result, { params: { path: "/x" } });
  assert.equal(state.currentNode, "A");
  assert.equal(logger.events.length, 1);
  assert.equal(logger.events[0].type, "allow");
  assert.equal(logger.events[0].transitioned, false);
});

test("allow: tool in immediate successor advances currentNode", () => {
  const graph = linearGraph();
  const state = freshState(graph);
  const logger = makeStubLogger();
  const { decide } = createEnforcer({ graph, state, runLogger: logger });

  const result = decide({ toolName: "write", params: {} });

  assert.deepEqual(result, { params: {} });
  assert.equal(state.currentNode, "B");
  assert.equal(logger.events[0].type, "allow");
  assert.equal(logger.events[0].transitioned, true);
  assert.equal(logger.events[0].from_node, "A");
  assert.equal(logger.events[0].to_node, "B");
});

test("allow: tool reachable through empty-tools transit node", () => {
  // From A, write isn't allowed. T is empty-tools (transparent). B[write] is
  // reachable through T. Should hop A -> B without stopping at T.
  const graph = transitGraph();
  const state = freshState(graph);
  const { decide } = createEnforcer({ graph, state, runLogger: makeStubLogger() });

  const result = decide({ toolName: "write", params: {} });

  assert.ok(result.params !== undefined, "expected allow");
  assert.equal(state.currentNode, "B");
});

test("block: tool exists in graph but is unreachable from current node", () => {
  // Move us to B first, then try `delete` (only at C, not reachable from B).
  const graph = branchingGraph();
  const state = freshState(graph);
  const logger = makeStubLogger();
  const telemetry = makeStubTelemetry();
  const { decide } = createEnforcer({ graph, state, runLogger: logger, telemetry });

  decide({ toolName: "write", params: {} }); // A -> B
  assert.equal(state.currentNode, "B");

  const result = decide({ toolName: "delete", params: {} });

  assert.equal(result.block, true);
  assert.match(result.blockReason, /DEVIATION/);
  assert.match(result.blockReason, /not allowed in node 'B'/);
  assert.match(result.blockReason, /Allowed tools in this node: \[write\]/);

  const dev = logger.events.find((e) => e.type === "deviation");
  assert.ok(dev, "expected a deviation event");
  assert.equal(dev.attempted_tool, "delete");
  assert.equal(dev.from_node, "B");
  assert.equal(dev.retry, 1);

  const devTel = telemetry.events.find((e) => e.event === "deviation_blocked");
  assert.ok(devTel, "expected a deviation_blocked telemetry event");
  assert.equal(devTel.properties.attempted_tool, "delete");
});

test("block: reconsider counter increments per attempt", () => {
  const graph = branchingGraph();
  const state = freshState(graph);
  const { decide } = createEnforcer({ graph, state, runLogger: makeStubLogger() });

  decide({ toolName: "write", params: {} }); // A -> B
  decide({ toolName: "delete", params: {} });
  decide({ toolName: "delete", params: {} });
  decide({ toolName: "delete", params: {} });

  assert.equal(state.reconsiderCounter, 3);
});

test("block: terminate after exceeding reconsider budget", () => {
  const graph = branchingGraph();
  graph.max_reconsider_retries = 2;
  const state = freshState(graph);
  const { decide } = createEnforcer({ graph, state, runLogger: makeStubLogger() });

  decide({ toolName: "write", params: {} }); // A -> B
  decide({ toolName: "delete", params: {} }); // retry 1
  decide({ toolName: "delete", params: {} }); // retry 2
  const terminal = decide({ toolName: "delete", params: {} }); // retry 3, exceeds 2

  assert.equal(terminal.block, true);
  assert.match(terminal.blockReason, /WORKFLOW TERMINATED/);
  assert.match(terminal.blockReason, /reconsider budget \(2\)/);
});

test("passthrough: tool not in any node's allowed_tools is not ours", () => {
  // `xyz_unknown` belongs to some other plugin / MCP server. We must not
  // claim jurisdiction over it — return undefined so the host runtime
  // forwards it normally.
  const graph = linearGraph();
  const state = freshState(graph);
  const logger = makeStubLogger();
  const { decide, isOurTool } = createEnforcer({
    graph, state, runLogger: logger,
  });

  assert.equal(isOurTool("xyz_unknown"), false);
  const result = decide({ toolName: "xyz_unknown", params: {} });

  assert.equal(result, undefined);
  assert.equal(logger.events.length, 0, "must not log non-ours tools");
});

test("passthrough: no graph loaded -> decide is a no-op", () => {
  const state = { currentNode: null, reconsiderCounter: 0 };
  const { decide } = createEnforcer({
    graph: null, state, runLogger: makeStubLogger(),
  });

  assert.equal(decide({ toolName: "anything", params: {} }), undefined);
});

test("namespace stripping: mcp__openclaw__write matches write in graph", () => {
  // The OpenClaw loopback MCP wraps tool names with this prefix when they
  // pass through the proxy. The enforcer must strip it before matching, or
  // every legitimate proxied call looks like a foreign tool.
  const graph = linearGraph();
  const state = freshState(graph);
  const logger = makeStubLogger();
  const { decide, isOurTool } = createEnforcer({
    graph, state, runLogger: logger,
  });

  assert.equal(isOurTool("mcp__openclaw__write"), true);
  const result = decide({ toolName: "mcp__openclaw__write", params: {} });

  assert.deepEqual(result, { params: {} });
  assert.equal(state.currentNode, "B");
  assert.equal(logger.events[0].tool, "write", "should log the bare name");
});

test("requires_approval: blocks with queued message and writes approval_pending", () => {
  const graph = linearGraph();
  graph.requires_approval = ["write"];
  const state = freshState(graph);
  const logger = makeStubLogger();
  const stderr = makeStubStderr();
  const { decide } = createEnforcer({
    graph, state, runLogger: logger, stderr,
  });

  const result = decide({ toolName: "write", params: { body: "..." } });

  assert.equal(result.block, true);
  assert.match(result.blockReason, /Approval queued/);
  assert.match(result.blockReason, /id=/);

  const pending = logger.events.find((e) => e.type === "approval_pending");
  assert.ok(pending, "expected approval_pending event");
  assert.equal(pending.tool, "write");
  assert.match(pending.id, /^[0-9a-f]{8}$/);
});

test("requires_approval: same {tool, params} within turn dedupes to same id", () => {
  // Claude CLI can retry inside one turn after a hook timeout. Without dedupe
  // the pending queue fills with duplicates; the user has to approve N times
  // for one logical action.
  const graph = linearGraph();
  graph.requires_approval = ["write"];
  const state = freshState(graph);
  const logger = makeStubLogger();
  const { decide } = createEnforcer({
    graph, state, runLogger: logger, stderr: makeStubStderr(),
  });

  const r1 = decide({ toolName: "write", params: { body: "x" } });
  const r2 = decide({ toolName: "write", params: { body: "x" } });

  const id1 = r1.blockReason.match(/id=([0-9a-f]+)/)[1];
  const id2 = r2.blockReason.match(/id=([0-9a-f]+)/)[1];
  assert.equal(id1, id2, "same {tool, params} should reuse the approval id");

  const pendings = logger.events.filter((e) => e.type === "approval_pending");
  assert.equal(pendings.length, 1, "second call must not write a new pending event");
});
