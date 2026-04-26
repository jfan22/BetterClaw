# Contributing to BetterClaw

Welcome. Here's how the v0.3 architecture works and where contributions help most.

## What BetterClaw is (and isn't) in v0.3

Per [ADR 0002](./docs/adrs/0002-enforcement-layer-not-vertical-bundler.md), BetterClaw is a **workflow-enforcement layer** — not a tool bundler. Tools come from the host environment (Anthropic Cowork connectors, OpenClaw MCP servers). The plugin gates calls to those tools against a declared graph.

This means: **don't add new "verticals" to the plugin.** That model existed in v0.2 and was retired. If you find yourself wanting to write a Gmail or Slack or Calendar tool inside BetterClaw, the answer is "use the host's connector / MCP server instead."

## Where contributions are welcome

### 1. Better compile prompts (highest leverage)

`packages/cli/bin/betterclaw` → `buildCompilePrompt()` produces the graphs. Real-world paragraphs occasionally trip up the compile (wrong tool name picked, missing approval gate, malformed graph). Each fix sharpens the V1 product for everyone.

If you observe a paragraph that compiles to a wrong-shaped graph, file an issue with:
- The exact paragraph
- The `active-graph.json` it produced
- What you expected

The fix is usually a 5-15 line addition to the prompt rules.

### 2. New workflow presets

`presets/` ships starter workflows. Adding a good one helps users discover the model.

```
presets/<your-preset-name>/
  graph.json       # the compiled workflow (concrete tool names)
  paragraph.md     # the English description it was compiled from
  meta.json        # {name, description, source: "preset", example_agent_message}
```

Use concrete tool names (`mcp__claude_ai_*` for Cowork or `mcp__<server>__<action>` for user MCPs). Don't reference v0.2 vertical-style names like `gmail_search`.

### 3. Common-connector hints

The `COMMON_COWORK_CONNECTORS` list in `packages/cli/bin/betterclaw` hints to the compile prompt about what's available in Cowork. As Anthropic adds connectors (or as the action names change), this list needs to track. Adding a new connector entry is one line.

### 4. Enforcement engine improvements

`packages/plugin-openclaw/enforcement.mjs` is the decision module. It's pure (side-effect collaborators injected) so it's testable in isolation. Areas worth attention:

- Better deviation messages (so the agent gets useful feedback, not just "blocked")
- Richer approval-state tracking
- Graph-state telemetry for V1 debugging

### 5. New host integrations (rare but high-value)

If a new agent runtime appears (Hermes, OpenAI Agent SDK, LangGraph, CrewAI), wiring up a BetterClaw plugin or hook adapter for it is a meaningful contribution. The pattern is documented in `packages/plugin-cowork/` and `packages/plugin-openclaw/`. Both register `before_tool_call` and `before_prompt_build` analogues; the rest is host-specific glue.

### 6. Documentation

If something in the docs is unclear, wrong, or stale, send a PR. README, QUICKSTART, and per-package READMEs are all fair game.

## Local development setup

```bash
git clone https://github.com/jfan22/BetterClaw.git
cd BetterClaw
pnpm install
ln -sf $PWD/packages/cli/bin/betterclaw ~/.local/bin/betterclaw

# OpenClaw plugin (linked, so edits take effect immediately)
openclaw plugins install $PWD/packages/plugin-openclaw --link
openclaw config set plugins.allow '["betterclaw"]'

# Cowork plugin (Claude Desktop)
claude --plugin-dir $PWD/packages/plugin-cowork
```

## Testing your changes

```bash
# Compile your test paragraph
betterclaw "<paragraph>"

# Review the graph in the browser, approve (y) or decline (N)
# Decline if you just want to see what compiled — graph isn't written

# Run the agent
betterclaw run "<task>"

# Inspect what happened
cat packages/plugin-openclaw/run.jsonl     # per-turn enforcement events
betterclaw view                             # post-hoc replay HTML
betterclaw view --watch                     # live view in browser
```

For pure-module tests on `enforcement.mjs` / `workflow.mjs`, write standalone Node scripts that pass mock `runLogger` / `telemetry` collaborators and assert on the decision returned. There's no test framework in the repo today; if you want to add one, that's a fine PR too.

## What NOT to do

- **Don't add new verticals.** v0.2 model. Use Cowork connectors or MCP servers instead.
- **Don't import subprocess-spawning modules from plugin code.** OpenClaw's install-time safety scanner does a **regex match** (not AST analysis) on literal strings `child_process` and `spawn(` — even in comments. Any mention blocks the install. The plugin should be pure code; subprocesses live in the CLI's daemon path (`packages/cli/bin/betterclaw`).
- **Don't bundle credentials or third-party API keys** in any package. The Gmail fallback's `~/.gmail-mcp/gcp-oauth.keys.json` lives in the user's home dir, never in the repo.
- **Don't break the v0.3 graph format.** Adding new optional fields is fine; renaming or removing existing ones (`entry`, `nodes`, `edges`, `requires_approval`, `max_reconsider_retries`) breaks the migration story.

## Filing bugs

- **OpenClaw-side bugs** (hook wrapping, plugin SDK gaps, MCP issues): open an issue in the OpenClaw repo. BetterClaw v0.3.0+ requires openclaw ≥ 2026.4.24.
- **BetterClaw-side bugs**: open an issue here. Include:
  - `betterclaw doctor` output
  - The compiled `active-graph.json`
  - The `run.jsonl` if you ran the agent
  - The exact paragraph if it's a compile bug

## License

BetterClaw is licensed under **[Apache License 2.0](./LICENSE)**. Chosen over MIT for the explicit patent grant. Third-party attribution lives in [NOTICE](./NOTICE).

Contributions are accepted under the same Apache-2.0 terms per §5 of the license ("Submission of Contributions"). By opening a PR, you agree your contribution is licensed under Apache-2.0 without any additional conditions.
