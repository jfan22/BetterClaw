// @betterclaw/contracts — shared type surface between plugin, CLI, and (later) cloud.
//
// V1 scaffold: this package is a placeholder. Types get filled in when
// (a) the paid cloud backend work starts (needs AuditEvent, ApprovalRequest,
// HmacToken schemas exchanged over the REST API), and
// (b) the Cowork plugin ships (shares graph schema + tool-call envelope with
// the OpenClaw plugin).
//
// For V1, the only shared type surface is the MCP JSON-RPC envelope already
// defined by the MCP spec itself — no BetterClaw-specific contracts yet.
//
// Types will be defined as JSDoc @typedef annotations so consumers can import
// them via `@typedef {import('@betterclaw/contracts').AuditEvent} AuditEvent`
// without a TypeScript build step. If type-safety becomes a bottleneck, this
// package can be promoted to real TypeScript.

/**
 * @typedef {object} PlaceholderTypesComingSoon
 * @property {never} _ TODO: real types land when cloud backend work starts.
 */

export const CONTRACTS_VERSION = "0.0.1";
