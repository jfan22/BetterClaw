# ADR 0002: BetterClaw is an Enforcement Layer, Not a Vertical Bundler

- **Status:** **Accepted** (Phase 0 spike completed 2026-04-26 — see `spikes/cowork-tool-discovery/results.md`. Stretch pass: all required capabilities verified plus a bonus enumeration surface via Claude's ToolSearch + deferred-tool model.)
- **Date:** 2026-04-26
- **Decision driver:** Realization that v0.2's "verticals" model produces a broken first-run experience for non-tech users. Without Gmail (which requires a GCP project and OAuth credentials.json — a hard wall for non-developers), no vertical actually works: shopping is dummyjson.com toy data, sales/travel are stubs, calendar doesn't exist. The right fix is architectural, not a docs rewrite.
- **Related:** ADR 0001 (Cowork plugin SDK feasibility), `spikes/cowork-tool-discovery/` (Phase 0 spike). Internal references (private): the CEO plan and the detailed v0.3 refactor plan live outside the public repo.

## Context

BetterClaw v0.1-v0.2 shipped four verticals as plugin-bundled modules:

| Vertical | Implementation | Reality |
|---|---|---|
| `vertical-email.mjs` | Real Gmail MCP integration | Works, but requires GCP project + OAuth credentials.json setup. Non-tech-user installs ~5%. |
| `vertical-shopping.mjs` | dummyjson.com calls | Toy data. Demo only. Not a real shopping experience. |
| `vertical-sales.mjs` | Stub | Was supposed to be HubSpot. Never built. |
| `vertical-travel.mjs` | Stub | Was supposed to be Amadeus or Duffel. Never built. |

The verticals were originally framed as "BetterClaw's domain coverage." In practice they were demo scaffolding from the prototype phase. Two of four are stubs, one is fake data, and the only real one (Gmail) has an installation cliff that excludes the target buyer (non-technical users running AI agents).

This is an architectural mismatch: BetterClaw's actual product is the **enforcement layer** (declarative graph compilation, approval gates, audit log, snap-back-on-deviation). The verticals were never the product. Bundling them into the plugin made BetterClaw look like a "Gmail tool with workflow enforcement" instead of "a workflow-enforcement layer that can run over any tools the host environment provides."

Meanwhile, the host environments BetterClaw targets already provide tools:

- **Cowork (Anthropic Claude Desktop):** Anthropic ships verified OAuth integrations for Gmail, Google Calendar, Google Drive, and Apollo.io. Zero user setup. Already covers what `vertical-email`, the missing calendar vertical, and `vertical-sales` would have done (Apollo is a stronger sales tool than HubSpot for V1 anyway).
- **OpenClaw CLI:** Power users configure their own MCP servers (gh, filesystem, slack, custom MCPs). They bring their own tools.

In both environments, BetterClaw's verticals duplicate or fake what the host already has.

## Decision

**BetterClaw v0.3.0 refactors from a vertical bundler to a host-tool enforcement layer.**

- The plugin enforces graphs over tools that the host environment provides. It does not own or bundle verticals.
- The CLI's compile step accepts any tool name registered in the host environment. Graphs reference tool names like `mcp__claude_ai_Gmail__send_email` (Cowork) or `slack.post_message` (user MCP), not BetterClaw-specific abstractions.
- Stub verticals (`vertical-sales.mjs`, `vertical-travel.mjs`) are deleted in v0.3.0.
- `vertical-shopping.mjs` is renamed to `demo-shopping.mjs` and registered only under a `--demo` flag. It exists for tutorial/example purposes, not as a feature.
- `vertical-email.mjs` is preserved for OpenClaw CLI users who don't have a Gmail MCP of their own (kept as an opt-in fallback). For Cowork users, the plugin enforces directly on Cowork's existing Gmail connector. No duplicate Gmail MCP runs.
- The Gmail MCP daemon in the CLI (`packages/cli/bin/betterclaw`'s `~/.betterclaw/mcp.sock`) becomes optional. It only starts when the user has explicitly opted into the OpenClaw fallback path.

### Plugin responsibility (post-refactor)

```
INSTEAD OF:                          NOW:
plugin                               plugin
├── vertical-email.mjs (real)        ├── enforcement engine
├── vertical-shopping.mjs (fake)     ├── graph state machine
├── vertical-sales.mjs (stub)        ├── approval gate dispatcher
├── vertical-travel.mjs (stub)       └── audit log writer
└── Gmail MCP daemon                 (no verticals — enforces on whatever
                                      tools the host provides)
```

The plugin's job is now clean: receive `PreToolUse` hook fires from the host, look up the current graph node, decide allow / deny / require-approval based on graph rules, write to audit log, return the decision. It does not know what Gmail or Calendar are. It knows tool names and graph rules.

### Compile-side changes

The CLI's paragraph→graph compiler resolves tool names from the host environment at compile time:

- **Cowork:** queries the Cowork plugin context for available connector tool names. Compiles the user's paragraph into a graph that references those concrete tool names.
- **OpenClaw:** queries the user's configured MCP server tool registry (`openclaw mcp list`). Compiles against those.
- **Bare environment with no tools:** compiler errors with a clear message: "No tools registered. Install at least one MCP server or enable Cowork connectors."

This means a Cowork user with Gmail + Calendar enabled can say "schedule a meeting next Tuesday and email the agenda" and the compile step produces a graph with concrete tool calls to `mcp__claude_ai_Google_Calendar__create_event` and `mcp__claude_ai_Gmail__send_email`. No new vertical code on BetterClaw's side. Calendar comes for free.

### What this is NOT

- **Not a tool-discovery framework.** The plugin doesn't proxy or wrap tools. The host calls tools directly; the plugin only enforces the graph rules over those calls via hooks.
- **Not "remove all Gmail support."** OpenClaw users without a Gmail MCP can still opt into the BetterClaw-bundled Gmail integration (which keeps the GCP-project setup as a power-user path). It's just no longer the default.
- **Not "Cowork-only V1."** OpenClaw remains a first-class target. Both paths now work the same way: enforce over whatever tools are present. The OpenClaw path simply requires more user-side setup because OpenClaw doesn't ship pre-verified connectors.

## Consequences

### Positive

1. **Non-tech users have a working path.** Cowork users get Gmail, Calendar, Drive, and Apollo with zero setup. The 95%-bounce-at-GCP-project problem is solved by routing those users through Cowork instead of through BetterClaw's own Gmail MCP.
2. **Calendar exists.** It comes from Anthropic's verified Google Calendar connector. BetterClaw never has to build or maintain a calendar integration.
3. **Sales is real (via Apollo).** Apollo is more relevant to V1's likely Tier 1 personas (sales ops / RevOps) than HubSpot would have been. And it's already connected.
4. **Plugin shrinks.** Stub verticals, dummy data, and GCP-setup paths in the CLI all go away. Plugin moves toward "pure enforcement" which matches the product narrative.
5. **README pitch sharpens.** "BetterClaw is the workflow-enforcement layer over your AI agent's tools" is a tighter, more honest pitch than "BetterClaw bundles four verticals."
6. **Docs lose the Gmail-setup wall.** The GCP-project + OAuth dance moves to a "Power user / advanced setup for OpenClaw without Gmail MCP" page. Off the golden path.

### Negative

1. **Cowork is the zero-setup path.** After this refactor, BetterClaw's smoothest non-developer experience runs through Cowork's verified connectors. The OpenClaw fallback and the Claude Agent SDK adapter remain available for setups that need a different path.
2. **Bare-OpenClaw-no-MCP users see an empty environment.** Today they at least see the dummy verticals as something to play with. After the refactor, they get a "no tools registered" error. We should mitigate with a clear setup guide pointing at the OpenClaw MCP registry or the BetterClaw Gmail fallback.
3. **The compile step gets more complex.** Tool registry resolution at compile time is real work. Today the verticals are hardcoded; tomorrow they're discovered from the environment.
4. **v0.2 → v0.3 is a breaking change for users who relied on the stub verticals.** Mitigation: nobody actually relies on them because they don't work. Document in CHANGELOG, point migrations at Cowork connectors or user-configured MCPs.
5. **Loses the "all-in-one demo" framing.** "BetterClaw bundles email, shopping, sales, travel" was a marketing-friendly story even if the verticals were stubs. The new pitch ("we enforce over your tools") requires the user to understand a slightly more abstract concept.

### Neutral

- **OpenClaw plugin still ships.** It's not deprecated. It just stops bundling verticals.
- **CLI still ships.** It just stops being a Gmail MCP daemon by default.
- **Existing v0.2 graphs continue to work** as long as the tools they reference exist in the new environment. Backward-compatible at the graph format level.

## Implementation outline

Detailed phased plan lives in the internal eng-plans archive (private). Summary of what executed:

1. Plugin: extract enforcement core from `index.mjs`, delete vertical files (sales, travel), gate shopping behind `--demo` flag.
2. CLI: add tool-registry resolution at compile time. Make Gmail MCP daemon opt-in via `betterclaw connect gmail` (OpenClaw fallback path).
3. CLI: detect host environment (Cowork vs OpenClaw) and pick the right tool registry source.
4. Cowork plugin: add `betterclaw-cowork` tool-availability adapter that pipes Cowork's connector tool names into the CLI's compile context.
5. Docs: rewrite README pitch, move GCP-setup to advanced section, document the "Cowork users get tools for free" path as primary.

## Open Questions

1. **(RESOLVED 2026-04-26)** ~~Can the Cowork plugin reliably enumerate which Anthropic connectors a user has enabled?~~ **Resolved via Phase 0 spike (`spikes/cowork-tool-discovery/`):** Anthropic connectors are exposed as **deferred tools** with names visible at session start (via Claude's system-reminder messages) and schemas loadable on-demand via Claude's `ToolSearch` built-in. Spike observed `total_deferred_tools: 50` in response. BetterClaw's compile step uses ToolSearch + deferred-tool names instead of needing a bespoke registry adapter. This simplifies the architecture; no plugin-side enumeration code needed.
2. **Does the OpenClaw CLI expose its registered MCP tool names to plugins via the existing API?** Spike: check `getGlobalToolRegistry()` or equivalent. If not, file an upstream PR adding the surface. (Less critical now that the Cowork path uses ToolSearch; OpenClaw users typically have their own MCP servers and can list them via `openclaw mcp list`.)
3. **What's the migration path for users with v0.2 Gmail working today?** Probably: their `vertical-email.mjs` configuration continues to work in v0.3 as the OpenClaw fallback, with a one-line CHANGELOG note. Confirm during refactor.
4. **Should the demo shopping vertical move out of the plugin entirely?** Argument for: it's not enforcement, it's a tutorial. Argument against: it's useful to have one self-contained demo path that requires zero setup. Lean toward keeping it under `--demo` flag in the plugin for now; revisit after v0.3 ships.
5. **(NEW from spike)** Does `permissionDecision: "deny"` work on MCP tool calls (not just Bash/Write/Edit)? The hook output schema is identical, so it should work, but verify with a 10-min test in Phase 1.
6. **(NEW from spike)** Concurrent matcher hooks need single-writer audit log. The spike showed interleaved log writes when 4 matchers fired in parallel for the same tool call. Production plugin must route all matchers through one audit writer with file locking (already the pattern `telemetry.mjs` uses).

## Next Actions

1. **(REVISED 2026-04-26 after Phase 0 spike passed):** Skip the v0.2.0 npm publish entirely. v0.2.0 stays as a git tag for history; v0.3.0 becomes the first npm release.
2. Merge v0.2.1 branch (drop OpenClaw hook workarounds) to main with `--no-ff`. v0.2.1 stays as git tag. No npm publish.
3. Begin v0.3.0 refactor on top of merged v0.2.1. (Detailed phased plan in the internal eng-plans archive.)
4. Document the OpenClaw fallback path and Claude Agent SDK adapter as the alternate routes for users who can't or don't want to run Cowork.

## Spike findings summary (2026-04-26)

Full results: `spikes/cowork-tool-discovery/results.md`. Highlights:

- **Tool name format confirmed:** `mcp__claude_ai_<Service>__<action>` (verified with Calendar's `list_calendars`).
- **Multiple matchers fire concurrently** for one call. BetterClaw can layer service-specific + global enforcement hooks without interference.
- **Hook latency 8-12ms.** Well under 50ms target.
- **Bonus: Claude's ToolSearch + deferred-tool model is the enumeration mechanism.** Compile step uses ToolSearch to find relevant tools for a paragraph; no plugin-side registry adapter needed.
- **Probe artifact noted:** concurrent matchers writing to one log file produced interleaved output. Production plugin uses single-writer audit log with file locking (already the pattern in `telemetry.mjs`).

## References

- ADR 0001: Cowork Plugin SDK Feasibility
- v0.3 refactor plan: internal (eng-plans archive)
- Cowork connector list (verified in current Claude Desktop session): Gmail, Google Calendar, Google Drive, Apollo.io
- OpenClaw MCP server registry: <https://github.com/openclaw/mcp-registry>
