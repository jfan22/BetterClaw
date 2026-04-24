# BetterClaw — TODOS

Deferred work tracked with enough context that anyone picking it up in 3 months knows why it's here, what it unblocks, and where to start. Created 2026-04-22 by /plan-eng-review.

Legend: **P1** = ship-blocker for the listed phase. **P2** = should-ship. **P3** = nice-to-have or conditional on signal.

---

## V2 (Month 2) items

### Cowork plugin client
**What:** Ship a Cowork plugin (Anthropic's Claude Desktop marketplace) that exposes BetterClaw's compile + enforce primitives to non-developer users with zero install.

**Why:** Distribution. Cowork has built-in reach to Anthropic's Pro/Team/Enterprise subscribers. Free plugin + paid cloud backend is the monetization pattern.

**Pros:** 10x distribution surface. Anthropic has already solved the install pain. Users who already trust Cowork adopt BetterClaw as an extension.

**Cons:** Dependency on Anthropic roadmap. Could be redundant if Anthropic builds enforcement natively. Plugin policy could change.

**Context:** Blocked on Decision 0 spike (Month 0 Week 1, see CEO plan 2026-04-22) — verifies Cowork plugin SDK exposes required hooks (before_tool_call, prompt-context prepend, approval pause, mobile render). If any hook missing, Cowork path drops and V1 ships OpenClaw-only. Code would live in `packages/cowork-client/` once scaffolded.

**Depends on:** Decision 0 spike result, V1 cloud backend live, HMAC token issuance working.

**Priority:** P1 for V2 *if* Decision 0 passes; else moved to V3+.

### Dry-run mode (read-only tools V1)
**What:** Execute a graph against historical data (last month's emails, last quarter's leads) with all external tool calls sandboxed to read-only.

**Why:** Compliance differentiator nobody else has. Compliance officer can audit agent behavior before it touches production.

**Pros:** Differentiated in enterprise sales. Catches bad graph logic before live deployment.

**Cons:** Requires deterministic replay substrate. Scoped to read-only for V2 (Gmail search, CRM read, inbox scan). Write-sandboxing deferred further.

**Context:** Ties into existing `~/.betterclaw/history.jsonl` as the replay source. Need a new `betterclaw dry-run <graph> --against <date-range>` subcommand. Hook points in `workflow.mjs` need a `dryRun: true` flag that intercepts before tool dispatch.

**Depends on:** V1 hash-chain write path (so dry-run events are tagged `dry_run:true` in audit log but don't break main chain).

**Priority:** P1 for V2.

### Team approval routing (role + amount)
**What:** Graphs declare approval gates with threshold rules like "drafts <$500 auto-send; $500-5k route to manager; $5k+ route to VP + legal."

**Why:** Enterprise hook. What makes BetterClaw sellable to a 500-person org vs a 5-person team.

**Pros:** Direct revenue driver — enterprises won't buy without this. Matches existing approval workflows companies already run through ServiceNow/Jira.

**Cons:** Requires identity+role data from WorkOS SCIM sync, approval-threshold syntax in graph JSON, routing logic in cloud, multi-channel notification (if manager is on Slack but VP wants email).

**Context:** Split into 3a (identity integration, 6wk/4wk CC) + 3b (routing logic, 1wk/3-4d CC) per the CEO plan. Identity is the real work; routing is small once identity lands.

**Depends on:** V1 WorkOS SSO live, SCIM directory sync implemented (part of 3a).

**Priority:** P1 for V2.

### Real sales + travel vertical backends
**What:** Replace the stubs in `packages/plugin-openclaw/vertical-sales.mjs` and `vertical-travel.mjs` with real backends.

**Why:** Sales/travel presets currently produce stub data. Demoing "real commerce" requires real APIs.

**Pros:** Four shipping verticals become four *real* working verticals. Sales is first real-commercial use case.

**Cons:** HubSpot MCP API keys cost money. Amadeus/Duffel have setup + approval flows. Vertical-by-vertical integration work.

**Context:** Sales → HubSpot MCP (has an MCP server already). Travel → Amadeus (established) or Duffel (modern, better DX). Each ~100 LOC plus tool stubs matching existing `vertical-*.mjs` pattern. Swap-pattern comments exist in those files.

**Depends on:** Vendor API keys (Duffel ~1 week application process).

**Priority:** P2 for V2.

---

## V3 (Month 3) items

### Graph marketplace (fork + attribution + commit history)
**What:** Public library of graphs — fork another user's graph, tweak one step, publish back with commit-graph of who changed what.

**Why:** Network effect. Upgrade from current `gh gist` approach to real catalog with search, ratings, author pages.

**Pros:** Drives organic growth. Finance teams fork a SOC2-audited expense-approval graph instead of writing from scratch.

**Cons:** Ships AFTER audit log + routing + SSO are live. Guardrail: validate with first design partner before investing in search/ratings. May be cut if enterprise design partners don't use it (they often don't fork public artifacts; they write private ones for their compliance rules).

**Context:** Extend `betterclaw publish/fork/load` beyond gist to a hosted catalog at `marketplace.betterclaw.cloud`. Needs author identity (WorkOS), commit-graph schema, fork tracking.

**Depends on:** V2 routing logic, WorkOS SSO, first design-partner feedback.

**Priority:** P3 (conditional on signal).

### UX polish pack — paragraph-edit diff + what-if simulation + NL audit query
**What:** 3 small delights:
1. User edits one sentence in the paragraph → compile highlights which nodes/edges changed before committing
2. Click any graph node → preview next 3 hypothetical actions
3. CFO types "show all money-moving actions Q1" into the audit UI → graph-aware NL search

**Why:** Turns the product from functional to delightful. Users say "oh nice, they thought of that."

**Pros:** Differentiates against Gumloop's flat-UX canvas. Makes enterprise demo memorable.

**Cons:** Polish work, not load-bearing. Can ship without. Each item is ~2-4 hrs CC (~1 week total).

**Context:** What-if simulation and dry-run are NOT redundant — what-if is interactive click-in-browser; dry-run is batch replay against historical data. NL audit query can leverage existing Claude CLI for natural-language parsing into SQL over audit_events.

**Depends on:** V1 browser live view (for paragraph diff + what-if), V1 audit log (for NL query).

**Priority:** P2 for V3.

### Third-framework adapter
**What:** Ship reference implementation of BetterClaw primitives (compile, enforce, audit) for one additional framework beyond Cowork + OpenClaw. Candidates: LangGraph (huge ecosystem), CrewAI (growing), Claude Agent SDK (closest to Cowork surface).

**Why:** Proves the "framework-agnostic workflow-trust layer" vision is real. Gets spec adopted outside Anthropic's ecosystem.

**Pros:** Differentiates against Cowork lock-in. Opens third-party partnership conversations. Aspirational 12-month north star made concrete.

**Cons:** Pure eng cost until adoption happens. Third-framework users aren't paying yet.

**Context:** Pick the framework with the easiest hook-wiring path first. LangGraph has callbacks; CrewAI has less mature hook surface; Claude Agent SDK is fresh. Probably Claude Agent SDK makes most sense as first target since it mirrors Cowork internals.

**Depends on:** V1 monorepo + contracts package public. V2 Cowork client proving the plugin-client pattern works.

**Priority:** P3 (12-month goal, not V3 urgent).

---

## Post-V3 (12-month horizon)

### Real-time collaborative graph editing
**What:** Two users edit the same graph simultaneously, see each other's cursors, CRDT-based merge.

**Why:** Would be required IF enterprise workflow authoring becomes a multi-person activity.

**Pros:** Unlocks team-authoring of compliance-critical graphs. Similar to Figma's collab for design.

**Cons:** Massive eng cost (CRDT infra, real-time sync protocol, presence). Unclear demand.

**Context:** Signal trigger = multiple enterprise customers explicitly asking for it. Until then, single-author + async review via fork+diff is sufficient.

**Depends on:** V3 marketplace (fork+attribution is partial collab).

**Priority:** P3 (conditional on signal).

### On-prem / air-gapped deployment
**What:** Self-hosted BetterClaw Cloud inside customer's VPC/network, no connection to betterclaw.cloud.

**Why:** Required IF regulated-industry customers with air-gapped requirements (defense, certain finance, healthcare) represent >10% of pipeline.

**Pros:** Unlocks customers that cannot legally use SaaS. Typical ACV jump 3-5x vs SaaS tier.

**Cons:** Massive ops burden (per-customer support), Docker/Helm packaging, offline updates, on-prem IdP integration. Drains team velocity.

**Context:** Defer until concrete pipeline signal. Most "we need on-prem" requests in enterprise sales are actually "we need VPC peering" which SaaS can handle.

**Depends on:** V1+V2 mature, ≥3 signed contracts contingent on on-prem.

**Priority:** P3 (defer until signal).

### Custom workflow DSL (beyond graph JSON)
**What:** Higher-level declarative language for workflows — maybe a YAML or TypeScript-DSL flavor that compiles to the graph JSON.

**Why:** IF graph JSON proves insufficient expressively.

**Pros:** More expressive workflows (loops, async fan-out — the term `fan-out` means "one input branches to many parallel handlers", sub-graphs, programmatic composition). Possibly easier for developers to author by hand.

**Cons:** Tool sprawl. Splits the authoring surface. The whole value prop is "paragraph → graph" — adding a DSL fights the product thesis.

**Context:** Defer until the LLM-compile-from-paragraph approach visibly breaks down for real customer paragraphs. Keep data: log compiler failures and re-compile rates. If real compile failure is >10% for non-trivial paragraphs, revisit.

**Depends on:** V1+V2 mature, telemetry on compile failure rate.

**Priority:** P3 (defer until signal).

---

## Upstream OpenClaw work (independent of BetterClaw roadmap)

These are filed upstream PRs we depend on merging. Check status before dropping workarounds.

- **PR #70147** `fix(gateway): fire before_tool_call hook on loopback MCP tools/call` — once merged, drop `wrapExecuteWithHook` workaround in `packages/plugin-openclaw/index.mjs`.
- **PR #70169** `fix(cli-runner): fire before_prompt_build hook on CLI-backend runs` — once merged, drop `MEMORY.md` cross-turn surfacing in `packages/plugin-openclaw/index.mjs` (`syncRecentApprovalsToMemoryFile`).

**Both drops conditional on:** `npm view openclaw version` shows a release that includes the merged commits. Check quarterly.
