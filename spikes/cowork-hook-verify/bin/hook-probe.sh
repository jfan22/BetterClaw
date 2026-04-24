#!/usr/bin/env bash
#
# hook-probe.sh — stub hook handler for Cowork SDK feasibility spike.
#
# Usage: invoked by Cowork/Claude Code plugin runtime with the hook event's
# JSON payload piped to stdin. First argument is a label identifying which
# hook slot fired (set in hooks/hooks.json).
#
# Behavior:
#   - Logs the event (timestamp, label, latency measurement, input JSON)
#     to ~/.betterclaw/spike-hook-verify.log
#   - Writes a hook output JSON to stdout that exercises different response
#     modes depending on the label, so we can verify each one works:
#       pre-tool-use-bash        → returns {} (allow)
#       pre-tool-use-write-deny  → returns permissionDecision:"deny"
#                                  (proves the plugin can block a tool)
#       pre-tool-use-all         → returns systemMessage for context inject
#                                  (proves systemMessage field lands in conversation)
#       user-prompt-submit       → returns systemMessage inject (proves
#                                  UserPromptSubmit fires every turn and
#                                  systemMessage lands on the model)
#       post-tool-use            → returns {} (just log)
#
# After running `claude --plugin-dir ./` and driving a few turns, read
# ~/.betterclaw/spike-hook-verify.log to see:
#   - WHICH hooks fired and in what order
#   - Timing (matters for Open Question 3: per-hook dispatch latency)
#   - Whether PreToolUse/UserPromptSubmit/PostToolUse all fire for plugin
#     shell-command hooks (not just for SDK callbacks)
#
# To stress-test the defer primitive (Open Question 1), temporarily change
# pre-tool-use-write-deny to emit permissionDecision:"defer" and see if the
# plugin runtime accepts it.

set -u  # no -e on purpose: any failure here must not block the agent

LABEL="${1:-unknown}"
LOG="${HOME}/.betterclaw/spike-hook-verify.log"
mkdir -p "$(dirname "$LOG")"

START_NS=$(date +%s%N 2>/dev/null || date +%s000000000)
INPUT="$(cat)"

# Log the event with a separator + timestamp + label + input
{
  echo "---"
  echo "ts=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  echo "label=${LABEL}"
  echo "input=${INPUT}"
} >> "$LOG" 2>/dev/null || true

# Emit the right response for each label
case "$LABEL" in
  pre-tool-use-write-deny)
    # Prove the plugin can block a tool call. Writes + Edits to any path
    # should be blocked with a user-visible reason.
    cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BetterClaw spike: Write/Edit blocked to verify plugin hook can enforce policy."
  }
}
JSON
    ;;

  pre-tool-use-all)
    # Prove systemMessage from a PreToolUse hook lands in the conversation
    # and is visible to the model on the next turn.
    cat <<'JSON'
{
  "systemMessage": "[BetterClaw spike] PreToolUse-all fired. If you are reading this, the plugin can prepend context to agent turns."
}
JSON
    ;;

  user-prompt-submit)
    # Prove UserPromptSubmit fires on user turns and systemMessage is
    # delivered. This is the mechanism BetterClaw uses for cross-turn
    # approval-history surfacing.
    cat <<'JSON'
{
  "systemMessage": "[BetterClaw spike] UserPromptSubmit fired. Recent approvals would be injected here in the real plugin."
}
JSON
    ;;

  *)
    # Default: allow, no mutation, no side effect on the conversation.
    echo '{}'
    ;;
esac

# Append latency measurement to the log (after stdout is flushed; non-blocking).
END_NS=$(date +%s%N 2>/dev/null || date +%s000000000)
DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))
echo "duration_ms=${DURATION_MS}" >> "$LOG" 2>/dev/null || true
