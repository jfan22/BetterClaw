# Changelog

All notable changes to BetterClaw are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). BetterClaw uses semver starting at v0.2.0; before that we shipped via git-commit version labels (see [RETRO.md](./RETRO.md) for the v0.1 → v0.3 build log).

## [0.2.0] — 2026-04-24

**Theme:** Monorepo scaffold + Gmail MCP migrates to a daemon. This is the V1 distribution-readiness release: the plugin no longer requires the `--dangerously-force-unsafe-install` flag, and the codebase is now structured for multi-package publishing.

### Added

- **Gmail MCP proxy daemon.** `betterclaw start` launches a detached daemon that owns the `@gongrzhe/server-gmail-autoauth-mcp` subprocess and multiplexes JSON-RPC requests over a Unix socket at `~/.betterclaw/mcp.sock`. Commands: `start`, `stop`, `status`, `mcp-daemon` (foreground mode). Persistent child means Gmail OAuth state survives across agent turns.
- **`betterclaw run "<task>"`** convenience wrapper. Auto-starts the daemon if needed, then runs `openclaw agent --local --agent main -m "<task>"`.
- **Monorepo layout** via pnpm workspaces. New packages at `packages/cli/`, `packages/plugin-openclaw/`, `packages/plugin-cowork/` (scaffold), `packages/contracts/` (scaffold), `packages/cloud/` (scaffold). See [README.md § Project layout](./README.md#project-layout).
- **Local usage telemetry** (opt-out, no PII, no remote collector in V1). Anonymous device UUID at `~/.betterclaw/identity.json`, events appended to `~/.betterclaw/telemetry.jsonl`. Events: `install`, `compile`, `approve`, `deny`, `auto_allow`, `deviation_blocked`, `dispatch_ok`, `dispatch_error`, `daemon_start`. Never captures paragraph text, email bodies/subjects/addresses, or graph contents. New subcommands: `betterclaw telemetry`, `betterclaw telemetry dump`, `betterclaw telemetry off/on`, `betterclaw telemetry export [--since YYYY-MM-DD]`. Opt-out also via `BETTERCLAW_TELEMETRY=off` env var. First-run notice on first `betterclaw start`.
- **Day-3 post-install feedback CTA.** After 3+ days of use AND real product activity (≥2 compiles or ≥1 approve), `betterclaw start`/`run`/`"<paragraph>"` prints a short "15 min of feedback?" prompt with a configurable URL. Dismiss via `betterclaw telemetry dismiss-cta` or `BETTERCLAW_FEEDBACK_URL=<yours>` env var. Auto-dismiss after 3 showings. Gated on telemetry being enabled — opt-outs never see it.
- **Apache-2.0 LICENSE + NOTICE.** BetterClaw is open source under Apache 2.0 (chose this over MIT for the explicit patent grant, relevant to the enterprise-compliance wedge). See LICENSE for full text, NOTICE for third-party attribution.
- **Cowork plugin (`packages/plugin-cowork/`).** Real implementation of BetterClaw as an Anthropic Cowork plugin. Manifest at `.claude-plugin/plugin.json`, three hook declarations in `hooks/hooks.json` (PreToolUse, UserPromptSubmit, PostToolUse), and a 1-line shell shim that execs `betterclaw hook <event>`. Same enforcement + approval queue as the OpenClaw plugin path; state is shared (active graph, approval queue) so `betterclaw pending` / `approve` / `deny` work identically regardless of which plugin generated the request.
- **`betterclaw hook <event>` subcommand.** Internal entry point invoked by the Cowork plugin shim. Reads JSON from stdin, runs workflow enforcement, writes response JSON to stdout. Vendors `loadGraph`/`enforce`/`freshState` inline so the CLI is self-contained for npm publish. Per-session current-node tracking in `~/.betterclaw/cowork-sessions.json` (pruned after 1h idle). ADR 0001 updated from Proposed to Accepted based on empirical verification.
- **npm publish readiness.** Both `@betterclaw/cli` and `betterclaw` (plugin) have `publishConfig`, `repository`, `keywords`, LICENSE + NOTICE in their tarballs. `npm pack --dry-run` verified: CLI = 5 files / 37kB, plugin = 13 files / 22kB. See [RELEASING.md](./RELEASING.md) for the publish playbook, [scripts/sync-license.sh](./scripts/sync-license.sh) to keep LICENSE/NOTICE in sync across packages, and [.github/workflows/ci.yml](./.github/workflows/ci.yml) for the CI checks (syntax, publish dry-run, PII audit, LICENSE sync).
- **DESIGN.md** — design system spec with dual-aesthetic surface map (editorial for CLI/PDF cover, modern tech for web UI, native for Slack).
- **TODOS.md** — V2 / V3 / horizon work items with full context per entry.
- **docs/adrs/0001-cowork-sdk-feasibility.md** — ADR accepting the Cowork plugin distribution path. Empirical verification via `spikes/cowork-hook-verify/`.
- **spikes/cowork-hook-verify/** — minimal Cowork plugin that exercises PreToolUse, UserPromptSubmit, and PostToolUse hooks. Reference for the real `packages/plugin-cowork/` when V2 ships.

### Changed

- **Plugin install no longer requires `--dangerously-force-unsafe-install`.** The plugin is pure code (no subprocess-spawning imports). Install with `openclaw plugins install $PWD/packages/plugin-openclaw --link`.
- **Plugin location:** `plugins/betterclaw/` → `packages/plugin-openclaw/`. Plugin identity stays `"betterclaw"` (per `openclaw.plugin.json:id`) so existing `plugins.allow` configs don't break.
- **CLI location:** `cli/betterclaw` → `packages/cli/bin/betterclaw`. Update your symlink: `ln -sf $PWD/packages/cli/bin/betterclaw ~/.local/bin/betterclaw`.
- **Package manager:** npm workspaces → pnpm workspaces. `pnpm install` at repo root installs everything.
- **`betterclaw doctor`** now includes a "MCP daemon running" check row.
- **QUICKSTART.md, README.md, package.json** updated for new paths.

### Removed

- `plugins/betterclaw/gmail-client.mjs` — replaced by `packages/plugin-openclaw/mcp-proxy-client.mjs` (Unix-socket MCP client, no subprocess spawn).
- Old `cli/betterclaw` per-approval one-shot MCP client code (~85 LOC). Approval dispatch now goes through the daemon socket.

### Migration notes for existing users

1. `betterclaw stop` to shut down any running daemon on the old path.
2. `openclaw plugins install $PWD/packages/plugin-openclaw --link` (re-points the install at the new directory).
3. Update your CLI symlink: `ln -sf $PWD/packages/cli/bin/betterclaw ~/.local/bin/betterclaw`.
4. `betterclaw start` to bring the daemon back up.
5. `betterclaw doctor` to confirm all rows green.

Plugin identity and `plugins.allow` config unchanged. Your saved graphs at `~/.betterclaw/library/` are unchanged. Gmail OAuth credentials at `~/.gmail-mcp/credentials.json` are unchanged.

## [0.1.0] — 2026-04-20 through 2026-04-22

Initial BetterClaw build. See [RETRO.md](./RETRO.md) for the full two-day build log and lessons. Highlights:

- Paragraph-to-graph compiler via `claude -p`
- OpenClaw plugin with workflow enforcement via inline `wrapExecuteWithHook`
- Four verticals: email, shopping, sales, travel (sales + travel are stubs)
- Four presets under `presets/`
- Approval queue + CLI-side async dispatch (v0.2 approval seam)
- Cross-turn history surfacing via `~/.openclaw/workspace/MEMORY.md` (v0.3 recent approvals, temporary workaround until upstream OpenClaw PR #70169 merges)
- Two upstream OpenClaw PRs filed: #70147 (`before_tool_call` hook wire-up) and #70169 (`before_prompt_build` for cli-runner path)
