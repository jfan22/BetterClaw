# BetterClaw Design System

Three surfaces, two aesthetics, one identity.

## The two aesthetics

**Editorial (auditor's journal)** — the original BetterClaw voice. Warm, considered, craft-forward. Feels like a private-banking statement or a 1950s accounting ledger. Used when BetterClaw wants to say *"we take the serious stuff seriously."*

**Modern tech SaaS** — clean, utilitarian, compliance-product vernacular. Feels like Linear/Vanta/Drata. Used when BetterClaw is the daily tool a manager or admin uses without thinking about design at all.

## Surface map

| Surface | Aesthetic | Why |
|---|---|---|
| CLI terminal output (existing) | Editorial | Developer tier, craft signal, differentiates from generic CLIs |
| Browser live view (`betterclaw view --watch`) | Editorial | Developer-facing, continuity with CLI |
| Paid cloud web UI (audit, approvals, settings, login) | Modern tech | Enterprise buyer expectation, compliance-SaaS vernacular |
| Slack approval cards | Native Slack | Lives in Slack's visual language, not ours |
| Exported PDF audit reports | Editorial (cover) + Modern (data) | Cover page = formal document feel; data pages = scannable tables |

**Why the split:** daily usage surface (web UI) optimizes for scanability and vendor-parity expectation; documents and craft surfaces (CLI, PDF cover) carry the distinctive voice. Signature moments = editorial; workhorse moments = modern.

## Editorial tokens (CLI + Live View + PDF cover)

```
/* colors */
--paper:       #f6f2e8;  /* warm cream bg */
--paper-edge:  #eeeada;  /* softer panel bg */
--ink:         #1c1c24;  /* near-black text */
--ink-soft:    #3b3b45;  /* secondary text */
--muted:       #6b6860;  /* muted text */
--hairline:    #c5bfac;  /* fine rules */
--allow:       #27613f;  /* green */
--allow-bg:    #c5e3d1;
--pending:     #8f5a18;  /* ochre */
--pending-bg:  #f5e3ba;
--deny:        #7a2418;  /* brick red */
--deny-bg:     #eec6bc;
--accent:      #1c3b5a;  /* navy, sparingly */
--flash-bg:    #fff2c4;

/* typography */
body: 15px/1.55 system-ui;
titles: Iowan Old Style / Charter / Georgia serif, 28px 400, -0.015em tracking;
h2: same serif, 18px 500;
labels: SFMono 11px 500, uppercase, 0.12em tracking;
code: SFMono 13px;

/* patterns */
card: 1.5px solid var(--ink), paper bg, no shadow
hairline: 1px var(--hairline) between sections
chip: pill 999px with semantic color (allow/pending/deny)
chip.live: pulsing dot animation (pulse keyframes)
```

## Modern tech tokens (cloud web UI)

```
/* colors */
--bg:           #fafafa;       /* app bg */
--surface:      #ffffff;       /* card/surface */
--text-primary: #0f172a;       /* slate-900 */
--text-secondary: #64748b;     /* slate-500 */
--text-tertiary: #94a3b8;      /* slate-400 */
--border:       #e2e8f0;       /* slate-200 hairline */
--border-heavy: #cbd5e1;       /* slate-300 divider */
--accent:       #1e40af;       /* deep blue primary */
--success:      #16a34a;       /* emerald-600 */
--success-bg:   #dcfce7;       /* emerald-100 */
--warning:      #d97706;       /* amber-600 */
--warning-bg:   #fef3c7;       /* amber-100 */
--danger:       #dc2626;       /* red-600 */
--danger-bg:    #fee2e2;       /* red-100 */

/* typography */
body: 15px/1.55 Inter, SF Pro, system-ui;
h1: 24px 600 Inter;
h2: 20px 600 Inter;
table: 14px 400 Inter;
labels: 11px 500 Inter, uppercase, 0.08em tracking;
stats (subtle editorial carryover): 32px 400 Tiempos / Fraunces serif for BIG numbers only (event counts, stat totals);
code/mono: JetBrains Mono, 13px;

/* patterns */
card: white, 6px radius, 1px slate-200 border, shadow-sm (0 1px 2px rgba(0,0,0,0.05))
input: 4px radius, 1px slate-200, focus:ring-2 blue
button.primary: blue #1e40af bg, white text, 6px radius, medium weight
button.secondary: white bg, slate-300 border, slate-900 text
chip: pill with semantic bg (emerald-100/amber-100/red-100) and matching 600 text
table: sortable column headers with caret icons, hover row slight blue tint
```

## Status chip semantics (both aesthetics)

One vocabulary, two visual treatments:

| State | Editorial color | Modern color | Meaning |
|---|---|---|---|
| Approved/Allow | green (#27613f on cream #c5e3d1) | emerald (#16a34a on #dcfce7) | Positive completion |
| Pending | ochre (#8f5a18 on cream #f5e3ba) | amber (#d97706 on #fef3c7) | Waiting on action |
| Denied | brick (#7a2418 on cream #eec6bc) | red (#dc2626 on #fee2e2) | Negative/blocked |
| Live/active | green with pulsing dot | emerald with pulsing dot | Currently running |

## Layout primitives

**Web UI (cloud):**
- Top nav: wordmark left, page title, user + tenant + notifications right
- Sticky filter strip below top nav
- Main content 70% + right sidebar 30% on desktop; collapses to drawer on tablet
- Single-column stacks on mobile (<768px); tables horizontally scrollable

**Editorial (CLI / PDF cover):**
- Kicker (mono uppercase) over serif title over hairline
- Full-width cards with ink borders
- Hairline rules between sections (never headings alone)
- Mono labels for metadata (timestamps, IDs, fingerprints)

## A11y baselines

- Keyboard navigation: Tab through all interactive elements, Enter activates, Space toggles
- Focus states: 2px blue outline (web) or underline (CLI stdout in terminal), never outline:none
- Touch targets: ≥44px minimum on mobile web
- Color contrast: all text ≥4.5:1 against background (verified for both aesthetics' token pairs)
- ARIA: landmarks (`<main>`, `<nav>`, `<aside>`), group roles on approval cards, labeled inputs
- Screen reader: audit table rows announce column values, status chips include visually-hidden text
- Visited link distinction preserved (never uniform link color)

## Anti-patterns to avoid

- Purple/indigo gradients (AI slop signal)
- 3-column icon-title-description feature grids
- Icons in colored circles as decoration
- Text-align:center on everything
- Uniform bubbly border-radius
- Decorative blobs or wavy SVG dividers
- Emoji in UI copy
- Colored left-border on cards
- Generic hero copy ("Unlock the power of...")
- system-ui as the primary display font in the web UI (Inter or SF Pro specifically)
- "No items found." as an empty state — empty states are features, not defaults

## BetterClaw mark (V1)

**V1 ships with wordmark only.** Typography: clean serif uppercase "BETTERCLAW" in the editorial surfaces; clean sans "BetterClaw" in modern tech surfaces.

**V2+**: commission a proper monogram mark. Ideas to explore: interlocking B + C in weight-contrast strokes (editorial-era mark aesthetic), or angular BC in a rounded square (modern tech mark aesthetic). Either works — the product decides which surface gets primacy.

## Mockup references (V1)

Approved mockups serve as visual truth during implementation:

- Audit dashboard: `~/.gstack/projects/BetterClaw/designs/v1-ui-20260422/audit-v2/variant-A.png`
- Approvals list: `~/.gstack/projects/BetterClaw/designs/v1-ui-20260422/approvals/variant-A.png`
- Slack approval card: `~/.gstack/projects/BetterClaw/designs/v1-ui-20260422/slack/variant-A.png`

Designers/engineers: match these pixel-for-pixel on first build. Deviations require a review PR, not a unilateral call.
