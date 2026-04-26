# @betterclaw-ai/plugin-cowork

BetterClaw as an Anthropic Cowork plugin (Claude Desktop). Puts BetterClaw's compile + enforce + approval + audit primitives in front of every tool call Cowork makes.

**Status:** v0.3.0. Works today with the hooks Cowork exposes (`PreToolUse`, `UserPromptSubmit`, `PostToolUse`). ADR 0001 empirically verified the SDK against BetterClaw's hook requirements on 2026-04-24; ADR 0002's Phase 0 spike (2026-04-26) verified the deferred-tool / `mcp__claude_ai_*` matcher behavior.

## How it works

```
┌──────────────────────────┐
│ Claude Desktop (Cowork)  │  fires a hook event
└──────────────────────────┘
              │
              ▼
   hooks/hooks.json declares three shell-command hooks:
     PreToolUse        → bin/hook-shim.sh pre-tool-call
     UserPromptSubmit  → bin/hook-shim.sh user-prompt-submit
     PostToolUse       → bin/hook-shim.sh post-tool-call
              │
              ▼
┌──────────────────────────┐
│ bin/hook-shim.sh         │  1-line exec — requires `betterclaw` on PATH
└──────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│ betterclaw hook <event>                  │  reads JSON from stdin,
│ (shipped in @betterclaw-ai/cli)             │  runs enforcement,
│                                          │  writes response JSON to stdout
└──────────────────────────────────────────┘
              │
              │ loads the active workflow graph and shared approval queue
              ▼
  packages/plugin-openclaw/active-graph.json   (shared with the OpenClaw plugin path)
  packages/plugin-openclaw/approvals/          (shared with `betterclaw approve/deny`)
  ~/.betterclaw/history.jsonl                  (cross-turn approval surfacing)
  ~/.betterclaw/cowork-sessions.json           (per-session current-node tracking)
```

Hook dispatch latency: ~100-150ms per invocation (Node cold start for the CLI). Acceptable for V1; if it matters we promote to a socket-resident enforcement path in V2.

## Install

Prereqs:

- Claude Desktop (latest) with Cowork enabled
- `@betterclaw-ai/cli` on PATH — `npm install -g @betterclaw-ai/cli` OR clone the BetterClaw repo and `ln -sf $PWD/packages/cli/bin/betterclaw ~/.local/bin/betterclaw`

Install the plugin via Claude Desktop's plugin manager (Settings → Plugins → Install from directory) and point it at `packages/plugin-cowork/`. Or for local development:

```bash
claude --plugin-dir /path/to/BetterClaw/packages/plugin-cowork
```

Verify it loaded: ask Claude to run a tool. You should see BetterClaw either:

- Allow the call silently (workflow lets the tool through at the current node), OR
- Refuse with a detailed deviation message ("DEVIATION: tool 'X' not allowed in node 'Y'..."), OR
- Queue for approval (`Approval required · id=XXXX · run 'betterclaw approve XXXX' to dispatch`).

## Compile a workflow first

The Cowork plugin enforces an existing BetterClaw graph. Compile one before installing:

```bash
betterclaw "triage my inbox: auto-archive newsletters, draft replies to customer questions, let me approve each draft"
```

After `y`-confirmation, the graph lands at `packages/plugin-openclaw/active-graph.json`. The Cowork plugin reads from the same path — Cowork and OpenClaw plugin paths share state for V1.

## What the plugin handles per hook event

### `PreToolUse`

1. Loads the active graph.
2. Looks up the current session's workflow state (or starts at `graph.entry`).
3. Runs the workflow-enforcement rule:
   - Tool is allowed in current node → allow, stay.
   - Tool is allowed in a reachable next node → allow, advance.
   - Tool deviates → block with a detailed DEVIATION message. Budget of `max_reconsider_retries` before hard-fail.
4. If the allowed tool requires approval (per `graph.requires_approval`), queue an approval record and block with a user-facing prompt to run `betterclaw approve <id>`.

### `UserPromptSubmit`

Surfaces recent approvals (past 24h, last 8) from `~/.betterclaw/history.jsonl` as a `systemMessage`. The model sees them in context and avoids re-attempting tool calls the user already handled.

### `PostToolUse`

V1: no-op (returns `{}`). Telemetry for tool-completion timing is already captured CLI-side on the approval-dispatch path.

## Troubleshooting

- **Plugin loaded but nothing enforces** — compile a graph first: `betterclaw "<paragraph>"`. Without an active graph, BetterClaw allows everything.
- **Hook timeout** — `betterclaw` must be on PATH. `command -v betterclaw` should print a path.
- **Approvals don't surface after `betterclaw approve <id>`** — UserPromptSubmit surfaces them on the NEXT user turn. It doesn't retroactively push into the current conversation.
- **Perf complaints** — each hook adds ~100-150ms of CLI cold-start. If this matters, watch for a V2 release with a socket-resident enforcement path (~7ms per hook). File an issue.

## Not yet implemented (V1 scope boundaries)

- **Built-in Cowork tool enforcement** (Bash, Write, Read, etc.) — V1 enforces over the tool names listed in the active graph. Built-in Claude Desktop tools are out of scope unless they appear in a graph node's allowed_tools. V2 may add an explicit "always-on built-in deny list" for safety.
- **Dry-run mode** — V2. Replay a graph against historical data without side effects.
- **Per-tenant identity in Cowork** — tied to the paid-cloud backend, gated on Week 3 validation.
- **`permissionDecision: "defer"`** — Open Question from ADR 0001. TypeScript-SDK-listed but not verified for shell-command plugin hooks. V1 uses `"deny"` + user-facing instructions to approve; behaviorally equivalent for sync approval flows.

## Related

- [ADR 0001 — Cowork plugin SDK feasibility](../../docs/adrs/0001-cowork-sdk-feasibility.md) — the verification that green-lit this package.
- [ADR 0002 — Enforcement layer, not vertical bundler](../../docs/adrs/0002-enforcement-layer-not-vertical-bundler.md) — the v0.3 architectural shift.
- [`spikes/cowork-hook-verify/`](../../spikes/cowork-hook-verify/) — the minimal probe plugin used to validate hook wire behavior. Useful when debugging.
- [`spikes/cowork-tool-discovery/`](../../spikes/cowork-tool-discovery/) — the Phase 0 spike that verified the `mcp__claude_ai_*` matcher behavior + ToolSearch enumeration mechanism.
- [`@betterclaw-ai/cli`](../cli/) — provides the `betterclaw` CLI this shim calls.
- [`betterclaw` (plugin-openclaw)](../plugin-openclaw/) — the sibling plugin for OpenClaw users. Same enforcement, different host runtime.
