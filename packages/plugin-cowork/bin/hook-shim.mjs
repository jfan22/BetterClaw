#!/usr/bin/env node
// BetterClaw Cowork plugin hook shim — cross-platform Node version.
//
// Cowork's plugin runtime fires this with a hook-event name as the first arg
// and the event JSON piped to stdin. The shim spawns `betterclaw hook <event>`,
// which does the actual enforcement + approval queueing, then writes the
// response JSON to stdout.
//
// Why Node and not bash: bash hook shims work on Linux/macOS but fail on
// Windows outside Git Bash. Node is required for BetterClaw to work at all
// (the CLI is Node) so it's universally available, and Node's spawn handles
// platform differences correctly via shell:true on Windows.

import { spawn } from "node:child_process";

const event = process.argv[2];

if (!event) {
  process.stderr.write("[betterclaw-cowork] missing hook event argument\n");
  process.stdout.write("{}\n");
  process.exit(0);
}

// On Windows, betterclaw is installed as a `.cmd` shim by npm, which Node's
// spawn can't invoke without shell:true. The flag is safe here because the
// only argument is a known hook-event name (not user-supplied content), so no
// shell-injection risk.
const isWindows = process.platform === "win32";

const child = spawn("betterclaw", ["hook", event], {
  stdio: ["inherit", "inherit", "inherit"],
  shell: isWindows,
});

child.on("error", (err) => {
  if (err.code === "ENOENT") {
    process.stderr.write(
      "[betterclaw-cowork] `betterclaw` CLI not on PATH.\n" +
      "[betterclaw-cowork] Install: npm install -g @betterclaw-ai/cli\n",
    );
    // Allow by default so the user isn't blocked from using Cowork entirely
    // — they'll see this stderr in Claude Desktop's plugin logs and can fix.
    process.stdout.write("{}\n");
    process.exit(0);
  }
  process.stderr.write(`[betterclaw-cowork] hook spawn failed: ${err.message}\n`);
  process.stdout.write("{}\n");
  process.exit(0);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
