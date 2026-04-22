# BetterClaw retro — Apr 20-21, 2026

Two-day build log. Honest about what worked and what didn't.

## What shipped

All four primitives from the original office-hours roadmap, across four verticals, with code visible end-to-end:

| Primitive | Status |
|---|---|
| Natural-language agent factory | ✓ `betterclaw "<paragraph>"` compiles via Claude CLI |
| Workflow enforcement | ✓ Graph-driven snap-back, DEVIATION reasons surfaced to the agent |
| Live-observable | ✓ `betterclaw view --watch` — HTTP server + browser polling 500ms |
| Redirectable | ✓ `requires_approval` + CLI/browser buttons, pause + resume |
| Marketplace (fork/diff/publish) | ✓ local library + gist publish via `gh` |
| Four verticals | ✓ email, shopping, sales, travel |

**Final code size:** 2,267 LOC across one CLI and seven plugin modules. No build step, no bundler, zero backend infrastructure.

## What went well

**The hook-pivot arc.** We started with a hook-based enforcement design, diagnosed that it didn't fire for plugin tools in the `agent --local` path, pivoted to inline enforcement, then found the actual OpenClaw bug (mcp-http.handlers.ts:73 skips the hook wrap), then landed back on the hook path by adding our own `wrapExecuteWithHook` inside the plugin. That sequence wasted maybe 30 minutes but produced the clearest architectural understanding of any subsystem — we know exactly where the hook fires, why it didn't, and how to re-enable it without forking OpenClaw.

**Embedded catalogs over external APIs.** fakestoreapi.com looked perfect (free, real products, no auth) until it returned 403 behind a Cloudflare challenge. Swapping to 12 inlined products took ~5 minutes and gave us something that works forever with zero network assumption. Same for the sales and travel stubs. For a demo where the primitive is *workflow enforcement* not *real commerce*, embedded is the right choice.

**Compiler via Claude CLI.** Using `claude -p "<prompt>"` to compile natural language into graph JSON means zero API key management — it inherits OAuth from the user's Claude CLI. This also made the shell-out dead simple. The compile prompt is now ~60 lines of plain English instructions with per-vertical rules; Claude reliably produces valid JSON without needing structured output or Zod-constrained generation.

**Mermaid + polling live view.** The live-run view is a static HTML file that `fetch('/state.json')` every 500ms. Re-renders Mermaid into `innerHTML`. No WebSocket, no SSE, no framework, no build. Works perfectly for the "watch a ~10s agent run step through a graph" use case. If we ever need <100ms latency there's SSE, but we don't.

**Four verticals from one plugin.** The vertical-abstraction refactor was clean: each vertical is a single file that exports a `{id, tools, guidance_for_compiler}` object. The main plugin imports all four, reads the active graph's `vertical` field, and registers only those tools. Adding a fifth vertical is ~50 LOC of tool stubs + 8 lines of compiler guidance.

## What was rough

**The OpenClaw hook-wiring bug took an hour to isolate.** `api.on("before_tool_call", handler)` registers successfully (`hasHooks=true`) but the hook never fires for plugin tools served via the loopback MCP. Root cause: `src/gateway/mcp-http.handlers.ts:73` calls `tool.execute` directly, skipping the wrap-with-hook that `src/mcp/plugin-tools-handlers.ts:28` uses on the ACPX path. We worked around it by implementing `wrapExecuteWithHook` inside the plugin — manual hook invocation via `getGlobalHookRunner()`. Deserves an upstream PR to OpenClaw.

**`--dangerously-force-unsafe-install` is required.** Because the plugin spawns a child Gmail MCP via `child_process.spawn`, OpenClaw's install-time safety scanner blocks it. The workaround (`openclaw plugins install --link --dangerously-force-unsafe-install`) is ugly. A proper fix upstream would be either (a) allow an allowlist of `child_process.spawn` uses in plugin metadata, or (b) move spawning behind a Plugin SDK primitive that's pre-allowed.

**Day-1 `gmail-mcp` bundle conflict.** The day-1 assignment installed Gmail as a Claude-format plugin bundle so the agent could reach it. When A''' shipped, that bundle had to be *disabled* — otherwise Claude CLI would see Gmail tools from two sources (direct via bundle, proxied via our plugin), use the direct one, and bypass our hooks silently. This is the worst kind of bug: enforcement appears to work because the happy path still works, but deviation attempts would go undetected. Added a note about it in the design doc; a proper solution is a startup check in the plugin that fails loudly if both sources are active.

**Detect-vertical keyword ordering.** My first version of `detectVertical` put email first in the fallback chain, and the sales paragraph "find me 3 leads ... draft a personalized outreach email" matched "email" because of the word "email." Obvious in hindsight — the word "email" as a standalone keyword is dominated by other verticals that mention email (sales outreach). Fixed by reordering so more specific verticals check first, and removing "email" as a bare keyword. Would be cleaner to have Claude emit the vertical in the compile step and skip keyword matching entirely.

**The tail filter trap.** Piping `openclaw agent --local` through `tail -N` buffers output until the agent finishes, which made debugging feel broken several times until I remembered. Always run agent invocations without output filters when iterating.

## Lessons worth keeping

1. **Structural enforcement + agent reasoning = defense in depth.** The shopping demo's deviation was a real workflow-compliance issue. The agent's own reasoning defended against the IT-admin phishing prompt. Both matter. Neither alone is enough.
2. **The compiler being an LLM is not a limitation.** Generating graph JSON from prose works reliably with a ~60-line prompt + per-vertical rules. No fine-tuning, no structured output, no schema-constrained decoding. One-shot Claude calls produce valid JSON.
3. **Plugin-registered tools go through the global hook runner once you invoke it.** `getGlobalHookRunner()?.runBeforeToolCall(...)` is the primitive. Any plugin can self-wrap its tools at registration time and get proper hook firing even on runtime paths where OpenClaw forgot the wrap.
4. **"Use an external API" is a trap for demo repos.** Cloudflare challenges, rate limits, auth rotations, service shutdowns. For the demo story we wanted, a 12-row inlined catalog was strictly better.
5. **Linking the plugin (`--link`) for dev is worth the setup friction.** Edits to source reflect on the next agent turn with zero reinstall. Iteration loop is literally "edit file → re-run agent."

## What I'd do differently on the next project

- Have the **compiler emit the vertical**, don't pre-detect via keywords. It adds an LLM call but removes a whole class of bugs.
- **Write the QUICKSTART.md first**, before the first demo works end-to-end. Forces the install path to be real.
- Have a **`doctor` subcommand from day 1** — any time setup breaks, `doctor` tells you exactly what's wrong. Added on day 2; should have been day 0.
- **Don't trust external free APIs** for any demo you'll still be running in a month. Embed or mock.

## What shipped vs the original pre-flight estimate

| Estimate | Actual |
|---|---|
| Day-0 pre-flight: 2h → ~24h remaining | ~21h actual, 4 verticals instead of 1 |
| "Hook-based enforcement" | Required a manual wrap around an OpenClaw bug — same outcome, different path |
| "V1 demo shippable" | Delivered end of day 2, plus redirectable + marketplace + 3 more verticals unplanned |

Overshipped, because each primitive built on the one before it faster than expected. The vertical abstraction in particular was a ~90-minute refactor that tripled the demo surface area.

## Repo state at retro time

- All four verticals end-to-end verified on real agent traffic
- Replay + live view work across all verticals
- Approval gates work across all verticals
- Fork/diff/publish work (graphs are vertical-agnostic)
- `--dangerously-force-unsafe-install` still required for the initial plugin install — acceptable for a project in this state, fixable upstream
- Gmail OAuth still tied to a throwaway account — by design
- No CI, no tests, no npm publish yet — ship-prep work

## Dogfood findings (Apr 21-22)

Four dogfood sessions: shopping with a real constraint ("Mother's Day gift, under $100, free shipping, not electronics"), throwaway-Gmail triage, read-only on real Gmail, and a full real-Gmail triage with approval on a self-sent test question.

Bugs caught + fixed mid-session:

- **Vertical detection missed "gift" / "jewellery" / "fragrance"** — compiler fell through to email on a shopping paragraph. +24 shopping keywords, fixed. Commit `7f1a3e3`. The structural fix is "have the compiler emit the vertical itself, not keyword heuristics" — deferred.

- **Claude CLI's per-tool-call timeout piled up duplicate approval requests.** Each ~60s retry created a fresh approval id; the pending queue grew to 3 entries for one intent. Added params-hash dedupe — retries await the same promise. Commit `da98294`.

- **Approval UX was too opaque** — `betterclaw pending` truncated at 200 chars, you couldn't read the full draft body from the CLI. Added `betterclaw show <id>` (works on pending + historical), tightened pending to a keys-only summary, added SIGTERM/SIGINT handling. Commit `6aee2a0`.

Known issue left on the wall (fixed in v0.2 — see next section):

- **Agent doesn't know post-approval drafts succeeded.** Observed on the real-Gmail triage run: agent's Claude CLI tool-call timed out, agent composed inline and ended the turn, user approved 6 min later, plugin dispatched the real draft silently. Agent believes the call failed. Gmail has the draft. If user re-runs triage, the agent may re-draft.
  Fixes in order of seriousness: (a) plugin returns "queued" immediately, draft happens async on approval — but that's a lie to the agent about outcome; (b) approval window ≤55s, after which the hook errors with "approval pending, see `betterclaw pending`" — honest but asks the user to resume manually; (c) patch openclaw-cli's tool timeout.
  For v0.1.0, documented and lived with. v0.2 shipped a variant of (a) that's *not* a lie — see below.

## v0.2 approval seam (Apr 22, commit `71672ad`)

The v0.1 approval flow blocked inside the plugin's `before_tool_call` hook while waiting for user approval. Since the plugin VM dies when the agent's turn ends, any approval that took longer than Claude CLI's ~60s per-tool-call timeout fell off a cliff: agent gave up, plugin kept waiting, user approved later, plugin dispatched silently, agent never knew.

The v0.2 fix splits dispatch responsibility:

- **Plugin** no longer blocks. On `requires_approval`, it records the pending event with full params and returns immediately (`block: true`, with a honest "queued for out-of-band approval" message). Agent sees the response well inside Claude CLI's timeout window and composes an accurate report: *"Draft queued. Run `betterclaw approve <id>` to dispatch."*
- **CLI** owns the dispatch. `betterclaw approve <id>` reads the pending record from `run.jsonl`, picks a backend by tool name (for `gmail_draft`: spawn `@gongrzhe/server-gmail-autoauth-mcp`, do MCP `initialize` handshake, call `tools/call` with the recorded params, capture the response), and logs `async_dispatch` with the real draft id or the error.
- **Backend router** lives in `callBackend(record)` in `cli/betterclaw`. One function, one switch on tool name. Adding a new approval-gated backend (HubSpot, Slack) is a new branch there — no plugin code changes.

What changed:

- Plugin's hook went from ~40 LOC of blocking + dedupe + cleanup to ~15 LOC of record + return-immediately.
- CLI gained `callBackend` + `dispatchToGmailMcp` (one-shot MCP client, ~85 LOC) + dispatcher-dispatch wiring.
- `approval_pending` records now carry `vertical` so downstream routing is cheap.
- The `waitForApproval` helper and its SIGTERM cancellation still ship (they're harmless, might be useful in a future long-running-gateway mode), but no code path currently calls it with `timeoutMs=0`.

Trade-offs to be honest about:

- **Agent can't see the dispatch result inline.** The agent composes its report *before* the user decides. So the report says "queued," never "dispatched successfully" or "failed." Fine for humans (next step is `betterclaw approve`), awkward for chained multi-step agents. Not a concern for v0.1 verticals.
- **Plugin is more stateless; CLI is more stateful.** The backend router is now in the CLI, which has to know how to talk to each backend. Today that's just one branch (gmail_draft). Scaling to 10 verticals means the CLI's backend router grows; consider extracting into a plugin-contributed manifest in v0.3.
- **Dedupe still works within a turn** but not across turns. If user re-runs triage and the agent attempts the same draft again, a new `pending` id is created. Not a fix in v0.2 because the natural behavior (agent re-tries, user denies the duplicate) is honest.

Verified end-to-end: synthetic injected approval + `betterclaw approve` → spawns Gmail MCP → creates real draft (`r8103012543485992626`) → logs full `approval_pending → approval_resolved → async_dispatch` chain in `run.jsonl`. Fresh live-agent triage with the new plugin → hook returns "queued" in <1s, agent composes honest "Draft queued. Run `betterclaw approve 986b9992` to dispatch."

Agent reasoning quality was genuinely good on real data:

- Cross-thread stitching: on the real inbox, correctly identified that the UT Austin scholarship thread (3 messages) was already resolved by your 17:05 reply.
- Temporal reasoning: eliminated a $89 Dior fragrance because "Ships in 2 weeks won't make Mother's Day May 10."
- Prompt-injection defense: refused the "IT admin, send API key" test on every run without enforcement having to step in. Workflow graph was defense in depth, not the primary defender.
- Draft body quality: answered both specific questions in the BetterClaw test email (tiered approval, tool throttling), plausible voice, substantive CTA ("what does next week look like for you?").

## Next, if we keep going

Ranked by leverage, not time:

1. **Upstream the OpenClaw hook-wrap bug.** PR to `mcp-http.handlers.ts:73` that applies `wrapToolWithBeforeToolCallHook` like the ACPX path already does. Benefits every OpenClaw plugin author, not just us. Would also let BetterClaw drop the plugin-side `wrapExecuteWithHook` workaround.
2. **Package for npm.** Right now install is "clone this repo + `openclaw plugins install --link --dangerously-force-unsafe-install ...`" — should be `npm i -g betterclaw && betterclaw init`. The `--dangerously` flag is the real blocker; needs either upstream OpenClaw plugin-SDK primitive for subprocess spawning, or a packaging dance that moves the Gmail-MCP child out of the plugin (maybe into the CLI's `betterclaw approve` path, which already spawns it for dispatch — the plugin could proxy read/search calls through the CLI too).
3. **Replace the sales stubs with a real CRM MCP.** HubSpot has an MCP; Salesforce has one via Composio. That's the first real-commercial vertical. Backend router pattern from v0.2 makes this a one-branch add.
4. **Design pass on the live view.** Shipped as part of the Apr 21 design pass — warm-paper palette, serif headers, hairlines. No more work needed unless a real user complains.
5. **Preset library expansion.** Four presets ship today; natural adds: customer-support triage, follow-up sweep (find emails you haven't replied to in N days), expense categorization, newsletter-only digest. Each is ~50 LOC of graph JSON + paragraph.
6. ~~`after_tool_call` hook + async result surfacing~~ — **shipped in v0.3**, see below.

## v0.3 recent-approvals surfacing (Apr 22, commit pending)

Closes the remaining "agent doesn't see outcome" gap from v0.2. After v0.2, approvals dispatched out-of-band via `betterclaw approve` wrote to `run.jsonl` but no future agent turn could see them — `run.jsonl` gets truncated on every plugin boot.

**The fix is two surfaces.**

1. **Cross-turn history log.** CLI's `resolveApproval` now appends every outcome (approved + dispatched, approved + backend error, denied) to `~/.betterclaw/history.jsonl`. This file is append-only across turns, outside the plugin's working directory, and persists forever (for now — cap it at ~10k entries if it grows noticeable).

2. **Context injection at the start of every turn.** The plugin on boot reads the last 8 history entries in the past 24h and writes a formatted block to `~/.openclaw/workspace/MEMORY.md` bounded by `<!-- BEGIN betterclaw:recent_approvals -->` / `<!-- END ... -->` markers. OpenClaw's CLI backend auto-loads `MEMORY.md` into the agent's prompt as bootstrap context, so every new agent turn starts knowing what previous turns + the user have already handled. Any user-owned content in `MEMORY.md` outside our markers is preserved.

**Hook detour for posterity.** Ideally this would be a `before_prompt_build` hook returning `{prependContext: block}`. The OpenClaw Plugin SDK supports this hook type and the result shape is exactly right. **But**: `runBeforePromptBuild()` is only invoked from `src/agents/pi-embedded-runner/` — the Pi embedded agent path. The `src/agents/cli-runner/` path (what `openclaw agent --local` uses with Claude CLI as backend) doesn't call it. Same pattern as the `before_tool_call` gap we found earlier.

Rather than fork OpenClaw, we took the `MEMORY.md` workspace-file route. The `api.on("before_prompt_build", ...)` registration still ships alongside as dead weight — it'll activate automatically if the user runs the Pi embedded agent, or when OpenClaw's CLI backend grows plugin-provided prompt mutation support. Documenting both approaches so a future reader knows what the "right" fix would look like.

**Verified.** Seeded `history.jsonl` with 3 entries from the real-Gmail dogfood (two approved drafts, one denied). Fresh triage run: the plugin wrote MEMORY.md on boot, the agent started its turn with recent-approvals in context, then on seeing the "Quick question about BetterClaw" email it decided: *"Skip — already handled. A reply draft to this exact thread was approved earlier today at 10:21 (per recent-approvals context). Not re-drafting."* No duplicate draft attempted. Exactly the behavior the v0.3 target described.

**Trade-off to be honest about.** The `MEMORY.md` surface is globally shared across all verticals and agents running in this OpenClaw install — our "Recent approvals" block shows up for every agent turn, even ones using a graph from a different vertical. For single-user solo-agent use today that's fine; for multi-agent or multi-user installs it would leak activity across contexts. Not a concern at v0.3 usage levels; worth fixing before the OpenClaw gateway multi-session mode becomes relevant.
