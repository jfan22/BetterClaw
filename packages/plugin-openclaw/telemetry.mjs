// Minimal plugin-side telemetry writer. Mirrors the CLI's emitTelemetry so the
// plugin can fire events without IPC or a cross-package import. Both sides
// write to the same ~/.betterclaw/telemetry.jsonl file; they coordinate via
// append-only O_APPEND semantics (atomic line writes up to PIPE_BUF on Linux).
//
// No PII is ever written. The keys allowed in `properties` are enforced by
// convention (no paragraph content, no email body/subject/to/from, no graph
// JSON). Reviewers: grep this file + every call site for PII leaks before
// shipping any new event.
//
// Opt-out resolution order (first match wins):
//   1. BETTERCLAW_TELEMETRY=off env var
//   2. ~/.betterclaw/telemetry.json with { "enabled": false }
//   3. default: enabled
//
// If the identity file doesn't exist, we DO NOT create one from here. The CLI
// creates it on first `betterclaw start` / `betterclaw <paragraph>`. If a user
// somehow runs the plugin before ever running the CLI (unusual), events fire
// with device_id="unknown" — the CLI will fix itself on next invocation.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IDENTITY_PATH = path.join(os.homedir(), ".betterclaw", "identity.json");
const CONFIG_PATH = path.join(os.homedir(), ".betterclaw", "telemetry.json");
const LOG_PATH = path.join(os.homedir(), ".betterclaw", "telemetry.jsonl");
const PLUGIN_VERSION = "0.3.17";

let _cachedIdentity = null;
let _cachedConfig = null;
let _configCheckedMs = 0;
const CONFIG_TTL_MS = 60 * 1000; // re-read config every minute

function loadIdentity() {
  if (_cachedIdentity) return _cachedIdentity;
  try {
    _cachedIdentity = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
  } catch {
    _cachedIdentity = { device_id: "unknown" };
  }
  return _cachedIdentity;
}

function loadConfig() {
  const now = Date.now();
  if (_cachedConfig && now - _configCheckedMs < CONFIG_TTL_MS) {
    return _cachedConfig;
  }
  _configCheckedMs = now;
  if (process.env.BETTERCLAW_TELEMETRY === "off") {
    _cachedConfig = { enabled: false };
    return _cachedConfig;
  }
  if (process.env.BETTERCLAW_TELEMETRY === "on") {
    _cachedConfig = { enabled: true };
    return _cachedConfig;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    _cachedConfig = { enabled: cfg.enabled !== false };
  } catch {
    _cachedConfig = { enabled: true };
  }
  return _cachedConfig;
}

/**
 * Fire-and-forget telemetry write. Never throws. If disabled or filesystem
 * write fails for any reason, silently no-ops.
 *
 * @param {string} event One of the documented plugin events: "auto_allow",
 *   "deviation_blocked". See docs/telemetry-schema.md (when we write it).
 * @param {object} properties Event-specific, must not contain PII. Allowed
 *   keys: vertical, tool_name, attempted_tool, block_reason, node_id.
 */
export function emitPluginTelemetry(event, properties = {}) {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const id = loadIdentity();
  const row = {
    ts: new Date().toISOString(),
    device_id: id.device_id,
    source: "plugin",
    version: PLUGIN_VERSION,
    event,
    properties: properties || {},
  };
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
  } catch {
    // Telemetry must never break enforcement. Swallow.
  }
}
