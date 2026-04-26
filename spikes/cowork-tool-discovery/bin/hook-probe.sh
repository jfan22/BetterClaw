#!/usr/bin/env bash
#
# hook-probe.sh — Phase 0 spike probe for v0.3 architecture verification.
#
# Goal: empirically determine
#   (A) what tool-name string Claude passes to the matcher when calling
#       Anthropic connectors (Gmail, Calendar, Drive, Apollo, etc.),
#   (B) which matcher patterns successfully catch those calls,
#   (C) whether the hook input JSON or environment variables contain
#       any surface for enumerating ALL available tools (not just the
#       one being called right now).
#
# Behavior on each fire:
#   - Logs: timestamp, label, env vars (filtered for CLAUDE_/MCP_/TOOL_/
#     PLUGIN_), the full hook input JSON, and any obvious context files
#   - Always returns {} (allow). Spike is read-only; never blocks tools.
#   - Records duration_ms.

set -u

LABEL="${1:-unknown}"
LOG="${HOME}/.betterclaw/spike-tool-discovery.log"
mkdir -p "$(dirname "$LOG")"

START_NS=$(date +%s%N 2>/dev/null || date +%s000000000)
INPUT="$(cat)"

{
  echo "==============================="
  echo "ts=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  echo "label=${LABEL}"
  echo "--- env (filtered) ---"
  env | grep -E '^(CLAUDE|MCP|TOOL|PLUGIN|ANTHROPIC|COWORK)' | sort || true
  echo "--- pwd ---"
  pwd
  echo "--- plugin dir contents (if visible) ---"
  ls -la "${CLAUDE_PLUGIN_ROOT:-/dev/null}" 2>/dev/null || echo "no CLAUDE_PLUGIN_ROOT"
  echo "--- input json ---"
  echo "${INPUT}"
} >> "$LOG" 2>/dev/null || true

echo '{}'

END_NS=$(date +%s%N 2>/dev/null || date +%s000000000)
DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))
echo "duration_ms=${DURATION_MS}" >> "$LOG" 2>/dev/null || true
