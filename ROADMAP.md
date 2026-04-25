# BetterClaw Roadmap

What we're working on next, in rough order. No commitments — we ship when we ship, and signal from real users will reorder this list. File issues to vote on what should move up.

## V2 — next minor release

- **Real backends for `sales` and `travel` verticals.** Sales swaps from stub catalog to a live CRM (HubSpot MCP candidate). Travel swaps to a live flight/hotel API (Amadeus or Duffel candidate).
- **More verticals** — customer support (Intercom / Zendesk / Front), revenue ops (Salesforce / HubSpot CRM), DevOps automation (Kubernetes MCP, AWS CLI), finance ops (Brex / Ramp / QuickBooks). See [`packages/plugin-openclaw/README.md`](./packages/plugin-openclaw/README.md) for the vertical recipe and [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add one.
- **Approval routing.** Workflow graphs declare role + threshold rules ("drafts under $500 auto, $500-5k manager, $5k+ VP+legal") and the daemon routes the approval to the correct human. Today only the active user can approve; multi-user routing adds team-tier value.
- **Dry-run mode (read-only tools).** Run a graph against historical data without external side effects. Useful for compliance officers reviewing a new agent before it touches production.

## V3 — exploratory

- **Marketplace.** Public catalog of graphs with fork + attribution + commit history. Today's `betterclaw publish --to gist` is the seed; V3 turns it into a searchable, browsable surface.
- **UX polish pack.** Paragraph-edit graph diff (highlight what changed before re-compile), what-if simulation (click a node, preview next 3 hypothetical actions), natural-language audit query ("show all money-moving actions in Q1").
- **Third-framework adapter.** Reference implementation for one more agent runtime beyond OpenClaw and Cowork. Candidates: LangGraph, CrewAI, Claude Agent SDK, Nous Hermes.

## Maintenance / upstream

- **Upstream OpenClaw fixes** — PR #70147 (`before_tool_call` hook wrap fix in `mcp-http.handlers.ts`) and PR #70169 (`before_prompt_build` for the cli-runner path). When both merge we drop the manual hook wrap in `packages/plugin-openclaw/index.mjs` and the MEMORY.md cross-turn-surfacing workaround. Track via the linked PRs on `openclaw/openclaw`.
- **Cowork plugin perf.** Today `betterclaw hook <event>` cold-starts Node per invocation (~100-150ms). If users hit this in practice, a socket-resident enforcement path on the daemon brings it down to ~7ms (verified in the spike).

## Want to influence the order?

Open an issue on [GitHub](https://github.com/jfan22/BetterClaw/issues) describing your use case. We look at usage telemetry + issue volume to reorder.
