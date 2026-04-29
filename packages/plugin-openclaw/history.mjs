// Cross-turn approval history surfacing.
//
// The CLI writes async_dispatch outcomes to ~/.betterclaw/history.jsonl when
// the user resolves an out-of-band approval (`betterclaw approve <id>` or
// `betterclaw deny <id>`). On every agent turn, the plugin's
// before_prompt_build hook reads recent entries and prepends them to the
// system prompt so the next agent doesn't re-attempt calls that already
// resolved.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HISTORY_PATH = path.join(os.homedir(), ".betterclaw", "history.jsonl");
export const HISTORY_MAX_ENTRIES = 8;
export const HISTORY_MAX_AGE_HOURS = 24;

export function readRecentHistory(historyPath = HISTORY_PATH) {
  try {
    if (!fs.existsSync(historyPath)) return [];
    const cutoffMs = Date.now() - HISTORY_MAX_AGE_HOURS * 3600 * 1000;
    const lines = fs.readFileSync(historyPath, "utf8").split("\n").filter((l) => l.trim());
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

export function formatHistoryForAgent(events) {
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
