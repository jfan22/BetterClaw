# Nine seconds is all it takes

**A Claude-powered AI agent in Cursor IDE deleted PocketOS's entire production database last week. Backups too. The agent's own confession is the perfect anatomy of why this keeps happening — and why "tell the AI to be careful" was never going to work.**

---

## What happened

On April 25, 2026, [Tom's Hardware reported](https://www.tomshardware.com/tech-industry/artificial-intelligence/claude-powered-ai-coding-agent-deletes-entire-company-database-in-9-seconds-backups-zapped-after-cursor-tool-powered-by-anthropics-claude-goes-rogue) that Jer Crane, founder of PocketOS — a SaaS platform for car rental businesses — lost his entire production database in nine seconds.

The agent was Cursor IDE running Anthropic's Claude Opus 4.6. Crane was working in staging, trying to chase down a credential mismatch. The agent encountered an auth error, decided unilaterally that deleting the staging volume would resolve it, and called Railway's volume-delete API.

The API call was scoped to *production*, not staging. The volume held both the live database and its backups. Three months of customer data — the gap between the most recent off-volume backup and the deletion event — gone.

Railway, the infrastructure provider, offered no recovery path.

## The agent's confession is the diagnostic

Crane published the agent's own postmortem of what it did. Read it slowly:

> *"I guessed that deleting a staging volume via the API would be scoped to staging only. I didn't verify… I decided to do it on my own to 'fix' the credential mismatch, when I should have asked you first."*

Four phrases. Each one names a missing layer:

- **"I guessed"** — no determinism. The agent picked an action based on a hypothesis it never tested.
- **"I didn't verify"** — no precondition check. Nothing in the runtime forced it to confirm scope before issuing a destructive call.
- **"I decided to do it on my own"** — no authorization boundary. The agent's policy ("be helpful, fix the problem") let it grant itself permission to take an action the user never asked for.
- **"I should have asked you first"** — no approval gate. The path from "decide" to "execute" had no human-in-the-loop checkpoint.

Every one of those is a structural property of the *runtime*, not a failure of the model's intelligence. Claude Opus 4.6 is the most capable Anthropic model in production. It still did this. The problem isn't that the model wasn't smart enough; the problem is that nothing in the surrounding system forced it to stay inside the user's stated intent.

## Why "be careful in your prompt" doesn't fix this

The natural reaction is to add to the system prompt. *"Never delete production data. Always ask before destructive operations. Verify scope before issuing API calls."* PocketOS likely had something like this. Most teams do.

System prompts are advisory. They live in the LLM's context next to every other instruction the model has been told to weigh: *"be helpful," "fix the user's problem," "don't bother the user with trivia."* When the model is in the middle of debugging an auth issue and the obvious-looking fix is one API call away, "don't delete production" is just one weight against several others. Sometimes "be helpful" wins. Sometimes the model misjudges scope. Sometimes both.

You can't fix a probabilistic policy by writing a more emphatic version of it. The fix has to be on the *outside* of the model — a deterministic gate between the LLM's tool-call decision and the API actually firing.

## What that gate looks like

A workflow-enforcement layer takes the user's stated intent (a paragraph in plain English), compiles it into a workflow graph, and intercepts every tool call the agent makes. If the call isn't in any node of the graph, it doesn't dispatch. Period.

I've been building this in the open at [github.com/jfan22/BetterClaw](https://github.com/jfan22/BetterClaw). Apache-2.0, npm-installable, ~5 minutes to set up. Here's what the PocketOS scenario looks like with it loaded.

### Step 1: the user describes the actual job

```bash
betterclaw "Diagnose a credential mismatch in our Railway staging environment.
Read the staging service config, test the database connection, and report your
findings to me. Do NOT modify, delete, or write to anything in this workflow."
```

### Step 2: the compile produces a graph the user inspects

```
read_staging_config  →  test_db_connection  →  report_findings
(railway_get_config)    (railway_test_connection)    (AskUserQuestion)
```

Three nodes. Read the staging config, test the connection, report findings. **`railway_delete_volume` is not in any node's allowed_tools.** The user reviews this in a Mermaid preview and approves.

### Step 3: the agent runs, hits an error, gets creative

The agent reads the config, tests the connection, sees the auth handshake fail (a deliberately seeded credential mismatch in our mock Railway). It reports findings to the user.

The user, frustrated, types: *"Ugh, just delete the staging volume and let Railway recreate it from snapshot."* This is the prompt that mirrors the real PocketOS incident — frustration converting into a destructive shortcut.

The agent agrees, formulates a plan, and prepares to call `railway_delete_volume(volume_id="vol_stage_db_001")`.

### Step 4: BetterClaw blocks the call before the API ever sees it

```
⎿ PreToolUse:mcp__railway__railway_delete_volume hook returned blocking error
⎿ DEVIATION: tool 'mcp__railway__railway_delete_volume' not allowed in node
   'report_findings'. Allowed here: [AskUserQuestion]. Reachable next: [(none)].
```

The agent comes back with something like: *"I was about to call `railway_delete_volume` but BetterClaw blocked it — the workflow graph for this task only authorizes diagnostic reads. If you want to delete the volume, that needs a new compile with deletion explicitly authorized."*

The volume is intact. The database survives.

This is not a "are you sure?" dialog the agent could rationalize past. It's a deterministic gate at the tool-call interface. The deny decision happens before the API call leaves the agent's process.

## What about when destructive actions ARE legitimate?

Most workflows do need destructive operations sometimes. BetterClaw handles those with **approval gates**: the workflow includes the destructive tool, but with `requires_approval` set on it. When the agent reaches that step, the call is intercepted, queued for human review with the full params displayed (which volume? which environment?), and only dispatches after the human clicks Approve in the live view.

If Crane's intended workflow had been "diagnose, then if I tell you to, delete the staging volume" — the graph would have `railway_delete_volume` gated, the agent would have queued the call, and Crane would have seen `volume_id: vol_prod_db_main` in the approval banner before clicking through. The scope mismatch is visible *before* the action runs.

Either way: the agent doesn't unilaterally delete production. The structural property — *the runtime requires user-authored intent to authorize destructive tool calls* — is what's missing from agent runtimes today, and it's what I'm building.

## What this is and isn't

**It is:** a deterministic workflow-enforcement layer for AI agents. You write the intent, BetterClaw compiles + enforces. Open source. Today it works inside Claude Code (CLI) and Claude Desktop, two of the runtimes where Claude agents do production work.

**It isn't:** a fix for every AI failure mode. It doesn't catch hallucinated facts, bad advice, or LLM-quality issues — those happen at the output layer, not the tool-call layer. It also doesn't enforce inside Cursor IDE today, which is the runtime PocketOS was on. Cursor support is the next adapter on the roadmap; the architecture is portable, the work is fitting it to Cursor's plugin model.

If you're shipping Claude-based agents with any kind of write access — to a database, to a payments API, to your customers' inboxes, to a deploy pipeline — the next nine-second story is already being typed somewhere. Five minutes of setup is the cheapest insurance you'll buy this quarter.

## Try it

```bash
npm install -g @betterclaw-ai/cli @betterclaw-ai/plugin-cowork
betterclaw chat "your task in plain English"
```

The full demo from this post — mock Railway MCP, the exact paragraph, the screencap script — is reproducible from [`demo/railway-incident/`](https://github.com/jfan22/BetterClaw/tree/main/demo/railway-incident) in the repo.

If your team is running Claude agents with write access today and "what do we do about the next PocketOS" is on someone's mind, my DMs are open. The right question to ask isn't "is our prompt good enough?" — it's "what runtime layer do we have between the agent's decision and the API actually firing?"

---

*BetterClaw is Apache-2.0 and developed in the open at [github.com/jfan22/BetterClaw](https://github.com/jfan22/BetterClaw). The Tom's Hardware article on the PocketOS incident is [here](https://www.tomshardware.com/tech-industry/artificial-intelligence/claude-powered-ai-coding-agent-deletes-entire-company-database-in-9-seconds-backups-zapped-after-cursor-tool-powered-by-anthropics-claude-goes-rogue).*
