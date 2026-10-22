// 合成协议及取消竞态测试；所有编译及工作线程均为 JS 替身，不执行真实 WASM。
// Synthetic protocol/cancellation races; compiler and workers are JS substitutes, never actual WASM.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createAirCompilerWorkerClient } from "../air-compiler-worker-client.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const factoryBytes = new Uint8Array([1, 2, 3]);
const wasmBytes = new Uint8Array([4, 5, 6]);
const assets = {
  factoryBytes,
  wasmBytes,
  factorySha256: sha(factoryBytes),
  wasmSha256: sha(wasmBytes),
  headerSha256: "1".repeat(64),
};
const source = "kernel void main0() {}";
const options = { entry: "main0", stage: "kernel" };

class ProtocolWorker extends EventTarget {
  requests = [];
  terminations = 0;
  postMessage(message, transfers = []) {
    const copied = structuredClone(message, { transfer: transfers });
    this.requests.push(copied);
    if (copied.type === "initialize")
      queueMicrotask(() => this.reply({ type: "initialized", id: copied.id, heapBytes: 4096 }));
  }
  reply(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  terminate() {
    this.terminations++;
  }
}

async function setup(t, onProgress) {
  // Explicitly replace compilation: these three-byte fixtures are not a WASM module.
  t.mock.method(WebAssembly, "compile", async () => ({ synthetic: true }));
  const workers = [];
  const client = await createAirCompilerWorkerClient({
    assets,
    onProgress,
    createWorker() {
      const worker = new ProtocolWorker();
      workers.push(worker);
      return worker;
    },
  });
  t.after(() => client.dispose());
  return { client, workers };
}
function compiled(worker, recycle = false) {
  return {
    type: "compiled",
    id: worker.requests.at(-1).id,
    bytes: new Uint8Array(88).fill(7).buffer,
    recycle,
    heapBytes: 4096,
    compilationCount: 1,
    inspection: { validation: "container-and-integrity-only", outputSize: 88 },
  };
}

for (const mode of ["throw", "reject", "thenable"])
  test(`AIR observers cannot disrupt initialization or output: ${mode}`, async (t) => {
    const phases = [];
    const onProgress = (event) => {
      assert.ok(Object.isFrozen(event));
      assert.deepEqual(Object.keys(event), ["phase"]);
      phases.push(event.phase);
      if (mode === "throw") throw new Error("Synthetic observer throw");
      if (mode === "reject") return Promise.reject(new Error("Synthetic observer rejection"));
      return {
        get then() {
          throw new Error("Synthetic thenable getter");
        },
      };
    };
    const { client, workers } = await setup(t, onProgress);
    const pending = client.compile(source, { ...options, onProgress });
    await nextTurn();
    const worker = workers[0],
      message = compiled(worker);
    for (const phase of ["compiling", "validating"])
      worker.reply({ type: "progress", id: message.id, phase });
    worker.reply(message);
    const output = await pending;
    await nextTurn();
    assert.deepEqual(phases, [
      "verifying",
      "preparing",
      "initializing",
      "compiling",
      "validating",
      "complete",
    ]);
    assert.ok(output.bytes.every((value) => value === 7));
    assert.equal(worker.terminations, 0);
    assert.equal(client.ready, true);
  });

test("AIR cancellation terminates active work and permits a fresh worker", async (t) => {
  const { client, workers } = await setup(t);
  const controller = new AbortController();
  const pending = client.compile(source, { ...options, signal: controller.signal });
  await nextTurn();
  controller.abort();
  await assert.rejects(pending, { code: "AIR_ABORTED" });
  assert.equal(workers[0].terminations, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const recovery = client.compile(source, options);
  await nextTurn();
  assert.equal(workers.length, 2);
  workers[1].reply(compiled(workers[1]));
  assert.equal((await recovery).bytes[0], 7);
});

for (const mode of ["dispose", "abort"])
  test(`AIR ${mode} after a reply wipes undelivered output`, async (t) => {
    const { client, workers } = await setup(t);
    const controller = new AbortController();
    const pending = client.compile(source, { ...options, signal: controller.signal });
    await nextTurn();
    const message = compiled(workers[0]);
    workers[0].reply(message);
    if (mode === "dispose") client.dispose();
    else controller.abort();
    await assert.rejects(pending, {
      code: mode === "dispose" ? "AIR_COMPILER_DISPOSED" : "AIR_ABORTED",
    });
    assert.ok(new Uint8Array(message.bytes).every((value) => value === 0));
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

test("AIR disposal from the completion observer wipes output before delivery", async (t) => {
  const { client, workers } = await setup(t);
  const pending = client.compile(source, {
    ...options,
    onProgress({ phase }) {
      if (phase === "complete") client.dispose();
    },
  });
  await nextTurn();
  const message = compiled(workers[0]);
  workers[0].reply(message);
  await assert.rejects(pending, { code: "AIR_COMPILER_DISPOSED" });
  assert.ok(new Uint8Array(message.bytes).every((value) => value === 0));
});

test("AIR worker recycling does not erase transferred caller-owned output", async (t) => {
  const { client, workers } = await setup(t);
  const pending = client.compile(source, options);
  await nextTurn();
  const message = compiled(workers[0], true);
  workers[0].reply(message);
  const output = await pending;
  assert.equal(workers[0].terminations, 1);
  client.dispose();
  assert.ok(output.bytes.every((value) => value === 7));
});

test("AIR compilation timeout settles work and removes its abort listener", async (t) => {
  const { client, workers } = await setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const pending = client.compile(source, { ...options, signal: controller.signal });
  await nextTurn();
  t.mock.timers.tick(client.limits.compilationMs);
  await assert.rejects(pending, { code: "AIR_COMPILATION_TIMEOUT" });
  assert.equal(workers[0].terminations, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("AIR preparation abort preserves in-use public input until compilation settles", async (t) => {
  const entered = Promise.withResolvers(),
    prepared = Promise.withResolvers();
  let input,
    workers = 0;
  t.mock.method(WebAssembly, "compile", (bytes) => {
    input = bytes;
    entered.resolve();
    return prepared.promise;
  });
  const controller = new AbortController();
  const pending = createAirCompilerWorkerClient({
    assets,
    signal: controller.signal,
    createWorker() {
      workers++;
      return new ProtocolWorker();
    },
  });
  await entered.promise;
  controller.abort();
  await assert.rejects(pending, { code: "AIR_ABORTED" });
  assert.deepEqual(input, wasmBytes, "an unresolved compiler still owns its immutable input");
  assert.notEqual(input.buffer, wasmBytes.buffer);
  prepared.resolve({ synthetic: true });
  await nextTurn();
  assert.ok(input.every((value) => value === 0));
  assert.deepEqual(wasmBytes, new Uint8Array([4, 5, 6]), "caller-owned assets are unchanged");
  assert.equal(workers, 0, "abandoned initialization must not create a late worker");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
