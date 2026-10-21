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
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => {
      clearTimeout(this.killTimer);
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
    if (this.closed) return;
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
    try {
      for (const listener of [this.onerror, ...(this.listeners.get("error") ?? [])]) {
        try {
          listener?.(event);
        } catch {
          /* 观察者不能阻断关闭。 | Observers cannot block shutdown. */
        }
      }
    } finally {
      this.terminate();
    }
  }

  terminate() {
    if (this.closed) return;
    this.closed = true;
    this.buffer = "";
    this.listeners.clear();
    this.onmessage = this.onerror = this.onmessageerror = null;
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    // 同步 Worker API 不等待退出；有限宽限期后强制终止桥接进程。
    // The synchronous Worker API cannot await exit; force the bridge down after a bounded grace period.
    this.killTimer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    this.killTimer.unref?.();
  }
}
