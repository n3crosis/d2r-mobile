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
  // 显式替换编译操作：这些三字节样例不是 WASM 模块。
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

test("worker failure preserves sanitized compiler prose through client rethrow", async (t) => {
  const { client, workers } = await setup(t);
  const pending = client.compile(source, options);
  await nextTurn();
  workers[0].reply({
    type: "error",
    id: workers[0].requests.at(-1).id,
    code: "AIR_FRONTEND_FAILED",
    shaderDiagnostic: {
      compilerPhase: "compiling",
      errorType: "RuntimeError",
      diagnostics: [
        "error: no matching function for call to 'sample'",
        "kernel void PRIVATE_SOURCE() {}",
      ],
      stack: "/Users/private/path",
      input: "PRIVATE_INPUT",
    },
  });
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "AIR_FRONTEND_FAILED");
    assert.deepEqual(error.shaderDiagnostic, {
      compilerPhase: "compiling",
      errorType: "RuntimeError",
      diagnostics: ["error: no matching function for call to 'sample'"],
    });
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE|Users/);
    return true;
  });
  assert.equal(workers[0].terminations, 1);
});

test("native frontend wording survives worker, client, report and local display revalidation", async (t) => {
  const { sanitizeAirFrontendDiagnostics, shaderFailureDiagnostic } =
    await import("../shader-diagnostics.mjs");
  const { shaderFailureDetails } = await import("../packaging-diagnostics.mjs");
  const raw = [
    "address space qualified parameter must have pointer type",
    "parameter may not be qualified with an address space",
    "type 'float4' cannot be used as a template argument",
    "non-const reference cannot bind to a temporary value",
  ];
  const diagnostics = sanitizeAirFrontendDiagnostics(raw.join("\n"));
  const { client, workers } = await setup(t);
  const pending = client.compile(source, options);
  await nextTurn();
  workers[0].reply({
    type: "error",
    id: workers[0].requests.at(-1).id,
    code: "AIR_FRONTEND_FAILED",
    shaderDiagnostic: { compilerPhase: "compiling", diagnostics },
  });
  await assert.rejects(pending, (error) => {
    const report = {
      stage: "shaders",
      code: "STAGE_FAILED",
      detailCode: error.code,
      shaderDiagnostic: shaderFailureDiagnostic(error, { substep: "compilation", record: 1 }),
    };
    assert.deepEqual(error.shaderDiagnostic.diagnostics, diagnostics);
    assert.deepEqual(report.shaderDiagnostic.diagnostics, diagnostics);
    const displayed = shaderFailureDetails(report);
    for (const line of raw) assert.ok(displayed.includes(`frontend diagnostic: ${line}`));
    assert.ok(diagnostics.every((line) => !line.startsWith("error:")));
    return true;
  });
});

// 每个协议替身代表独立实例；测试只控制完成顺序，不衡量真实编译性能。
// Each protocol substitute represents an isolated instance; these tests control completion order, not compiler performance.
async function poolSetup(
  t,
  { capabilities = { hardwareConcurrency: 8, deviceMemory: 8 }, createWorker } = {},
) {
  const { createAirCompilerWorkerPool } = await import("../air-compiler-worker-client.mjs");
  const compilation = t.mock.method(WebAssembly, "compile", async () => ({ synthetic: true }));
  const workers = [];
  const client = await createAirCompilerWorkerPool({
    assets,
    capabilities,
    createWorker() {
      if (createWorker) return createWorker(workers);
      const worker = new ProtocolWorker();
      workers.push(worker);
      return worker;
    },
  });
  t.after(() => client.dispose());
  return { client, workers, compilation };
}

test("AIR pool shares one verified code compilation across four isolated bounded lanes", async (t) => {
  const { client, workers, compilation } = await poolSetup(t);
  assert.equal(client.concurrency, 4);
  assert.equal(workers.length, 4);
  assert.equal(compilation.mock.callCount(), 1);
  const pending = workers.map((_, index) => client.compile(`${source}\n// ${index}`, options));
  await nextTurn();
  assert.ok(workers.every((worker) => worker.requests.length === 2));
  await assert.rejects(client.compile(source, options), { code: "AIR_COMPILER_BUSY" });
  assert.ok(
    workers.every((worker) => worker.requests.length === 2),
    "overflow is not queued",
  );
  for (const index of [3, 1, 2, 0]) {
    const response = compiled(workers[index]);
    new Uint8Array(response.bytes).fill(index + 1);
    workers[index].reply(response);
  }
  const results = await Promise.all(pending);
  assert.deepEqual(
    results.map((result) => result.bytes[0]),
    [1, 2, 3, 4],
  );
  assert.equal(compilation.mock.callCount(), 1);
});

test("AIR pool caps device hints without requiring shared memory or cross-origin isolation", async () => {
  const { selectAirCompilerConcurrency: select } =
    await import("../air-compiler-worker-client.mjs");
  assert.equal(select({ hardwareConcurrency: 64, deviceMemory: 8 }), 4);
  assert.equal(select({ hardwareConcurrency: 4, deviceMemory: 8 }), 4);
  assert.equal(select({ hardwareConcurrency: 2, deviceMemory: 8 }), 2);
  assert.equal(select({ hardwareConcurrency: 64, deviceMemory: 4 }), 2);
  assert.equal(select({ hardwareConcurrency: 8, deviceMemory: 2 }), 1);
  assert.equal(select({}), 2);
  assert.equal(select({ hardwareConcurrency: 1 }), 1);
  assert.equal(select({ hardwareConcurrency: Infinity, deviceMemory: NaN }), 2);
});

for (const mode of ["abort", "failure", "dispose"])
  test(`AIR pool ${mode} stops all lanes and wipes undelivered replies`, async (t) => {
    const { client, workers } = await poolSetup(t);
    const controller = new AbortController();
    const pending = workers.map(() =>
      client.compile(source, { ...options, signal: controller.signal }),
    );
    const settlement = Promise.allSettled(pending);
    await nextTurn();
    const response = compiled(workers[3]);
    workers[3].reply(response);
    if (mode === "abort") controller.abort();
    else if (mode === "dispose") client.dispose();
    else
      workers[0].reply({
        type: "error",
        id: workers[0].requests.at(-1).id,
        code: "AIR_FRONTEND_FAILED",
      });
    const results = await settlement;
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.ok(workers.every((worker) => worker.terminations === 1));
    assert.ok(new Uint8Array(response.bytes).every((value) => value === 0));
    assert.equal(client.ready, false);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    await assert.rejects(client.compile(source, options), { code: "AIR_COMPILER_DISPOSED" });
  });

test("AIR pool recycles only an exhausted lane using already verified code", async (t) => {
  const { client, workers, compilation } = await poolSetup(t);
  const first = client.compile(source, options);
  await nextTurn();
  workers[0].reply(compiled(workers[0], true));
  await first;
  const next = client.compile(source, options);
  await nextTurn();
  assert.equal(workers.length, 5);
  assert.equal(workers[0].terminations, 1);
  assert.ok(workers.slice(1).every((worker) => worker.terminations === 0));
  workers[4].reply(compiled(workers[4]));
  await next;
  assert.equal(compilation.mock.callCount(), 1);
});

test("AIR pool keeps initialized lanes if another worker cannot be created", async (t) => {
  const { client, workers } = await poolSetup(t, {
    createWorker(workers) {
      if (workers.length === 2) throw new Error("Synthetic worker resource limit");
      const worker = new ProtocolWorker();
      workers.push(worker);
      return worker;
    },
  });
  assert.equal(client.concurrency, 2);
  assert.equal(client.ready, true);
  assert.ok(workers.every((worker) => worker.terminations === 0));
});

test("AIR pool never downgrades corrupted worker initialization into success", async (t) => {
  const workers = [];
  t.mock.method(WebAssembly, "compile", async () => ({ synthetic: true }));
  const { createAirCompilerWorkerPool } = await import("../air-compiler-worker-client.mjs");
  await assert.rejects(
    createAirCompilerWorkerPool({
      assets,
      capabilities: { hardwareConcurrency: 8, deviceMemory: 8 },
      createWorker() {
        const worker = new ProtocolWorker();
        if (workers.length === 1)
          worker.postMessage = function (message) {
            queueMicrotask(() =>
              this.reply({ type: "error", id: message.id, code: "AIR_ASSET_MISMATCH" }),
            );
          };
        workers.push(worker);
        return worker;
      },
    }),
    { code: "AIR_ASSET_MISMATCH" },
  );
  assert.equal(workers.length, 2);
  assert.ok(workers.every((worker) => worker.terminations === 1));
});

test("AIR pool stops adding workers when initialized heaps exhaust its startup budget", async (t) => {
  const { client, workers } = await poolSetup(t, {
    createWorker(workers) {
      const worker = new ProtocolWorker();
      worker.postMessage = function (message, transfers = []) {
        const data = structuredClone(message, { transfer: transfers });
        this.requests.push(data);
        queueMicrotask(() =>
          this.reply({ type: "initialized", id: data.id, heapBytes: 256 * 1024 * 1024 }),
        );
      };
      workers.push(worker);
      return worker;
    },
  });
  assert.equal(client.concurrency, 2);
  assert.equal(workers.length, 2);
});

test("AIR pool timeout terminates every active worker", async (t) => {
  const { client, workers } = await poolSetup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = workers.map(() => client.compile(source, options));
  const settlement = Promise.allSettled(pending);
  await nextTurn();
  t.mock.timers.tick(client.limits.compilationMs);
  const results = await settlement;
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.ok(workers.every((worker) => worker.terminations === 1));
  assert.equal(client.ready, false);
});

for (const mode of ["error", "protocol"])
  test(`AIR pool rejects an accepted lane's ${mode} while another lane initializes`, async (t) => {
    const { createAirCompilerWorkerPool } = await import("../air-compiler-worker-client.mjs");
    t.mock.method(WebAssembly, "compile", async () => ({ synthetic: true }));
    const workers = [];
    await assert.rejects(
      createAirCompilerWorkerPool({
        assets,
        capabilities: { hardwareConcurrency: 8, deviceMemory: 8 },
        createWorker() {
          const worker = new ProtocolWorker();
          if (workers.length === 1)
            worker.postMessage = function (message, transfers = []) {
              this.requests.push(structuredClone(message, { transfer: transfers }));
              queueMicrotask(() => {
                if (mode === "error") workers[0].dispatchEvent(new Event("error"));
                else workers[0].reply({ type: "initialized", id: 999, heapBytes: 4096 });
              });
            };
          workers.push(worker);
          return worker;
        },
      }),
      { code: mode === "error" ? "AIR_WORKER_FAILED" : "AIR_PROTOCOL_FAILED" },
    );
    assert.equal(workers.length, 2);
    assert.ok(workers.every((worker) => worker.terminations === 1));
  });

test("AIR pool rejects a lane stopped after its initialized reply but before startup handoff", async (t) => {
  const { createAirCompilerWorkerPool } = await import("../air-compiler-worker-client.mjs");
  t.mock.method(WebAssembly, "compile", async () => ({ synthetic: true }));
  const worker = new ProtocolWorker();
  worker.postMessage = function (message) {
    queueMicrotask(() => {
      this.reply({ type: "initialized", id: message.id, heapBytes: 4096 });
      this.reply({ type: "initialized", id: message.id, heapBytes: 4096 });
    });
  };
  await assert.rejects(
    createAirCompilerWorkerPool({
      assets,
      capabilities: { hardwareConcurrency: 1 },
      createWorker: () => worker,
    }),
    { code: "AIR_PROTOCOL_FAILED" },
  );
  assert.equal(worker.terminations, 1);
});

test("AIR pool cancellation between last initialization and pool handoff rejects and terminates", async (t) => {
  const { createAirCompilerWorkerPool } = await import("../air-compiler-worker-client.mjs");
  t.mock.method(WebAssembly, "compile", async () => ({ synthetic: true }));
  const controller = new AbortController();
  const worker = new ProtocolWorker();
  worker.postMessage = function (message) {
    queueMicrotask(() => {
      this.reply({ type: "initialized", id: message.id, heapBytes: 4096 });
      queueMicrotask(() => queueMicrotask(() => controller.abort()));
    });
  };
  await assert.rejects(
    createAirCompilerWorkerPool({
      assets,
      signal: controller.signal,
      capabilities: { hardwareConcurrency: 1 },
      createWorker: () => worker,
    }),
    { code: "AIR_ABORTED" },
  );
  assert.equal(worker.terminations, 1);
});
