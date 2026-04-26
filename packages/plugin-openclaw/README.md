# betterclaw (OpenClaw plugin)

Workflow-enforcement layer for OpenClaw. Snaps agents back when they try to step outside the declared workflow graph. Per ADR 0002, the plugin enforces over whatever tools the host environment provides; it does not own or bundle verticals.

## What's in here

```
packages/plugin-openclaw/
├── package.json              name: "@betterclaw-ai/plugin-openclaw"
├── openclaw.plugin.json      id: "betterclaw", description, configSchema
├── index.mjs                 thin plugin entry — loads graph, registers hooks
├── enforcement.mjs           enforcement core: graph + tool call → decision
├── history.mjs               cross-turn approval-history surfacing
├── workflow.mjs              graph loader, transition rule, circuit breaker
├── mcp-proxy-client.mjs      Unix-socket MCP client (used by Phase 2 Gmail fallback)
├── telemetry.mjs             plugin-side telemetry writer
├── vertical-email.mjs        Gmail integration — kept for Phase 2 `betterclaw connect gmail` opt-in (not registered by default in v0.3+)
├── demo-shopping.mjs         tutorial demo (dummyjson.com), gated by BETTERCLAW_DEMO=1
└── active-graph.json         current workflow graph (rewritten by `betterclaw <paragraph>`)
```

The plugin is **pure code** — no subprocess spawns, no tool registration by default. That's why it installs without the `--dangerously-force-unsafe-install` flag. Real verticals (Gmail, calendar, sales, etc.) come from the host environment: Anthropic connectors when running under Cowork, user-installed MCP servers when running under OpenClaw.

## How it's identified

OpenClaw tracks this plugin as **`betterclaw`** (the `id` field in `openclaw.plugin.json`). That's what goes in `plugins.allow`. The npm package name is `@betterclaw-ai/plugin-openclaw` — different from the plugin id by design: the id is the runtime identity OpenClaw recognizes, the package name is where npm publishes the code.

## Install / reinstall

From repo root:

```bash
openclaw plugins install $PWD/packages/plugin-openclaw --link
openclaw config set plugins.allow '["betterclaw"]'
```

`--link` means edits to files in this directory take effect on the next agent turn — no reinstall cycle during dev.

## Architecture notes

Enforcement registers two native OpenClaw hooks via `api.on(...)`:

- **`before_tool_call`** — runs the workflow gate. Decides allow / block / queue-for-approval. Fires for plugin-served tools as of openclaw 2026.4.24 (upstream PR [#71159](https://github.com/openclaw/openclaw/pull/71159)).
- **`before_prompt_build`** — surfaces recent out-of-band approvals so the agent sees what the user handled in another shell. Returns `{ prependContext }` which OpenClaw splices into the system prompt for the next turn. Fires on the cli-runner path as of openclaw 2026.4.24 (upstream PR [#70625](https://github.com/openclaw/openclaw/pull/70625)).

v0.3.0 requires `openclaw.compat.minGatewayVersion >= 2026.4.24` so both hooks fire natively.

## Testing

```bash
# Demo path (zero external setup, runs against fake catalog)
BETTERCLAW_DEMO=1 betterclaw run "find a good wireless mouse under $50"

# Real workflows: tools come from host environment
# (Anthropic Cowork connectors, or user-installed MCP servers under OpenClaw)
betterclaw run "<your paragraph>"
```

Watch `~/.betterclaw/history.jsonl` to see what the plugin recorded. Watch `packages/plugin-openclaw/run.jsonl` for per-turn enforcement events.

## What's NOT here (by design)

- No tool ownership by default — tools come from the host environment, not from BetterClaw.
- No approval dispatch code — lives in `@betterclaw-ai/cli` (the plugin just marks things `queued` and returns immediately).
- No Cowork-specific code — lives in `packages/plugin-cowork/`.

## Demo flag

Set `BETTERCLAW_DEMO=1` to register the tutorial shopping tools (dummyjson.com fake catalog: `shop_search`, `shop_details`, `shop_compare`). Tutorial only — not a real shopping integration. Off by default.
