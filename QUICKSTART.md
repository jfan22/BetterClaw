# BetterClaw QUICKSTART

Zero-to-first-agent in about 5 minutes. Three install paths depending on which agent runtime you use:

| Path | Best for | Setup |
|---|---|---|
| **A. Cowork (Claude Desktop)** | Non-developers, fastest path | ~5 min, no GCP setup |
| **B. OpenClaw (CLI)** | Developers running their own MCP servers | ~10 min |
| **C. Demo (no real tools)** | Trying BetterClaw out before committing | ~3 min |

## 0. Prerequisites (all paths)

- **Node 22+** (`nvm install 22 && nvm use 22 && nvm alias default 22`)
- **pnpm** (`npm install -g pnpm`, or see https://pnpm.io/installation)
- **Claude CLI** authenticated (`claude --version` should work)

## 1. Install BetterClaw (all paths)

```bash
git clone https://github.com/jfan22/BetterClaw.git ~/Prj/BetterClaw
cd ~/Prj/BetterClaw
pnpm install

# Symlink the CLI onto your PATH
ln -sf $PWD/packages/cli/bin/betterclaw ~/.local/bin/betterclaw

betterclaw --version    # should print "betterclaw 0.3.0"
```

First `betterclaw` invocation prints a one-line notice about anonymous usage telemetry written to `~/.betterclaw/telemetry.jsonl` — no PII, local-only, no remote collector. Opt out any time: `betterclaw telemetry off`.

---

## Path A — Cowork (recommended for non-developers)

### A.1. Install Claude Desktop and enable the connectors you want

Download Claude Desktop, sign in, and in claude.ai under Settings → Connectors, enable any of:

- **Gmail**
- **Google Calendar**
- **Google Drive**
- **Apollo.io**

Anthropic ships verified OAuth — click through the standard Google consent screen. **No GCP project, no credentials.json.** Zero developer setup.

### A.2. Install the BetterClaw Cowork plugin

```bash
claude --plugin-dir $PWD/packages/plugin-cowork
```

This loads the BetterClaw Cowork plugin into Claude Desktop. The plugin enforces over the connectors you enabled in step A.1.

### A.3. Compile and run a workflow

```bash
betterclaw "schedule a meeting next Tuesday and email the agenda to the team"
```

BetterClaw compiles your paragraph into a graph that references concrete tool names like `mcp__claude_ai_Google_Calendar__create_event` and `mcp__claude_ai_Gmail__send_email`. A Mermaid preview opens in your browser. Answer `y`. Then in Claude Desktop, ask the agent to do that workflow — the plugin enforces the graph.

---

## Path B — OpenClaw (developer route)

### B.1. Install OpenClaw + register Claude

```bash
npm install -g openclaw@latest
openclaw models auth login --provider anthropic --method cli --set-default
openclaw doctor    # verify
```

### B.2. Install the BetterClaw plugin

```bash
openclaw plugins install $PWD/packages/plugin-openclaw --link
openclaw config set plugins.allow '["betterclaw"]'
```

### B.3. Bring your own tools

OpenClaw users provide tools via MCP servers. Install the ones you want via `openclaw mcp` — filesystem, slack, gh, custom. BetterClaw enforces over whatever tools your MCP servers expose.

### B.4. Compile and run

```bash
betterclaw "<your paragraph>"
betterclaw run "<the same paragraph>"
```

### B.5. (Optional) Gmail without Cowork

If you want Gmail under OpenClaw and don't want to use Cowork:

```bash
betterclaw connect gmail
```

This walks you through enabling BetterClaw's bundled Gmail integration, which **does** require a GCP project + OAuth setup. Most users should prefer Cowork (Path A) — that's why this path is opt-in.

---

## Path C — Demo (no real tools, no setup)

For trying BetterClaw out before committing to either Cowork or OpenClaw:

```bash
# Tutorial demo — uses dummyjson.com fake catalog, zero auth
BETTERCLAW_DEMO=1 betterclaw "find a wireless mouse under $50, compare the top two"
```

Demo tools are clearly labeled `[DEMO]` and only registered when `BETTERCLAW_DEMO=1` is set. They don't ship in the production code path.

---

## Common steps

### Live view (any path)

In one terminal:
```bash
betterclaw view --watch
# → opens http://127.0.0.1:<port>/
```

In another terminal:
```bash
betterclaw run "<your task>"
```

The browser re-renders the Mermaid graph live as the agent steps through it: visited nodes go green, traversed edges bold, attempted deviations appear as dashed red ghosts. Approval gates surface as banners with Approve/Deny buttons.

### Approvals

If the graph has `requires_approval`, the agent pauses on those tools:

```bash
betterclaw pending             # list pending approvals
betterclaw show <id>           # inspect one (params pretty-printed)
betterclaw approve <id>        # dispatch to the real tool
betterclaw deny <id>           # cancel
```

### Sharing

```bash
betterclaw save customer-triage              # snapshot to ~/.betterclaw/library/
betterclaw list                              # see all saved graphs
betterclaw publish customer-triage --to gist # via `gh gist create`

# Another developer, later:
betterclaw fork <gist-url> customer-triage
betterclaw load customer-triage
```

## Troubleshooting

`betterclaw doctor` first — it tells you exactly what's broken.

**"plugins.allow is empty"** (OpenClaw) — `openclaw config set plugins.allow '["betterclaw"]'`.

**"No API key found"** — Claude isn't the default model. `openclaw models auth login --provider anthropic --method cli --set-default`.

**Agent says "I don't have an X tool"** — the host environment doesn't expose that tool.
- Cowork: enable the relevant connector in Claude.ai.
- OpenClaw: install the relevant MCP server (`openclaw mcp install <name>`).
- Gmail-specifically (OpenClaw without Cowork): `betterclaw connect gmail`.

**"daemon not reachable"** or **"daemon not running"** — only relevant if you ran `betterclaw connect gmail`. `betterclaw start` to start it; `betterclaw status` to check.

**`openclaw agent --local` hangs** — likely waiting for approval. `betterclaw pending` to check; if there's a pending approval, `betterclaw approve <id>` resumes.

**Compile produces an `unrecognized_action` node** — your paragraph references an action that doesn't map to any plausible host-provided tool. Either rewrite the paragraph, or enable the relevant connector / install the relevant MCP server, then recompile.
