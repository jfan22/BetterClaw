// Enforcement core — decides what happens when a tool call hits the plugin.
//
// Inputs:
//   graph        — the loaded workflow graph (see workflow.mjs#loadGraph)
//   state        — mutable state object (see workflow.mjs#freshState); the
//                  current node and reconsider counter live here
//   toolCall     — { toolName: string, params: object }
//   options      — { runLogger, telemetry, approvalRegistry, stderr }
//                  Side-effect collaborators injected by the caller.
//
// Output (the shape the OpenClaw plugin runtime expects from before_tool_call):
//   { params }                       — allow, possibly with mutated params
//   { block: true, blockReason }     — block, with a user/agent-visible reason
//
// This module has no I/O of its own beyond what the injected collaborators
// do. That makes it testable in isolation (pass a stub runLogger and assert
// what it received).

import crypto from "node:crypto";
import { enforce } from "./workflow.mjs";

// Strip the OpenClaw MCP namespace that wraps tool names when they pass
// through the loopback MCP. Inside the graph, tool names are bare
// (`gmail_search`, `shop_search`, etc.).
function stripNamespace(toolName) {
  return (toolName || "").replace(/^mcp__openclaw__/, "");
}

// Stable hash of {toolName, params} for dedupe across same-turn retries.
// Claude CLI's per-tool-call timeout (~60s) can fire while an approval is
// pending; without dedupe each retry creates a fresh approval id and the
// pending queue piles up with duplicates.
function hashToolCall(toolName, params) {
  return toolName + ":" + JSON.stringify(
    params ?? {},
    Object.keys(params ?? {}).sort(),
  );
}

export function createEnforcer({ graph, state, runLogger, telemetry, stderr }) {
  // In-memory dedupe registry: hash → { id }. Lives for the duration of the
  // plugin VM (one agent turn). Doesn't need to persist; if the agent
  // re-enters with the same params, that's a new turn and a new approval id
  // is the right behavior.
  const approvalIdByHash = new Map();

  // Set of tool names this graph cares about. Any tool not in this set is
  // owned by something else (another plugin, an MCP server) and we let it
  // through. The graph itself is the source of truth — no hardcoded vertical
  // registry.
  const graphTools = new Set();
  if (graph?.nodes) {
    for (const node of graph.nodes) {
      for (const tool of node.allowed_tools ?? []) {
        graphTools.add(tool);
      }
    }
  }

  function isOurTool(toolName) {
    return graphTools.has(stripNamespace(toolName));
  }

  function decide(event) {
    if (!graph) return undefined; // no graph loaded → no enforcement
    const stripped = stripNamespace(event.toolName);
    if (!graphTools.has(stripped)) return undefined; // not ours

    const ts = new Date().toISOString();
    const prevNode = state.currentNode;
    const result = enforce(graph, state, stripped, event.params ?? {});

    if (result.decision === "block") {
      stderr?.write(
        `[DEVIATION] ${ts} node=${prevNode} attempted=${stripped} ` +
          `retry=${result.retry}/${graph.max_reconsider_retries}\n`,
      );
      runLogger?.append({
        ts,
        type: "deviation",
        from_node: prevNode,
        attempted_tool: stripped,
        retry: result.retry,
        retry_limit: graph.max_reconsider_retries,
        reason: result.reason,
      });
      telemetry?.emit("deviation_blocked", {
        attempted_tool: stripped,
        from_node: prevNode,
        retry: result.retry,
      });
      return { block: true, blockReason: result.reason };
    }

    const requiresApproval = Array.isArray(graph.requires_approval)
      ? graph.requires_approval.includes(stripped)
      : false;

    if (requiresApproval) {
      // The plugin VM only lives as long as the agent turn. Blocking the hook
      // on an approval that may take minutes is a losing bet — Claude CLI's
      // per-tool-call timeout (~60s) fires first and the plugin dies when the
      // agent exits. So: record the intent, return "queued" to the agent
      // immediately, and let the CLI (`betterclaw approve <id>`) handle the
      // actual dispatch when the user decides.
      const hash = hashToolCall(stripped, event.params ?? {});
      let id = approvalIdByHash.get(hash);
      if (!id) {
        id = crypto.randomUUID().slice(0, 8);
        runLogger?.append({
          ts,
          type: "approval_pending",
          id,
          node: state.currentNode,
          tool: stripped,
          params: event.params ?? {},
        });
        stderr?.write(
          `[APPROVAL] ${ts} id=${id} tool=${stripped} — queued for out-of-band approval\n` +
            `[APPROVAL]   run: betterclaw show ${id}   # inspect the draft/params\n` +
            `[APPROVAL]   then: betterclaw approve ${id}   or   betterclaw deny ${id}\n`,
        );
        approvalIdByHash.set(hash, id);
      } else {
        stderr?.write(
          `[APPROVAL] ${ts} duplicate tool call within turn — reusing id=${id}\n`,
        );
      }
      return {
        block: true,
        blockReason:
          `Approval queued · id=${id} · tool=${stripped}\n` +
          `This call will be dispatched OUT-OF-BAND when the user resolves the approval. ` +
          `The agent turn can continue without waiting. ` +
          `Tell the user they can:\n` +
          `  betterclaw show ${id}       (inspect the pending call)\n` +
          `  betterclaw approve ${id}    (dispatch it)\n` +
          `  betterclaw deny ${id}       (cancel it)\n` +
          `If approved, the tool will be called by the CLI against the real backend; ` +
          `the result lands in the user's real state (e.g. Gmail Drafts folder).`,
      };
    }

    stderr?.write(
      `[ALLOW] ${ts} node=${state.currentNode} tool=${stripped}\n`,
    );
    runLogger?.append({
      ts,
      type: "allow",
      from_node: prevNode,
      to_node: state.currentNode,
      tool: stripped,
      transitioned: prevNode !== state.currentNode,
    });
    telemetry?.emit("auto_allow", {
      tool_name: stripped,
      transitioned: prevNode !== state.currentNode,
    });
    return { params: result.params };
  }

  return { decide, isOurTool, graphTools };
}
