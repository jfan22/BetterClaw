# @betterclaw-ai/contracts

**Status:** V1 scaffold. Placeholder until cloud backend work starts.

Shared type definitions and wire protocol schemas between BetterClaw's plugin, CLI, and (future) paid cloud backend. Lives as its own package so type changes land atomically across consumers.

## What it will contain (when cloud work starts)

```javascript
// JSDoc @typedef annotations exported from src/index.mjs
// Consumers import types via @typedef { import('@betterclaw-ai/contracts').AuditEvent } AuditEvent

/** @typedef AuditEvent — one row in the append-only hash-chained audit log */
/** @typedef ApprovalRequest — the shape the plugin sends + the cloud stores */
/** @typedef ApprovalResolution — approve / deny / defer + approver_id + timestamp */
/** @typedef GraphSchema — the JSON shape of a compiled BetterClaw graph */
/** @typedef HmacToken — structure used for plugin ↔ cloud auth */
```

## Why it's empty right now

For V1's OpenClaw-only distribution, the only shared wire contract is the MCP JSON-RPC envelope (already defined by the MCP spec). BetterClaw-specific types don't exist yet because neither the cloud backend nor the Cowork plugin has been built.

When cloud work starts (gated on Week 3 validation per the CEO plan), types land here first and consumers (plugin, CLI, cloud, future plugin-cowork) import them. That keeps the OSS/paid boundary clean: the `@betterclaw-ai/contracts` package stays public (publishable to npm) while `@betterclaw-ai/cloud` stays private.

## Why JSDoc @typedef instead of TypeScript

No build step needed. JS consumers get type hints in IDEs via JSDoc import syntax. If strict type safety becomes a bottleneck, promote to real TypeScript (adds `tsc` build, `.d.ts` emit) when the cloud backend needs it.
