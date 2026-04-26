# @betterclaw-ai/cli

The BetterClaw command-line tool. Compiles English paragraphs into workflow graphs, manages the approval queue, and (when explicitly opted in) runs the Gmail MCP proxy daemon for OpenClaw users without Cowork.

## What's in here

```
packages/cli/
├── package.json
└── bin/
    └── betterclaw      single-file executable (~3700 LOC of ESM JavaScript)
```

The CLI is intentionally one file for V1 — easy to audit, easy to distribute, no build step. When the codebase grows further (likely when the paid cloud backend work starts), we split into `src/{compile,daemon,approvals,view,library}.mjs` modules.

## Key commands

See `betterclaw --help` for the full list. The essentials:

| Command | What it does |
|---|---|
| `betterclaw "<paragraph>"` | Compile a paragraph into `active-graph.json` (host-tool-aware prompt) |
| `betterclaw run "<task>"` | Run `openclaw agent --local -m "<task>"` (auto-starts the Gmail daemon iff connected) |
| `betterclaw connect gmail` / `disconnect gmail` | Opt-in / out of the bundled Gmail integration (OpenClaw users without Cowork) |
| `betterclaw start` / `stop` / `status` | Gmail MCP daemon lifecycle (only relevant after `connect gmail`) |
| `betterclaw pending` / `approve <id>` / `deny <id>` | Approval queue |
| `betterclaw view --watch` | Live HTTP server + browser view |
| `betterclaw doctor` | Diagnose setup problems |
| `betterclaw presets [name]` | List or install bundled presets |
| `betterclaw save`/`load`/`list`/`fork`/`diff`/`publish` | Pattern library (paragraphs + graphs, sharable via gist) |
| `betterclaw telemetry` / `dump` / `off` / `on` / `export` | Local-only usage metrics (no PII, no remote collector) |
| `betterclaw hook <event>` | Cowork plugin shim — reads JSON from stdin, returns enforcement decision |

## How the CLI talks to the plugin

Per ADR 0002 (v0.3+), the plugin doesn't call the CLI for tool execution by default — tools come from the host environment (Cowork connectors or user MCP servers). The CLI is involved in:

1. **Compile** (`betterclaw "<paragraph>"`) — invokes Claude CLI to produce a graph; writes to `active-graph.json` which the plugin reads on boot.
2. **Approval dispatch** (`betterclaw approve <id>`) — when a graph has a Gmail-fallback approval, the CLI dispatches the call against the daemon's Gmail MCP. Only relevant when `betterclaw connect gmail` has been run.
3. **Cowork hook subcommand** (`betterclaw hook <event>`) — invoked by the Cowork plugin's shell-command hook shim. Reads hook input JSON from stdin, runs enforcement, writes response JSON to stdout. Cold-starts Node per call (~100-150ms).

The Gmail MCP daemon (`mcp-daemon` mode) is opt-in. Without `betterclaw connect gmail`, the daemon stays dormant and `betterclaw start` refuses with a pointer.

## Development

Edit `bin/betterclaw` directly. Changes take effect on next invocation (no build step). Run `betterclaw doctor` after edits to confirm nothing regressed.

For integration testing, see `spikes/` for minimal probe plugins. Two are useful:

- `spikes/cowork-hook-verify/` — verifies the four core Cowork hook capabilities BetterClaw needs (ADR 0001).
- `spikes/cowork-tool-discovery/` — verifies tool-name format and matcher behavior for Anthropic connectors (ADR 0002 Phase 0).
