# Contributing to BetterClaw

## Adding a new vertical

A "vertical" is a group of tools that covers one use-case domain — email, shopping, sales, travel. Each vertical is one file: `plugins/betterclaw/vertical-<name>.mjs`.

The architecture guarantees:
- Tools for exactly one vertical are loaded per agent turn (based on the active graph's `vertical` field).
- The compiler knows which tools exist and which rules apply for the vertical, so LLM-generated graphs stay valid.
- Enforcement, approvals, replay, live view, fork/diff/publish all work vertical-agnostically.

### The 3-step recipe

**Step 1: Create `plugins/betterclaw/vertical-<name>.mjs`.**

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

**Step 2: Register it in `plugins/betterclaw/index.mjs`.**

Add the import and the VERTICALS entry:

```js
import { vertical as myVertical } from "./vertical-<name>.mjs";

const VERTICALS = new Map([
  // ...existing...
  [myVertical.id, myVertical],
]);
```

**Step 3: Teach the compiler about it in `cli/betterclaw`.**

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
openclaw agent --local --agent main -m "<task>"
# Verify [ALLOW] lines show your tools firing
betterclaw view  # see the replay
```

### Common patterns

- **Stub backend for v1, real backend later.** Start with an embedded catalog / fake data. Prove the vertical end-to-end. Then replace with a real MCP (HubSpot, Salesforce, Amadeus, etc.) without touching the graph schema.
- **Use `Type.Optional` for non-required parameters.** The compiler doesn't need to understand all of them; agents will figure out which to pass.
- **Tool descriptions are for the agent, not the user.** Write them as if you're briefing an agent: what does it do, what does it return, what's the input shape.
- **Return `{content: [{type: "text", text: "..."}]}` for normal results.** Return `{...content, isError: true}` for tool-level errors. This is the standard MCP tool-result shape.

### What NOT to do

- **Don't put vertical-specific state in `index.mjs`.** The main plugin is the dispatcher — it shouldn't know what a "lead" or "flight" is. All domain state belongs in the vertical file.
- **Don't use `child_process.spawn` unless you truly need an external MCP server.** It triggers OpenClaw's dangerous-code scanner and forces users to pass `--dangerously-force-unsafe-install`. Prefer inline logic or `fetch()` to a public API.
- **Don't try to share tools across verticals.** If two verticals both want "send email," each should declare its own tool. Cross-vertical composition can come later via plugin dependencies.

### The full cost

~50 LOC of tool stubs + 8 lines of compiler guidance + 3 lines in the vertical map. If you want a working demo, add a sentence or two of test setup in the README.

## Filing bugs

- **OpenClaw-side bugs** (hook wrapping, plugin SDK gaps): open an issue in the OpenClaw repo. We track two known issues in RETRO.md: `mcp-http.handlers.ts:73` missing hook wrap, and the dangerous-code scanner blocking child_process plugins.
- **BetterClaw-side bugs**: open an issue here. Include `betterclaw doctor` output, the active graph, and the run.jsonl if available.

## License

TBD — the project is in active prototype state. Pick MIT if you're forking for internal use.
