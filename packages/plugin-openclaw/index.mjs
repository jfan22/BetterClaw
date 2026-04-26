import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import fs from "node:fs";
import os from "node:os";
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
import { emitPluginTelemetry } from "./telemetry.mjs";
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

// Cross-turn history log. CLI writes async_dispatch outcomes here (see
// cli/betterclaw). On every agent turn, our before_prompt_build hook reads
// the most recent entries and surfaces them to the agent so it can avoid
// re-attempting tool calls that already resolved.
const HISTORY_PATH = path.join(os.homedir(), ".betterclaw", "history.jsonl");
const HISTORY_MAX_ENTRIES = 8;
const HISTORY_MAX_AGE_HOURS = 24;

function readRecentHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const cutoffMs = Date.now() - HISTORY_MAX_AGE_HOURS * 3600 * 1000;
    const lines = fs.readFileSync(HISTORY_PATH, "utf8").split("\n").filter((l) => l.trim());
    const events = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.ts && new Date(e.ts).getTime() >= cutoffMs) events.push(e);
      } catch {}
    }
    return events.slice(-HISTORY_MAX_ENTRIES);
  } catch {
    return [];
  }
}

// One-shot cleanup of the v0.2.0 MEMORY.md cross-turn-history workaround.
// v0.2.0 wrote recent-approval blocks into ~/.openclaw/workspace/MEMORY.md
// because OpenClaw's CLI-backend path didn't fire `before_prompt_build` on
// plugin tools. Upstream openclaw@2026.4.24 (PR #70625) fixed that, so we now
// register the hook natively and never touch MEMORY.md. This function strips
// any leftover BetterClaw block on plugin boot so the upgrade is invisible
// — if MEMORY.md doesn't have our block it's a fast no-op.
//
// Removable in a future release once we're confident no v0.2.0 installs are
// in active use (likely v0.3.x once telemetry shows < 5% v0.2.0 footprint).
function removeLegacyMemoryBlock() {
  const memoryPath = path.join(os.homedir(), ".openclaw", "workspace", "MEMORY.md");
  const begin = "<!-- BEGIN betterclaw:recent_approvals -->";
  const end = "<!-- END betterclaw:recent_approvals -->";
  try {
    if (!fs.existsSync(memoryPath)) return;
    const existing = fs.readFileSync(memoryPath, "utf8");
    const beginIdx = existing.indexOf(begin);
    const endIdx = existing.indexOf(end);
    if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return;
    const cleaned = (existing.slice(0, beginIdx) + existing.slice(endIdx + end.length))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (cleaned.length === 0) {
      try { fs.unlinkSync(memoryPath); } catch {}
    } else {
      fs.writeFileSync(memoryPath, cleaned + "\n");
    }
  } catch {
    // Best-effort cleanup; failure is harmless.
  }
}

function formatHistoryForAgent(events) {
  if (events.length === 0) return null;
  const lines = [
    "## Recent approvals — past " + HISTORY_MAX_AGE_HOURS + "h",
    "",
    "These tool calls were already dispatched or denied out-of-band (by the user via `betterclaw approve`/`deny`). You do NOT need to re-attempt them. The user has already handled them.",
    "",
  ];
  for (const e of events) {
    const when = e.ts.replace("T", " ").slice(0, 16);
    const verdict =
      e.status === "success" ? "APPROVED · success" :
      e.status === "error" ? "APPROVED · backend error" :
      e.status === "not_dispatched" ? "DENIED" :
      "UNKNOWN";
    const detail =
      e.status === "success" && e.result_summary ? e.result_summary :
      e.status === "error" && e.error ? `error: ${e.error}` :
      "";
    const hint = e.summary_hint ? ` (${e.summary_hint})` : "";
    lines.push(`- ${when} · ${e.tool} · ${verdict}${hint}${detail ? " — " + detail : ""}`);
  }
  return lines.join("\n");
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

    // One-shot upgrade cleanup: strip the v0.2.0 MEMORY.md block if present.
    removeLegacyMemoryBlock();

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
        emitPluginTelemetry("deviation_blocked", {
          vertical: activeVerticalId,
          attempted_tool: stripped,
          from_node: prevNode,
          retry: result.retry,
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
      emitPluginTelemetry("auto_allow", {
        vertical: activeVerticalId,
        tool_name: stripped,
        transitioned: prevNode !== workflowState.currentNode,
      });
      return { params: result.params };
    });

    // Surface out-of-band dispatch outcomes to the agent at the start of
    // every turn. Closes the "agent doesn't see the approved draft" UX gap:
    // when the CLI's `betterclaw approve` dispatches a draft via Gmail MCP,
    // the agent that originally requested it is long gone — the next turn's
    // agent needs to know what's already been handled so it doesn't re-attempt.
    //
    // Native `before_prompt_build` hook (openclaw>=2026.4.24, PR #70625).
    // Returns { prependContext } which OpenClaw splices into the system
    // prompt for the next turn.
    api.on("before_prompt_build", () => {
      const events = readRecentHistory();
      const block = formatHistoryForAgent(events);
      if (!block) return;
      return { prependContext: block };
    });

    // Register the active vertical's tools. Enforcement happens via the
    // `before_tool_call` hook registered above — OpenClaw fires it natively
    // for plugin-served tools as of 2026.4.24 (PR #71159), so each tool's
    // execute function runs as-is.
    for (const tool of vertical.tools) {
      api.registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.execute,
      });
    }
  },
});
