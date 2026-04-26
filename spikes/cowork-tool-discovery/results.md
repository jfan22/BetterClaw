# Spike Results — Cowork Tool Discovery

**Run on:** 2026-04-26 by jfan
**Claude Code session:** bdea0734-50a3-4381-82d5-c71c46a5e6b8
**Connectors observed:** Google Calendar (used: `list_calendars`). Gmail/Apollo/Drive not exercised in this run; not needed for verdict.

## 1. Tool name format ✓

Observed exactly the hypothesized pattern.

| Connector | Tool name |
|---|---|
| Calendar | `mcp__claude_ai_Google_Calendar__list_calendars` |
| (others) | by inference: `mcp__claude_ai_<Service>__<action>` |

**Format hypothesis confirmed.** Regex matchers in `packages/plugin-cowork/hooks/hooks.json` can use the `mcp__claude_ai_.*` pattern as designed.

## 2. Matcher behavior ✓

For the Calendar `list_calendars` call at 12:37:33.087-088, ALL FOUR matchers fired:

| Call | pre-calendar | pre-anthropic-connector-any | pre-mcp-any | pre-catchall |
|---|---|---|---|---|
| `mcp__claude_ai_Google_Calendar__list_calendars` | ✓ | ✓ | ✓ | ✓ |
| `Bash` (ls) | | | | ✓ |

**Catch-all behavior:** Multiple matchers fire concurrently for the same call. The plugin runtime does NOT pick "most specific match only." This is good — it means BetterClaw can layer enforcement (e.g., service-specific approval policy + global audit hook) without interfering.

**Side effect:** concurrent matchers writing to the same log file produced interleaved output. Not an architectural problem; the production plugin will route all hooks through one audit writer with proper file locking (as `telemetry.mjs` already does via O_APPEND atomic semantics).

## 3. Hook input JSON — enumeration surface check

Sample input JSON from the Calendar `pre-catchall` fire:

```json
{
  "session_id": "bdea0734-50a3-4381-82d5-c71c46a5e6b8",
  "transcript_path": "/home/jfan/.claude/projects/-home-jfan-Prj-BetterClaw/bdea0734-50a3-4381-82d5-c71c46a5e6b8.jsonl",
  "cwd": "/home/jfan/Prj/BetterClaw",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "mcp__claude_ai_Google_Calendar__list_calendars",
  "tool_input": { ... },
  "tool_use_id": "toolu_..."
}
```

**Direct enumeration field in input JSON:** none. No `tools`, `available_tools`, `connectors`, `mcp_servers` field.

**STRETCH PASS — enumeration found via different mechanism:** the ToolSearch tool. Earlier in the same session, Claude itself called ToolSearch to load the Calendar schema:

```json
{"tool_name": "ToolSearch",
 "tool_input": {"query": "select:mcp__claude_ai_Google_Calendar__list_calendars", "max_results": 1}}
```

with response:

```json
{"matches": ["mcp__claude_ai_Google_Calendar__list_calendars"],
 "total_deferred_tools": 50}
```

This reveals the deferred-tool architecture: connector tools are exposed by NAME at session start (visible in Claude's system-reminder messages) but their schemas are loaded on-demand via `ToolSearch`. The `total_deferred_tools` field tells BetterClaw how many connector tools are available even before invocation.

**Implication:** BetterClaw's compile step can use ToolSearch to enumerate and fetch schemas for relevant tools. No bespoke "tool registry adapter" needed in the plugin.

## 4. Environment variables at hook fire time

```
CLAUDE_CODE_ENTRYPOINT=cli
CLAUDE_PLUGIN_DATA=/home/jfan/.claude/plugins/data/betterclaw-cowork-tool-discovery-spike-inline
CLAUDE_PLUGIN_ROOT=/home/jfan/Prj/BetterClaw/spikes/cowork-tool-discovery
CLAUDE_PROJECT_DIR=/home/jfan/Prj/BetterClaw
```

`CLAUDE_PLUGIN_DATA` is a per-plugin persistent data directory — useful for caching tool registry between sessions if we ever need that. `CLAUDE_PROJECT_DIR` is the user's project root, useful for project-specific graph storage.

## 5. Plugin directory visibility

Plugin can `ls` its own root via `${CLAUDE_PLUGIN_ROOT}`. No exposed parent-of-plugin or sibling-plugin context. Plugin context is appropriately sandboxed.

## 6. Latency

| Hook | duration_ms |
|---|---|
| UserPromptSubmit (3 fires) | 8, 8, 9 |
| pre-catchall (Bash ls) | 9 |
| post-tool-use (Bash) | 9 |
| pre-catchall (ToolSearch) | 12 |
| post-tool-use (ToolSearch) | 8 |
| pre-calendar / pre-anthropic-connector-any / pre-mcp-any / pre-catchall (Calendar, parallel) | sub-ms timing |

All under 50ms. No latency concern. Consistent with 7ms median from the previous spike.

## 7. Verdict

- [x] **STRETCH PASS** — All required capabilities verified plus a bonus enumeration surface (ToolSearch + deferred-tool model). Proceed with v0.3-first plan.

## 8. Implications for v0.3 plan

**Phase 2 (CLI tool registry):** simpler than originally drafted. Compile step uses ToolSearch + deferred-tool names from Claude's session context, not a custom registry adapter. Estimated savings: ~1.5 days CC.

**Phase 3 (Cowork tool-context adapter):** can be deleted from the plan. The plugin doesn't need to enumerate connectors at all; it just enforces matchers on tool calls. The compile step is what queries Claude's deferred tools. Estimated savings: ~2 days CC.

**Net calendar impact:** ~3.5 days reduction, from ~11 days CC to ~7-8 days CC.

**One new wrinkle:** the deferred-tool model means the compile step needs to invoke Claude (which already happens — paragraph→graph compilation calls Claude). What changes is that the compile prompt now includes deferred tool names so Claude knows what tools are available to reference. This is a prompt change, not new infrastructure.

## 9. Open follow-ups

These didn't block the verdict but are worth checking during Phase 1-2 implementation:

1. **Confirm `permissionDecision: "deny"` works on MCP tool calls.** Previous spike confirmed it for Bash/Write/Edit. The hook output schema is identical, so it should work, but worth a 10-min verification when Phase 1 starts.
2. **Confirm matcher regex on the full namespaced name.** Specifically: does `mcp__claude_ai_Gmail__send_email` get matched by `mcp__claude_ai_Gmail__.*`? The Calendar-matcher firing for `mcp__claude_ai_Google_Calendar__list_calendars` strongly suggests yes, but we only verified one service. Test Gmail and Apollo when those connectors are authed.
3. **Concurrent log writes need flock or single-writer.** Probe artifact in this spike showed interleaved output. Production plugin should funnel all matchers through one audit writer.
4. **Test `permissionDecision: "ask"` on MCP tool.** If we want the synchronous in-Desktop approval dialog to work for connector calls, confirm the dialog appears with the right context.
