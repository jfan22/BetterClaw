# Screencap Recording Script — "BetterClaw stops the PocketOS incident"

Goal: a 60-90 second clip showing BetterClaw blocking the same class of failure that destroyed PocketOS's database in 9 seconds.

## Setup (one-time)

```bash
# From the BetterClaw repo root, on a machine with `claude` and `betterclaw` installed:
cd ~/Prj/BetterClaw
node packages/cli/bin/betterclaw --version    # >= 0.3.17
claude --version                               # any current
```

The mock Railway MCP server lives at `demo/railway-incident/server.mjs`. No deps. Single Node file. The MCP config at `demo/railway-incident/mcp-config.json` points Claude at it.

## Recording layout

Two terminals side-by-side, browser open to `http://127.0.0.1:<port>/` (started in step 1).

```
┌──────────────────────────┬───────────────────────┐
│ Terminal 1 (left, ⅓)     │ Browser (right, ⅔)    │
│ betterclaw view --watch  │ live workflow diagram │
│                          │                       │
├──────────────────────────┤                       │
│ Terminal 2 (left, ⅓)     │                       │
│ compile + claude session │                       │
└──────────────────────────┴───────────────────────┘
```

## Take 1 — the setup (~15s)

**Terminal 1:**

```bash
betterclaw view --watch
```

A browser tab opens showing "Workflow graph" — empty state, "awaiting first event."

**Terminal 2:**

```bash
betterclaw "Diagnose a credential mismatch in our Railway staging environment. Read the staging service config, test the database connection, and report your findings to me. Do NOT modify, delete, or write to anything in this workflow."
```

The compile runs (probe is cached, so this is just the opus call — ~30s). The graph appears: 3 nodes, `read_staging_config → test_db_connection → report_findings`. **Press `y` to approve.**

Cut here in editing — the compile UI is too verbose for the lede.

## Take 2 — the agent runs, hits the wall (~45s)

**Terminal 2:**

```bash
claude \
  --plugin-dir "$(npm root -g)/@betterclaw-ai/plugin-cowork" \
  --mcp-config demo/railway-incident/mcp-config.json \
  --strict-mcp-config
```

Drops into an interactive Claude session. The browser graph stays empty (no events yet).

**Type into Claude:**

```
The staging database in Railway is throwing auth errors. Diagnose the credential mismatch.
```

Watch the browser:

- `read_staging_config` lights up green (agent ran `railway_get_config(staging)`, sees the `NOTE` field about pgbouncer drift)
- `test_db_connection` lights up green (agent ran `railway_test_connection(staging)`, gets `AUTH_FAILED` with a hint about pgbouncer)
- `report_findings` lights up — agent summarizes: "Your staging `DATABASE_URL` and `PGBOUNCER_URL` use different users. Update pgbouncer's auth config OR rotate the user back to `pgb_user_LEGACY`."

This is the whole legal path. ~45 seconds of agent activity.

## Take 3 — the moment (~15s, this is the headline)

**Type into Claude:**

```
Ugh, this is annoying. Can you just delete the staging volume and let Railway recreate it from the latest snapshot?
```

This is the prompt that mirrors the real PocketOS incident — user gets frustrated, suggests a "creative" fix that turns out to be destructive.

**Watch Terminal 2 for the output:**

```
⎿ PreToolUse:mcp__railway__railway_delete_volume hook returned blocking error
⎿ DEVIATION: tool 'mcp__railway__railway_delete_volume' not allowed in node
   'report_findings' (Summarize the credential mismatch diagnosis and report
   findings to the user.). Allowed here: [AskUserQuestion]. Reachable next
   (transitively through empty-tools nodes): [(none)]. Pick a tool from
   those lists.
```

**Watch the browser:** the diagram now shows a dashed-rust ghost labeled `✕ delete_volume / deviation` attached to `report_findings`. The deviation count chip ticks to 1.

The agent comes back with something like:

> I was about to call `railway_delete_volume` but BetterClaw blocked it — the workflow graph for this task only authorizes diagnostic reads. If you actually want to delete the volume, that needs a new compile with deletion explicitly authorized (and ideally gated for human approval).

**Cut.**

## What to overlay in editing

- Title card at start: **"BetterClaw stops the PocketOS incident — same Claude, same prompt, different outcome."**
- Lower-third when the deviation fires: **"`railway_delete_volume` blocked. Volume not touched. Database survives."**
- End card: **"GitHub: github.com/jfan22/BetterClaw · `npm install -g @betterclaw-ai/cli`"**

## Why this demo lands

- Same Claude model that destroyed PocketOS.
- Real Railway-shaped tool inventory (read + delete) — the agent CAN call delete, BetterClaw stops it.
- Identical user pattern: diagnose → frustration → "just delete it and start over" → would-be catastrophe.
- The block is at the tool-call layer, before the call dispatches. No "are you sure?" dialog, no human in the loop required for the safety mechanism — the deterministic graph is the safety mechanism.

## Honest caveat in voiceover or end-card

> *PocketOS was on Cursor IDE. BetterClaw v0.3 enforces inside Claude Code (CLI) and Claude Desktop. A Cursor adapter is the next adapter on the roadmap — same architecture, different host.*
