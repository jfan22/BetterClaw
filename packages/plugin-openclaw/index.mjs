// BetterClaw plugin entry — pure enforcement layer.
//
// Per ADR 0002, BetterClaw v0.3 is an enforcement layer over whatever tools
// the host environment (OpenClaw or Cowork) provides. The plugin does not
// register or own tools. It loads the active workflow graph, derives the
// set of tool names the graph cares about, and gates calls to those tools
// via the `before_tool_call` hook. The `before_prompt_build` hook surfaces
// recent out-of-band approval outcomes to the next agent turn.
//
// One exception: when BETTERCLAW_DEMO=1 is set, the plugin registers the
// demo-shopping tutorial tools (dummyjson.com-backed) so a fresh user can
// run BetterClaw end-to-end without external credentials. This is a
// tutorial path, not a product feature.
//
// Real verticals (Gmail, calendar, sales, etc.) come from:
//   - Cowork: Anthropic's verified connectors (zero setup)
//   - OpenClaw: user-installed MCP servers
//   - OpenClaw fallback: `betterclaw connect gmail` (Phase 2)

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadGraph,
  freshState,
  resolveDefaultGraphPath,
  resolveDefaultRunLogPath,
  resolveApprovalsDir,
  resolveDefaultParagraphPath,
  verifyGraphParagraphBinding,
  createRunLogger,
} from "./workflow.mjs";
import { createEnforcer } from "./enforcement.mjs";
import { readRecentHistory, formatHistoryForAgent } from "./history.mjs";
import { emitPluginTelemetry } from "./telemetry.mjs";

// Gmail fallback marker — written by CLI's `betterclaw connect gmail`. When
// present, the plugin registers vertical-email tools and the CLI starts the
// Gmail MCP daemon. Cowork users don't need this; their Gmail comes from
// Anthropic's verified connector.
const GMAIL_FALLBACK_MARKER_PATH = path.join(os.homedir(), ".betterclaw", "gmail-fallback-enabled");

function isGmailFallbackEnabled() {
  return fs.existsSync(GMAIL_FALLBACK_MARKER_PATH);
}

export default definePluginEntry({
  id: "betterclaw",
  name: "BetterClaw",
  description: "Workflow-enforcement layer for OpenClaw — gates AI agent tool calls against a declarative graph.",
  register(api) {
    const pluginRoot = api.rootDir ?? process.cwd();

    // Load the active workflow graph. If absent, the plugin still registers
    // hooks but they no-op — useful for users who installed BetterClaw before
    // running `betterclaw <paragraph>`.
    let graph = null;
    let state = null;
    try {
      graph = loadGraph(resolveDefaultGraphPath(pluginRoot));
      state = freshState(graph);
      api.logger?.info?.(
        `BetterClaw: loaded graph — entry=${graph.entry}, ` +
          `nodes=${graph.nodes.length}, edges=${graph.edges.length}`,
      );
    } catch (err) {
      api.logger?.warn?.(
        `BetterClaw: no graph at ${resolveDefaultGraphPath(pluginRoot)} — enforcement disabled. Error: ${String(err)}`,
      );
    }

    const runLogger = createRunLogger(resolveDefaultRunLogPath(pluginRoot));
    runLogger.append({
      ts: new Date().toISOString(),
      type: "boot",
      graph_entry: graph?.entry ?? null,
      graph_nodes: graph?.nodes.map((n) => n.id) ?? [],
    });

    // Verify the active graph still binds to the paragraph it was compiled from.
    // Drift means the user edited the paragraph without re-compiling — the
    // running enforcement no longer matches the spec on disk. Warn loudly,
    // don't block (the user may be mid-edit, and refusing to enforce isn't
    // safer than enforcing slightly stale).
    if (graph) {
      const binding = verifyGraphParagraphBinding(graph, resolveDefaultParagraphPath(pluginRoot));
      if (binding.status === "drift") {
        api.logger?.warn?.(
          `BetterClaw: paragraph drift detected — active-paragraph.md has been edited since compile. ` +
            `Graph hash ${binding.graphHash.slice(0, 12)}…, paragraph hash ${binding.paragraphHash.slice(0, 12)}…. ` +
            `Re-compile to update enforcement: betterclaw "<your paragraph>"`,
        );
        runLogger.append({
          ts: new Date().toISOString(),
          type: "paragraph_drift",
          graph_hash: binding.graphHash,
          paragraph_hash: binding.paragraphHash,
        });
      } else if (binding.status === "missing_paragraph") {
        api.logger?.warn?.(
          `BetterClaw: active-graph.json references a paragraph hash but active-paragraph.md is missing. ` +
            `Re-compile to restore the binding: betterclaw "<your paragraph>"`,
        );
      }
      // "missing_field" (legacy graph) and "ok" → silent.
    }

    try {
      fs.mkdirSync(resolveApprovalsDir(pluginRoot), { recursive: true });
    } catch {}

    const enforcer = createEnforcer({
      graph,
      state,
      runLogger,
      telemetry: { emit: emitPluginTelemetry },
      stderr: process.stderr,
    });

    api.on("before_tool_call", async (event) => {
      const decision = enforcer.decide(event);
      if (decision !== undefined) return decision;
    });

    api.on("before_prompt_build", () => {
      const events = readRecentHistory();
      const block = formatHistoryForAgent(events);
      if (!block) return;
      return { prependContext: block };
    });

    // Demo-only tool registration. The production plugin owns no tools; this
    // is a tutorial escape hatch so a fresh install can run end-to-end with
    // zero external setup. Gated behind BETTERCLAW_DEMO=1.
    if (process.env.BETTERCLAW_DEMO === "1") {
      registerDemoTools(api);
    }

    // Gmail fallback for OpenClaw users without Cowork. Gated behind the
    // marker file written by `betterclaw connect gmail` (CLI). When the marker
    // is absent, vertical-email is not loaded and the Gmail MCP daemon stays
    // dormant. Cowork users get Gmail via Anthropic's verified connector and
    // should NOT enable this.
    if (isGmailFallbackEnabled()) {
      registerGmailFallbackTools(api);
    }
  },
});

async function registerDemoTools(api) {
  const { demoShopping } = await import("./demo-shopping.mjs");
  for (const tool of demoShopping.tools) {
    api.registerTool({
      name: tool.name,
      description: `[DEMO] ${tool.description}`,
      parameters: tool.parameters,
      execute: tool.execute,
    });
  }
  api.logger?.info?.(
    `BetterClaw: demo tools registered (BETTERCLAW_DEMO=1). ` +
      `${demoShopping.tools.map((t) => t.name).join(", ")}.`,
  );
}

async function registerGmailFallbackTools(api) {
  const { vertical: emailVertical } = await import("./vertical-email.mjs");
  for (const tool of emailVertical.tools) {
    api.registerTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute,
    });
  }
  api.logger?.info?.(
    `BetterClaw: Gmail fallback tools registered (marker present). ` +
      `${emailVertical.tools.map((t) => t.name).join(", ")}.`,
  );
}
