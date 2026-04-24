# @betterclaw/cloud

**Status:** V1 scaffold. Implementation gated on Week 3 decision.

This package will hold BetterClaw's paid cloud backend:

- Event-centric append-only audit log with per-tenant KMS-signed hash chain (see ADRs)
- WorkOS SSO integration (SAML, OIDC, SCIM directory sync)
- Multi-tenant isolation via Postgres row-level security
- Team approval routing (role + amount thresholds)
- PDF compliance export API
- Immutable audit export with cryptographic verification

## Why it's empty right now

Per the CEO plan's Week 3 gate, no expensive cloud backend work starts until combined telemetry + interview signal validates the wedge. Writing code here before that signal exists is premature — it costs weeks of CC time that could be wasted if the V1 persona doesn't concentrate around the enterprise use case.

The monorepo scaffold exists early so that (a) shared types (`@betterclaw/contracts`) can land without a second repo reorg, and (b) when signal arrives, implementation starts in a clean workspace with the right structure.

## Planned structure (when we build it)

```
packages/cloud/
├── package.json              # Fastify + Postgres + WorkOS SDK + jose (KMS signing)
├── src/
│   ├── server.mjs            # Fastify bootstrap
│   ├── routes/
│   │   ├── events.mjs        # POST /v1/events — audit batch insert
│   │   ├── approvals.mjs     # POST/PATCH/GET /v1/approvals
│   │   ├── auth.mjs          # POST /v1/auth/sso/{saml,oidc}/callback
│   │   └── export.mjs        # GET /v1/audit/export
│   ├── audit/
│   │   ├── hash-chain.mjs    # per-tenant advisory lock + chain append
│   │   └── kms-signer.mjs    # async KMS signing worker
│   ├── identity/
│   │   └── workos.mjs        # WorkOS client wrappers
│   └── db/
│       ├── migrations/
│       └── rls-policies.sql  # tenant_id RLS on every table
└── test/
    └── rls.property.test.mjs # must-have: tenant isolation property test
```

See:
- `~/.gstack/projects/BetterClaw/ceo-plans/2026-04-22-workflow-trust-layer.md` — Decisions 1, 2, 3, Data Governance
- `docs/adrs/` — individual architecture decision records
