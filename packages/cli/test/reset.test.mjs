// Tests for the runReset extracted from `betterclaw reset`. Confirms what
// gets wiped vs preserved so we never accidentally regress and blow away
// identity.json (telemetry opt-out) or library/ (saved graphs) — those
// are the things that, if reset destroys them, the user notices and is
// rightfully upset.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReset } from "../lib/reset.mjs";

function makeTmpState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-reset-"));
  const paths = {
    runLog: path.join(dir, "run.jsonl"),
    graph: path.join(dir, "active-graph.json"),
    paragraph: path.join(dir, "active-paragraph.md"),
    coworkSessions: path.join(dir, "cowork-sessions.json"),
    history: path.join(dir, "history.jsonl"),
    approvalsDir: path.join(dir, "approvals"),
    toolCache: path.join(dir, "tool-cache.json"),
  };

  // Wipeable state.
  fs.writeFileSync(paths.runLog, '{"type":"allow"}\n');
  fs.writeFileSync(paths.graph, "{}");
  fs.writeFileSync(paths.paragraph, "diagnose...");
  fs.writeFileSync(paths.coworkSessions, "{}");
  fs.writeFileSync(paths.history, '{"tool":"x"}\n');
  fs.mkdirSync(paths.approvalsDir);
  fs.writeFileSync(path.join(paths.approvalsDir, "abc12345.pending"), "");
  fs.writeFileSync(path.join(paths.approvalsDir, "def67890.approved"), "");
  fs.writeFileSync(path.join(paths.approvalsDir, "old11111.denied"), "");
  // Junk file in approvals/ that does NOT match the sentinel pattern; must be preserved.
  fs.writeFileSync(path.join(paths.approvalsDir, "README.md"), "do not delete me");
  fs.writeFileSync(paths.toolCache, '{"tools":[]}');

  // Things reset must NEVER touch.
  fs.writeFileSync(path.join(dir, "identity.json"), '{"device_id":"x"}');
  fs.writeFileSync(path.join(dir, "telemetry.json"), '{"enabled":false}');
  fs.writeFileSync(path.join(dir, "telemetry.jsonl"), '{"event":"x"}\n');
  fs.mkdirSync(path.join(dir, "library"));
  fs.writeFileSync(path.join(dir, "library", "saved.json"), "{}");

  return { dir, paths };
}

test("default reset: wipes per-run state, keeps tool-cache + identity + library", () => {
  const { dir, paths } = makeTmpState();

  const result = runReset({ paths, all: false });

  // Wipeable files removed.
  assert.equal(fs.existsSync(paths.runLog), false);
  assert.equal(fs.existsSync(paths.graph), false);
  assert.equal(fs.existsSync(paths.paragraph), false);
  assert.equal(fs.existsSync(paths.coworkSessions), false);
  assert.equal(fs.existsSync(paths.history), false);

  // Approval sentinels removed.
  assert.equal(fs.existsSync(path.join(paths.approvalsDir, "abc12345.pending")), false);
  assert.equal(fs.existsSync(path.join(paths.approvalsDir, "def67890.approved")), false);
  assert.equal(fs.existsSync(path.join(paths.approvalsDir, "old11111.denied")), false);
  // Non-sentinel files in approvals/ preserved.
  assert.equal(
    fs.readFileSync(path.join(paths.approvalsDir, "README.md"), "utf8"),
    "do not delete me",
  );

  // Tool cache preserved (fast next-compile is the whole point).
  assert.equal(fs.existsSync(paths.toolCache), true);
  assert.equal(result.keptToolCache, paths.toolCache);

  // Things reset must never blow away — these are the bug-class to guard.
  assert.equal(fs.existsSync(path.join(dir, "identity.json")), true);
  assert.equal(fs.existsSync(path.join(dir, "telemetry.json")), true);
  assert.equal(fs.existsSync(path.join(dir, "telemetry.jsonl")), true);
  assert.equal(fs.existsSync(path.join(dir, "library", "saved.json")), true);
});

test("reset --all: also wipes tool-cache.json", () => {
  const { paths } = makeTmpState();

  const result = runReset({ paths, all: true });

  assert.equal(fs.existsSync(paths.toolCache), false);
  assert.equal(result.keptToolCache, null);
});

test("reset on a clean state directory: nothing wiped, no errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-reset-empty-"));
  const paths = {
    runLog: path.join(dir, "run.jsonl"),
    graph: path.join(dir, "active-graph.json"),
    paragraph: path.join(dir, "active-paragraph.md"),
    coworkSessions: path.join(dir, "cowork-sessions.json"),
    history: path.join(dir, "history.jsonl"),
    approvalsDir: path.join(dir, "approvals"),
    toolCache: path.join(dir, "tool-cache.json"),
  };

  const result = runReset({ paths, all: false });
  assert.deepEqual(result.wiped, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.keptToolCache, null);
});

test("reset reports each wiped path in the wiped[] array", () => {
  const { paths } = makeTmpState();

  const result = runReset({ paths, all: true });

  assert.ok(result.wiped.includes(paths.runLog));
  assert.ok(result.wiped.includes(paths.graph));
  assert.ok(result.wiped.includes(paths.history));
  assert.ok(result.wiped.includes(paths.toolCache));
  // Approval sentinels by full path.
  assert.ok(result.wiped.some((p) => p.endsWith("abc12345.pending")));
});

test("reset: missing approvalsDir is fine, no crash", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-reset-no-app-"));
  const paths = {
    runLog: path.join(dir, "run.jsonl"),
    graph: path.join(dir, "active-graph.json"),
    paragraph: path.join(dir, "active-paragraph.md"),
    coworkSessions: path.join(dir, "cowork-sessions.json"),
    history: path.join(dir, "history.jsonl"),
    approvalsDir: path.join(dir, "approvals"), // never created
    toolCache: path.join(dir, "tool-cache.json"),
  };
  fs.writeFileSync(paths.runLog, "x");

  assert.doesNotThrow(() => runReset({ paths, all: false }));
});
