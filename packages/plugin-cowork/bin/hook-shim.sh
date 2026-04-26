#!/usr/bin/env bash
# BetterClaw Cowork plugin hook shim.
#
# Cowork's plugin runtime fires this script with a hook-event name as the first
# argument and the event JSON piped to stdin. The shim execs the BetterClaw CLI
# (`betterclaw hook <event>`), which does the actual enforcement + approval
# queueing, then writes the response JSON to stdout.
#
# Why a shim at all: Cowork's hook manifest (hooks/hooks.json) takes a shell
# command, not a Node module. The shim is a 1-line exec that keeps the manifest
# simple and lets `betterclaw` be installed however the user prefers (npm global,
# local ln -sf, pnpm, etc.) — we just require it on PATH.
#
# Failure mode: if `betterclaw` isn't on PATH, Claude Desktop shows the stderr
# line as a plugin error. The user fixes their PATH and retries. No silent fail.

set -eu

event="${1:-}"
if [ -z "$event" ]; then
  echo "[betterclaw-cowork] missing hook event argument" >&2
  echo "{}"
  exit 0
fi

if ! command -v betterclaw > /dev/null 2>&1; then
  echo "[betterclaw-cowork] \`betterclaw\` CLI not on PATH." >&2
  echo "[betterclaw-cowork] Install: \`npm install -g @betterclaw-ai/cli\` or symlink from your BetterClaw repo." >&2
  # Allow by default so the user isn't blocked from using Cowork entirely.
  echo "{}"
  exit 0
fi

exec betterclaw hook "$event"
