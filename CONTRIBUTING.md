# Contributing to BetterClaw

## Adding a new vertical

A "vertical" is a group of tools that covers one use-case domain — email, shopping, sales, travel. Each vertical is one file: `packages/plugin-openclaw/vertical-<name>.mjs`.

The architecture guarantees:
- Tools for exactly one vertical are loaded per agent turn (based on the active graph's `vertical` field).
- The compiler knows which tools exist and which rules apply for the vertical, so LLM-generated graphs stay valid.
- Enforcement, approvals, replay, live view, fork/diff/publish all work vertical-agnostically.

### The 3-step recipe

**Step 1: Create `packages/plugin-openclaw/vertical-<name>.mjs`.**

```js
import { Type } from "@sinclair/typebox";

export const vertical = {
  id: "<name>",
  description: "One-line human description.",
  guidance_for_compiler: `
AVAILABLE TOOLS — pick only from this list:
- <tool_a>: what it does
- <tool_b>: what it does

RULES:
1. The entry node's allowed_tools MUST include "<entry_tool>".
2. ...additional sequencing constraints...
`.trim(),
  tools: [
    {
      name: "<tool_a>",
      description: "Agent-facing description. Will appear in the LLM's tool list.",
      parameters: Type.Object({
        query: Type.String(),
        maxResults: Type.Optional(Type.Number({ default: 5 })),
      }),
      async execute(_id, params) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    },
    // ...more tools
  ],
};
```

**Step 2: Register it in `packages/plugin-openclaw/index.mjs`.**

Add the import and the VERTICALS entry:

```js
import { vertical as myVertical } from "./vertical-<name>.mjs";

const VERTICALS = new Map([
  // ...existing...
  [myVertical.id, myVertical],
]);
```

**Step 3: Teach the compiler about it in `packages/cli/bin/betterclaw`.**

Add an entry to `VERTICAL_GUIDANCE`:

```js
const VERTICAL_GUIDANCE = {
  // ...existing...
  <name>: {
    description: "Short description for the compile prompt.",
    tools: ["<tool_a>", "<tool_b>", ...],
    rules: [
      `The entry node's allowed_tools MUST include "<entry_tool>".`,
      // ...sequencing rules
    ],
    tool_descriptions: `- <tool_a>: ...
- <tool_b>: ...`,
  },
};
```

And add keyword routing in `detectVertical()`:

```js
if (hit("keyword1", "keyword2", "<phrase specific to your vertical>"))
  return "<name>";
```

Put specific verticals before generic ones (e.g. "support" tickets before "email"), because the first match wins.

### Testing the new vertical

```bash
# Edit → no reinstall needed; plugin was installed with --link
betterclaw "<paragraph that exercises your new vertical>"
# Review the compiled graph in the browser → approve (y)
betterclaw run "<task>"             # wraps `openclaw agent --local --agent main -m <task>`
# Verify [ALLOW] lines show your tools firing
betterclaw view                      # see the replay
```

### Common patterns

- **Stub backend for v1, real backend later.** Start with an embedded catalog / fake data. Prove the vertical end-to-end. Then replace with a real MCP (HubSpot, Salesforce, Amadeus, etc.) without touching the graph schema.
- **Use `Type.Optional` for non-required parameters.** The compiler doesn't need to understand all of them; agents will figure out which to pass.
- **Tool descriptions are for the agent, not the user.** Write them as if you're briefing an agent: what does it do, what does it return, what's the input shape.
- **Return `{content: [{type: "text", text: "..."}]}` for normal results.** Return `{...content, isError: true}` for tool-level errors. This is the standard MCP tool-result shape.

### What NOT to do

- **Don't put vertical-specific state in `index.mjs`.** The main plugin is the dispatcher — it shouldn't know what a "lead" or "flight" is. All domain state belongs in the vertical file.
- **Don't import subprocess-spawning modules from plugin code.** OpenClaw's install-time safety scanner does a **regex match** (not AST analysis) on the literal strings `child_process` and `spawn(` — even in comments. Any mention blocks the install. If a vertical genuinely needs to drive an external MCP subprocess (like email does for Gmail), wire it through the BetterClaw CLI daemon (`packages/cli/bin/betterclaw` owns all subprocesses) and talk to the daemon over the Unix socket from the plugin side. See `packages/plugin-openclaw/mcp-proxy-client.mjs` for the pattern. Prefer `fetch()` to a public HTTP API when the vertical doesn't require MCP.
- **Don't try to share tools across verticals.** If two verticals both want "send email," each should declare its own tool. Cross-vertical composition can come later via plugin dependencies.

### The full cost

~50 LOC of tool stubs + 8 lines of compiler guidance + 3 lines in the vertical map. If you want a working demo, add a sentence or two of test setup in the README.

## Filing bugs

- **OpenClaw-side bugs** (hook wrapping, plugin SDK gaps): open an issue in the OpenClaw repo. BetterClaw v0.2.1+ requires openclaw ≥ 2026.4.24 (the version that ships PR #71159's `before_tool_call` hook wiring and PR #70625's `before_prompt_build` cli-runner fix). If you hit a hook-firing issue, first verify via `openclaw --version` that you're on 2026.4.24 or later.
- **BetterClaw-side bugs**: open an issue here. Include `betterclaw doctor` output, the active graph, and the run.jsonl if available.

## License

BetterClaw is licensed under **[Apache License 2.0](./LICENSE)**. Chosen over MIT for the explicit patent grant, which matters for the enterprise-compliance wedge we're building toward. Third-party attribution lives in [NOTICE](./NOTICE).

Contributions are accepted under the same Apache-2.0 terms per §5 of the license ("Submission of Contributions"). By opening a PR, you agree your contribution is licensed under Apache-2.0 without any additional conditions.
