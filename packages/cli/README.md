# @betterclaw/cli

The BetterClaw command-line tool. Compiles English paragraphs into workflow graphs, manages the Gmail MCP proxy daemon, handles the approval queue, and wraps `openclaw agent --local` for convenience.

## What's in here

```
packages/cli/
├── package.json
└── bin/
    └── betterclaw      single-file executable (~3600 LOC of ESM JavaScript)
```

The CLI is intentionally one file for V1 — easy to audit, easy to distribute, no build step. When the monorepo grows (likely around Month 2 when paid cloud backend work starts), we split into `src/{compile,daemon,approvals,view,library}.mjs` modules.

## Key commands

See `betterclaw --help` for the full list. The essentials:

| Command | What it does |
|---|---|
| `betterclaw "<paragraph>"` | Compile a paragraph into `active-graph.json` |
| `betterclaw run "<task>"` | Auto-start daemon + run `openclaw agent --local -m "<task>"` |
| `betterclaw start` / `stop` / `status` | Daemon lifecycle |
| `betterclaw mcp-daemon` | Run daemon in foreground (debug mode) |
| `betterclaw pending` / `approve <id>` / `deny <id>` | Approval queue |
| `betterclaw view --watch` | Live HTTP server + browser view |
| `betterclaw doctor` | Diagnose setup problems |
| `betterclaw presets [name]` | List or install bundled presets |
| `betterclaw save`/`load`/`list`/`fork`/`diff`/`publish` | Graph library + marketplace |
| `betterclaw telemetry` / `dump` / `off` / `on` / `export` | Local-only usage metrics (no PII, no remote collector) |

## How the CLI talks to the plugin

The plugin (`packages/plugin-openclaw/`) doesn't call this CLI directly. Instead, both the plugin and the CLI's approval dispatcher connect to the **BetterClaw daemon** (also this CLI, in `mcp-daemon` mode) over the Unix socket at `~/.betterclaw/mcp.sock`. The daemon owns the Gmail MCP subprocess and multiplexes JSON-RPC requests.

See `bin/betterclaw`'s "MCP daemon" section for the socket protocol, ID multiplexing, and crash-loop respawn policy.

## Development

Edit `bin/betterclaw` directly. Changes take effect on next invocation (no build step). Run `betterclaw doctor` after edits to confirm nothing regressed.

For integration testing, the `spikes/cowork-hook-verify/` sibling package has a minimal stub plugin useful for testing hook dispatch latency and JSON-RPC wire behavior.
