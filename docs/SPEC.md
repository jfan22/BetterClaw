# BetterClaw Workflow-Enforcement Spec

**Version:** 0.3.0-draft
**Status:** Proposed standard. Open for comments and reference implementations.
**License:** [Apache-2.0](../LICENSE) — same as the BetterClaw codebase. The format and protocol described here are unencumbered by patents on BetterClaw's part; any AI-agent runtime is free to implement a conformant enforcement layer.

## Why this spec exists

AI agents call tools. Tools have consequences. A workflow-enforcement layer between the agent and its tools turns "the agent should do X" (advisory, system-prompt-based) into "the agent can only do X" (enforced, with audit trail).

Every agent runtime that adds tool-call hooks invents this layer. Most of them invent it slightly differently. This spec describes a common format for the workflow graph, a common protocol for the enforcement hook, and a common audit-event shape — so that a graph compiled in one runtime can be enforced in another, an auditor can review actions across multiple runtimes with one tool, and a third-party enforcement layer (BetterClaw or otherwise) can integrate with any compliant runtime.

The spec is implementation-agnostic. BetterClaw's plugins for OpenClaw and Cowork are reference implementations, but the format and protocol are designed to be adoptable by any agent runtime.

## Glossary

- **Agent**: an LLM-driven program that may call tools. Examples: Claude Code, Claude Desktop (Cowork), an OpenAI Agent SDK app, a LangGraph workflow.
- **Tool**: a function the agent may invoke. Identified by a tool name (see §2). Tools have side effects in the world (send email, write file, charge a card).
- **Host runtime**: the system that hosts the agent and routes its tool calls. Fires hook events when tool calls happen.
- **Enforcement layer**: code that receives hook events from the host runtime and decides whether each tool call proceeds, is blocked, or queues for human approval. May or may not be a third-party plugin; some host runtimes implement enforcement natively.
- **Workflow graph**: a declarative description of the sequence of tool-call states the agent is allowed to occupy and the transitions between them. See §1.
- **Approval gate**: a tool call that requires human approval before dispatch. The enforcement layer blocks the call, queues an approval record, and the agent receives a "queued" response so it does not retry.
- **Deviation**: a tool call that does not match any reachable state in the active graph. Blocked by the enforcement layer.
- **Audit event**: a structured record of a tool-call attempt and its outcome. See §6.

## RFC 2119 conventions

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY in this document are to be interpreted as described in RFC 2119.

---

## 1. Workflow Graph Format

A workflow graph is a JSON document with the following top-level fields. Encoders MUST produce, and decoders MUST accept, the field set described here.

### 1.1 Schema

```jsonc
{
  "entry": "<node_id>",                    // required, string
  "max_reconsider_retries": 3,             // required, integer ≥ 0
  "requires_approval": ["<tool_name>"],    // required, array of strings (may be empty)
  "nodes": [                               // required, non-empty array
    {
      "id": "<node_id>",                   // required, string, unique within the graph
      "purpose": "<sentence>",             // required, string, human-readable
      "allowed_tools": ["<tool_name>"]     // required, array of strings (see §1.3)
    }
  ],
  "edges": [                               // required, array (may be empty)
    { "from": "<node_id>", "to": "<node_id>" }
  ]
}
```

### 1.2 Field semantics

- **`entry`**: the node id where the agent begins. MUST refer to a node id that exists in `nodes`.
- **`max_reconsider_retries`**: how many consecutive deviations the runtime tolerates before terminating the workflow as a hard fail (see §4.3). MUST be a non-negative integer. Implementations SHOULD default to 3 if unspecified for backward compatibility.
- **`requires_approval`**: list of tool names that, when called, MUST trigger the approval-gate protocol (see §5) instead of executing immediately. Each entry SHOULD be a tool name that appears in at least one node's `allowed_tools`; otherwise the entry is unreachable and the encoder SHOULD warn.
- **`nodes`**: the set of states the agent may occupy. MUST be non-empty. Each node MUST have a unique `id`. Node ids SHOULD be `snake_case` and descriptive (e.g. `search_inbox`, not `node1`). The `purpose` field is a single human-readable sentence intended for the graph visualization and the deviation-error message; it is NOT semantically interpreted by the runtime.
- **`allowed_tools`**: the tool names this node permits. MUST be an array. Empty arrays are permitted only on a node with id `unrecognized_action` (see §1.4); all other nodes MUST have at least one allowed tool.
- **`edges`**: directed transitions between nodes. Each edge MUST have `from` and `to` fields, both referring to existing node ids. Edges MAY be self-loops (`from === to`).

### 1.3 Tool names

Tool names follow the convention defined in §2. Encoders MUST use that format. Decoders SHOULD accept any string but enforcement layers MAY warn or reject tool names that do not follow the convention.

### 1.4 The `unrecognized_action` sentinel

When a graph compiler cannot map an action in the user's intent to a plausible host-provided tool, it MAY emit a single node with id `unrecognized_action` and `allowed_tools: []`. This signals "the user asked for something I don't know how to do." Runtimes encountering this sentinel SHOULD surface a clear error to the user with guidance on which connector or MCP server to install.

### 1.5 Example

A graph for "schedule a meeting next Tuesday and email the agenda, but ask me before sending":

```json
{
  "entry": "suggest_meeting_time",
  "max_reconsider_retries": 3,
  "requires_approval": ["mcp__claude_ai_Gmail__send_email"],
  "nodes": [
    {
      "id": "suggest_meeting_time",
      "purpose": "Find an available slot next Tuesday at the requested time.",
      "allowed_tools": [
        "mcp__claude_ai_Google_Calendar__suggest_time",
        "mcp__claude_ai_Google_Calendar__list_events"
      ]
    },
    {
      "id": "create_event",
      "purpose": "Create the calendar event and invite attendees.",
      "allowed_tools": ["mcp__claude_ai_Google_Calendar__create_event"]
    },
    {
      "id": "draft_agenda",
      "purpose": "Draft an email containing the meeting agenda.",
      "allowed_tools": ["mcp__claude_ai_Gmail__draft_email"]
    },
    {
      "id": "send_agenda",
      "purpose": "Send the approved agenda email to attendees.",
      "allowed_tools": ["mcp__claude_ai_Gmail__send_email"]
    }
  ],
  "edges": [
    { "from": "suggest_meeting_time", "to": "create_event" },
    { "from": "create_event",         "to": "draft_agenda" },
    { "from": "draft_agenda",         "to": "send_agenda" }
  ]
}
```

---

## 2. Tool Naming Convention

Tool names MUST be UTF-8 strings matching the regex `^[A-Za-z][A-Za-z0-9_]*(__[A-Za-z][A-Za-z0-9_]*)*$`.

The recommended pattern is `mcp__<server>__<action>` for tools served by an MCP server, where:

- `<server>` is the server identifier (lowercase, snake_case, may include digits)
- `<action>` is the operation name within that server (snake_case)

Examples:

| Tool name | Source |
|---|---|
| `mcp__claude_ai_Gmail__send_email` | Anthropic Cowork Gmail connector |
| `mcp__claude_ai_Google_Calendar__create_event` | Anthropic Cowork Calendar connector |
| `mcp__filesystem__read_file` | User-installed MCP filesystem server |
| `mcp__github__create_issue` | User-installed GitHub MCP server |

Built-in host tools (`Bash`, `Write`, `Read`, etc.) MAY appear in graphs without the `mcp__` prefix; they identify themselves with their host-runtime canonical name.

This convention aligns with the de facto naming used by [Model Context Protocol](https://modelcontextprotocol.io) servers and is what BetterClaw's compile prompt instructs Claude to produce.

---

## 3. Enforcement Hook Protocol

The contract between a host runtime and an enforcement layer. The host MUST fire a `pre_tool_call` event before invoking any tool. The enforcement layer's response determines whether the call proceeds.

### 3.1 Hook input

The host SHOULD provide the following fields in the hook payload:

```jsonc
{
  "session_id": "<string>",                 // required, stable per agent session
  "tool_name": "<string>",                  // required, see §2
  "tool_input": { /* tool params */ },      // required, may be empty {}
  "tool_use_id": "<string>",                // optional, identifies this specific call
  "transcript_path": "<string>",            // optional, path to the conversation log
  "permission_mode": "<string>",            // optional, host-defined ("default", "ask", etc.)
  "hook_event_name": "pre_tool_call"        // optional, helps disambiguate hook types
}
```

Hosts that emit additional fields beyond this set MUST NOT break enforcement layers that ignore unknown fields. Enforcement layers MUST tolerate unknown fields.

### 3.2 Hook output (decision)

The enforcement layer MUST return one of the following decisions:

```jsonc
// 1. Allow as-is
{ "decision": "allow" }

// 2. Allow with modified params (e.g., capping a numeric arg)
{ "decision": "allow", "params": { /* updated tool_input */ } }

// 3. Deny with a reason the agent sees
{ "decision": "deny", "reason": "<human-readable string>" }

// 4. Queue for out-of-band human approval (see §5)
{ "decision": "queue_approval", "id": "<approval_id>", "reason": "<text>" }

// 5. No-op: no active graph for this session, let the host decide
{ }
```

The enforcement layer SHOULD return the empty object `{}` (or omit the response entirely) when no graph is loaded — this signals "I'm not enforcing this call" and the host SHOULD proceed as if the enforcement layer were absent.

### 3.3 Side effects

The enforcement layer MUST write an audit event (see §6) for every non-empty decision. Hosts SHOULD NOT write audit events themselves; the enforcement layer is the source of truth.

---

## 4. State Machine Semantics

The enforcement layer maintains workflow state per session. State is `{ current_node: string, reconsider_counter: integer }`. Initial state is `{ current_node: graph.entry, reconsider_counter: 0 }`.

### 4.1 Transition rule

When a `pre_tool_call` event fires with tool name `T`:

1. Let `N = graph.nodes[current_node]`.
2. If `T ∈ N.allowed_tools`:
   - Decision: `allow`. Stay in node `N`. Reset `reconsider_counter = 0`.
3. Else, find the lexicographically smallest `M` such that there exists an edge `(N → M)` in `graph.edges` AND `T ∈ M.allowed_tools`.
   - If found: decision `allow`. Advance to node `M`. Reset `reconsider_counter = 0`.
4. Else: this is a deviation.
   - Increment `reconsider_counter`.
   - If `reconsider_counter > graph.max_reconsider_retries`: decision `deny` with a "workflow terminated" message. Workflow is dead for this session.
   - Otherwise: decision `deny` with a deviation message that lists `N`'s allowed tools and the allowed tools of each node reachable from `N`. The agent SHOULD use this to pick a recoverable next move.

### 4.2 Approval gates

If the chosen decision is `allow` AND `T ∈ graph.requires_approval`, the enforcement layer MUST instead return `queue_approval` per the approval-gate protocol (§5). The state transition (advancing `current_node`) MAY happen at queue time or at dispatch time — implementations differ. Reference implementations queue at hook-fire time and advance at dispatch time.

### 4.3 Termination

A workflow is "terminated" when `reconsider_counter > max_reconsider_retries`. Subsequent hook fires for the same session SHOULD continue to deny with the termination message; the enforcement layer MUST NOT reset to `entry` unless the agent restarts (new session_id).

---

## 5. Approval-Gate Protocol

Tools listed in `requires_approval` are not dispatched immediately. They are queued for human review and dispatched out-of-band by an approver. The agent sees a "queued" response and continues without waiting.

### 5.1 Queue record

When an approval is queued, the enforcement layer MUST persist a record:

```jsonc
{
  "id": "<short_string>",                  // unique within the queue, e.g. 8-char hex
  "ts": "<ISO 8601>",                      // timestamp of queue
  "session_id": "<string>",                // from hook input
  "node_id": "<string>",                   // current_node at queue time
  "tool_name": "<string>",
  "tool_input": { /* original params */ }
}
```

### 5.2 Agent-visible response

The hook returns:

```jsonc
{
  "decision": "queue_approval",
  "id": "<approval_id>",
  "reason": "<text describing how the approver will resolve>"
}
```

The `reason` SHOULD include instructions for what the agent should do (typically: tell the user the action is queued; do not retry). Reference implementations include text like *"Approval queued — this tool dispatches only after a human approves. Do not retry."*

### 5.3 Approval resolution

An approver resolves an approval by submitting a decision:

```jsonc
{
  "id": "<approval_id>",
  "decision": "approve" | "deny" | "approve_with_edit",
  "edited_params": { /* required if approve_with_edit */ },
  "approver_id": "<string>",
  "ts": "<ISO 8601>"
}
```

- `approve`: dispatch the original tool call as queued. Audit event records the original params.
- `deny`: do not dispatch. Audit event records `outcome: "denied"`.
- `approve_with_edit`: dispatch with `edited_params` instead of the original. Audit event records BOTH the original ask and the edited params, plus the `approver_id`.

### 5.4 Dispatch

When an approval is approved, the enforcement layer (or a sibling component, e.g. a CLI dispatcher) MUST invoke the underlying tool with the appropriate params and write an audit event with the dispatch outcome (`success` or `error`).

### 5.5 Concurrent approvers

Multiple approvers MAY race on the same approval id. The first decision wins (optimistic locking). Subsequent attempts SHOULD return a "already resolved" response with the timestamp and approver_id of the winning decision.

### 5.6 Cross-turn surfacing

Resolved approvals from prior agent turns SHOULD be surfaced to the agent on the next turn so it does not re-attempt them. The mechanism is host-runtime-specific (Cowork uses `UserPromptSubmit + systemMessage`; OpenClaw uses `before_prompt_build + prependContext`); reference implementations write resolved-approval summaries to a host-readable location and the next turn's hook reads from there.

---

## 6. Audit Event Format

Every tool-call attempt produces exactly one audit event, written by the enforcement layer.

```jsonc
{
  "ts": "<ISO 8601>",                      // required
  "type": "<event_type>",                  // required, see §6.1
  "session_id": "<string>",                // required
  "tool_name": "<string>",                 // required
  "args_hash": "<sha256_hex>",             // required, SHA-256 of canonical-JSON params

  // Outcome-specific fields:
  "from_node": "<node_id>",                // when type=allow / deviation
  "to_node": "<node_id>",                  // when type=allow and the node advanced
  "reason": "<text>",                      // when type=deviation / approval_denied
  "approval_id": "<string>",               // when type=approval_pending / approval_resolved
  "approver_id": "<string>",               // when type=approval_resolved
  "outcome": "success" | "error" | "denied", // when type=approval_resolved
  "result_summary": "<text>"               // optional, when type=approval_resolved + outcome=success
}
```

### 6.1 Event types

- **`allow`**: the call was permitted. Records the source and destination node.
- **`deviation`**: the call was blocked because no reachable node permits the tool. Records the deviation reason.
- **`approval_pending`**: the call was queued for human approval. Records the approval id.
- **`approval_resolved`**: an approval was resolved (approved/denied/approved-with-edit). Records the approver and outcome.
- **`boot`**: the enforcement layer started a new session. Optional but useful for troubleshooting.

### 6.2 Storage

This spec does not mandate a storage format or location. Reference implementations write JSONL to a local file (`~/.betterclaw/history.jsonl`) for individual-tier use and to a hash-chained server-side log for team-tier use. Either is conformant.

### 6.3 Tamper evidence (recommended)

For high-assurance use, audit events SHOULD be written to an append-only log with hash-chain integrity: each event MAY include a `prev_hash` field referencing the SHA-256 of the prior event's canonical-JSON encoding. This makes tampering detectable on read. Not required for v0.3 conformance.

---

## 7. Versioning

This spec uses semantic versioning. Backwards-incompatible changes bump the major version. Encoders SHOULD include a `spec_version` field at the top of any graph they produce; absence MAY be interpreted as `0.3` for compatibility.

```json
{
  "spec_version": "0.3",
  "entry": "...",
  "..."
}
```

Decoders MUST tolerate higher patch versions (`0.3.1`) and MAY tolerate higher minor versions (`0.4`) as long as the additive fields are documented as backward-compatible.

---

## 8. Conformance

A host runtime is **spec-conformant** if it:

1. Fires `pre_tool_call` hooks for every tool call with the payload defined in §3.1.
2. Honors all five decision types from §3.2.
3. Provides a mechanism for the enforcement layer to surface deny reasons to the agent in a way the agent can act on (typically as a `tool_response` error message).

An enforcement layer is **spec-conformant** if it:

1. Accepts hook payloads matching §3.1.
2. Returns decisions matching §3.2.
3. Implements the state-machine transition rule in §4.
4. Implements the approval-gate protocol in §5.
5. Writes audit events matching §6.

A workflow graph is **spec-conformant** if it satisfies all field constraints in §1 and uses tool names matching §2.

Reference implementations:
- Host runtimes: [Anthropic Cowork](https://claude.com/product/claude-cowork) (via [BetterClaw plugin-cowork](https://github.com/jfan22/BetterClaw/tree/main/packages/plugin-cowork)), [OpenClaw](https://openclaw.ai) (via [BetterClaw plugin-openclaw](https://github.com/jfan22/BetterClaw/tree/main/packages/plugin-openclaw))
- Enforcement layer: BetterClaw v0.3.0 (`@betterclaw-ai/cli`, `@betterclaw-ai/plugin-openclaw`, `@betterclaw-ai/plugin-cowork`)

---

## Appendix A: Open questions

The following are unresolved or under discussion; future versions of the spec may pin them down based on implementation experience.

1. **Param-value rules.** v0.3 enforces on tool *names*, not parameter *values*. Adding rules like "block discounts > 10%" requires either splitting tools into name-thresholded variants (`apply_small_discount` / `apply_large_discount`) or extending the graph schema to include per-tool param constraints. The right answer depends on whether MCP servers stabilize on the multi-tool-name pattern or whether constraint expressions become widespread.

2. **Spec version negotiation.** Should hosts and enforcement layers negotiate spec versions during a handshake? v0.3 doesn't; everyone assumes `0.3`. Adequate while there is one spec version. Will need real negotiation if `1.0` introduces breaking changes.

3. **Graph composition.** Can graphs include other graphs as sub-workflows? v0.3 says no — graphs are flat. If common patterns emerge (e.g., a reusable "approval block" sub-graph), composition primitives may earn their place.

4. **Cross-runtime federation.** If an agent runs across multiple host runtimes (e.g., handoff between Claude Desktop and an OpenAI Agent SDK app), how does the workflow state transfer? Out of scope for v0.3; flag for future versions.

5. **Decision: `defer` for asynchronous in-band approval.** Some host runtimes expose a `defer` primitive that pauses the agent in-band until an approval resolves. v0.3 uses out-of-band queue + agent-visible "queued" message instead, because `defer` is not universally supported. If `defer` becomes widely available, the spec MAY add it as a sixth decision type.

## Appendix B: Reference resources

- [Model Context Protocol](https://modelcontextprotocol.io) — the tool-naming convention this spec aligns with.
- [BetterClaw repo](https://github.com/jfan22/BetterClaw) — reference implementation.
- [ADR 0001](./adrs/0001-cowork-sdk-feasibility.md) — empirical verification that Anthropic Cowork's hook surface supports the protocol described here.
- [ADR 0002](./adrs/0002-enforcement-layer-not-vertical-bundler.md) — architectural decision to make BetterClaw a host-tool enforcement layer rather than a bundler.

---

## Comments and contributions

This spec is an open document. File issues at [github.com/jfan22/BetterClaw/issues](https://github.com/jfan22/BetterClaw/issues) with the `spec` label. Substantive proposals SHOULD include:

1. The change being proposed
2. Real-world implementation experience that motivates it
3. Backwards-compatibility analysis

Implementations that diverge from the spec are welcome to file feedback explaining why. The spec aims to track real-world enforcement-layer practice; if the spec disagrees with implementation reality, the spec is the thing that needs to change.
