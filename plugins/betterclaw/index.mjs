import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { getGlobalHookRunner } from "openclaw/plugin-sdk/plugin-runtime";
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

const MEMORY_PATH = path.join(os.homedir(), ".openclaw", "workspace", "MEMORY.md");
const MEMORY_MARKER_BEGIN = "<!-- BEGIN betterclaw:recent_approvals -->";
const MEMORY_MARKER_END = "<!-- END betterclaw:recent_approvals -->";

// Write our "recent approvals" block into ~/.openclaw/workspace/MEMORY.md,
// which OpenClaw's CLI backend auto-loads into the agent's prompt context
// on every turn. Preserves any user-owned content outside our markers.
// If history is empty, strips our section (leaves other content alone).
function syncRecentApprovalsToMemoryFile() {
  try {
    fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
    const existing = fs.existsSync(MEMORY_PATH) ? fs.readFileSync(MEMORY_PATH, "utf8") : "";
    const events = readRecentHistory();
    const block = formatHistoryForAgent(events);

    // Strip any prior betterclaw block (idempotent).
    const beginIdx = existing.indexOf(MEMORY_MARKER_BEGIN);
    const endIdx = existing.indexOf(MEMORY_MARKER_END);
    let preserved = existing;
    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      preserved = (existing.slice(0, beginIdx) + existing.slice(endIdx + MEMORY_MARKER_END.length))
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    let next;
    if (block) {
      const section = [MEMORY_MARKER_BEGIN, "", block, "", MEMORY_MARKER_END].join("\n");
      next = preserved ? `${section}\n\n${preserved}\n` : `${section}\n`;
    } else {
      next = preserved ? `${preserved}\n` : "";
    }

    if (next.length === 0) {
      // Nothing to write, nothing user-owned — remove the file if we created it earlier.
      if (existing && existing.trim() === "") {
        try { fs.unlinkSync(MEMORY_PATH); } catch {}
      }
      return;
    }
    fs.writeFileSync(MEMORY_PATH, next);
    process.stderr.write(
      `[HISTORY] synced ${events.length} recent approval event(s) to ${MEMORY_PATH}\n`,
    );
  } catch (err) {
    process.stderr.write(`[HISTORY] sync failed: ${String(err)}\n`);
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

    // v0.3: surface out-of-band dispatch outcomes to the agent at the start
    // of every turn. Closes the "agent doesn't see the approved draft"
    // UX gap: when the CLI's `betterclaw approve` dispatches a draft via
    // Gmail MCP, the agent that originally requested it is long gone.
    //
    // Implementation: we'd prefer api.on("before_prompt_build", ...), but
    // that hook doesn't fire in the `openclaw agent --local` cli-runner
    // path (same OpenClaw gap as before_tool_call — runBeforePromptBuild is
    // only invoked from pi-embedded-runner). Workaround: write our history
    // block into the workspace's MEMORY.md, which OpenClaw's CLI backend
    // auto-loads into the agent's bootstrap context. Bounded file (fixed
    // allowlist of names in workspace.ts), so we don't pollute unexpected
    // paths. Any user-owned content outside our markers is preserved.
    syncRecentApprovalsToMemoryFile();
    api.on("before_prompt_build", () => {
      // Dead weight in the current cli-runner path, but leave it wired so
      // it activates automatically if the user runs the Pi embedded agent
      // (which DOES fire before_prompt_build) or when OpenClaw's CLI
      // backend eventually grows support for plugin-provided prompt
      // mutations.
      const events = readRecentHistory();
      const block = formatHistoryForAgent(events);
      if (!block) return;
      return { prependContext: block };
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
