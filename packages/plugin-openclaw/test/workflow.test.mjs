// Tests for the workflow-graph state machine — paths not exercised by the
// enforcement.test.mjs suite. Covers graph corruption, loadGraph
// determinism, waitForApproval polling, and createRunLogger truncation.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadGraph,
  enforce,
  freshState,
  waitForApproval,
  createRunLogger,
} from "../workflow.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-wf-"));
}

function writeGraph(graph) {
  const dir = tmpDir();
  const file = path.join(dir, "graph.json");
  fs.writeFileSync(file, JSON.stringify(graph));
  return file;
}

test("enforce: corrupted state (currentNode missing from graph) returns block", () => {
  const file = writeGraph({
    entry: "A",
    nodes: [{ id: "A", purpose: "x", allowed_tools: ["read"] }],
    edges: [],
  });
  const graph = loadGraph(file);
  const state = { currentNode: "GHOST", reconsiderCounter: 0 };

  const result = enforce(graph, state, "read", {});
  assert.equal(result.decision, "block");
  assert.match(result.reason, /WORKFLOW CORRUPTED/);
});

test("loadGraph: edges sorted lexicographically for deterministic tie-breaking", () => {
  // Insert edges out of order; loadGraph must sort by (from, to) so the BFS
  // tie-breaking is reproducible across runs.
  const file = writeGraph({
    entry: "A",
    nodes: [
      { id: "A", purpose: "x", allowed_tools: [] },
      { id: "B", purpose: "x", allowed_tools: [] },
      { id: "C", purpose: "x", allowed_tools: [] },
    ],
    edges: [
      { from: "A", to: "C" },
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ],
  });
  const graph = loadGraph(file);
  // After sort: A->B, A->C, B->C
  assert.deepEqual(
    graph.edges.map((e) => `${e.from}->${e.to}`),
    ["A->B", "A->C", "B->C"],
  );
});

test("loadGraph: max_reconsider_retries defaults to 3 when absent", () => {
  const file = writeGraph({
    entry: "A",
    nodes: [{ id: "A", purpose: "x", allowed_tools: ["t"] }],
    edges: [],
  });
  const graph = loadGraph(file);
  assert.equal(graph.max_reconsider_retries, 3);
});

test("loadGraph: respects an explicit max_reconsider_retries", () => {
  const file = writeGraph({
    entry: "A",
    nodes: [{ id: "A", purpose: "x", allowed_tools: ["t"] }],
    edges: [],
    max_reconsider_retries: 7,
  });
  const graph = loadGraph(file);
  assert.equal(graph.max_reconsider_retries, 7);
});

test("freshState: initializes to graph.entry with zero reconsiders", () => {
  const file = writeGraph({
    entry: "X",
    nodes: [{ id: "X", purpose: "x", allowed_tools: [] }],
    edges: [],
  });
  const state = freshState(loadGraph(file));
  assert.deepEqual(state, { currentNode: "X", reconsiderCounter: 0 });
});

test("waitForApproval: returns 'approved' when the .approved sentinel appears", async () => {
  const dir = tmpDir();
  const id = "abc12345";

  // Drop the sentinel slightly after we start polling so we exercise the
  // wait path, not the immediate-find path.
  setTimeout(() => fs.writeFileSync(path.join(dir, `${id}.approved`), ""), 50);
  const decision = await waitForApproval(dir, id, 2000);
  assert.equal(decision, "approved");
});

test("waitForApproval: returns 'denied' when the .denied sentinel appears", async () => {
  const dir = tmpDir();
  const id = "deadbeef";
  setTimeout(() => fs.writeFileSync(path.join(dir, `${id}.denied`), ""), 50);
  const decision = await waitForApproval(dir, id, 2000);
  assert.equal(decision, "denied");
});

test("waitForApproval: returns 'timeout' when neither sentinel appears", async () => {
  const dir = tmpDir();
  const decision = await waitForApproval(dir, "never", 300);
  assert.equal(decision, "timeout");
});

test("createRunLogger: truncates the log on construction", () => {
  const dir = tmpDir();
  const file = path.join(dir, "run.jsonl");
  fs.writeFileSync(file, '{"old":"data"}\n{"more":"old"}\n');
  assert.ok(fs.statSync(file).size > 0);

  createRunLogger(file);
  assert.equal(fs.readFileSync(file, "utf8"), "");
});

test("createRunLogger: append writes valid JSON lines, one per call", () => {
  const dir = tmpDir();
  const file = path.join(dir, "run.jsonl");
  const logger = createRunLogger(file);
  logger.append({ type: "allow", tool: "read" });
  logger.append({ type: "deviation", tool: "delete" });

  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { type: "allow", tool: "read" });
  assert.deepEqual(JSON.parse(lines[1]), { type: "deviation", tool: "delete" });
});
