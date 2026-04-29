// Regression tests for the recent-approvals preamble that bit us during the
// Railway demo recording — Apollo entries from a previous demo leaked into
// the prompt panel of every fresh take. Confirms the cutoff, the entry
// limit, malformed-line tolerance, and the empty-input fallthrough.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readRecentHistory,
  formatHistoryForAgent,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_AGE_HOURS,
} from "../history.mjs";

function tmpHistoryFile(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-hist-"));
  const file = path.join(dir, "history.jsonl");
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

function isoHoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

test("readRecentHistory: missing file -> empty array", () => {
  assert.deepEqual(readRecentHistory("/nonexistent/path/history.jsonl"), []);
});

test("readRecentHistory: empty file -> empty array", () => {
  const file = tmpHistoryFile([""]);
  assert.deepEqual(readRecentHistory(file), []);
});

test("readRecentHistory: filters out entries older than HISTORY_MAX_AGE_HOURS", () => {
  // 1h ago should stay, 25h ago should be dropped (HISTORY_MAX_AGE_HOURS=24).
  const fresh = { ts: isoHoursAgo(1), tool: "fresh", status: "success" };
  const stale = { ts: isoHoursAgo(HISTORY_MAX_AGE_HOURS + 1), tool: "stale", status: "success" };
  const file = tmpHistoryFile([JSON.stringify(stale), JSON.stringify(fresh)]);

  const events = readRecentHistory(file);
  assert.equal(events.length, 1);
  assert.equal(events[0].tool, "fresh");
});

test("readRecentHistory: malformed JSON line is skipped, doesn't crash", () => {
  const good = { ts: isoHoursAgo(1), tool: "good", status: "success" };
  const file = tmpHistoryFile([
    "not json {{{",
    JSON.stringify(good),
    "}}}also broken",
  ]);

  const events = readRecentHistory(file);
  assert.equal(events.length, 1);
  assert.equal(events[0].tool, "good");
});

test("readRecentHistory: caps at HISTORY_MAX_ENTRIES, returns the most recent", () => {
  // Generate 2x the cap, all within the time window.
  const lines = [];
  for (let i = 0; i < HISTORY_MAX_ENTRIES * 2; i++) {
    lines.push(JSON.stringify({
      ts: isoHoursAgo(1),
      tool: `tool_${i}`,
      status: "success",
    }));
  }
  const file = tmpHistoryFile(lines);

  const events = readRecentHistory(file);
  assert.equal(events.length, HISTORY_MAX_ENTRIES);
  // slice(-HISTORY_MAX_ENTRIES) — should keep the LAST N, which are the
  // newest in append-order.
  assert.equal(events[0].tool, `tool_${HISTORY_MAX_ENTRIES}`);
  assert.equal(events.at(-1).tool, `tool_${HISTORY_MAX_ENTRIES * 2 - 1}`);
});

test("formatHistoryForAgent: empty events returns null", () => {
  assert.equal(formatHistoryForAgent([]), null);
});

test("formatHistoryForAgent: APPROVED success label + result_summary detail", () => {
  const out = formatHistoryForAgent([
    {
      ts: "2026-04-29T12:34:56Z",
      tool: "gmail_send",
      status: "success",
      result_summary: "draft saved",
    },
  ]);
  assert.match(out, /Recent approvals/);
  assert.match(out, /gmail_send/);
  assert.match(out, /APPROVED · success/);
  assert.match(out, /draft saved/);
});

test("formatHistoryForAgent: DENIED label for not_dispatched", () => {
  const out = formatHistoryForAgent([
    { ts: "2026-04-29T00:00:00Z", tool: "delete_volume", status: "not_dispatched" },
  ]);
  assert.match(out, /DENIED/);
  assert.match(out, /delete_volume/);
});

test("formatHistoryForAgent: error status surfaces backend error string", () => {
  const out = formatHistoryForAgent([
    { ts: "2026-04-29T00:00:00Z", tool: "x", status: "error", error: "rate-limited" },
  ]);
  assert.match(out, /APPROVED · backend error/);
  assert.match(out, /error: rate-limited/);
});
