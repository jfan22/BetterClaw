// End-to-end tests that spawn the actual `betterclaw` bin as a subprocess.
// Catches the things unit tests can't: missing files in the npm tarball,
// ESM/shebang regressions, broken arg parsing, Windows path bugs, the
// bin -> lib wiring in subcommands like `reset`.
//
// All tests redirect state via BETTERCLAW_HOME=<tmpdir> so they NEVER touch
// the developer's real ~/.betterclaw. Spawn as `node <bin>` (not `./bin`)
// because Windows can't directly exec shebang lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const BIN = path.resolve(path.dirname(__filename), "..", "bin", "betterclaw");

// Strip ANSI color escapes so substring assertions don't break when the
// CLI uses chalk-style coloring.
const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*m/g, "");

function runCli(args, { home } = {}) {
  const tmpHome = home ?? fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-"));
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, BETTERCLAW_HOME: tmpHome, NO_COLOR: "1" },
  });
  return {
    stdout: stripAnsi(result.stdout || ""),
    stderr: stripAnsi(result.stderr || ""),
    code: result.status,
    home: tmpHome,
  };
}

test("--version: exits 0 and prints a semver", () => {
  const { stdout, code } = runCli(["--version"]);
  assert.equal(code, 0);
  assert.match(stdout, /betterclaw/);
  assert.match(stdout, /\d+\.\d+\.\d+/);
});

test("--help: exits 0 and lists the documented subcommands", () => {
  const { stdout, code } = runCli(["--help"]);
  assert.equal(code, 0);
  // A handful of must-document subcommands. If we rename one, this test is
  // the canary that flags every help-text site we forgot to update.
  for (const sub of ["reset", "doctor", "view", "telemetry", "tools"]) {
    assert.match(stdout, new RegExp(`betterclaw ${sub}\\b`), `help is missing "${sub}"`);
  }
});

test("no args: prints help and exits 0 (same as --help)", () => {
  const { stdout, code } = runCli([]);
  assert.equal(code, 0);
  assert.match(stdout, /BetterClaw/);
  assert.match(stdout, /betterclaw reset\b/);
});

test("--show with no active graph: exits 1 with a clear message", () => {
  const { stdout, code, home } = runCli(["--show"]);
  assert.equal(code, 1);
  assert.match(stdout, /No graph at/);
  assert.ok(stdout.includes(home), "error message should reference the BETTERCLAW_HOME path");
});

test("reset: wipes per-run state, keeps identity/library/tool-cache", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-reset-"));
  // Pre-populate the state dir with a representative mix of files: some
  // wipeable (run.jsonl, graph, history, approvals/*), some preserved
  // (identity, library, tool-cache).
  fs.writeFileSync(path.join(home, "run.jsonl"), '{"type":"allow"}\n');
  fs.writeFileSync(path.join(home, "active-graph.json"), "{}");
  fs.writeFileSync(path.join(home, "history.jsonl"), '{"tool":"x"}\n');
  fs.writeFileSync(path.join(home, "tool-cache.json"), '{"tools":[]}');
  fs.writeFileSync(path.join(home, "identity.json"), '{"device_id":"abc"}');
  fs.mkdirSync(path.join(home, "library"));
  fs.writeFileSync(path.join(home, "library", "saved.json"), "{}");
  fs.mkdirSync(path.join(home, "approvals"));
  fs.writeFileSync(path.join(home, "approvals", "abc12345.pending"), "");

  const { stdout, code } = runCli(["reset"], { home });
  assert.equal(code, 0);
  assert.match(stdout, /Wiped/);

  // Wipeable: gone.
  assert.equal(fs.existsSync(path.join(home, "run.jsonl")), false);
  assert.equal(fs.existsSync(path.join(home, "active-graph.json")), false);
  assert.equal(fs.existsSync(path.join(home, "history.jsonl")), false);
  assert.equal(fs.existsSync(path.join(home, "approvals", "abc12345.pending")), false);

  // Preserved: still there.
  assert.equal(fs.existsSync(path.join(home, "identity.json")), true);
  assert.equal(fs.existsSync(path.join(home, "library", "saved.json")), true);
  // tool-cache preserved by default (--all needed to clear).
  assert.equal(fs.existsSync(path.join(home, "tool-cache.json")), true);
});

test("reset --all: also wipes tool-cache.json", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-reset-all-"));
  fs.writeFileSync(path.join(home, "tool-cache.json"), '{"tools":[]}');
  fs.writeFileSync(path.join(home, "identity.json"), '{"device_id":"abc"}');

  const { code } = runCli(["reset", "--all"], { home });
  assert.equal(code, 0);

  assert.equal(fs.existsSync(path.join(home, "tool-cache.json")), false);
  // identity still preserved even with --all.
  assert.equal(fs.existsSync(path.join(home, "identity.json")), true);
});

test("reset on a clean state dir: exits 0 with the 'nothing to wipe' message", () => {
  const { stdout, code } = runCli(["reset"]);
  assert.equal(code, 0);
  assert.match(stdout, /nothing to wipe/);
});
