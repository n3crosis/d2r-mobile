// 合成子进程测试，不使用转换器二进制或私有输入。
// Synthetic child-process tests, without converter binaries or private inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { NodeCrossWorker } from "../scripts/bun-e2e-node-worker.mjs";
import {
  readNativeOutput,
  runNativeCommand,
  stopNativeChildren,
} from "../scripts/bun-e2e-node-cross.mjs";
async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), "d2r-synthetic-cross-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("native output rejects oversized files before returning text", () =>
  fixture(async (root) => {
    const file = join(root, "text");
    await writeFile(file, "1234");
    assert.equal(await readNativeOutput(file, 4), "1234");
    await assert.rejects(readNativeOutput(file, 3), /OUTPUT_LIMIT/);
  }));
test("worker receives synthetic response and termination clears retained state", () =>
  fixture(async (root) => {
    const source = join(root, "worker.mjs");
    await writeFile(
      source,
      `self.addEventListener('message',({data})=>self.postMessage({id:data.id,ok:true}));`,
    );
    const worker = new NodeCrossWorker(source);
    try {
      const response = new Promise((resolve, reject) => {
        worker.onmessage = resolve;
        worker.onerror = reject;
      });
      worker.postMessage({ id: 0 });
      assert.equal((await response).data.ok, true);
      const exited = once(worker.child, "exit");
      worker.terminate();
      await exited;
      assert.equal(worker.closed, true);
      assert.equal(worker.buffer, "");
      assert.equal(worker.listeners.size, 0);
    } finally {
      worker.terminate();
    }
  }));
test("stdin failure terminates even when an observer throws", () =>
  fixture(async (root) => {
    const source = join(root, "worker.mjs");
    await writeFile(source, `self.addEventListener('message',()=>{});`);
    const worker = new NodeCrossWorker(source);
    worker.onerror = () => {
      throw new Error("observer");
    };
    const exited = once(worker.child, "exit");
    worker.child.stdin.emit("error", Object.assign(new Error("synthetic pipe"), { code: "EPIPE" }));
    assert.equal(worker.closed, true);
    await exited;
  }));
test("owned child ignoring SIGTERM is killed and drained before cleanup", () =>
  fixture(async (root) => {
    const marker = join(root, "ready");
    // 使用 Node 本身运行固定合成脚本，不调用 git 或真实编译器。
    // Run a fixed synthetic script with Node itself, never git or a real compiler.
    const result = runNativeCommand("node", [
      "-e",
      `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);`,
      marker,
    ]).catch((error) => error);
    for (let i = 0; i < 200; i++) {
      if (await readFile(marker, "utf8").catch(() => null)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const pid = Number(await readFile(marker, "utf8"));
    await Promise.all([stopNativeChildren(), stopNativeChildren()]);
    assert.ok((await result) instanceof Error);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }));
