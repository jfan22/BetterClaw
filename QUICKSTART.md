# BetterClaw QUICKSTART

Zero-to-first-agent in about 5 minutes. Three install paths depending on which agent runtime you use:

| Path | Best for | Setup |
|---|---|---|
| **A. Cowork (Claude Desktop)** | Non-developers, fastest path | ~5 min, no GCP setup |
| **B. OpenClaw (CLI)** | Developers running their own MCP servers | ~10 min |
| **C. Demo (no real tools)** | Trying BetterClaw out before committing | ~3 min |

**Supported platforms** (verified end-to-end as of v0.3.16):

- ✅ Linux
- ✅ macOS
- ✅ Windows (PowerShell or Git Bash; both work for the CLI install + compile + Cowork plugin paths)

## 0. Prerequisites (all paths)

- **Node 22+** ([nvm](https://github.com/nvm-sh/nvm) on Linux/macOS, [nvm-windows](https://github.com/coreybutler/nvm-windows) on Windows). Verify: `node --version`.

- **Claude CLI** — the `claude` command-line binary. **This is NOT the same as Claude Desktop** (which is the GUI app for Cowork). BetterClaw needs the CLI for its compile step (`paragraph → graph` runs through `claude -p` as a subprocess). Cowork users still need it.

  Install via npm (cross-platform):

  ```bash
  npm install -g @anthropic-ai/claude-code
  claude     # interactive auth — sign in via browser
  claude --version    # confirm install
  ```

- **Git Bash** (Windows only). Claude CLI on Windows requires a bash shell to run, and BetterClaw's Cowork plugin uses a bash hook shim. Both work cleanly in Git Bash.

  Install Git for Windows from https://git-scm.com/download/win. Accept defaults; pick the "Git from the command line and also from 3rd-party software" PATH option. After install, "Git Bash" appears in the Start menu as its own terminal. **Run all BetterClaw commands from Git Bash** (not PowerShell or CMD) on Windows. Verify: `bash --version`.

  *(Linux and macOS already have a working bash; no extra step.)*

## 1. Install BetterClaw (all paths, all OSes)

```bash
npm install -g @betterclaw-ai/cli @betterclaw-ai/plugin-openclaw

betterclaw --version    # should print "betterclaw 0.3.16" or higher
```

That's it. Works on Linux, macOS, and Windows (Git Bash) — npm handles the per-platform binary shim creation. **No source clone, no symlinks, no PATH editing.**

First `betterclaw` invocation prints a one-line notice about anonymous local-only usage telemetry written to `~/.betterclaw/telemetry.jsonl` — no PII, no remote collector. Opt out any time: `betterclaw telemetry off`.

---

## Path A — Cowork (recommended for non-developers)

### A.1. Install Claude Desktop and enable connectors

Download Claude Desktop from https://claude.com/download. Sign in. In claude.ai under Settings → Connectors, enable any of:

- **Gmail**
- **Google Calendar**
- **Google Drive**
- **Apollo.io**

These are Anthropic-verified — you'll see a normal Google OAuth consent screen, not a "Google hasn't verified this app" warning. Zero GCP project, zero credentials.json.

### A.2. Install the BetterClaw Cowork plugin

```bash
npm install -g @betterclaw-ai/plugin-cowork

# Load the plugin into Claude Desktop. Path differs slightly by OS:
# - Linux / macOS / Git Bash:
claude --plugin-dir "$(npm root -g)/@betterclaw-ai/plugin-cowork"

# - Windows PowerShell:
claude --plugin-dir "$(npm root -g)\@betterclaw-ai\plugin-cowork"
```

The plugin's hook shim is a Node script (cross-platform), so it works on Linux, macOS, and Windows directly. No WSL or Git Bash required.

### A.3. Compile and run a workflow (one command)

```bash
betterclaw chat "schedule a meeting next Tuesday and email the agenda to the team"
```

`betterclaw chat` compiles your paragraph into a workflow graph (probing Claude for the *real* tool inventory available in your Cowork session — Gmail, Calendar, Drive, Apollo connector tools — and feeding those names into the compile prompt so the graph can't reference tools that don't exist), shows you a Mermaid preview, asks `y/N`, then **launches Claude with the BetterClaw plugin already loaded** so you can immediately ask the agent to do the workflow. The plugin enforces the graph at every tool call.

Two-step alternative if you want to compile and run separately:

```bash
betterclaw "<paragraph>"                # compile only — preview + y/N + write graph
claude --plugin-dir "$(npm root -g)/@betterclaw-ai/plugin-cowork"   # then start Claude
```

**Live view (optional, for the curious):**

```bash
betterclaw view --watch
```

Opens a browser tab that polls every 500ms — visited nodes turn green, traversed edges go bold, deviation attempts appear as dashed-rust ghost nodes, pending approvals surface as banners with Approve/Deny buttons. Works for both Cowork and OpenClaw runtimes as of v0.3.16.

---

## Path B — OpenClaw

### B.1. Install OpenClaw + register Claude

```bash
npm install -g openclaw@latest
openclaw models auth login --provider anthropic --method cli --set-default
```

### B.2. Install the BetterClaw plugin from npm

```bash
openclaw plugins install @betterclaw-ai/plugin-openclaw
openclaw config set plugins.allow '["betterclaw", "anthropic", "acpx"]'
openclaw config set gateway.mode local

systemctl --user restart openclaw-gateway   # Linux only
openclaw doctor                              # verify everything's green
```

(On macOS/Windows, OpenClaw uses launchd / a Windows service equivalent; restart via that mechanism. `openclaw doctor --fix` handles platform differences.)

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

This walks you through enabling BetterClaw's bundled Gmail integration, which **does** require a GCP project + OAuth setup. Most users should prefer Cowork (Path A) — that's why this path is opt-in. **Windows note:** the Gmail MCP daemon uses Unix domain sockets and is unreliable on Windows; use WSL or Cowork instead.

---

## Path C — Demo (no real tools, no setup)

For trying BetterClaw out before committing to either Cowork or OpenClaw:

```bash
BETTERCLAW_DEMO=1 betterclaw "find a wireless mouse under $50, compare the top two"
```

Demo tools (`shop_search`, `shop_details`, `shop_compare`) are clearly labeled `[DEMO]` and only registered when `BETTERCLAW_DEMO=1` is set. They don't ship in the production code path.

---

## Common steps

### Live view (any path)

In one terminal:

```bash
betterclaw view --watch
# → opens http://127.0.0.1:<port>/
```

In another terminal, run your workflow — either of these:

```bash
betterclaw chat "<your task>"     # Cowork path — compile + launch Claude in one
betterclaw run  "<your task>"     # OpenClaw path
```

The browser re-renders the Mermaid graph live as the agent steps through it: visited nodes go green, traversed edges bold, attempted deviations appear as dashed-rust ghosts. Approval gates surface as banners with Approve/Deny buttons. Works for both Cowork and OpenClaw runtimes as of v0.3.16.

### Tool inventory cache

BetterClaw probes Claude for the actual tool inventory available in your session before compiling, so the graph references real tool names rather than hardcoded hints. The result is cached at `~/.betterclaw/tool-cache.json` for one hour. If you enable a new connector in claude.ai mid-session and don't want to wait for the TTL:

```bash
betterclaw tools refresh    # force a fresh probe
betterclaw tools            # show cache state (count, age, expiry)
betterclaw tools show       # print cached names — pipe to grep
betterclaw tools clear      # delete the cache file
```

### Approvals

If the graph has `requires_approval`, the agent pauses on those tools:

```bash
betterclaw pending             # list pending approvals
betterclaw show <id>           # inspect one (params pretty-printed)
betterclaw approve <id>        # dispatch to the real tool
betterclaw deny <id>           # cancel
```

### Sharing patterns

```bash
betterclaw save customer-triage              # snapshot to ~/.betterclaw/library/
betterclaw list                              # see all saved patterns
betterclaw publish customer-triage --to gist # via `gh gist create`

# Another user, later:
betterclaw fork <gist-url> customer-triage
betterclaw load customer-triage
```

## Troubleshooting

`betterclaw doctor` first — it tells you exactly what's broken.

**`betterclaw: command not found` (after `npm install -g`)** — npm's global bin dir isn't on PATH. Run `npm config get prefix` to find it (usually `~/.npm-global` on Linux/macOS, `%APPDATA%\npm` on Windows). Add `<prefix>/bin` (or just `<prefix>` on Windows) to PATH and restart your shell.

**`error: \`claude\` CLI not found on PATH`** — you have Claude Desktop (GUI) but not Claude CLI (command-line). They're separate. Install: `npm install -g @anthropic-ai/claude-code`, then `claude` to auth.

**Claude CLI says "requires git-bash" on Windows** — install Git for Windows from https://git-scm.com/download/win, then run BetterClaw commands from the Git Bash terminal (not PowerShell or CMD).

**"plugins.allow is empty"** (OpenClaw) — `openclaw config set plugins.allow '["betterclaw", "anthropic", "acpx"]'`.

**"No API key found"** — Claude isn't the default model. `openclaw models auth login --provider anthropic --method cli --set-default`.

**Agent says "I don't have an X tool"** — the host environment doesn't expose that tool.
- Cowork: enable the relevant connector in Claude.ai.
- OpenClaw: install the relevant MCP server.
- Gmail-specifically (OpenClaw without Cowork): `betterclaw connect gmail`.

**"daemon not reachable"** or **"daemon not running"** — only relevant if you ran `betterclaw connect gmail`. `betterclaw start` to start it; `betterclaw status` to check. **Windows users:** the daemon uses Unix sockets and is unreliable on Windows; consider WSL or Cowork.

**`openclaw agent` hangs** — likely waiting for approval. `betterclaw pending` to check; if there's a pending approval, `betterclaw approve <id>` resumes.

**Compile produces an `unrecognized_action` node** — your paragraph references an action that doesn't map to any plausible host-provided tool. Either rewrite the paragraph, or enable the relevant connector / install the relevant MCP server, then recompile.

## For contributors

If you want to modify BetterClaw's source, you do need a clone. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev-setup flow (`pnpm install`, `npm link`, etc.).
