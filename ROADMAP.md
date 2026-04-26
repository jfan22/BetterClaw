# BetterClaw Roadmap

What we're working on next, in rough order. No commitments, no timelines — we ship when we ship, and signal from real users will reorder this list. File issues to vote on what should move up.

## What runtimes BetterClaw enforces today

v0.3.0 ships enforcement adapters for two agent runtimes:

| Runtime | Adapter |
|---|---|
| Claude Code (CLI) | `packages/plugin-openclaw` |
| Claude Desktop (Cowork) | `packages/plugin-cowork` |

Other runtimes (Claude Agent SDK, LangGraph, CrewAI, Hermes) are planned but not yet implemented. File an issue if you need one.

## Themes we're investing in next

- **Compile prompt iteration.** Real-world paragraphs occasionally produce graphs with wrong tool names, missing approval gates, or odd shapes. Each issue informs a small prompt fix. Telemetry from real installs is what tells us which patterns matter.
- **Approval routing.** Multi-user role + threshold rules so the right person sees the right approval. Today only the active user can approve.
- **Dry-run mode.** Run a graph against historical data without external side effects. Useful for reviewing a new agent before it touches production.
- **Better deviation messages.** When the agent calls a tool outside the graph, today's error is mechanical. Make it agent-actionable so the agent recovers cleanly.
- **More host-runtime adapters.** Claude Agent SDK is the most-requested. LangGraph, CrewAI, Hermes after.

## Exploratory

- **Cloud-tier audit log.** Hash-chained, multi-user, exportable for compliance. Exists in BetterClaw's longer-term thinking; gated on real signal that customers want to pay for it.
- **Pattern library.** Public catalog of workflow paragraphs (and reference graphs that compile from them). Today's `betterclaw publish --to gist` already shares the paragraph + graph + meta as a unit. A real catalog makes patterns discoverable. Whether it ships depends on whether enough patterns get shared via gist first to suggest demand. Note: in v0.3, paragraphs travel better than graphs — graphs reference concrete host-tool names, paragraphs recompile against the recipient's environment, so the unit of sharing is the pattern, not the graph.
- **UX polish.** Paragraph-edit graph diff, what-if simulation, natural-language audit query.
- **Integrations with closed SaaS AI products** (Ada / Intercom Fin / Zendesk AI / Cresta / etc.). Their runtimes don't host plugins, so BetterClaw's v0.3 model doesn't apply directly. We're exploring audit-only ingestion via webhooks as a starting point. File an issue if your team is locked into a SaaS product and wants to talk through what would be useful.

## Maintenance

- **Cowork plugin perf.** Hook dispatch is ~100-150ms today (Node cold start). Socket-resident path drops it to ~7ms when latency starts mattering.
- **Connector hint list.** `COMMON_COWORK_CONNECTORS` in the CLI tracks Anthropic-shipped connectors; needs updates as that list evolves.

## Want to influence the order?

Open an issue on [GitHub](https://github.com/jfan22/BetterClaw/issues) describing your use case. We look at usage telemetry + issue volume to reorder.
