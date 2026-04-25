# betterclaw (OpenClaw plugin)

Workflow-enforcement plugin for OpenClaw. Snaps agents back when they try to step outside the declared workflow graph. Exposes per-vertical tools (Gmail, shopping, sales, travel) via OpenClaw's loopback MCP.

## What's in here

```
packages/plugin-openclaw/
├── package.json              name: "betterclaw" (kept for OpenClaw identity)
├── openclaw.plugin.json      id: "betterclaw", description, configSchema
├── index.mjs                 plugin entry — tool registration, before_tool_call hook wire-up
├── workflow.mjs              graph loader, transition rule, circuit breaker
├── mcp-proxy-client.mjs      Unix-socket MCP client → connects to BetterClaw daemon
├── vertical-email.mjs        Gmail tools (gmail_search, gmail_read, gmail_draft)
├── vertical-shopping.mjs     dummyjson.com-backed shopping tools
├── vertical-sales.mjs        stub (V2: real HubSpot MCP)
├── vertical-travel.mjs       stub (V2: real Amadeus/Duffel API)
└── active-graph.json         current workflow graph (rewritten by `betterclaw <paragraph>`)
```

The plugin is **pure code** — no subprocess spawns. That's why it installs without the `--dangerously-force-unsafe-install` flag. When the email vertical needs to call Gmail MCP, it proxies the call over `~/.betterclaw/mcp.sock` to the daemon managed by `@betterclaw/cli`.

## How it's identified

OpenClaw tracks this plugin as **`betterclaw`** (the `id` field in `openclaw.plugin.json`). That's what goes in `plugins.allow`. The pnpm package name deliberately stays `"betterclaw"` (not `@betterclaw/plugin-openclaw`) to match, so `openclaw plugins install` and `pnpm` see the same identity.

## Install / reinstall

From repo root:

```bash
openclaw plugins install $PWD/packages/plugin-openclaw --link
openclaw config set plugins.allow '["betterclaw"]'
```

`--link` means edits to files in this directory take effect on the next agent turn — no reinstall cycle during dev.

## Architecture notes

The plugin manually invokes `before_tool_call` via `getGlobalHookRunner()` because OpenClaw's host-side hook wrap doesn't fire for plugin-served tools in the `agent --local` path — until upstream PR [#70147](https://github.com/openclaw/openclaw/pull/70147) lands. `index.mjs:wrapExecuteWithHook` owns that.

Cross-turn approval state (what you approved last week, so the agent doesn't re-draft it) surfaces via `~/.openclaw/workspace/MEMORY.md` until upstream PR [#70169](https://github.com/openclaw/openclaw/pull/70169) lands. `index.mjs:syncRecentApprovalsToMemoryFile` owns that.

## Testing

```bash
# Compile a preset
betterclaw presets shopping-compare

# Run the agent
betterclaw run "find a good wireless mouse under $50"
```

Watch `~/.betterclaw/history.jsonl` to see what the plugin recorded. Watch `packages/plugin-openclaw/run.jsonl` for per-turn enforcement events.

## What's NOT here (by design)

- No direct Gmail MCP spawn — lives in `@betterclaw/cli`'s daemon.
- No approval dispatch code — lives in `@betterclaw/cli` (the plugin just marks things `queued` and returns immediately).
- No Cowork-specific code — lives in `packages/plugin-cowork/` (scaffold, not yet implemented).
