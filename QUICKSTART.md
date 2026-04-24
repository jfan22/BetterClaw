# BetterClaw QUICKSTART

Zero-to-first-agent in about 5 minutes (plus 2 minutes of Google Cloud Console for the email vertical).

## 0. Prerequisites

- **Node 22+** (use `nvm install 22 && nvm use 22 && nvm alias default 22`)
- **OpenClaw** installed globally: `npm install -g openclaw@latest`
- **Claude CLI** installed + authenticated — `openclaw doctor` will tell you

Run `openclaw doctor` to verify.

## 1. Register Claude CLI with OpenClaw (one-time)

OpenClaw needs an auth profile that points at the locally-authed Claude CLI. This command is interactive:

```bash
openclaw models auth login --provider anthropic --method cli --set-default
```

Accept the defaults.

## 2. Install BetterClaw

```bash
git clone https://github.com/jfan22/BetterClaw.git ~/Prj/BetterClaw
cd ~/Prj/BetterClaw
pnpm install                                    # pnpm workspaces — installs deps for every package

# Symlink the CLI onto your PATH
ln -sf $PWD/packages/cli/bin/betterclaw ~/.local/bin/betterclaw

# Install the OpenClaw plugin (linked so edits reflect immediately)
openclaw plugins install $PWD/packages/plugin-openclaw --link

# Tell OpenClaw the plugin is trusted
openclaw config set plugins.allow '["betterclaw"]'

# Start the Gmail MCP proxy daemon
betterclaw start
```

If you don't have pnpm, `npm install -g pnpm` first, or see https://pnpm.io/installation.

The daemon owns the Gmail MCP subprocess on behalf of both the plugin and the CLI, listening on `~/.betterclaw/mcp.sock`. One reason it exists: the plugin itself no longer spawns subprocesses, so `openclaw plugins install` no longer needs the `--dangerously-force-unsafe-install` flag it used to require. Side benefit: Gmail OAuth state persists across agent turns.

- `betterclaw start` — start detached. Idempotent.
- `betterclaw stop` — stop.
- `betterclaw status` — check daemon state.
- `betterclaw mcp-daemon` — foreground mode for debugging (stderr visible).
- `betterclaw run "<task>"` — auto-starts daemon + runs `openclaw agent --local -m "<task>"`.

First `betterclaw start` prints a one-line notice about anonymous usage telemetry written to `~/.betterclaw/telemetry.jsonl` — no PII, local-only, no remote collector. Opt out any time: `betterclaw telemetry off`. See [`betterclaw telemetry --help`](./packages/cli/README.md) for the full surface (`dump`, `export`, `dismiss-cta`).

Verify: `betterclaw doctor` should report everything GREEN except the Gmail-specific rows if you haven't done step 4.

## 3. (Optional) Also install the Cowork plugin

If you'd rather run BetterClaw inside Anthropic's Cowork (Claude Desktop) instead of — or alongside — `openclaw agent --local`, install the sibling plugin:

```bash
# Load the plugin into Claude Desktop (research-preview flow)
claude --plugin-dir $PWD/packages/plugin-cowork
```

Both plugins read the same active graph and share the same approval queue, so `betterclaw pending` / `approve <id>` / `deny <id>` work regardless of which plugin generated the request. Pick whichever runtime matches your workflow — CLI-agent folks tend toward OpenClaw, desktop-agent folks toward Cowork.

See [`packages/plugin-cowork/README.md`](./packages/plugin-cowork/README.md) for the architecture diagram and troubleshooting. ADR 0001 ([docs/adrs/](./docs/adrs/)) documents the Cowork plugin SDK verification.

## 4. (Optional) Gmail vertical setup

Only needed if you want the email vertical. Skip this section if you only care about shopping / sales / travel.

### 4a. Throwaway Gmail + Google Cloud project (~2 min)

1. Create a throwaway Gmail account (or use an existing one you don't mind the agent drafting in).
2. https://console.cloud.google.com/ → new project "BetterClaw Dev"
3. **APIs & Services → Library** → search "Gmail API" → **Enable**
4. **APIs & Services → OAuth consent screen** → walk through the wizard. Set user type to **External**. Add your throwaway Gmail as a test user.
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → application type **Desktop app** → **Create** → **Download JSON**.
6. Move the downloaded file to `~/.gmail-mcp/gcp-oauth.keys.json`:
   ```bash
   mkdir -p ~/.gmail-mcp
   mv ~/Downloads/client_secret_*.json ~/.gmail-mcp/gcp-oauth.keys.json
   ```

### 4b. Run the auth flow

```bash
npm install -g @gongrzhe/server-gmail-autoauth-mcp
npx @gongrzhe/server-gmail-autoauth-mcp auth
```

Browser opens, click through consent (you'll see "Google hasn't verified this app" — expected; click Advanced → proceed). Credentials land at `~/.gmail-mcp/credentials.json`.

## 5. Pick a preset (fastest) or compile your own

### Preset route — zero setup (shopping/sales/travel) or Gmail setup (email)

```bash
# See what's bundled
betterclaw presets

# Install one — copies into your library AND loads as the active graph
betterclaw presets shopping-compare     # no setup, works immediately
betterclaw presets sales-prospect        # no setup, stub leads
betterclaw presets travel-cheapest-flight   # no setup, stub flights
betterclaw presets email-triage          # needs step 4 above
```

### Compile route — your own paragraph

```bash
# Email triage with approval gate
betterclaw "triage my inbox: flag investor emails, draft replies for customer questions, let me approve each draft"

# Or shopping — no setup needed
betterclaw "find me a good wireless mouse under \$50 — compare the top two"

# Or travel
betterclaw "book a trip from SFO to JFK — search flights under \$400, then compare the two cheapest"

# Or sales (stub leads)
betterclaw "find 3 leads in logistics with signals of recent growth, draft personalized outreach, let me approve each draft"
```

Compiling opens a Mermaid diagram of the compiled graph in your browser. Review, answer `y` at the terminal prompt. Presets skip the review step because the graph is pre-baked.

### Run the agent

```bash
betterclaw run "<describe the task>"
```

This auto-starts the daemon if needed and runs `openclaw agent --local --agent main -m "<task>"`. You can also invoke `openclaw` directly if you prefer — just make sure `betterclaw start` has run first.

Each preset's `meta.json` has an `example_agent_message` you can paste verbatim — `betterclaw presets <name>` prints it for you.

You'll see `[ALLOW]` and `[DEVIATION]` lines on stderr. If the graph includes `requires_approval`, the agent pauses — run `betterclaw pending` then `betterclaw approve <id>` to resume.

## 6. Live view (optional but cool)

In one terminal:

```bash
betterclaw view --watch
# → opens http://127.0.0.1:<port>/ in your browser
```

In another terminal:

```bash
betterclaw run "<your task>"
```

The browser re-renders the Mermaid graph live as the agent steps through it: visited nodes go green, traversed edges bold, attempted deviations appear as dashed red ghosts off the node where the attempt fired. Approval gates surface as banners with Approve/Deny buttons.

## 7. Sharing

```bash
betterclaw save customer-triage              # snapshot to ~/.betterclaw/library/
betterclaw list                              # see all saved graphs
betterclaw publish customer-triage --to gist # publishes via gh gist create

# Another developer, later:
betterclaw fork <gist-url> customer-triage
betterclaw load customer-triage
```

## Troubleshooting

Run `betterclaw doctor` first — it tells you exactly what's broken.

**"plugins.allow is empty"** — run `openclaw config set plugins.allow '["betterclaw"]'`.

**"No API key found for provider 'openai'"** — Claude isn't the default model. Run `openclaw models auth login --provider anthropic --method cli --set-default`.

**"BetterClaw daemon not running"** or **"daemon not reachable"** — run `betterclaw start`. If `betterclaw status` shows stale PID, run `betterclaw stop && betterclaw start`. Daemon logs go to `~/.betterclaw/mcp.log`; for live output, run `betterclaw mcp-daemon` in the foreground.

**Agent says "I don't have a Gmail tool"** — either (a) you're on a non-email vertical but asked for email; (b) the plugin didn't load — check `openclaw plugins inspect betterclaw`; (c) the daemon is down — `betterclaw status`.

**`openclaw agent --local` just hangs** — the plugin may be waiting for approval. Check `betterclaw pending`. If no pending and still hanging, check for `[APPROVAL]` in the agent's stderr.

**"tail: ... | tail -N"** — don't pipe agent output through tail while iterating. `tail` buffers until the agent exits. Pipe through nothing.
