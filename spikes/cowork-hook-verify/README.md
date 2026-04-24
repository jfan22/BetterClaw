# Cowork Hook Verification Spike

Minimal stub plugin to empirically verify that Anthropic's Cowork plugin runtime exposes the four hook capabilities BetterClaw needs. See `docs/adrs/0001-cowork-sdk-feasibility.md` for context and the decision criteria.

## What this does

Registers three hook types in the Cowork/Claude Code plugin runtime:

- **`PreToolUse`** in three flavors: allow-only on Bash, deny on Write/Edit, and a catch-all that injects `systemMessage` into the conversation.
- **`UserPromptSubmit`** injects `systemMessage` on every user turn.
- **`PostToolUse`** logs every tool completion.

Each hook invocation writes a timestamped entry with the event input JSON and the hook's own duration to `~/.betterclaw/spike-hook-verify.log`.

## How to run the spike

From inside the BetterClaw repo root:

```bash
cd spikes/cowork-hook-verify
claude --plugin-dir .
```

Then, inside the Claude session:

1. **Ask Claude to run a `ls` command** (triggers `PreToolUse:Bash`, `PostToolUse`, `pre-tool-use-all`). Expected: command runs, `systemMessage` appears in the next agent turn.
2. **Ask Claude to write a file** (triggers `PreToolUse:Write|Edit`). Expected: denied with the BetterClaw reason string visible to the user.
3. **Send a second user message** (triggers `UserPromptSubmit`). Expected: `systemMessage` from the hook is visible in context on the next turn.

## Reading the log

```bash
tail -100 ~/.betterclaw/spike-hook-verify.log
```

You should see entries like:

```
---
ts=2026-04-24T15:30:12.431Z
label=pre-tool-use-bash
input={"tool_name":"Bash","tool_input":{...},"session_id":"...","hook_event_name":"PreToolUse",...}
duration_ms=4
---
ts=2026-04-24T15:30:12.450Z
label=pre-tool-use-all
input={...}
duration_ms=3
---
ts=2026-04-24T15:30:15.002Z
label=post-tool-use
input={"tool_name":"Bash","tool_response":{...},...}
duration_ms=2
```

## What to look for (per Open Question in ADR 0001)

| Open Question | Check |
|---|---|
| 1. Does `"defer"` work for plugin shell-command hooks? | Edit `bin/hook-probe.sh`: change `pre-tool-use-write-deny` to return `permissionDecision:"defer"` and re-run. If Claude pauses/resumes the query on a later event, PASS. If Claude treats it as unknown/error, FAIL (fall back to `"ask"`). |
| 2. Does `UserPromptSubmit` fire on every turn? | Send 3 user messages in one session. Confirm 3 `label=user-prompt-submit` entries in the log. |
| 3. Shell-command hook latency | Look at `duration_ms` values. Target <50ms. If consistently >100ms, BetterClaw will need a persistent daemon + Unix socket instead of `betterclaw` invoked per hook. |
| 4. Hooks + MCP together | Add an `.mcp.json` to this spike with a trivial MCP server, re-run, confirm both hooks and MCP tools work in the same session. |
| 5. Upgrade story | Modify `plugin.json` version + `bin/hook-probe.sh`, re-run with same `--plugin-dir`, confirm changes take effect (may need `/reload-plugins`). |

## Pass / fail decision

Record results in `docs/adrs/0001-cowork-sdk-feasibility.md` by updating the status from "Proposed" to either:

- **Accepted** — all critical hooks work; proceed with Cowork plugin path in V1.
- **Superseded** — one or more critical hooks missing in practice; revert to OpenClaw-only V1 and file upstream issue with Anthropic.

## Cleanup

```bash
rm -rf ~/.betterclaw/spike-hook-verify.log
```

The spike plugin itself lives in `spikes/cowork-hook-verify/` — leave it in the repo as reference for future Cowork SDK work. It's NOT shipped in the V1 release; the real plugin lives at `packages/plugin-cowork/` (per the monorepo structure decision in plan-eng-review).
