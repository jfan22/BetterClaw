# Cowork Tool-Discovery Spike (Phase 0 for v0.3)

**Status:** to be run before committing to the v0.3.0 refactor schedule. Time-box: 1 day.
**Driver:** [ADR 0002 — Enforcement Layer, Not Vertical Bundler](../../docs/adrs/0002-enforcement-layer-not-vertical-bundler.md), Open Question 1.

## What we're testing

The v0.3 refactor depends on two assumptions about how the Cowork plugin runtime treats Anthropic-built connector tools (Gmail, Google Calendar, Google Drive, Apollo.io):

1. **Hooks fire for connector tool calls.** When Claude invokes a connector tool like Gmail's `send_email`, the plugin's `PreToolUse` hook fires with the tool name in the matcher input.
2. **The tool name follows a predictable pattern** (probably `mcp__claude_ai_<Connector>__<action>` based on how this Claude Code session exposed them). If the format diverges, our regex matchers in `packages/plugin-cowork/hooks/hooks.json` need to change.

Plus a stretch goal:

3. **Some surface area exists for enumerating all currently-available tools** (not just the one being called right now). This would let BetterClaw's compile step know what tools are available before the user hits compile. If no such surface exists, we fall back to per-call observation + a manual config file.

## How to run

From the BetterClaw repo root:

```bash
# Clean any previous spike log
rm -f ~/.betterclaw/spike-tool-discovery.log

# Launch claude with the spike as a plugin
claude --plugin-dir spikes/cowork-tool-discovery/
```

Inside the Claude session, run these prompts in order (skip ones that aren't connected; that's also a useful data point):

1. **Baseline (no MCP tool):** "What time is it?"
   - Triggers `UserPromptSubmit` only. Establishes baseline log entry.

2. **Built-in tool:** "Run `ls` in the current directory."
   - Triggers `PreToolUse:Bash` → catches in `pre-catchall`, NOT in any `mcp__*` matcher.
   - Confirms the catch-all still works for non-MCP tools.

3. **Calendar (most likely to be authed):** "List my calendars."
   - Should trigger `mcp__claude_ai_Google_Calendar__list_calendars` or similar.
   - Watch which matchers fire: `pre-calendar`, `pre-anthropic-connector-any`, `pre-mcp-any`, `pre-catchall`.

4. **Gmail (may need auth first):** "List my last 3 emails."
   - If unauthed, Claude will call `mcp__claude_ai_Gmail__authenticate` — that itself fires hooks. Either path produces useful data.

5. **Apollo (if connected):** "Search Apollo for contacts named John at Anthropic."
   - Should trigger `mcp__claude_ai_Apollo_io__apollo_contacts_search` or similar.

6. **A second user message** to confirm `UserPromptSubmit` still fires every turn: "thanks, what's next?"

Then exit Claude (`/exit` or Ctrl+D).

## Read the log

```bash
less ~/.betterclaw/spike-tool-discovery.log
```

Each fire appears as a block:

```
===============================
ts=2026-04-26T15:30:12.431Z
label=pre-calendar
--- env (filtered) ---
CLAUDE_PLUGIN_ROOT=/home/jfan/Prj/BetterClaw/spikes/cowork-tool-discovery
CLAUDE_...
--- pwd ---
/some/path
--- plugin dir contents (if visible) ---
total ...
--- input json ---
{"tool_name":"mcp__claude_ai_Google_Calendar__list_calendars","tool_input":{...},"session_id":"...","hook_event_name":"PreToolUse",...}
duration_ms=4
```

## What to extract (fill in `results.md`)

After the run, fill in `results.md` (template provided) with:

1. **Tool name format observed.** Exact string for one Gmail call, one Calendar call, one Apollo call. Confirms or contradicts the `mcp__claude_ai_<Service>__<action>` hypothesis.

2. **Which matchers caught each call.** A connector call should ideally fire 4 hooks: the service-specific matcher (`pre-gmail`), the Anthropic-connector matcher (`pre-anthropic-connector-any`), the generic MCP matcher (`pre-mcp-any`), and the catch-all (`pre-catchall`). Document which actually fired in what order.

3. **Hook input JSON contents for one connector call.** Specifically: does it include any `tools`, `available_tools`, `connectors`, or similar field that lists what's available? Usually it doesn't — but worth checking.

4. **Env vars at hook fire time.** Anything in `CLAUDE_*`, `MCP_*`, `ANTHROPIC_*`, `COWORK_*` that hints at a tool registry path or API.

5. **Plugin dir visibility.** Does the plugin runtime expose any context files (e.g., a `tools.json` or settings file) inside `${CLAUDE_PLUGIN_ROOT}` or its parent? Worth a `ls -laR` mention in results.

6. **Latency.** `duration_ms` per hook fire. Target <50ms (consistent with previous spike's 7ms).

## Pass / fail rubric for v0.3-first sequencing

| Outcome | Decision |
|---|---|
| **PASS:** hooks fire for connector tools, tool name follows predictable `mcp__claude_ai_*` pattern, matchers catch them | Proceed with v0.3-first plan. Skip v0.2.0 npm publish. Open Question 1 in ADR 0002 resolved as "verified by observation; enumeration via per-call learning + manual config fallback." |
| **PARTIAL PASS:** hooks fire but tool name format differs from expected | Proceed with v0.3-first, but update the regex patterns in `packages/plugin-cowork/hooks/hooks.json` and the compile-side tool registry to match the actual format. Add a few hours to Phase 1. |
| **FAIL:** hooks don't fire for connector tools, OR tool names are opaque/unmatchable | v0.3 architecture needs redesign. Fall back to publishing v0.2.0 to npm + revisit ADR 0002 before refactoring. |
| **STRETCH PASS:** hook input JSON or env exposes a way to enumerate all available tools at any time | Architectural bonus. Compile step can know tools without waiting for first call. Document in results, plan compile-step accordingly. |

## Cleanup

```bash
rm -f ~/.betterclaw/spike-tool-discovery.log
```

Leave the spike directory in the repo as reference. It's not shipped in any release.
