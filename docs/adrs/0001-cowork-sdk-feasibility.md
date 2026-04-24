# ADR 0001: Cowork Plugin SDK Feasibility for BetterClaw V1

- **Status:** **Accepted** (empirically verified 2026-04-24 against Claude Desktop via `spikes/cowork-hook-verify`)
- **Date:** 2026-04-24
- **Decision driver:** CEO plan Week 0-3 Track A depends on a Cowork plugin as free distribution. This ADR records whether Cowork's plugin runtime exposes the four capabilities BetterClaw needs before we commit to the Cowork branch.
- **Related:** `~/.gstack/projects/BetterClaw/ceo-plans/2026-04-22-workflow-trust-layer.md` (Decision 0 in "Blocking Decisions" section)

## Empirical Verification (2026-04-24)

Spike executed against live Claude Desktop with `claude --plugin-dir spikes/cowork-hook-verify`. Log: `~/.betterclaw/spike-hook-verify.log`.

**Confirmed via live test:**

| Capability | Evidence |
|---|---|
| `PreToolUse` fires for plugin shell-command hooks with full context | Log shows `input` JSON with `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input.file_path`, `tool_input.content`, `tool_use_id` — everything needed for enforcement decisions. |
| `permissionDecision: "deny"` + `permissionDecisionReason` renders visibly to the user | User saw `"Error: BetterClaw spike: Write/Edit blocked to verify plugin hook can enforce policy"` directly in the Claude chat UI when the hook denied a Write tool call. |
| `UserPromptSubmit` fires on every user turn | Hook fired on second user turn ("Hi again"), proving every-turn firing (Open Question 2 resolved). |
| `systemMessage` from `UserPromptSubmit` lands visibly in the conversation | User confirmed `"[BetterClaw spike] UserPromptSubmit fired. Recent approvals would be injected here in the real plugin."` appeared in the next agent turn. Context injection works end-to-end. |
| Shell-command hook dispatch latency | Measured 7ms per hook fire. Under the 50ms target. Open Question 3 resolved: no persistent daemon needed; CLI-invoked-per-hook model is sufficient. |

**Verified by docs + mechanism (not separately tested but low-risk inference):**
- Matcher regex on tool name works (`Write|Edit` matcher fired correctly → same mechanism for Bash matcher or catch-all).
- `PostToolUse` and `PreToolUse` catch-all use the same `hooks.json` declaration format → should work identically.

**Still open (not blocking for V1):**
- Whether `permissionDecision: "defer"` works for shell-command plugin hooks (Open Question 1). Not blocking because `"ask"` + Slack-async via OpenClaw covers async approvals. Will test during V1 build if useful.
- Hooks + MCP coexisting in one plugin (Open Question 4). Docs don't suggest exclusivity; will verify during real plugin development.
- Upgrade/reload story (Open Question 5). Will discover during V1 iteration.

## Context

BetterClaw's value is a trust layer around AI-agent actions: declarative workflow enforcement, compile-preview, and audit trail. To run that layer inside Anthropic's Cowork (the "Claude Code power for knowledge work" product that ships inside Claude Desktop), we need four specific plugin capabilities. If any are missing, the Cowork distribution path is not viable for V1 and we ship OpenClaw-only.

The four capabilities:

1. **Pre-execution hook on tool calls** — intercept a tool call, inspect args, block/allow/modify with user-visible reason.
2. **Prompt context prepend** — inject text that reliably appears in the next agent turn (how BetterClaw surfaces cross-turn state like "you already approved X").
3. **Approval pause primitive** — pause the agent, surface a user prompt, resume on user decision.
4. **Mobile UI render surface** — approval cards/panels that display on Claude's iOS/Android apps.

## Evidence

Researched via WebFetch on 2026-04-24 against the public Claude Code / Cowork plugin documentation.

### Capability 1: Pre-execution tool-call hook — PASS ✓

- **Source:** <https://code.claude.com/docs/en/agent-sdk/hooks>, <https://code.claude.com/docs/en/plugins>
- **Hook event:** `PreToolUse`. Fires before every tool invocation.
- **Plugin access:** Plugins declare hooks in `hooks/hooks.json` at the plugin root. The JSON schema matches `.claude/settings.json` hook config (shell command hooks).
- **Capabilities available:**
  - Block (`permissionDecision: "deny"` with `permissionDecisionReason`)
  - Ask for user permission (`permissionDecision: "ask"`)
  - Allow with modified input (`permissionDecision: "allow"` + `updatedInput` inside `hookSpecificOutput`)
  - Defer execution (`permissionDecision: "defer"` — TypeScript SDK only; shell-command-hook support unverified, see Open Questions)
  - Inject context into the conversation (`systemMessage` top-level field)
- **Matcher:** regex on tool name. Supports built-in tools (`Bash`, `Write`, etc.) and MCP tools (`mcp__<server>__<action>`).
- **Verdict:** Sufficient for BetterClaw's enforcement engine. Plugin-declared shell command can call `betterclaw hook pre-tool-call` which returns the policy decision based on the active graph.

### Capability 2: Prompt context prepend — PASS ✓

- **Source:** <https://code.claude.com/docs/en/agent-sdk/hooks>
- **Hook event:** `UserPromptSubmit`. Fires when the user submits a prompt. The available-hooks table lists "Inject additional context into prompts" as the example use case.
- **Capability:** Shell command hook receives the prompt text as JSON on stdin, returns `systemMessage` field in output JSON that "injects a message into the conversation visible to the model."
- **Alternative:** `PostToolUse` hooks expose `additionalContext` to append information to a tool result.
- **Verdict:** Sufficient. BetterClaw can surface cross-turn approval history on every user turn via `UserPromptSubmit` + `systemMessage`. This replaces the MEMORY.md workaround used in v0.3 for the OpenClaw CLI-runner path.

### Capability 3: Approval pause primitive — PASS (conditional) ✓

- **Source:** <https://code.claude.com/docs/en/agent-sdk/hooks>
- **Primary mechanism:** `permissionDecision: "ask"` triggers Claude Desktop's native permission dialog. Suitable for synchronous approval (user clicks Approve/Deny in-app).
- **Async mechanism:** `permissionDecision: "defer"` "ends the query and resumes later." Listed as **TypeScript SDK only** — whether plugin shell-command hooks can return `"defer"` is not explicitly documented. This is the primary Open Question below.
- **Fallback plan:** if `"defer"` is not available to shell-command hooks, BetterClaw uses `"ask"` for synchronous in-Desktop approval + Slack channel (via OpenClaw) for asynchronous approvals. This matches the design-review decision that Slack is the default mobile approval channel. No functionality lost; async approvals still work, just via a different surface.
- **Verdict:** Sufficient for V1. Confirm `"defer"` behavior during the empirical spike; fallback is documented and acceptable.

### Capability 4: Mobile UI render surface — FAIL ✗

- **Source:** <https://support.claude.com/en/articles/13837440-use-plugins-in-claude-cowork> and <https://claude.com/blog/cowork-plugins>
- **Finding:** Cowork plugin docs reference only the Claude **Desktop** app. The blog post states *"Plugins are currently saved locally to your machine"* — plugins live on a user's filesystem, which Claude iOS/Android apps don't have access to.
- **Mobile parity not documented.** "Research preview" status + no mention of mobile suggests Cowork plugins are Desktop-only today.
- **Impact on BetterClaw:** Claude mobile apps cannot render BetterClaw's approval cards directly via the Cowork plugin.
- **Workaround already in plan:** The design review (2026-04-22) already committed Slack as BetterClaw's default mobile approval channel via OpenClaw's existing channel infrastructure. Mobile approvals flow: agent hits gate → OpenClaw channel dispatches Slack message with ✓/✗ buttons → user approves on phone → response flows back through OpenClaw → BetterClaw resumes. No Cowork mobile plugin needed.
- **Verdict:** Capability 4 fails, but it's architecturally redundant. Mobile is solved via Slack-through-OpenClaw, not via Cowork plugin UI.

## Decision

**CONDITIONAL PASS.** Ship the Cowork plugin in V1.

- 3 of 4 required capabilities are directly available via documented plugin hooks (`hooks/hooks.json` format).
- The 4th capability (mobile UI) is unavailable in Cowork today but is architecturally redundant because BetterClaw's mobile approval strategy uses OpenClaw's existing Slack/SMS/WhatsApp channels, not a Cowork-native mobile surface.
- The Cowork plugin becomes the **desktop approval surface**; OpenClaw channels become the **mobile approval surface**. These split cleanly along device boundary, not along user journey.

### Architectural consequence

BetterClaw's Cowork plugin is thin: `plugin.json` + `hooks/hooks.json` that points shell commands at the `betterclaw` CLI daemon. State (pending approvals, history, graph registry) lives in the CLI, not in the plugin. This matches the existing OpenClaw plugin architecture and keeps the code shared.

### Plugin structure (V1)

```
betterclaw-cowork/
├── .claude-plugin/
│   └── plugin.json         # metadata only
├── hooks/
│   └── hooks.json          # PreToolUse + UserPromptSubmit + PostToolUse
└── bin/
    └── betterclaw-hook     # shim that calls `betterclaw hook <event>` with stdin JSON piped in
```

## Open Questions (to resolve via empirical spike)

1. **Does `permissionDecision: "defer"` work for plugin shell-command hooks?** Docs describe it as "TypeScript SDK only" but the hook output JSON schema is shared between SDK callbacks and shell command hooks. Empirical test: have the spike stub return `"defer"` for a test tool call; confirm behavior. If fails, fall back to `"ask"` + Slack async approval.
2. **Does `UserPromptSubmit` fire on every user turn, or only on the first prompt in a session?** Spike test: log timestamps from the hook; confirm it fires on each turn.
3. **Hook command latency budget.** Spike test: measure shell-command hook dispatch time. Target: <50ms overhead per hook fire. If higher, BetterClaw needs a persistent daemon + Unix socket rather than `betterclaw` invoked fresh per hook.
4. **Can a plugin register hooks AND expose tools via `.mcp.json` simultaneously?** Architectural question — BetterClaw wants both. Likely yes (docs don't suggest exclusivity) but confirm.
5. **What's the uninstall/upgrade story?** Can users update the plugin cleanly when BetterClaw ships new versions? This affects rollout UX.

## Next Actions

1. **User runs `spikes/cowork-hook-verify` locally** against their Claude Desktop install to empirically verify the three PASS capabilities and resolve Open Questions 1-3.
2. **Update this ADR** from "Proposed" to "Accepted" (or "Superseded" if empirical results diverge).
3. **If accepted:** proceed with Track A Cowork plugin shipping (Week 0-1 of CEO plan).
4. **If empirical results show a critical hook missing in practice despite docs:** revert to OpenClaw-only V1, file upstream issue with Anthropic, revisit Cowork Month 4+.

## References

- Cowork plugins overview: <https://claude.com/plugins>
- Cowork plugin blog post: <https://claude.com/blog/cowork-plugins>
- Cowork plugin user guide: <https://support.claude.com/en/articles/13837440-use-plugins-in-claude-cowork>
- Agent SDK hooks reference: <https://code.claude.com/docs/en/agent-sdk/hooks>
- Create plugins guide: <https://code.claude.com/docs/en/plugins>
- Plugins full reference: <https://code.claude.com/docs/en/plugins-reference>
