// Tests for the telemetry writer's user-facing contract:
//   1. opt-out via env var actually suppresses writes (the most-load-bearing
//      privacy guarantee — we tell users they can disable telemetry; if
//      the writer fires anyway we've broken trust)
//   2. opt-out via config file works the same way
//   3. emitted rows have the documented envelope shape
//   4. missing identity.json -> device_id falls back to "unknown" (no crash)
//
// We redirect telemetry's view of $HOME to a tmpdir so the writer reads/writes
// under it instead of the user's real ~/.betterclaw, then call
// _resetTelemetryCachesForTesting() between cases so cached config doesn't
// leak between tests.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emitPluginTelemetry,
  _resetTelemetryCachesForTesting,
} from "../telemetry.mjs";

let tmpHome;
let originalHome;
let originalUserProfile;
let originalTelemetryEnv;

// os.homedir() reads $HOME on POSIX and $USERPROFILE on Windows. Override
// both so this test redirects telemetry to a tmpdir on every platform.
beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-tel-"));
  fs.mkdirSync(path.join(tmpHome, ".betterclaw"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  originalTelemetryEnv = process.env.BETTERCLAW_TELEMETRY;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.BETTERCLAW_TELEMETRY;
  _resetTelemetryCachesForTesting();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalTelemetryEnv === undefined) delete process.env.BETTERCLAW_TELEMETRY;
  else process.env.BETTERCLAW_TELEMETRY = originalTelemetryEnv;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  _resetTelemetryCachesForTesting();
});

const logPath = () => path.join(tmpHome, ".betterclaw", "telemetry.jsonl");

test("opt-out via BETTERCLAW_TELEMETRY=off suppresses the write", () => {
  process.env.BETTERCLAW_TELEMETRY = "off";
  _resetTelemetryCachesForTesting();
  emitPluginTelemetry("auto_allow", { tool_name: "x" });
  assert.equal(fs.existsSync(logPath()), false, "log file must not be created");
});

test("opt-out via telemetry.json { enabled: false } suppresses the write", () => {
  fs.writeFileSync(
    path.join(tmpHome, ".betterclaw", "telemetry.json"),
    JSON.stringify({ enabled: false }),
  );
  _resetTelemetryCachesForTesting();
  emitPluginTelemetry("auto_allow", { tool_name: "x" });
  assert.equal(fs.existsSync(logPath()), false);
});

test("env var BETTERCLAW_TELEMETRY=on overrides config file disabled", () => {
  fs.writeFileSync(
    path.join(tmpHome, ".betterclaw", "telemetry.json"),
    JSON.stringify({ enabled: false }),
  );
  process.env.BETTERCLAW_TELEMETRY = "on";
  _resetTelemetryCachesForTesting();
  emitPluginTelemetry("auto_allow", { tool_name: "x" });
  assert.ok(fs.existsSync(logPath()), "env var 'on' should override config 'off'");
});

test("default (no opt-out) writes a JSON-line row with the documented envelope", () => {
  fs.writeFileSync(
    path.join(tmpHome, ".betterclaw", "identity.json"),
    JSON.stringify({ device_id: "test-device-abc" }),
  );
  _resetTelemetryCachesForTesting();
  emitPluginTelemetry("deviation_blocked", {
    attempted_tool: "delete",
    node_id: "report",
  });

  const contents = fs.readFileSync(logPath(), "utf8").trim();
  assert.equal(contents.split("\n").length, 1);
  const row = JSON.parse(contents);
  assert.equal(row.event, "deviation_blocked");
  assert.equal(row.source, "plugin");
  assert.equal(row.device_id, "test-device-abc");
  assert.match(row.version, /^\d+\.\d+\.\d+$/);
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.deepEqual(row.properties, {
    attempted_tool: "delete",
    node_id: "report",
  });
});

test("missing identity.json -> device_id falls back to 'unknown' (no crash)", () => {
  // Don't write identity.json. The writer must still emit, with device_id="unknown".
  _resetTelemetryCachesForTesting();
  emitPluginTelemetry("auto_allow", { tool_name: "x" });

  const row = JSON.parse(fs.readFileSync(logPath(), "utf8").trim());
  assert.equal(row.device_id, "unknown");
});

test("never throws — telemetry must not break enforcement", () => {
  // Point the log at an unwritable directory shape (a path that's a file,
  // not a dir) and verify the writer swallows the error.
  const fakeLog = path.join(tmpHome, ".betterclaw", "telemetry.jsonl");
  fs.mkdirSync(fakeLog); // a directory where a file is expected -> appendFileSync EISDIR
  _resetTelemetryCachesForTesting();
  assert.doesNotThrow(() =>
    emitPluginTelemetry("auto_allow", { tool_name: "x" }),
  );
});
