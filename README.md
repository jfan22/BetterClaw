# BetterClaw

**v0.2.0** — workflow-enforced AI agents

BetterClaw creates workflow-enforced AI agents. It wraps [OpenClaw](https://openclaw.ai) and [Anthropic Cowork](https://claude.com/product/claude-cowork) (with [Nous Research Hermes](https://nousresearch.com/hermes-3) and OpenAI agent runtimes on the roadmap) via a plugin that (a) enforces a declared workflow graph on every tool call, (b) snaps the agent back when it tries to step outside the declared workflow, (c) can pause mid-run on sensitive tool calls and resume after human approval, (d) writes a cross-turn audit log so future sessions see what the user already handled.

## Why is this useful?

Three reasons: **compliance**, **security**, and **tracking**.

**Compliance.** Enterprises often require specific workflows for regulatory or audit reasons — "the agent must route every refund over $500 to finance, every legal redline to counsel, every customer-data export to the DPO." A declared workflow makes that requirement enforceable instead of aspirational. Auditors get exportable evidence; the agent can't quietly drift.

**Security.** Agents that run within a declared workflow can't be hijacked into unintended actions by malicious inputs (prompt injection, supply-chain prompts, hostile email content, manipulated retrieval). Anything outside the graph is blocked and flagged, so a compromised input has a bounded blast radius.

**Tracking.** A persistent audit log records every tool call — allowed, blocked, approved, denied — so reviewers can answer "what did the agent do this week?" without reading transcripts. Behavior outside the graph is especially visible, and approvals carry the approver's identity for downstream investigation.

Four verticals ship today: **email** (real Gmail), **shopping** (real dummyjson.com catalog), **sales** and **travel** (stubs, V2 swaps in real CRM and travel APIs respectively). Upcoming work lives in [ROADMAP.md](./ROADMAP.md).

## Start here

| If you want to... | Go to |
|---|---|
| Install and run it in 5 minutes | [QUICKSTART.md](./QUICKSTART.md) |
| Understand the design system | [DESIGN.md](./DESIGN.md) |
| See what's coming next | [ROADMAP.md](./ROADMAP.md) |
| See what shipped in this release | [CHANGELOG.md](./CHANGELOG.md) |
| Contribute (or add a vertical) | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Release / publish to npm | [RELEASING.md](./RELEASING.md) |
| License | [Apache-2.0](./LICENSE) |
| Architecture decisions | [docs/adrs/](./docs/adrs/) |
| The original product pitch | [prompt.md](./prompt.md) |

## Verticals

BetterClaw compiles to one of four verticals per workflow. The compiler auto-detects which from the paragraph (with an explicit override via `vertical: shopping` style phrases). Each vertical registers its own tool set; the plugin loads only tools for the active graph's vertical.

| Vertical | Tools | Backend |
|---|---|---|
| `email` | `gmail_search`, `gmail_read`, `gmail_draft` | `@gongrzhe/server-gmail-autoauth-mcp` (owned by the BetterClaw daemon, proxied over Unix socket) |
| `shopping` | `shop_search`, `shop_details`, `shop_compare` | **Real** — dummyjson.com (194 products, 24 categories, server-side search, no auth) |
| `sales` | `sales_find_leads`, `sales_enrich`, `sales_draft_outreach` | Stub lead catalog (5 fake leads). File header shows HubSpot / Apollo / Salesforce swap patterns. |
| `travel` | `travel_search_flights`, `travel_search_hotels`, `travel_compare_flights` | Stub flight + hotel catalog. File header shows Amadeus swap pattern. |

Verticals live in `packages/plugin-openclaw/vertical-*.mjs` — adding a new one is: write a file that exports a `{id, tools, guidance_for_compiler}` object, import it in `index.mjs`, add an entry to `VERTICAL_GUIDANCE` in `packages/cli/bin/betterclaw`. ~50 LOC per vertical for the tool stubs. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full recipe.

## Quick demo

```bash
# 1. Compile a paragraph into a workflow graph. Opens Mermaid in your browser.
betterclaw "triage my inbox: flag anything from investors, draft replies for customer questions, ignore newsletters"

# 2. Review the graph in the browser. Answer y at the terminal prompt.

# 3. Run the agent. The new graph is picked up on the next turn.
betterclaw run "triage my inbox"

# 4. View a replay of what just happened
betterclaw view

# OR — watch the agent execute live in your browser:
# Terminal A:
betterclaw view --watch
# Terminal B:
betterclaw run "triage my inbox"
# Browser auto-refreshes every 500ms as the agent steps through the graph.
```

You'll see `[ALLOW] node=... tool=...` lines on stderr as the agent walks through the graph, and `[DEVIATION] ...` lines (with a structured error visible to the agent) whenever it tries a tool outside the current node's allowlist. The same events land as JSONL in `packages/plugin-openclaw/run.jsonl` and drive the replay / live views.

## Architecture snapshot

```
betterclaw CLI (packages/cli/bin/betterclaw)
   │ claude -p <compile-prompt>
   ▼
active-graph.json   ←  read once at plugin init
   ▲
   │
BetterClaw plugin (packages/plugin-openclaw/index.mjs)
   │
   ├─ registerTool("gmail_search")  ─┐
   ├─ registerTool("gmail_read")    ─┤  each handler:
   ├─ registerTool("gmail_draft")   ─┤   1. enforceGate(toolName)  →  block on deviation
   └─ registerTool("gmail_ping")    ─┘   2. gmail.callTool(childToolName, params)
                                            │
                                            ▼
                            GmailMcpClient  (packages/plugin-openclaw/mcp-proxy-client.mjs)
                                            │ JSON-RPC over Unix socket
                                            ▼
                               BetterClaw daemon  (~/.betterclaw/mcp.sock)
                                            │ stdio MCP JSON-RPC
                                            ▼
                            @gongrzhe/server-gmail-autoauth-mcp  (daemon-owned subprocess)
                                            │ Gmail API
                                            ▼
                                         Gmail
```

The daemon (`betterclaw start` / `stop` / `status`) owns the Gmail MCP subprocess on behalf of both the plugin and the CLI's approval dispatcher. Because the plugin is pure code (no `child_process.spawn`), `openclaw plugins install` no longer requires the `--dangerously-force-unsafe-install` flag. Gmail OAuth state also persists across agent turns via the one long-lived child.

## Implementation notes

Enforcement registers two native OpenClaw hooks: `before_tool_call` for the workflow gate (block deviations, queue approvals, allow valid tool calls) and `before_prompt_build` for cross-turn approval surfacing (the agent sees what the user already approved or denied out-of-band). Both fire natively as of [openclaw 2026.4.24](https://github.com/openclaw/openclaw/releases) — earlier BetterClaw releases (v0.2.0 and earlier) carried workarounds for two upstream gaps that have since been fixed (PRs [#71159](https://github.com/openclaw/openclaw/pull/71159) and [#70625](https://github.com/openclaw/openclaw/pull/70625)). Architecture decisions are tracked in [`docs/adrs/`](./docs/adrs/).

## Project layout

Monorepo under `packages/` (pnpm workspaces, see `pnpm-workspace.yaml`):

```
BetterClaw/
├── README.md                           this file
├── prompt.md                           original pitch
├── DESIGN.md                           dual-aesthetic design system
├── ROADMAP.md                          what's coming next
├── CHANGELOG.md                        release history
├── pnpm-workspace.yaml                 workspace manifest
├── packages/
│   ├── cli/                            @betterclaw/cli
│   │   ├── package.json
│   │   └── bin/
│   │       └── betterclaw              compiler + daemon + approval CLI
│   ├── plugin-openclaw/                the OpenClaw plugin (name: "betterclaw")
│   │   ├── package.json
│   │   ├── openclaw.plugin.json
│   │   ├── index.mjs                   plugin entry — tool registration + enforcement gate
│   │   ├── mcp-proxy-client.mjs        Unix-socket MCP client — talks to the BetterClaw daemon
│   │   ├── workflow.mjs                graph loader + transition rule + circuit breaker
│   │   └── active-graph.json           the current workflow (rewritten by `betterclaw <paragraph>`)
│   ├── plugin-cowork/                  SCAFFOLD — Cowork/Claude Desktop plugin, Week 3+
│   ├── contracts/                      SCAFFOLD — shared types between plugin + cloud, filled in with cloud work
│   └── cloud/                          SCAFFOLD — paid cloud backend, gated on Week 3 validation
├── presets/                            bundled workflow presets (one dir per vertical)
├── docs/
│   └── adrs/                           architecture decision records
├── spikes/
│   └── cowork-hook-verify/             verification spike for Cowork plugin SDK (ADR 0001)
└── setup/
    └── gcp-oauth-walkthrough.md        one-time Google Cloud setup guide
```

Presets, docs, and spikes stay at repo root because they're shared across packages, not package-scoped.

## Key commands

```bash
# Compile a new workflow
betterclaw "<paragraph>"       # compile → Mermaid preview → y/N → write graph
betterclaw --show              # print current graph JSON

# Inspect the last run
betterclaw view                # post-hoc replay HTML (static)
betterclaw view --watch        # live server, browser re-polls every 500ms
                               # also exposes Approve/Deny buttons for pending requests

# Approvals (if the graph has requires_approval)
betterclaw pending             # list in-flight approval requests
betterclaw approve <id>        # approve
betterclaw deny <id>           # deny

# Library / marketplace
betterclaw presets             # list bundled presets (one per vertical, ready to use)
betterclaw presets <name>      # install + activate a preset in one command
betterclaw save <name>         # snapshot active graph into ~/.betterclaw/library
betterclaw load <name>         # load a saved graph as active
betterclaw list                # show saved graphs (name, nodes/edges, approvals count, saved timestamp)
betterclaw fork <src> <name>   # fork from URL / gist:<id> / local path
betterclaw diff <a> <b>        # side-by-side Mermaid diff — grey=same, yellow=tools changed, green=added
betterclaw publish <name> --to gist   # publish via `gh gist create` (requires gh CLI)

# Run the agent
betterclaw run "<task>"        # auto-starts daemon, wraps `openclaw agent --local`

# Daemon
betterclaw start               # start the Gmail MCP proxy daemon (idempotent)
betterclaw stop                # stop
betterclaw status              # pid, socket, log path

# Diagnostics
betterclaw doctor              # full setup check
openclaw plugins list
openclaw plugins inspect betterclaw
openclaw mcp list
```

## Sharing / forking (marketplace)

Workflow graphs are shareable artifacts. The unit of sharing is a three-file directory:

```
customer-triage/
  graph.json       # the compiled workflow
  paragraph.md     # the English description it was compiled from
  meta.json        # {name, saved_at, source, forked_from?, nodes, edges, entry, requires_approval}
```

Graphs go in `~/.betterclaw/library/<name>/`. `betterclaw save <name>` snapshots the active graph; `betterclaw load <name>` brings a saved one back; `betterclaw fork <src> <name>` pulls from a URL, a local path, or `gist:<id>` (via `gh`). Publishing creates a public gist (`betterclaw publish <name> --to gist`) that others can fork with a single command.

The `betterclaw diff <a> <b>` command renders both graphs side-by-side in one HTML page, with Mermaid highlighting: grey = unchanged, yellow = allowed_tools changed, green = added node, 🆕 label = new edge. Forks don't get a "patch" relative to their origin — they're just graphs, with `meta.json` recording where they came from. If you want diffs, run `betterclaw diff <origin> <fork>`.

Distribution is GitHub gists, not a custom platform. Git handles versioning; GitHub handles discovery; `gh` handles uploads. If/when this scales, ClawHub is the obvious next step.

## What's next

See [ROADMAP.md](./ROADMAP.md) for the planned V2 / V3 work — real backends for the stub verticals, more vertical types, multi-user approval routing, dry-run mode, marketplace, and adapters for additional agent runtimes. Open an issue if you want to influence priority.
