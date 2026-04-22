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

Known issue left on the wall (not fixed):

- **Agent doesn't know post-approval drafts succeeded.** Observed on the real-Gmail triage run: agent's Claude CLI tool-call timed out, agent composed inline and ended the turn, user approved 6 min later, plugin dispatched the real draft silently. Agent believes the call failed. Gmail has the draft. If user re-runs triage, the agent may re-draft.
  Fixes in order of seriousness: (a) plugin returns "queued" immediately, draft happens async on approval — but that's a lie to the agent about outcome; (b) approval window ≤55s, after which the hook errors with "approval pending, see `betterclaw pending`" — honest but asks the user to resume manually; (c) patch openclaw-cli's tool timeout.
  For v0.1.0, documented and lived with. v0.2 target.

Agent reasoning quality was genuinely good on real data:

- Cross-thread stitching: on the real inbox, correctly identified that the UT Austin scholarship thread (3 messages) was already resolved by your 17:05 reply.
- Temporal reasoning: eliminated a $89 Dior fragrance because "Ships in 2 weeks won't make Mother's Day May 10."
- Prompt-injection defense: refused the "IT admin, send API key" test on every run without enforcement having to step in. Workflow graph was defense in depth, not the primary defender.
- Draft body quality: answered both specific questions in the BetterClaw test email (tiered approval, tool throttling), plausible voice, substantive CTA ("what does next week look like for you?").

## Next, if we keep going

Ranked by leverage, not time:

1. **Upstream the OpenClaw hook-wrap bug.** PR to `mcp-http.handlers.ts:73` that applies `wrapToolWithBeforeToolCallHook` like the ACPX path already does. Benefits every OpenClaw plugin author, not just us.
2. **Package for npm.** Right now install is "clone this repo + `openclaw plugins install --link ...`" — should be `npm i -g betterclaw && betterclaw init`.
3. **Replace the sales stubs with a real CRM MCP.** HubSpot has an MCP; Salesforce has one via Composio. That's the first real-commercial vertical.
4. **Design pass on the live view.** It's functional but visually crude. Closer to a YC demo bar.
