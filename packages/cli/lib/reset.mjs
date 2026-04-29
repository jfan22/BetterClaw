// Wipe per-run state. Pure function — caller passes the file paths to act
// on, this module handles the unlink loop and reports back. Formatting +
// process.exit happen in the bin script; the function itself stays
// reusable and unit-testable.

import fs from "node:fs";
import path from "node:path";

/**
 * Wipe per-run BetterClaw state.
 *
 * @param {object} args
 * @param {object} args.paths Path bundle:
 *   - runLog, graph, paragraph, coworkSessions, history, toolCache (files)
 *   - approvalsDir (directory; only *.pending|approved|denied entries are removed)
 * @param {boolean} [args.all=false] If true, also wipe paths.toolCache.
 *   Default false (preserve tool cache so the next compile doesn't re-probe).
 * @returns {{wiped: string[], skipped: string[], keptToolCache: string|null}}
 *   wiped: paths actually unlinked (existed and removal succeeded)
 *   skipped: paths that existed but unlink failed (with error reason)
 *   keptToolCache: path of tool-cache.json IF preserved (was kept and exists)
 */
export function runReset({ paths, all = false }) {
  const wiped = [];
  const skipped = [];

  const tryUnlink = (p) => {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        wiped.push(p);
      } catch (err) {
        skipped.push(`${p} (${err.message})`);
      }
    }
  };

  tryUnlink(paths.runLog);
  tryUnlink(paths.graph);
  tryUnlink(paths.paragraph);
  tryUnlink(paths.coworkSessions);
  tryUnlink(paths.history);

  if (paths.approvalsDir && fs.existsSync(paths.approvalsDir)) {
    for (const entry of fs.readdirSync(paths.approvalsDir)) {
      if (/\.(pending|approved|denied)$/.test(entry)) {
        tryUnlink(path.join(paths.approvalsDir, entry));
      }
    }
  }

  if (all) {
    tryUnlink(paths.toolCache);
  }

  const keptToolCache =
    !all && paths.toolCache && fs.existsSync(paths.toolCache) ? paths.toolCache : null;

  return { wiped, skipped, keptToolCache };
}
