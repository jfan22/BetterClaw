# Changelog

All notable changes to BetterClaw are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). BetterClaw uses semver starting at v0.2.0; before that we shipped via git-commit version labels.

## [0.3.14] — 2026-04-28

**Theme:** cache the v0.3.13 tool probe so repeat compiles aren't waiting on it.

### Added

- **Tool inventory cache** at `~/.betterclaw/tool-cache.json` with a 1-hour TTL. The pre-compile probe added in v0.3.13 takes ~10-15s. Caching for 1h means the first compile in a session pays the latency, every later compile reads from disk in ~5ms. Connector enable/disable is rare enough that 1h is a safe TTL in practice.

- **`betterclaw tools` subcommand.** Inspect and manage the cache:
  - `betterclaw tools` — show cache state (count, age, expiry, path).
  - `betterclaw tools refresh` — force a fresh probe and update the cache.
  - `betterclaw tools show` — print cached tool names, one per line (greps cleanly).
  - `betterclaw tools clear` — delete the cache file.

- **`BETTERCLAW_REFRESH_TOOL_CACHE=1` env var.** Bypass the cache for a single compile and force a fresh probe. Useful right after enabling a new connector in claude.ai when you don't want to wait for the TTL.

- **Cache hit/miss telemetry.** Compile events record `probe_status: "cache_hit" | "probe_ok" | "skipped" | "failed"` and `probe_cache_age_ms`. Helps us see how often the cache is doing its job vs. the probe is being re-paid.

### Changed

- Compile UI distinguishes "tools (12 tools, cached 14m ago)" from "tools probed [12 tools] (14123ms, cached for 1h)" so you can see at a glance whether you're paying the probe latency or not.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.14 @betterclaw-ai/plugin-openclaw@0.3.14 @betterclaw-ai/plugin-cowork@0.3.14`. No state migration needed — first compile after upgrade does a fresh probe to populate the cache.

## [0.3.13] — 2026-04-28

**Theme:** compile against the host's *real* tool inventory, not a hardcoded hint list.

### Fixed

- **Compiler no longer hallucinates tool names that don't exist.** Before this release, BetterClaw built compile prompts from a hardcoded `COMMON_COWORK_CONNECTORS` list. When Cowork's actual schema diverged from that list — for example, Gmail's real tools are `search_threads`, `get_thread`, `create_draft`, `list_drafts` (not the previously-hinted `list_messages`, `get_message`, `send_email`) — the compiler dutifully invented graphs around the wrong names. The runtime hook then correctly blocked the agent from calling the tools that *do* exist, leaving the user stuck.

  Symptom (real example from v0.3.12): user asks `betterclaw chat "summarize my inbox"`, the compiled `list_inbox` node demands `mcp__claude_ai_Gmail__list_messages`, agent reaches for `mcp__claude_ai_Gmail__search_threads` (the tool that exists), hook blocks. No path forward.

### Added

- **Pre-compile tool probe.** Before generating the graph, BetterClaw spawns `claude -p --model haiku` with a strict-format prompt that asks for a JSON array of every tool name available in the user's session. The result becomes the ground-truth tool inventory fed into the compile prompt — under "AVAILABLE TOOLS — these are the EXACT tools the agent will have at runtime." Adds ~1-3s to compile. Uses haiku (cheap, fast).

  Probe is best-effort. If it fails (network, timeout, malformed JSON), compile falls back to the hardcoded hints with a clear "probe failed" UI indicator. Compile never blocks on probe failure.

- **`BETTERCLAW_SKIP_TOOL_PROBE=1` env var.** Skips the probe and falls back to hints immediately. Useful for CI, offline environments, scripted compile flows, and debugging.

- **Probe telemetry.** Compile events now record `probe_status` (ok/failed/skipped), `probe_tool_count`, and `probe_duration_ms`. Helps us track hint-list drift over time.

### Changed

- **Approval-gate placement guidance updated.** When the AVAILABLE TOOLS list lacks an irreversible-action tool that the paragraph implies (e.g., Gmail exposes `create_draft` but no `send` tool), the compiler is instructed to end the workflow at the draft step rather than invent a non-existent send tool. The user completes the action manually.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.13 @betterclaw-ai/plugin-openclaw@0.3.13 @betterclaw-ai/plugin-cowork@0.3.13`. No state migration needed.

## [0.3.12] — 2026-04-26

**Theme:** one-shot `betterclaw chat` — compile + open Claude in a single command.

### Added

- **`betterclaw chat "<paragraph>"`** subcommand. Compiles the paragraph, prompts y/N to approve the graph, then spawns `claude --plugin-dir <plugin-cowork>` with stdio inherited so the user is dropped straight into an interactive Claude session with BetterClaw's enforcement plugin already loaded. Removes the friction of running BetterClaw and the Claude CLI as two separate steps.

  Plugin-cowork is auto-resolved in this order: `BETTERCLAW_PLUGIN_COWORK` env var → `<repo>/packages/plugin-cowork` (dev mode) → `$(npm root -g)/@betterclaw-ai/plugin-cowork`. Surfaces a clear install hint if none exist.

- **`BETTERCLAW_PLUGIN_COWORK` env var.** Override the plugin-cowork path for non-standard installs (custom npm prefix, vendored copies, etc.).

### Changed

- Help text reorders the quick-start example to lead with `betterclaw chat` (the recommended path for Cowork users), with the two-step compile/run flow shown as the alternative.

### Skipped

- v0.3.11 was a CI/lockfile fix tag with no published packages. v0.3.12 is the next published version on npm.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.12 @betterclaw-ai/plugin-openclaw@0.3.12 @betterclaw-ai/plugin-cowork@0.3.12`. No state migration needed.

## [0.3.10] — 2026-04-27

**Theme:** Cowork install becomes one-line; cross-platform hook shim; clearer next-step guidance.

### Added

- **`@betterclaw-ai/plugin-cowork` is now published to npm.** Previously `private: true` and required a sparse-clone workaround. Now `npm install -g @betterclaw-ai/plugin-cowork` works cross-platform. Update QUICKSTART Path A removes the clone step.

- **Cross-platform Cowork hook shim.** `bin/hook-shim.mjs` (Node) replaces `bin/hook-shim.sh` (bash). Works on Linux, macOS, and Windows directly — no WSL or Git Bash required. Node is already a hard requirement for BetterClaw, so no new dependency.

### Changed

- **Smarter `betterclaw run` error when openclaw is missing.** Instead of a generic "openclaw not recognized," the CLI now detects the missing binary and prints both forward paths: install OpenClaw (`npm install -g openclaw@latest`) OR switch to the Cowork path (`npm install -g @betterclaw-ai/plugin-cowork` + use Claude Desktop). Tells the user where the active graph already is.

- **Post-compile next-steps differentiate Cowork vs OpenClaw.** The previous output assumed everyone runs `betterclaw run`, which only works for OpenClaw users. Now shows both paths with the install one-liner for each.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.10 @betterclaw-ai/plugin-openclaw@0.3.10 @betterclaw-ai/plugin-cowork@0.3.10`. No state migration needed.

## [0.3.9] — 2026-04-27

**Theme:** the actual root cause behind v0.3.4-v0.3.8's browser-open saga.

### Fixed

- **Browser auto-open on Windows.** All five previous attempts (v0.3.4 through v0.3.8) were debugging the wrong layer. The CLI had a Linux-only headless heuristic — `headless = !DISPLAY && !BROWSER` — that always evaluated `true` on Windows (because `DISPLAY` is never set on Windows; X11 isn't native to Windows). Result: on Windows the CLI took the "headless, print Mermaid as text" branch and never called `openInBrowser` at all. Each browser-launching fix was correct in isolation but never being reached.

  Why Git Bash worked anyway: Git Bash on Windows often sets `DISPLAY` for X11 GUI forwarding (xterm support), so headless evaluated `false` in Git Bash → openInBrowser ran → browser opened. PowerShell never sets `DISPLAY` → headless guard fired → no browser-open attempt at all.

  Fix: new `isHeadless()` helper that's platform-aware. Linux respects DISPLAY/BROWSER. Windows and macOS default to non-headless (desktop always available). Override with `BETTERCLAW_HEADLESS=1` for explicit control (CI, scripted compile flows).

### Added

- `BETTERCLAW_HEADLESS` env var. Set to `1` to force headless mode regardless of platform — the CLI prints Mermaid source as text instead of opening a browser. Useful for CI pipelines and scripted compile flows.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.9 @betterclaw-ai/plugin-openclaw@0.3.9`. No state migration needed.

## [0.3.8] — 2026-04-27

**Theme:** browser auto-open, take 5 — give up on rolling our own, use the `open` package.

### Fixed

- **Browser auto-open in PowerShell on Windows.** Four previous attempts (`cmd /c start`, `shell: true`, `powershell.exe -EncodedCommand`, `explorer.exe`) each had different shell-specific quirks. v0.3.8 adopts the `open` npm package — battle-tested for 8+ years across thousands of Node CLIs (Vite, Storybook, npm-create-*, etc.) for exactly this kind of cross-platform / cross-shell file/URL launching. The marginal install cost (~10-15KB with transitive deps) is well worth not maintaining platform shims that fail in different ways across user environments.

### Added

- New runtime dep: `open` (^11.0.0). First runtime dep for the CLI; previous versions had zero deps.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.8 @betterclaw-ai/plugin-openclaw@0.3.8`. No state migration needed.

## [0.3.7] — 2026-04-27

**Theme:** browser auto-open take 4 — give up on shell tricks, use explorer.exe directly.

### Fixed

- **Browser auto-open in PowerShell + Git Bash + CMD on Windows.** Three previous attempts (`cmd /c start`, `shell: true`, `powershell.exe -EncodedCommand`) each had quirks across different calling shells. v0.3.7 takes the simplest possible approach: spawn `explorer.exe <target>` directly. explorer.exe is always at `C:\Windows\explorer.exe` (on PATH on every Windows install), opens any file via its default-app association (.html → default browser), and doesn't go through any shell — so no detachment quirks, no encoding issues, no execution-policy edge cases. The exit code is documented to be 1 even on success ([Stack Overflow](https://stackoverflow.com/questions/9356985)) so we ignore status.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.7 @betterclaw-ai/plugin-openclaw@0.3.7`. No state migration needed.

## [0.3.6] — 2026-04-27

**Theme:** browser auto-open take 3 — works in PowerShell now via `powershell.exe -EncodedCommand`.

### Fixed

- **Browser auto-open in PowerShell.** v0.3.5 used `cmd /c start` via `shell: true`, which worked from Git Bash but not PowerShell — PowerShell's child-process detachment model has quirks that prevent `start` from working reliably. v0.3.6 invokes `powershell.exe -EncodedCommand` directly with a base64 UTF-16LE encoded `Start-Process` command. This is the same approach used by the popular `open` npm package and works across all calling shells (PowerShell, CMD, Git Bash, WSL) because:
  - `powershell.exe` is at a stable system path on every Windows install
  - `Start-Process` is the canonical Windows file-open primitive
  - `-EncodedCommand` sidesteps all shell-quoting issues by passing the command opaquely

### Migration

`npm install -g @betterclaw-ai/cli@0.3.6 @betterclaw-ai/plugin-openclaw@0.3.6`. No state migration needed.

## [0.3.5] — 2026-04-27

**Theme:** browser auto-open take 2 + relax over-strict graph validation.

### Fixed

- **Browser auto-open on Windows.** v0.3.4's `spawn("cmd", ["/c", "start", "", target])` didn't work in Git Bash + Node combinations because of msys2 path-translation interactions. v0.3.5 uses `spawn(\`start "" "..."\`, [], { shell: true })` instead — `shell: true` forces invocation through cmd.exe, which always handles `start` (a cmd.exe builtin) correctly regardless of the calling shell.

- **Relaxed graph validation: empty `allowed_tools` is allowed for any node.** Previously only the `unrecognized_action` sentinel could have empty tools; this rejected legitimate workflows where a node represents a pure-LLM-thinking step (summarize, classify, decide-which-branch). The agent produces text in such states and advances by calling a tool from a reachable next node — semantically valid; the validation was over-strict. Compile prompt updated to match: rule 2 now explicitly allows empty `allowed_tools` for analytical/thinking nodes.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.5 @betterclaw-ai/plugin-openclaw@0.3.5`. No state migration needed.

## [0.3.4] — 2026-04-27

**Theme:** browser auto-open works on Windows now.

### Fixed

- **Mermaid graph preview didn't open the browser on Windows.** The CLI used `xdg-open` (Linux) or `open` (macOS) for browser launching, with no Windows fallback. v0.3.4 adds the missing case: `cmd /c start "" <target>` (the empty `""` is `start`'s required title arg when the path may contain spaces).
- **Refactored four browser-open sites into a single `openInBrowser()` helper** so future platform fixes only need one place to update.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.4 @betterclaw-ai/plugin-openclaw@0.3.4`. No state migration needed.

## [0.3.3] — 2026-04-27

**Theme:** Windows binary lookup, take 2. v0.3.2 added a `where`-based path resolver but Node still couldn't invoke `.cmd` shims even with the full path. v0.3.3 uses `shell: true` on Windows + stdin-based prompt passing (no shell escaping needed for the user-supplied prompt).

### Fixed

- **Windows: `claude` CLI still not found by `betterclaw` even after v0.3.2.** Node has a documented quirk where `.cmd` shims (the standard npm install format on Windows) require `shell: true` to invoke regardless of whether you have the full path. v0.3.2 added a path resolver but didn't add `shell: true`, so the bug persisted. v0.3.3 introduces `winSpawnOpts()` that adds `shell: true` on Windows for all binary invocations.

- **Compile prompt safe to pass on Windows.** The compile call passes a multi-line prompt (with possible shell metacharacters from the user's paragraph) to `claude -p`. Shell-escaping that on cmd.exe is fragile. v0.3.3 sends the prompt via stdin (`input` option of spawnSync) instead, sidestepping shell escaping entirely.

- **Better Windows error guidance.** Compile-failed error message on Windows includes a hint to run from Git Bash rather than PowerShell or CMD.

### Migration

`npm install -g @betterclaw-ai/cli@0.3.3 @betterclaw-ai/plugin-openclaw@0.3.3`. No state migration needed.

## [0.3.2] — 2026-04-27

**Theme:** fix Windows binary lookup. Cross-platform install actually works now.

### Fixed

- **Windows: `claude` CLI not found by `betterclaw`** even when `claude --version` works in the same shell. Root cause: Node's `spawnSync` on Windows doesn't find `.cmd` shims (which is how npm installs binaries) unless you pass `shell: true` (insecure with user-supplied args) or resolve the full path first. v0.3.2 adds a `resolveBin()` helper that resolves binaries via `where` on Windows, falls back to bare names elsewhere. Applied to all `claude`, `openclaw`, and `gh` invocations in the CLI.

- **Windows-specific error guidance.** When `claude` lookup fails on Windows, the error now adds *"on Windows, run BetterClaw from Git Bash (not PowerShell or CMD)"* — the most common cause of the failure.

### Migration notes

Just update: `npm install -g @betterclaw-ai/cli@0.3.2 @betterclaw-ai/plugin-openclaw@0.3.2`. No state migration needed.

## [0.3.1] — 2026-04-27

**Theme:** fix the path-mismatch bug that broke npm-installed CLIs on Windows (and was a workaround on Linux).

### Fixed

- **Per-user state moves to `~/.betterclaw/`** (overrideable via `BETTERCLAW_HOME`). Previously the CLI computed paths like `active-graph.json` relative to a hardcoded source-tree layout (`packages/plugin-openclaw/`), which doesn't exist when the CLI is npm-installed. Result on Windows: `error: plugin root missing: <wrong path>` on every compile attempt. On Linux the CLI silently wrote to a path the npm-installed plugin couldn't read; we worked around with manual symlinks.

  Now both CLI and plugin read/write `active-graph.json`, `active-paragraph.md`, `run.jsonl`, and `approvals/` from `~/.betterclaw/`. No symlinks needed; no PLUGIN_ROOT requirement; works identically across source-clone, `--link`, and npm install.

- **`preflightCheck()` no longer requires PLUGIN_ROOT to exist.** The check was a leftover from the source-tree-only era.

### Migration notes

If you have an `active-graph.json` from a v0.3.0 source-tree install that you want to keep:

```bash
cp ~/Prj/BetterClaw/packages/plugin-openclaw/active-graph.json ~/.betterclaw/active-graph.json
cp ~/Prj/BetterClaw/packages/plugin-openclaw/active-paragraph.md ~/.betterclaw/active-paragraph.md 2>/dev/null
```

Otherwise: just recompile from a paragraph, `betterclaw "<paragraph>"` writes to the new location.

## [0.3.0] — 2026-04-26

**Theme:** BetterClaw refactors from a vertical bundler into a pure workflow-enforcement layer. The plugin no longer owns or registers tools by default; tools come from the host environment (Anthropic Cowork connectors or user-installed MCP servers). This removes the GCP-project setup wall from the non-tech-user golden path: Cowork users get Gmail / Calendar / Drive / Apollo with zero setup.

This is the **first npm release** of BetterClaw. v0.2.x stayed as git tags only; per [ADR 0002](./docs/adrs/0002-enforcement-layer-not-vertical-bundler.md), we skipped publishing v0.2.x to avoid baking the broken-vertical first impression into npm search results.

### Architecture (per ADR 0002, accepted after Phase 0 spike)

- **Plugin owns no tools by default.** `index.mjs` registers only `before_tool_call` and `before_prompt_build` hooks. Production code paths register zero tools.
- **Enforced tool-name set comes from the active graph itself**, not from a hardcoded vertical registry. Whatever tool names the graph references, the plugin enforces.
- **CLI compile is host-tool-aware.** Prompt instructs Claude to emit graphs with concrete tool names (`mcp__claude_ai_Gmail__send_email`, `mcp__filesystem__read_file`, etc.) following the conventions used by Anthropic connectors and user MCP servers.
- **Gmail fallback is opt-in.** OpenClaw users without Cowork can run `betterclaw connect gmail` to enable BetterClaw's bundled Gmail integration. The MCP daemon is dormant otherwise.

### Added

- `packages/plugin-openclaw/enforcement.mjs` — pure decision module taking `(graph, state, toolCall)` and returning allow / block / approval-queued. Side-effect collaborators (runLogger, telemetry, stderr) injected for testability.
- `packages/plugin-openclaw/history.mjs` — cross-turn approval-history surfacing (extracted from index.mjs).
- `betterclaw connect gmail` / `betterclaw disconnect gmail` — opt-in enable/disable for the bundled Gmail integration. Writes `~/.betterclaw/gmail-fallback-enabled` marker.
- `BETTERCLAW_DEMO=1` env var — registers `demo-shopping` tutorial tools (renamed from `vertical-shopping`). Tutorial only; not on the production code path.
- `detectHost()` inline function in CLI — classifies runtime as cowork / openclaw / manual. Used to shape error messages.
- `docs/adrs/0002-enforcement-layer-not-vertical-bundler.md` — architecture decision record.
- Phase 0 spike findings recorded in `spikes/cowork-tool-discovery/results.md`. Detailed phased refactor plan kept private (eng-plans archive).
- `spikes/cowork-tool-discovery/` — Phase 0 spike that verified the deferred-tool model and stretch-passed the architecture gate.

### Changed (breaking)

- **Plugin no longer registers tools by default.** Graphs that reference `gmail_search`, `shop_search`, `sales_find_leads`, etc. (the v0.2 vertical names) need to be recompiled. The new compile produces graphs with concrete host-tool names.
- **CLI compile prompt rewritten.** `VERTICAL_GUIDANCE` table dropped. `detectVertical` keyword-matching dropped. New prompt guides Claude to use the `mcp__<server>__<action>` convention.
- **`validateGraph` no longer enforces a hardcoded tool whitelist.** Compile-time validation only checks graph shape; runtime catches unknown tools.
- **Gmail MCP daemon no longer auto-starts on every `betterclaw run`.** Requires the marker file written by `betterclaw connect gmail`. `betterclaw start` refuses with a clear pointer if the marker is absent.
- **`graph.vertical` field is no longer read.** Existing graphs with the field still load; the field is just ignored.

### Removed

- `packages/plugin-openclaw/vertical-sales.mjs` (stub that never shipped a real implementation).
- `packages/plugin-openclaw/vertical-travel.mjs` (stub that never shipped a real implementation).
- `VERTICAL_GUIDANCE` table in CLI (~50 LOC of hardcoded tool names per vertical).
- `detectVertical()` function in CLI (~40 LOC of keyword matching).

### Deprecated

- `vertical-email.mjs` is preserved in the plugin package but loaded only when `~/.betterclaw/gmail-fallback-enabled` exists. Future versions may remove it entirely if Cowork's Gmail connector is sufficient and OpenClaw users adopt their own Gmail MCPs.

## [0.2.1] — 2026-04-25

**Theme:** drop the v0.2.0 workarounds now that upstream OpenClaw caught up. Plugin shrinks ~50 LOC, gets cleaner native hook semantics.

### Changed

- **Native `before_tool_call` hook.** Plugin no longer manually wraps every tool's `execute` function via `wrapExecuteWithHook`. Now relies on OpenClaw firing the hook natively for plugin-served tools, fixed upstream in [openclaw 2026.4.24 PR #71159](https://github.com/openclaw/openclaw/pull/71159) (also added owner-only tool policy as a bonus security boundary on the loopback MCP).
- **Native `before_prompt_build` hook.** Cross-turn approval surfacing no longer goes through `~/.openclaw/workspace/MEMORY.md`. Now returns `{ prependContext }` from the hook directly, fixed upstream in [openclaw 2026.4.24 PR #70625](https://github.com/openclaw/openclaw/pull/70625).
- **`openclaw.plugin.json` compat bumped** from `>=2026.3.24-beta.2` to `>=2026.4.24`. Users on older OpenClaw should pin to `betterclaw@0.2.0` or upgrade their OpenClaw install.

### Removed

- `wrapExecuteWithHook` function in `packages/plugin-openclaw/index.mjs` (~25 LOC) and the `getGlobalHookRunner` import.
- `syncRecentApprovalsToMemoryFile` function (~50 LOC) and the `MEMORY_PATH` / `MEMORY_MARKER_*` constants.

### Added

- One-shot upgrade cleanup: on first plugin boot of v0.2.1, `removeLegacyMemoryBlock()` strips any leftover `<!-- BEGIN betterclaw:recent_approvals -->` block from `~/.openclaw/workspace/MEMORY.md`. Idempotent — once cleaned, it's a fast no-op. Will be removed in a future release once telemetry shows v0.2.0 footprint is below 5%.

### Migration notes

Upgrading from v0.2.0:

1. `npm install -g openclaw@latest` (must be ≥ 2026.4.24)
2. `npm install -g @betterclaw-ai/cli@0.2.1` (CLI version-bumped for parity, no functional changes)
3. Reinstall the plugin so the new compat is read: `openclaw plugins install $PWD/packages/plugin-openclaw --link`
4. Restart the daemon: `betterclaw stop && betterclaw start`
5. Run any agent — the plugin's first boot strips the legacy MEMORY.md block silently.

Behaviorally identical to v0.2.0. Hooks fire faster (no manual wrap layer), MEMORY.md no longer mutated.

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
- **npm publish readiness.** Both `@betterclaw-ai/cli` and `betterclaw` (plugin) have `publishConfig`, `repository`, `keywords`, LICENSE + NOTICE in their tarballs. `npm pack --dry-run` verified: CLI = 5 files / 37kB, plugin = 13 files / 22kB. See [RELEASING.md](./RELEASING.md) for the publish playbook, [scripts/sync-license.sh](./scripts/sync-license.sh) to keep LICENSE/NOTICE in sync across packages, and [.github/workflows/ci.yml](./.github/workflows/ci.yml) for the CI checks (syntax, publish dry-run, PII audit, LICENSE sync).
- **DESIGN.md** — design system spec with dual-aesthetic surface map (editorial for CLI/PDF cover, modern tech for web UI, native for Slack).
- **ROADMAP.md** — public-facing summary of V2 / V3 work and upstream maintenance tracking.
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

Initial BetterClaw build over two days. Highlights:

- Paragraph-to-graph compiler via `claude -p`
- OpenClaw plugin with workflow enforcement via inline `wrapExecuteWithHook`
- Four verticals: email, shopping, sales, travel (sales + travel are stubs)
- Four presets under `presets/`
- Approval queue + CLI-side async dispatch (v0.2 approval seam)
- Cross-turn history surfacing via `~/.openclaw/workspace/MEMORY.md` (v0.3 recent approvals, temporary workaround until upstream OpenClaw PR #70169 merges)
- Two upstream OpenClaw PRs filed: #70147 (`before_tool_call` hook wire-up) and #70169 (`before_prompt_build` for cli-runner path)
