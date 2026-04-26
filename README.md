# BetterClaw

**v0.3.0** — workflow-enforcement layer for AI agents

BetterClaw is the **workflow-enforcement layer** between your AI agent and its tools. You write a paragraph; BetterClaw compiles it into a workflow graph; the plugin enforces that graph at runtime. Tools come from the host environment ([Anthropic Cowork](https://claude.com/product/claude-cowork) connectors, [OpenClaw](https://openclaw.ai) MCP servers — with [Nous Research Hermes](https://nousresearch.com/hermes-3) and OpenAI agent runtimes on the roadmap). BetterClaw doesn't own or bundle them; it gates calls to them.

What you get: (a) a declared workflow that the agent must follow, (b) snap-back-on-deviation when the agent tries to step outside, (c) approval gates that pause the run on sensitive tool calls and resume after human approval, (d) a cross-turn audit log so future sessions see what the user already handled.

## Why is this useful?

Three reasons: **compliance**, **security**, and **tracking**.

**Compliance.** Enterprises often require specific workflows for regulatory or audit reasons — "the agent must route every refund over $500 to finance, every legal redline to counsel, every customer-data export to the DPO." A declared workflow makes that requirement enforceable instead of aspirational. Auditors get exportable evidence; the agent can't quietly drift.

**Security.** Agents that run within a declared workflow can't be hijacked into unintended actions by malicious inputs (prompt injection, supply-chain prompts, hostile email content, manipulated retrieval). Anything outside the graph is blocked and flagged, so a compromised input has a bounded blast radius.

**Tracking.** A persistent audit log records every tool call — allowed, blocked, approved, denied — so reviewers can answer "what did the agent do this week?" without reading transcripts. Behavior outside the graph is especially visible, and approvals carry the approver's identity for downstream investigation.

## Walkthrough: preventing an unauthorized discount

It's a Tuesday afternoon. A customer DMs your AI support agent — built on Claude Code, Claude Desktop, or Claude Agent SDK — about a late shipment. The agent, trying to be helpful, offers a 20% discount on their next order. The customer screenshots the offer and posts it to Reddit. Within an hour, three more customers ask "where's MY 20%?" Finance asks why margin dropped this week. You discover the policy was supposed to be **max 10% goodwill credit; anything over requires manager approval** — but nothing technically enforces that on the AI. The system prompt said it. The agent ignored it. You have no audit trail of why it picked 20%.

System prompts are advisory, not enforcement. "Don't offer more than 10%" lives next to "Be helpful, be empathetic." When the LLM weights those instructions against "this customer is upset, give them something significant," the helpfulness wins. There's no second layer that says "no, this tool call is not allowed." That gap is what BetterClaw fills.

### Where BetterClaw can enforce

BetterClaw runs as a plugin inside the agent's runtime and intercepts tool calls before they execute. v0.3 supports:

- **Claude Code** (CLI) — via OpenClaw plugin
- **Claude Desktop** (Cowork) — via Cowork plugin
- **Claude Agent SDK** — with adapter work; file an issue if you need this

SaaS support products with closed runtimes (Ada, Intercom Fin, Zendesk AI, Cresta, Decagon, Forethought) cannot host BetterClaw today — their tool-call decisions happen in the vendor's cloud, where third-party plugins don't run. If you're building a new AI support agent and want this enforcement, build it on one of the runtimes above. If you're locked into a SaaS product, we have ideas for an audit-only integration but it's not in v0.3.

### Step 1: compile a workflow

Paragraph in, graph out:

```bash
betterclaw "For each support ticket: read the ticket, classify the issue, respond to the customer with a draft. If the response includes a refund or discount, route it to me for approval before posting. Always post a Slack message to #cx-escalations when an approval is needed. Never promise a feature that doesn't exist. Never issue a discount or refund without approval."
```

### Step 2: review the graph

A Mermaid diagram opens in your browser. The graph has concrete tool names like `mcp__claude_ai_Zendesk__get_ticket`, `mcp__claude_ai_Stripe__create_refund`, `mcp__claude_ai_Shopify__create_discount`, `mcp__claude_ai_Slack__post_message`. The discount and refund tools are placed in `requires_approval`. The graph has no edge that lets the agent reach those tools without going through the approval gate. You answer `y`. The graph is now active.

### Step 3: what happens next time

Customer DMs about the late shipment. The agent reads the ticket, classifies it as a shipping complaint, decides a 20% discount is appropriate. It tries to call `Shopify__create_discount({percent: 20, customer_id: "cust_123", reason: "shipping delay"})`.

BetterClaw's `before_tool_call` hook fires. The tool is in `requires_approval`, so the call is **blocked and queued** with the full params. The agent gets back a message: *"Approval queued — this tool dispatches only after a human approves. Do not retry."* It moves on (drafts a soft "I'm looking into a goodwill credit, I'll be in touch shortly" instead of shipping the discount).

Your `#cx-escalations` Slack channel pings: *"Approval needed: discount 20% to cust_123 (shipping delay)."* You see "20% is over our 10% policy." Either:

- **Deny** → the agent gets `not_dispatched` and tells the customer the issue will go through standard process.
- **Approve, edit to 10%** → the actual Stripe/Shopify call dispatches with `percent: 10`, audit log records both the original ask and your override.

Either way: the 20% never hits production. The Reddit screenshot doesn't happen.

### Step 4: the audit trail

Once a quarter your VP asks "what did the AI agent actually do?" You don't open transcripts. You export the audit log:

```bash
betterclaw telemetry export --since 2026-01-01 > q1-audit.jsonl
```

One row per attempted tool call — allowed, blocked, approved, denied — with timestamps, params, approver identity. The agent tried to promise a Q3 feature ship date that wasn't committed? Blocked as a deviation, because the graph has no node where that tool is allowed. You have evidence the AI's worst impulses were caught before they hit a customer.

## Start here

| If you want to... | Go to |
|---|---|
| Install and run it in 5 minutes | [QUICKSTART.md](./QUICKSTART.md) |
| Understand the design system | [DESIGN.md](./DESIGN.md) |
| See what's coming next | [ROADMAP.md](./ROADMAP.md) |
| See what shipped in this release | [CHANGELOG.md](./CHANGELOG.md) |
| Contribute | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Release / publish to npm | [RELEASING.md](./RELEASING.md) |
| License | [Apache-2.0](./LICENSE) |
| Architecture decisions | [docs/adrs/](./docs/adrs/) |
| Workflow-enforcement spec (for other framework authors) | [docs/SPEC.md](./docs/SPEC.md) |
| The original product pitch | [prompt.md](./prompt.md) |

## Where do tools come from?

BetterClaw doesn't ship verticals. Tools are provided by the host environment:

| Host | Tool source | Setup |
|---|---|---|
| **Cowork** (Claude Desktop) | Anthropic's verified connectors: Gmail, Google Calendar, Google Drive, Apollo.io, etc. | Enable in Claude.ai. Zero setup. |
| **OpenClaw** | User-installed MCP servers (filesystem, slack, gh, custom). | Install MCP servers via OpenClaw's MCP registry. |
| **OpenClaw + Gmail fallback** | BetterClaw's bundled Gmail integration. Requires GCP project + OAuth. | `betterclaw connect gmail` (advanced; most users should prefer Cowork). |
| **Demo / tutorial** | dummyjson.com fake catalog (no setup). | `BETTERCLAW_DEMO=1`. Tutorial only. |

Compile produces graphs that reference concrete tool names (`mcp__claude_ai_Gmail__send_email`, `mcp__filesystem__read_file`, etc.). The plugin enforces over those names regardless of source.

## Quick demo

```bash
# Tutorial path — zero external setup
BETTERCLAW_DEMO=1 betterclaw "find a wireless mouse under $50, compare the top two"

# Real workflow under Cowork (after enabling Gmail/Calendar in Claude.ai)
betterclaw "schedule a meeting next Tuesday and email the agenda"

# Real workflow under OpenClaw with your own MCP servers
betterclaw "search my Slack for messages about Q3 planning, draft a summary, ask me before posting"
betterclaw run "<the same paragraph>"
```

You'll see `[ALLOW] node=... tool=...` lines on stderr as the agent walks through the graph, and `[DEVIATION] ...` lines (with a structured error visible to the agent) whenever it tries a tool outside the current node's allowlist. The same events land as JSONL in `packages/plugin-openclaw/run.jsonl` and drive the replay / live views.

## Architecture snapshot

```
betterclaw CLI (packages/cli/bin/betterclaw)
   │ claude -p <compile-prompt>      ← prompt instructs Claude to use
   ▼                                   concrete tool names from the host
active-graph.json                      environment (mcp__claude_ai_*, etc.)
   ▲
   │ load on plugin boot
   │
BetterClaw plugin (packages/plugin-openclaw/)
   │
   ├─ before_tool_call hook  ─→  enforcement.mjs (allow / block / queue-approval)
   ├─ before_prompt_build hook  ─→  history.mjs (surface recent approvals)
   └─ no tool registration by default

Tools resolve via the host runtime:
   • Cowork: Anthropic-verified connectors (Gmail, Calendar, Drive, Apollo)
   • OpenClaw: user-installed MCP servers
   • Optional fallback: BetterClaw-bundled Gmail (`betterclaw connect gmail`)
```

The plugin owns no tools by default. The CLI's Gmail MCP daemon is dormant unless the user explicitly opts into the OpenClaw fallback path. Cowork users get Gmail / Calendar / Drive / Apollo with zero setup via Anthropic's verified connectors.

## Implementation notes

The plugin registers two native OpenClaw hooks: `before_tool_call` for the workflow gate (block deviations, queue approvals, allow valid tool calls) and `before_prompt_build` for cross-turn approval surfacing (the agent sees what the user already approved or denied out-of-band). Both fire natively as of [openclaw 2026.4.24](https://github.com/openclaw/openclaw/releases). Architecture decisions live in [`docs/adrs/`](./docs/adrs/) — most recently [ADR 0002](./docs/adrs/0002-enforcement-layer-not-vertical-bundler.md), which records the v0.3 shift from vertical bundler to enforcement layer.

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
│   ├── cli/                            @betterclaw-ai/cli
│   │   └── bin/betterclaw              compile + daemon + approval CLI
│   ├── plugin-openclaw/                OpenClaw plugin ("betterclaw")
│   │   ├── index.mjs                   thin entry — load graph, register hooks
│   │   ├── enforcement.mjs             enforcement core (decision module)
│   │   ├── history.mjs                 cross-turn approval surfacing
│   │   ├── workflow.mjs                graph loader + transition rule
│   │   ├── vertical-email.mjs          Gmail integration (opt-in fallback)
│   │   └── demo-shopping.mjs           tutorial demo (dummyjson)
│   ├── plugin-cowork/                  Cowork plugin (Claude Desktop)
│   ├── contracts/                      shared types (cloud-tier prep)
│   └── cloud/                          paid cloud backend (gated on V1 signal)
├── presets/                            bundled workflow presets
├── docs/
│   └── adrs/                           architecture decision records
├── spikes/                             empirical-verification probes
└── setup/                              setup walkthroughs
```

## Key commands

```bash
# Compile a new workflow
betterclaw "<paragraph>"       # compile → Mermaid preview → y/N → write graph
betterclaw --show              # print current graph JSON

# Inspect the last run
betterclaw view                # post-hoc replay HTML (static)
betterclaw view --watch        # live server, browser re-polls every 500ms

# Approvals (if the graph has requires_approval)
betterclaw pending             # list in-flight approval requests
betterclaw approve <id>        # approve
betterclaw deny <id>           # deny

# Pattern library
betterclaw presets             # list bundled presets
betterclaw presets <name>      # install + activate a preset
betterclaw save <name>         # snapshot active graph into ~/.betterclaw/library
betterclaw load <name>         # load a saved graph as active
betterclaw list                # show saved graphs
betterclaw fork <src> <name>   # fork from URL / gist:<id> / local path
betterclaw diff <a> <b>        # side-by-side Mermaid diff
betterclaw publish <name> --to gist   # publish via `gh gist create`

# Run the agent
betterclaw run "<task>"        # wraps `openclaw agent --local`

# Gmail fallback (OpenClaw users without Cowork)
betterclaw connect gmail       # enable BetterClaw's bundled Gmail integration
betterclaw disconnect gmail    # disable
betterclaw start               # start the Gmail MCP daemon (only if connected)
betterclaw stop                # stop
betterclaw status              # daemon pid, socket, log path

# Diagnostics
betterclaw doctor              # full setup check
openclaw plugins list
openclaw mcp list              # list MCP servers + their tools
```

## Sharing patterns

Workflow patterns are shareable artifacts. The unit of sharing is a three-file directory:

```
customer-triage/
  paragraph.md     # the English description — the portable part
  graph.json       # the compiled workflow (references concrete tool names)
  meta.json        # {name, saved_at, source, forked_from?, nodes, edges, entry, requires_approval}
```

The **paragraph is what travels well**. Graphs reference concrete host-tool names (`mcp__claude_ai_Gmail__send_email`, `mcp__filesystem__read_file`, etc.), so a graph compiled in your environment may not work in someone else's if their connectors and MCP servers differ. The paragraph compiles fresh against the recipient's environment.

Patterns go in `~/.betterclaw/library/<name>/`. `betterclaw save <name>` snapshots the active workflow; `betterclaw load <name>` brings a saved one back; `betterclaw fork <src> <name>` pulls from a URL, a local path, or `gist:<id>` (via `gh`). Publishing creates a public gist (`betterclaw publish <name> --to gist`) that others can fork with a single command. Recipients of a forked pattern can `betterclaw load` to use the cached graph as-is, OR recompile from the paragraph against their own host tools — whichever fits.

`betterclaw diff <a> <b>` renders both graphs side-by-side in one HTML page, with Mermaid highlighting: grey = unchanged, yellow = allowed_tools changed, green = added node, 🆕 label = new edge. Forks don't get a "patch" relative to their origin — they're just patterns, with `meta.json` recording where they came from.

Distribution is GitHub gists, not a custom platform. Git handles versioning; GitHub handles discovery; `gh` handles uploads.

## What's next

See [ROADMAP.md](./ROADMAP.md) for planned work — multi-user approval routing, paid cloud backend (audit log + SSO + compliance export), more host integrations, dry-run mode. Open an issue if you want to influence priority.
