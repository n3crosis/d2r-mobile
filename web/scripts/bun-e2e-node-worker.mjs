import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export class NodeCrossWorker {
  constructor(sourcePath) {
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.listeners = new Map();
    this.closed = false;
    this.buffer = "";
    this.child = spawn(
      "node",
      [fileURLToPath(new URL("./bun-e2e-node-cross.mjs", import.meta.url)), sourcePath],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => {
      if (!this.closed) this.fail(new Error(`Node SPIRV-Cross worker exited: ${code}`));
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.receive(chunk));
    this.child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message, transfers = []) {
    if (this.closed) throw new Error("NODE_CROSS_WORKER_CLOSED");
    const data = { ...message };
    if (data.assets)
      data.assets = data.assets.map(([name, bytes]) => [
        name,
        Buffer.from(bytes).toString("base64"),
      ]);
    if (data.spirv) data.spirv = Buffer.from(data.spirv).toString("base64");
    this.child.stdin.write(`${JSON.stringify(data)}\n`);
    if (transfers.length) structuredClone(null, { transfer: transfers });
  }

  receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 32 * 1024 * 1024) {
      this.fail(new Error("NODE_CROSS_MESSAGE_LIMIT"));
      return;
    }
    for (;;) {
      const end = this.buffer.indexOf("\n");
      if (end < 0) break;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      try {
        const event = { data: JSON.parse(line) };
        this.onmessage?.(event);
        for (const listener of this.listeners.get("message") ?? []) listener(event);
      } catch (error) {
        this.fail(error);
        return;
      }
    }
  }

  fail(error) {
    if (this.closed) return;
    const event = { message: error.message, error };
    this.onerror?.(event);
    for (const listener of this.listeners.get("error") ?? []) listener(event);
    this.terminate();
  }

  terminate() {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    this.child.kill();
  }
}
