# docs/

Design docs, architecture decision records (ADRs), and long-form design notes that don't belong in code comments or the repo-level `README.md`.

## Contents

### `adrs/`

Architecture decision records — one file per significant technical decision. Format loosely follows [Michael Nygard's ADR template](https://github.com/joelparkerhenderson/architecture-decision-record).

Number files sequentially: `NNNN-short-slug.md`. Never renumber after the fact; if an ADR is superseded, write a new one that says "Supersedes ADR-NNNN" in its header.

Current ADRs:

- [`0001-cowork-sdk-feasibility.md`](./adrs/0001-cowork-sdk-feasibility.md) — Accepts the Anthropic Cowork plugin distribution path after empirically verifying the required hooks (`PreToolUse`, `UserPromptSubmit`, `PostToolUse`) work for shell-command plugin hooks with ~7ms dispatch latency.

### What goes here vs. elsewhere

| Goes in `docs/adrs/` | Goes in `DESIGN.md` | Goes in code comments | Goes in `~/.gstack/` |
|---|---|---|---|
| Decisions between two real alternatives with tradeoffs and a verdict | The product's visual system (colors, type, layout primitives, anti-patterns) | Why a specific function exists or what an invariant guarantees | Strategic plans, CEO review, discovery interview notes, anything personal |
| Durable once committed. "Superseded" never "deleted." | Living doc. Update when the system changes. | Evolves with code. | Private to the builder; not shipped. |

### When to write an ADR

- You chose between two ≥-credible technical options and would have made either call differently with different constraints. Future contributors need to know WHICH constraints drove the call.
- You ruled OUT a tempting technical path. The ADR prevents someone from re-litigating it in three months.
- You committed to a non-obvious architecture that depends on external assumptions (a vendor's SDK capability, a library's semantics). If any of those assumptions changes, the ADR is the thing someone re-reads.

### When NOT to write an ADR

- Routine "what to name the function" decisions.
- Decisions that are obvious from the code alone.
- Personal workflow preferences.
- Product-strategy calls — those live in the CEO plan (`~/.gstack/projects/BetterClaw/ceo-plans/`), not here.
