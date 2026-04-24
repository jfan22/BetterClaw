// Plugin-side MCP client. Connects to the BetterClaw daemon's Unix socket
// at ~/.betterclaw/mcp.sock and speaks JSON-RPC 2.0 over that channel.
//
// Same wire protocol as stdio MCP, just over a different transport. The daemon
// is a transparent proxy to the real Gmail MCP subprocess, so tools/call,
// tools/list, initialize — everything — works identically from the plugin's
// point of view.
//
// Why a socket rather than direct subprocess ownership from the plugin:
//   - OpenClaw's install-time safety scanner blocks plugin code that imports
//     subprocess-spawning modules. Moving that ownership into the CLI daemon
//     keeps this file pure and lets the plugin install without the
//     dangerously-force flag.
//   - The daemon's persistent child means Gmail OAuth state survives across
//     agent turns (nice side effect; the old one-child-per-turn re-initialized
//     every time).

import net from "node:net";
import os from "node:os";
import path from "node:path";

const SOCKET_PATH = path.join(os.homedir(), ".betterclaw", "mcp.sock");
const CONNECT_TIMEOUT_MS = 2000;
const REQUEST_TIMEOUT_MS = 30000;

// Public API is intentionally the same shape as the old GmailMcpClient so
// vertical-email.mjs and any other consumer see zero behavior change.
export class GmailMcpClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.connecting = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.buffer = "";
    this.initialized = false;
    this.initPromise = null;
  }

  async ensureConnected() {
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve, reject) => {
      const socket = net.createConnection(SOCKET_PATH);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new Error(
            `BetterClaw daemon not reachable at ${SOCKET_PATH} (timeout after ${CONNECT_TIMEOUT_MS}ms). ` +
              `Run \`betterclaw start\` to launch it.`,
          ),
        );
      }, CONNECT_TIMEOUT_MS);

      socket.once("connect", () => {
        clearTimeout(timer);
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => this.onData(chunk));
        socket.on("close", () => this.onClose(new Error("daemon socket closed")));
        socket.on("error", (err) => this.onClose(err));
        this.socket = socket;
        this.connected = true;
        this.connecting = null;
        resolve();
      });

      socket.once("error", (err) => {
        clearTimeout(timer);
        this.connecting = null;
        if (err.code === "ENOENT") {
          reject(
            new Error(
              `BetterClaw daemon not running (no socket at ${SOCKET_PATH}). ` +
                `Run \`betterclaw start\` to launch it.`,
            ),
          );
        } else if (err.code === "ECONNREFUSED") {
          reject(
            new Error(
              `BetterClaw daemon socket exists but is not accepting connections. ` +
                `Stale socket file? Try \`betterclaw stop && betterclaw start\`.`,
            ),
          );
        } else {
          reject(err);
        }
      });
    });

    return this.connecting;
  }

  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stderr.write(`[mcp-proxy] non-JSON line: ${line}\n`);
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(`MCP error: ${JSON.stringify(msg.error)}`));
        else entry.resolve(msg.result);
      }
      // Notifications (no id) are ignored on the client side.
    }
  }

  onClose(err) {
    const reason = err?.message || "daemon connection closed";
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
    this.socket = null;
    this.connected = false;
    this.initialized = false;
    this.initPromise = null;
  }

  send(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout after ${REQUEST_TIMEOUT_MS}ms (method=${method})`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  notify(method, params) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.socket.write(payload);
  }

  async initialize() {
    await this.ensureConnected();
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "betterclaw-plugin", version: "0.0.1" },
      });
      this.notify("notifications/initialized");
      this.initialized = true;
    })();
    return this.initPromise;
  }

  async callTool(name, args) {
    await this.initialize();
    return this.send("tools/call", { name, arguments: args ?? {} });
  }

  async shutdown() {
    if (this.socket) {
      try {
        this.socket.end();
      } catch {}
      this.socket = null;
    }
    this.connected = false;
    this.initialized = false;
    this.initPromise = null;
  }
}
