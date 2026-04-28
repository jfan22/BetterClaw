// Workflow-graph state machine for BetterClaw. Loads a graph from JSON, tracks
// per-session state (current_node, reconsider_counter), applies the transition
// rule, and builds the deviation-error message the agent sees.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-user state dir, shared between the CLI and the plugin. Both write/read
// through here so they stay in sync regardless of plugin install layout
// (source clone, --link, or npm install).
const BETTERCLAW_HOME = process.env.BETTERCLAW_HOME || path.join(os.homedir(), ".betterclaw");

export function loadGraph(graphPath) {
  const raw = fs.readFileSync(graphPath, "utf8");
  const graph = JSON.parse(raw);

  // Sort edges lexicographically for deterministic tie-breaking in the
  // transition rule. Matches what the design doc specifies.
  graph.edges = [...graph.edges].sort((a, b) =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
  );
  graph.max_reconsider_retries = graph.max_reconsider_retries ?? 3;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = new Map();
  for (const e of graph.edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from).push(e.to);
  }
  graph._byId = byId;
  graph._outgoing = outgoing;
  return graph;
}

// BFS from fromNodeId looking for a concrete destination where toolName is
// allowed, walking through empty-allowed-tools "thinking" nodes as
// transparent transits. The compile prompt explicitly tells the model that
// pure-LLM-thinking nodes (allowed_tools: []) advance by calling a tool
// from a reachable next node, so the runtime must honor that contract by
// hopping past empty nodes — otherwise the empty node is a dead end.
//
// Stops at non-empty-tools nodes: those are concrete destinations or
// non-matches, never transparent.
function findReachableViaEmptyTransits(graph, fromNodeId, toolName) {
  const visited = new Set([fromNodeId]);
  const candidates = [];
  const queue = [...(graph._outgoing.get(fromNodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = graph._byId.get(id);
    if (!node) continue;
    const tools = node.allowed_tools ?? [];
    if (tools.length === 0) {
      for (const next of graph._outgoing.get(id) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    } else if (tools.includes(toolName)) {
      candidates.push(id);
    }
  }
  candidates.sort();
  return candidates[0] ?? null;
}

function summarizeReachableDestinations(graph, fromNodeId) {
  const visited = new Set([fromNodeId]);
  const reachable = [];
  const queue = [...(graph._outgoing.get(fromNodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = graph._byId.get(id);
    if (!node) continue;
    const tools = node.allowed_tools ?? [];
    if (tools.length === 0) {
      for (const next of graph._outgoing.get(id) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    } else {
      reachable.push({ id, tools });
    }
  }
  return reachable;
}

// Enforce one tool call. Returns either:
//   { decision: "allow", params }           — caller forwards the call
//   { decision: "block", reason, retry }    — caller returns block: true
export function enforce(graph, state, toolName, params) {
  const currentNode = graph._byId.get(state.currentNode);
  if (!currentNode) {
    return {
      decision: "block",
      reason: `WORKFLOW CORRUPTED: current node '${state.currentNode}' missing from graph. This is a bug — report it.`,
      retry: 0,
    };
  }

  // 1. Is this tool allowed in the current node? (Stay)
  if (currentNode.allowed_tools.includes(toolName)) {
    state.reconsiderCounter = 0;
    return { decision: "allow", params };
  }

  // 2. Is there a reachable destination (transitively, through empty-tools
  //    transit nodes) where this tool IS allowed?
  const destination = findReachableViaEmptyTransits(graph, state.currentNode, toolName);
  if (destination) {
    state.currentNode = destination;
    state.reconsiderCounter = 0;
    return { decision: "allow", params };
  }

  // 3. Deviation. Build a maximally helpful error text — list ALL
  //    transit-reachable destinations, not just immediate successors,
  //    so the agent sees its full move options.
  state.reconsiderCounter += 1;
  const allowedHere = currentNode.allowed_tools.join(", ") || "(none)";
  const reachable = summarizeReachableDestinations(graph, state.currentNode);
  const reachableSummary = reachable.length > 0
    ? reachable.map(({ id, tools }) => `${id} [${tools.join(", ")}]`).join("; ")
    : "(none)";

  const reason =
    `DEVIATION: tool '${toolName}' is not allowed in node '${currentNode.id}' ` +
    `(${currentNode.purpose}). Allowed tools in this node: [${allowedHere}]. ` +
    `Reachable next nodes (transitively through empty-tools nodes) and their tools: [${reachableSummary}]. ` +
    `Pick one of those tools and try again.`;

  if (state.reconsiderCounter > graph.max_reconsider_retries) {
    return {
      decision: "block",
      reason:
        `WORKFLOW TERMINATED: exceeded reconsider budget (${graph.max_reconsider_retries}) ` +
        `at node '${currentNode.id}'. Last attempt: ${toolName}. ` +
        `Stop trying; no valid move exists from here.`,
      retry: state.reconsiderCounter,
    };
  }

  return { decision: "block", reason, retry: state.reconsiderCounter };
}

export function freshState(graph) {
  return {
    currentNode: graph.entry,
    reconsiderCounter: 0,
  };
}

// Path resolvers ignore the legacy `pluginRoot` argument and return paths
// under BETTERCLAW_HOME instead. The argument is preserved for call-site
// backward compatibility (older callers still pass it; we just ignore it).
export function resolveDefaultGraphPath(_pluginRoot) {
  return path.join(BETTERCLAW_HOME, "active-graph.json");
}

export function resolveDefaultRunLogPath(_pluginRoot) {
  return path.join(BETTERCLAW_HOME, "run.jsonl");
}

export function resolveApprovalsDir(_pluginRoot) {
  return path.join(BETTERCLAW_HOME, "approvals");
}

// Global cancellation signal — set when the plugin VM is shutting down so
// in-flight approval waits can abort cleanly instead of dangling.
let shutdownRequested = false;
function triggerShutdown() { shutdownRequested = true; }
process.once("SIGTERM", triggerShutdown);
process.once("SIGINT", triggerShutdown);

// Block until the approval file appears. Polls every 200ms. Returns
// "approved" | "denied" | "timeout" | "cancelled".
//   timeoutMs=0 → wait forever (until shutdown).
export async function waitForApproval(approvalsDir, id, timeoutMs = 0) {
  const approved = path.join(approvalsDir, `${id}.approved`);
  const denied = path.join(approvalsDir, `${id}.denied`);
  const start = Date.now();
  for (;;) {
    if (shutdownRequested) return "cancelled";
    if (fs.existsSync(approved)) return "approved";
    if (fs.existsSync(denied)) return "denied";
    if (timeoutMs > 0 && Date.now() - start >= timeoutMs) return "timeout";
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Single-run log writer. Truncates on construction (each plugin VM is a fresh
// turn, so "the log" is always "this agent turn").
export function createRunLogger(logPath) {
  try {
    fs.writeFileSync(logPath, ""); // truncate
  } catch (err) {
    // If we can't write, events just won't persist. Not fatal.
    return { append: () => {} };
  }

  return {
    append(event) {
      try {
        fs.appendFileSync(logPath, JSON.stringify(event) + "\n");
      } catch {
        // best-effort; don't crash the agent over a log-write error
      }
    },
  };
}
