# BetterClaw

Paragraph-in, workflow-enforced AI agents. Wraps OpenClaw with a plugin that (a)
exposes scoped tools via OpenClaw's loopback MCP, (b) enforces a declared
workflow graph on every tool call, (c) snaps the agent back when it tries to step
outside the declared workflow, (d) can pause mid-run on sensitive tool calls and
resume after human approval.

Four verticals in the v0.1: **email**, **shopping**, **sales**, **travel**.

**→ New here? Read [QUICKSTART.md](./QUICKSTART.md) — zero-to-first-agent in 5 minutes.**

**→ Contributing (or adding a vertical): [CONTRIBUTING.md](./CONTRIBUTING.md)**

**→ Backstory and lessons: [RETRO.md](./RETRO.md)**

**→ Design doc:** `~/.gstack/projects/BetterClaw/jfan-unknown-design-20260420-101229.md`

## Verticals

BetterClaw compiles to one of four verticals per workflow. The compiler auto-detects which from the paragraph (with an explicit override via `vertical: shopping` style phrases). Each vertical registers its own tool set; the plugin loads only tools for the active graph's vertical.

| Vertical | Tools | Backend |
|---|---|---|
| `email` | `gmail_search`, `gmail_read`, `gmail_draft` | `@gongrzhe/server-gmail-autoauth-mcp` (spawned child) |
| `shopping` | `shop_search`, `shop_details`, `shop_compare` | Embedded catalog (12 products — electronics, clothing, jewelery) |
| `sales` | `sales_find_leads`, `sales_enrich`, `sales_draft_outreach` | Embedded lead catalog (5 fake leads) — stub; swap for HubSpot/Salesforce MCP later |
| `travel` | `travel_search_flights`, `travel_search_hotels`, `travel_compare_flights` | Embedded flight + hotel catalog — stub; swap for Amadeus/Sabre later |

Verticals live in `plugins/betterclaw/vertical-*.mjs` — adding a new one is: write a file that exports a `{id, tools, guidance_for_compiler}` object, import it in `index.mjs`, add an entry to `VERTICAL_GUIDANCE` in `cli/betterclaw`. ~50 LOC per vertical for the tool stubs.

## Status — v1 demo shippable (2026-04-21)

- [x] Node 22 installed via nvm (default alias)
- [x] OpenClaw CLI installed globally (`openclaw@latest`, v2026.4.15)
- [x] Gmail OAuth (throwaway test account, `~/.gmail-mcp/credentials.json`)
- [x] BetterClaw plugin installed (link mode) at `~/.openclaw/extensions/betterclaw/`
- [x] Gmail-shaped loopback tools: `gmail_search`, `gmail_read`, `gmail_draft`, `gmail_ping`
- [x] Plugin-owned child Gmail MCP (`@gongrzhe/server-gmail-autoauth-mcp` spawned via stdio)
- [x] Inline workflow enforcement (gate at the top of each tool handler)
- [x] Paragraph → workflow graph compiler (`betterclaw "..."` via `claude -p`)
- [x] Mermaid HTML visual confirmation + y/N approval gate
- [x] Test inbox seeded with 5+ emails including a prompt-injection one
- [x] End-to-end verified: happy path + deviation block + prompt-injection defense

## Quick demo

```bash
# 1. Compile a paragraph into a workflow graph. Opens Mermaid in your browser.
betterclaw "triage my inbox: flag anything from investors, draft replies for customer questions, ignore newsletters"

# 2. Review the graph in the browser. Approve with y in the terminal.

# 3. Run the agent. The new graph is picked up on the next turn.
openclaw agent --local --agent main -m "triage my inbox"

# 4. View a replay of what just happened
betterclaw view

# OR — watch the agent execute live in your browser:
# Terminal A:
betterclaw view --watch
# Terminal B:
openclaw agent --local --agent main -m "triage my inbox"
# Browser auto-refreshes every 500ms as the agent steps through the graph.
```

You'll see `[ALLOW] node=... tool=...` lines on stderr as the agent walks
through the graph, and `[DEVIATION] ...` lines (+ a structured error visible
to the agent) whenever it tries a tool outside the current node's allowlist.
The same events land as JSONL in `~/.openclaw/extensions/betterclaw/run.jsonl`
and drive the replay / live views.

## Architecture snapshot

```
betterclaw CLI (cli/betterclaw)
   │ claude -p <compile-prompt>
   ▼
active-graph.json   ←  read once at plugin init
   ▲
   │
BetterClaw plugin (plugins/betterclaw/index.mjs)
   │
   ├─ registerTool("gmail_search")  ─┐
   ├─ registerTool("gmail_read")    ─┤  each handler:
   ├─ registerTool("gmail_draft")   ─┤   1. enforceGate(toolName)  →  block on deviation
   └─ registerTool("gmail_ping")    ─┘   2. gmail.callTool(childToolName, params)
                                            │
                                            ▼
                            GmailMcpClient  (plugins/betterclaw/gmail-client.mjs)
                                            │ stdio MCP JSON-RPC
                                            ▼
                            @gongrzhe/server-gmail-autoauth-mcp  (child process)
                                            │ Gmail API
                                            ▼
                                         Gmail
```

## Architecture notes that differ from the design doc

The design originally specified **A'''** — an OpenClaw plugin that registers
`before_tool_call` via `api.on("before_tool_call", handler)`. In practice, the
hook registers without error but does not fire on plugin-served tools in the
`openclaw agent --local` subprocess path. We pivoted to **inline enforcement
inside each tool handler** — same net behavior, simpler code, works by
construction because the handler itself is definitely invoked.

Everything else in the design doc carried over intact: the graph schema,
transition rules, circuit breaker, Mermaid viz, paragraph compiler.

## Project layout

```
BetterClaw/
├── README.md                          this file
├── prompt.md                          original pitch
├── cli/
│   └── betterclaw                     compiler CLI (Claude-CLI-backed, Mermaid viz, approval gate)
├── plugins/
│   ├── betterclaw/                    the BetterClaw plugin itself
│   │   ├── package.json
│   │   ├── openclaw.plugin.json
│   │   ├── index.mjs                  plugin entry — tool registration + enforcement gate
│   │   ├── gmail-client.mjs           minimal stdio MCP client for the child Gmail MCP
│   │   ├── workflow.mjs               graph loader + transition rule + circuit breaker
│   │   └── active-graph.json          the current workflow (rewritten by `betterclaw <paragraph>`)
│   └── gmail-bundle/                  DAY-1 ARTIFACT — disabled; kept for reference
└── setup/
    └── gcp-oauth-walkthrough.md       one-time Google Cloud setup guide
```

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
openclaw agent --local --agent main -m "<task>"

# Diagnostics
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

## Known issues / future work (weekend 2+)

- **Hook-based enforcement** — investigate why `api.on("before_tool_call")`
  doesn't fire for plugin tools in the `agent --local` path. Once fixed, move
  enforcement from inline gate → proper plugin hook (gets us ctx.sessionKey for
  real per-session isolation).
- **Live workflow timeline UI** — design doc's "replay-diff" idea: ghosted
  branch showing what the agent tried vs what got allowed.
- **More Gmail tools** — `gmail_modify` (labels, flag, archive), `gmail_send`
  once the workflow is trusted. Currently v1 only drafts.
- **Multi-vertical** — sales outreach, travel, shopping. Compiler prompt needs
  per-vertical tuning.
- **CI/CD + distribution** — package as npm / ClawHub. For now install path is
  `openclaw plugins install --link --dangerously-force-unsafe-install <path>`.
  (Dangerous flag is required because the plugin spawns a child process.)
