// Minimal MCP stdio client — spawns a child MCP server and speaks JSON-RPC over
// its stdin/stdout. Scoped to exactly what BetterClaw needs: initialize once,
// tools/call on demand. No tools/list, no subscriptions, no cancellation.

import { spawn } from "node:child_process";

export class GmailMcpClient {
  constructor() {
    this.child = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject }
    this.buffer = "";
    this.initialized = false;
    this.initPromise = null;
  }

  ensureStarted() {
    if (this.child) return;

    this.child = spawn("npx", ["-y", "@gongrzhe/server-gmail-autoauth-mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      // Child's logs go to our process stderr for debugging.
      process.stderr.write(`[gmail-child] ${chunk}`);
    });
    this.child.on("exit", (code, signal) => {
      const reason = `gmail child exited code=${code} signal=${signal}`;
      for (const { reject } of this.pending.values()) reject(new Error(reason));
      this.pending.clear();
      this.child = null;
      this.initialized = false;
      this.initPromise = null;
    });
  }

  onStdout(chunk) {
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
        process.stderr.write(`[gmail-child] non-JSON line: ${line}\n`);
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`gmail MCP error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
      // Notifications are ignored.
    }
  }

  send(method, params) {
    this.ensureStarted();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  notify(method, params) {
    this.ensureStarted();
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.child.stdin.write(payload);
  }

  async initialize() {
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
    const result = await this.send("tools/call", { name, arguments: args ?? {} });
    // MCP tool results look like { content: [...], isError?: boolean }
    return result;
  }

  async shutdown() {
    if (!this.child) return;
    try {
      this.child.stdin.end();
    } catch {}
    this.child.kill("SIGTERM");
    this.child = null;
    this.initialized = false;
    this.initPromise = null;
  }
}
