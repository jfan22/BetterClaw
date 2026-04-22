import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { getGlobalHookRunner } from "openclaw/plugin-sdk/plugin-runtime";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  loadGraph,
  enforce,
  freshState,
  resolveDefaultGraphPath,
  resolveDefaultRunLogPath,
  resolveApprovalsDir,
  waitForApproval,
  createRunLogger,
} from "./workflow.mjs";

// All verticals ship inside this plugin. Each exports a `vertical` object with
// an id, a tool list, and compiler guidance. Which one gets exposed is decided
// by the active graph's "vertical" field. Default: email (back-compat with
// earlier graphs).
import { vertical as emailVertical } from "./vertical-email.mjs";
import { vertical as shoppingVertical } from "./vertical-shopping.mjs";
import { vertical as salesVertical } from "./vertical-sales.mjs";
import { vertical as travelVertical } from "./vertical-travel.mjs";
const VERTICALS = new Map([
  [emailVertical.id, emailVertical],
  [shoppingVertical.id, shoppingVertical],
  [salesVertical.id, salesVertical],
  [travelVertical.id, travelVertical],
]);

let workflowGraph = null;
let workflowState = null;
let runLogger = { append: () => {} };
let activeVerticalId = "email";

// Dedupe key: toolName + canonical JSON of params. When Claude CLI's
// per-tool-call timeout fires during a long approval wait, it retries the
// same tool call. Without dedupe, each retry creates a fresh approval id and
// the pending queue piles up with duplicates. With dedupe, retries await
// the same in-flight approval. Map<hash, Promise<"approved"|"denied">>.
const approvalPromiseByHash = new Map();
function hashToolCall(toolName, params) {
  // Stable JSON — the hook sees params unchanged so key-order drift isn't a
  // concern in practice, but JSON.stringify with sorted keys gives us
  // correctness regardless.
  return toolName + ":" + JSON.stringify(params ?? {}, Object.keys(params ?? {}).sort());
}

function wrapExecuteWithHook(toolName, realExecute) {
  return async (toolCallId, params, signal, onUpdate) => {
    const runner = getGlobalHookRunner();
    let adjustedParams = params;
    if (runner?.hasHooks("before_tool_call")) {
      const event = { toolName, params: params ?? {}, toolCallId };
      const ctx = { toolName };
      const outcome = await runner.runBeforeToolCall(event, ctx);
      if (outcome?.block) {
        return {
          content: [
            {
              type: "text",
              text: outcome.blockReason || "Tool call blocked by workflow enforcement.",
            },
          ],
          isError: true,
        };
      }
      if (outcome?.params) adjustedParams = outcome.params;
    }
    return realExecute(toolCallId, adjustedParams, signal, onUpdate);
  };
}

export default definePluginEntry({
  id: "betterclaw",
  name: "BetterClaw",
  description: "Workflow-enforcement plugin for OpenClaw.",
  register(api) {
    const pluginRoot = api.rootDir ?? process.cwd();
    const graphPath = resolveDefaultGraphPath(pluginRoot);
    try {
      workflowGraph = loadGraph(graphPath);
      workflowState = freshState(workflowGraph);
      activeVerticalId = workflowGraph.vertical ?? "email";
      api.logger?.info?.(
        `BetterClaw: loaded graph — vertical=${activeVerticalId}, entry=${workflowGraph.entry}, ` +
          `nodes=${workflowGraph.nodes.length}, edges=${workflowGraph.edges.length}`,
      );
    } catch (err) {
      api.logger?.warn?.(
        `BetterClaw: no graph at ${graphPath} — enforcement disabled. Error: ${String(err)}`,
      );
      workflowGraph = null;
      workflowState = null;
    }

    runLogger = createRunLogger(resolveDefaultRunLogPath(pluginRoot));
    runLogger.append({
      ts: new Date().toISOString(),
      type: "boot",
      vertical: activeVerticalId,
      graph_entry: workflowGraph?.entry ?? null,
      graph_nodes: workflowGraph?.nodes.map((n) => n.id) ?? [],
    });

    const approvalsDir = resolveApprovalsDir(pluginRoot);
    try { fs.mkdirSync(approvalsDir, { recursive: true }); } catch {}

    // Determine which tool name prefixes are "ours" (belong to the active
    // vertical) so we only enforce on those.
    const vertical = VERTICALS.get(activeVerticalId) ?? emailVertical;
    const ourToolNames = new Set(vertical.tools.map((t) => t.name));

    api.on("before_tool_call", async (event, ctx) => {
      if (!workflowGraph) return;
      const stripped = (event.toolName || "").replace(/^mcp__openclaw__/, "");
      if (!ourToolNames.has(stripped)) return;

      const prevNode = workflowState.currentNode;
      const result = enforce(workflowGraph, workflowState, stripped, event.params ?? {});
      const ts = new Date().toISOString();

      if (result.decision === "block") {
        process.stderr.write(
          `[DEVIATION] ${ts} node=${prevNode} attempted=${stripped} ` +
            `retry=${result.retry}/${workflowGraph.max_reconsider_retries}\n`,
        );
        runLogger.append({
          ts,
          type: "deviation",
          from_node: prevNode,
          attempted_tool: stripped,
          retry: result.retry,
          retry_limit: workflowGraph.max_reconsider_retries,
          reason: result.reason,
        });
        return { block: true, blockReason: result.reason };
      }

      const requiresApproval = Array.isArray(workflowGraph.requires_approval)
        ? workflowGraph.requires_approval.includes(stripped)
        : false;

      if (requiresApproval) {
        // v0.2 approval seam: the plugin VM only lives as long as the agent
        // turn. Blocking the hook on an approval that may take minutes is a
        // losing bet — Claude CLI's per-tool-call timeout (~60s) fires first
        // and the plugin dies when the agent exits. So: record the intent,
        // return "queued" to the agent IMMEDIATELY, and let the CLI
        // (`betterclaw approve <id>`) handle the actual dispatch to the
        // backend when the user decides.
        //
        // Dedupe on {tool, params}: if Claude CLI retries the same tool call
        // with identical params before the agent's turn ends, reuse the same
        // id so `betterclaw pending` doesn't show duplicates.
        const hash = hashToolCall(stripped, event.params ?? {});
        let id = approvalPromiseByHash.get(hash)?.id;
        if (!id) {
          id = crypto.randomUUID().slice(0, 8);
          runLogger.append({
            ts,
            type: "approval_pending",
            id,
            node: workflowState.currentNode,
            tool: stripped,
            vertical: activeVerticalId,
            params: event.params ?? {},
          });
          process.stderr.write(
            `[APPROVAL] ${ts} id=${id} tool=${stripped} — queued for out-of-band approval\n` +
              `[APPROVAL]   run: betterclaw show ${id}   # inspect the draft/params\n` +
              `[APPROVAL]   then: betterclaw approve ${id}   or   betterclaw deny ${id}\n`,
          );
          // Track so retries within the same turn dedupe to this id.
          // (The "promise" field is kept for compat with older callers but
          // isn't meaningfully awaited anywhere now.)
          approvalPromiseByHash.set(hash, { id, promise: Promise.resolve("queued") });
        } else {
          process.stderr.write(
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

      process.stderr.write(
        `[ALLOW] ${ts} node=${workflowState.currentNode} tool=${stripped}\n`,
      );
      runLogger.append({
        ts,
        type: "allow",
        from_node: prevNode,
        to_node: workflowState.currentNode,
        tool: stripped,
        transitioned: prevNode !== workflowState.currentNode,
      });
      return { params: result.params };
    });

    // Register only the tools for the active vertical. Each execute is
    // wrapped so the before_tool_call hook above actually fires.
    for (const tool of vertical.tools) {
      api.registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: wrapExecuteWithHook(tool.name, tool.execute),
      });
    }
  },
});
