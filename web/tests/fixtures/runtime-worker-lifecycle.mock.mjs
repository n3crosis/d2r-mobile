// 使用合成公开清单、工作线程及手动时钟验证密封 RPC 生命周期；不执行真实 WASM 或私有任务。
// Verify sealed RPC lifetimes with synthetic public inventory, workers and a manual clock, not actual WASM or private jobs.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { createExtractionWorkerClient } from "../../extraction-worker-client.mjs";
import { OPTIONAL_RUNTIME_ASSET_GROUPS } from "../../runtime-asset-groups.mjs";

const encode = (value) => new TextEncoder().encode(value);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shell = encode("synthetic pinned shell");
const profile = {
  id: "synthetic-profile",
  archivePath: "profile/shell.zip",
  evidence: { archiveBytes: shell.length, sha256: sha(shell) },
};
mock.module("../../shell-profiles.mjs", {
  namedExports: { SHELL_PROFILE_IDS: [profile.id], resolveShellProfile: () => profile },
});
globalThis.isSecureContext = true;
globalThis.location = { href: "https://example.test/", origin: "https://example.test" };
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
let serial = 0;
async function setup(
  t,
  { components = ["program"], initialize = true, sendError, producer = false } = {},
) {
  const controller = new AbortController();
  const state = {
    workers: [],
    timers: new Map(),
    initialize,
    sendError,
    firstInitialize: Promise.withResolvers(),
    producerInitialize: Promise.withResolvers(),
  };
  let timerId = 0;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const id = ++timerId;
    state.timers.set(id, { callback, delay });
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => state.timers.delete(id));
  const data = new Map(
    [
      "sealed-workers/program-worker.mjs",
      "toolchain/program-rewrite-spike/dist/capstone-lz4.wasm",
      "sealed-runtime/texture-worker.mjs",
      "toolchain/texture-spike/dist/texture.mjs",
      "toolchain/texture-spike/dist/texture.wasm",
      "toolchain/texture-spike/dist/bc3.wasm",
      "toolchain/texture-spike/browser-texture.mjs",
      "toolchain/texture-spike/browser-texture-encoder.mjs",
      "sealed-workers/nsp-worker.mjs",
      "toolchain/nsp-extract-spike/dist/hactool-boundary.wasm",
    ].map((path) => [path, encode(`synthetic ${path}`)]),
  );
  data.set(profile.archivePath, shell);
  if (producer) {
    data.set("toolchain/asset-runtime-js/dist/png-codec.wasm", encode("synthetic PNG wasm"));
    for (const path of OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"])
      data.set(path, encode(`synthetic ${path}`));
  }
  const assets = [...data].map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: sha(bytes),
    ...(OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].includes(path)
      ? { optionalGroup: "legacy-astc" }
      : {}),
  }));
  const manifest = encode(
    JSON.stringify({ version: 1, assets, totalBytes: assets.reduce((sum, a) => sum + a.bytes, 0) }),
  );
  data.set("runtime-manifest.json", manifest);
  t.mock.method(globalThis, "fetch", async (url) => {
    const value = data.get(new URL(url).pathname.slice("/runtime/".length));
    assert.ok(value, "only verified public inventory is fetched");
    return new Response(value);
  });
  globalThis.caches = { open: () => Promise.reject(new Error("Synthetic cache unavailable")) };
  globalThis.Worker = class extends EventTarget {
    requests = [];
    terminations = 0;
    constructor() {
      super();
      state.workers.push(this);
    }
    dispatchEvent(event) {
      this[`on${event.type}`]?.(event);
      return super.dispatchEvent(event);
    }
    reply(data) {
      this.dispatchEvent(new MessageEvent("message", { data }));
    }
    postMessage(message, transfers = []) {
      if (state.sendError) throw state.sendError;
      const copied = structuredClone(message, { transfer: transfers });
      this.requests.push(copied);
      if (message.type === "initialize" && message.id === undefined) {
        state.producerInitialize.resolve(this);
      } else if (message.type === "initialize") {
        state.firstInitialize.resolve(this);
        if (state.initialize)
          queueMicrotask(() => this.reply({ id: 0, ok: true, result: { initialized: true } }));
      }
    }
    terminate() {
      this.terminations++;
    }
  };
  const module = await import(`../../sealed-runtime/clients.mjs?lifecycle=${serial++}`);
  let runtime;
  t.after(async () => {
    await runtime?.close();
  });
  return {
    ...module,
    state,
    controller,
    async start() {
      runtime = await module.prepareSealedRuntime({
        baseUrl: "https://example.test/runtime/",
        manifestSha256: sha(manifest),
        components,
        optionalGroups: producer ? ["legacy-astc"] : [],
        signal: controller.signal,
      });
      return runtime;
    },
    expire(delay) {
      const matches = [...state.timers].filter(([, timer]) => timer.delay === delay);
      assert.equal(matches.length, 1);
      const [id, timer] = matches[0];
      state.timers.delete(id);
      timer.callback();
    },
  };
}
const runProgram = (client) =>
  client.run({ bytes: new Uint8Array([1, 2]), moduleName: "synthetic", releaseId: "synthetic" });
const runTexture = (client, signal) =>
  client.packLinearBC3(
    { templateHeader: new Uint8Array(40), linearBC3: new Uint8Array(16), width: 1, height: 1 },
    { signal },
  );
function stopped(state, controller) {
  assert.ok(state.workers.every((worker) => worker.terminations >= 1));
  assert.equal(state.timers.size, 0, "all request timers are cleared");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
}

test("matching initialization replies require a boolean success discriminator", async (t) => {
  const setupState = await setup(t, { initialize: false });
  const pending = setupState.start();
  const worker = await setupState.state.firstInitialize.promise;
  worker.reply({ id: 0, ok: "yes", result: { initialized: true } });
  await assert.rejects(pending, /Runtime worker protocol failed/);
  stopped(setupState.state, setupState.controller);
});

test("malformed matching operation replies close every worker, not resolve a result", async (t) => {
  const { start, state, controller, assertSealedRuntime } = await setup(t, {
    components: ["program", "texture"],
  });
  const runtime = await start();
  const pending = runProgram(runtime.createProgramWorker());
  state.workers[1].reply({ id: 1, ok: 1, files: {} });
  await assert.rejects(pending, /Runtime worker protocol failed/);
  assert.throws(() => assertSealedRuntime(runtime), /live verified/);
  stopped(state, controller);
});

test("successful replies preserve nested and top-level worker shapes and clear abort listeners", async (t) => {
  const { start, state } = await setup(t, { components: ["program", "texture"] });
  const runtime = await start();
  const controller = new AbortController();
  const texture = runtime.createTextureClient();
  const pending = runTexture(texture, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  state.workers[0].reply({ id: 1, ok: true, result: { sprite: new Uint8Array([7]) } });
  assert.deepEqual(await pending, { sprite: new Uint8Array([7]) });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(state.timers.size, 0);
  controller.abort();
  assert.ok(state.workers.every((worker) => worker.terminations === 0));
  const program = runProgram(runtime.createProgramWorker());
  const reply = { id: 1, ok: true, files: {}, metadata: "synthetic" };
  state.workers[1].reply(reply);
  assert.deepEqual(await program, reply);
});

test("busy rejection leaves the original request active and operation errors remain bounded", async (t) => {
  const { start, state } = await setup(t);
  const runtime = await start();
  const client = runtime.createProgramWorker();
  const first = runProgram(client);
  await assert.rejects(runProgram(client), /busy/);
  await assert.rejects(runProgram(runtime.createProgramWorker()), /busy/);
  assert.equal(state.workers[0].requests.length, 2);
  state.workers[0].reply({ id: 1, ok: false, error: "PRIVATE-CANARY" });
  await assert.rejects(first, /^Error: Runtime operation failed$/);
  assert.equal(state.timers.size, 0);
  const next = runProgram(client);
  state.workers[0].reply({ id: 2, ok: true, files: {} });
  assert.deepEqual(await next, { id: 2, ok: true, files: {} });
});

test("closing an active lease rejects pending work and permanently revokes the runtime", async (t) => {
  const { start, state, controller, assertSealedRuntime } = await setup(t);
  const runtime = await start();
  const client = runtime.createProgramWorker();
  const pending = runProgram(client);
  client.close();
  await assert.rejects(pending, /Sealed runtime closed/);
  const closing = runtime.close();
  assert.equal(runtime.close(), closing);
  await closing;
  await assert.rejects(runProgram(client), /closed/);
  assert.throws(() => assertSealedRuntime(runtime), /live verified/);
  state.workers[0].reply({ id: 1, ok: true, files: {} });
  stopped(state, controller);
});

test("abort during initialization rejects setup and clears its deadline and listener", async (t) => {
  const { start, state, controller } = await setup(t, { initialize: false });
  const pending = start();
  const worker = await state.firstInitialize.promise;
  controller.abort("PRIVATE-CANARY");
  await assert.rejects(pending, /Runtime cancelled/);
  worker.reply({ id: 0, ok: true, result: { initialized: true } });
  stopped(state, controller);
});

test("abort during an operation rejects once and clears listeners before late replies", async (t) => {
  const { start, state, controller } = await setup(t, { components: ["texture"] });
  const runtime = await start();
  const operation = new AbortController();
  const pending = runTexture(runtime.createTextureClient(), operation.signal);
  operation.abort("PRIVATE-CANARY");
  await assert.rejects(pending, { name: "AbortError", message: "Runtime cancelled" });
  assert.equal(getEventListeners(operation.signal, "abort").length, 0);
  state.workers[0].reply({ id: 1, ok: true, result: {} });
  stopped(state, controller);
});

test("initialization stages and unrelated replies cannot extend the initialization deadline", async (t) => {
  const { start, state, controller, expire } = await setup(t, { initialize: false });
  const pending = start();
  const worker = await state.firstInitialize.promise;
  const [timer] = state.timers.keys();
  worker.reply({ type: "initialization-stage", stage: "starting" });
  worker.reply({ id: 41, ok: true, result: { initialized: true } });
  assert.deepEqual([...state.timers.keys()], [timer]);
  expire(60000);
  await assert.rejects(pending, /Runtime deadline exceeded/);
  stopped(state, controller);
});

test("operation deadline closes all workers and rejects the active request", async (t) => {
  const { start, state, controller, expire } = await setup(t, {
    components: ["program", "texture"],
  });
  const runtime = await start();
  const pending = runProgram(runtime.createProgramWorker());
  expire(120000);
  await assert.rejects(pending, /Runtime deadline exceeded/);
  stopped(state, controller);
});

test("postMessage failure during initialization clears pending setup without a timeout", async (t) => {
  const { start, state, controller } = await setup(t, { sendError: new Error("synthetic clone") });
  await assert.rejects(start(), /synthetic clone/);
  stopped(state, controller);
});

test("postMessage failure during an operation rejects and closes every component", async (t) => {
  const { start, state, controller } = await setup(t, {
    components: ["program", "texture"],
  });
  const runtime = await start();
  state.sendError = new Error("synthetic clone");
  await assert.rejects(runProgram(runtime.createProgramWorker()), /synthetic clone/);
  stopped(state, controller);
});

test("worker errors and deserialization errors terminate pending requests", async (t) => {
  const { start, state, controller } = await setup(t);
  const runtime = await start();
  const pending = runProgram(runtime.createProgramWorker());
  state.workers[0].dispatchEvent(new Event("messageerror"));
  await assert.rejects(pending, /Sealed runtime closed/);
  stopped(state, controller);
});

test("runtime close rejects acquired extraction transport requests and removes its listeners", async (t) => {
  const { start, state, controller } = await setup(t, { components: ["extraction"] });
  const runtime = await start();
  const client = createExtractionWorkerClient({ createWorker: runtime.createExtractionWorker });
  const pending = client.readRomfs({ token: "synthetic", offset: 0n, count: 1 });
  await runtime.close();
  await assert.rejects(pending, /EXTRACTION_WORKER_FAILED/);
  for (const event of ["message", "error", "messageerror"])
    assert.equal(getEventListeners(state.workers[0], event).length, 0);
  stopped(state, controller);
});

test("an earlier worker failure cancels a pending producer initializer without waiting for its deadline", async (t) => {
  const { start, state, controller, expire } = await setup(t, { producer: true });
  let settled = false;
  const pending = start().finally(() => {
    settled = true;
  });
  const checked = assert.rejects(pending, { name: "AbortError" });
  const producer = await state.producerInitialize.promise;
  state.workers[0].dispatchEvent(new Event("error"));
  await new Promise(setImmediate);
  // 旧实现需靠超时才结束；让失败测试也能清理，而不挂起测试进程。
  // The old implementation needs its timeout; release that failure path instead of hanging the test runner.
  const settledBeforeDeadline = settled;
  if (!settled) expire(60000);
  await checked;
  assert.equal(settledBeforeDeadline, true);
  for (const event of ["message", "error", "messageerror"])
    assert.equal(getEventListeners(producer, event).length, 0);
  stopped(state, controller);
});

test("external cancellation still reaches a pending producer initializer", async (t) => {
  const { start, state, controller } = await setup(t, { producer: true });
  const pending = start();
  const producer = await state.producerInitialize.promise;
  controller.abort("PRIVATE-CANARY");
  await assert.rejects(pending, { name: "AbortError" });
  for (const event of ["message", "error", "messageerror"])
    assert.equal(getEventListeners(producer, event).length, 0);
  stopped(state, controller);
});

test("producer proof resolution followed by close before parent continuation still disposes the client", async (t) => {
  const { start, state, controller } = await setup(t, { producer: true });
  const pending = start();
  const checked = assert.rejects(pending, { name: "AbortError" });
  const producer = await state.producerInitialize.promise;
  producer.reply({ type: "initialized", version: 1, astc: true, png: true, sha: true });
  // 证明回复先排入辅助函数恢复；此微任务随后关闭会话，并先于父级 await 的赋值执行。
  // The proof queues the helper continuation first; this microtask closes before the parent's await assignment.
  await new Promise((resolve) => {
    queueMicrotask(() => {
      assert.equal(state.timers.size, 0, "proof already settled the helper request");
      assert.equal(getEventListeners(producer, "message").length, 1);
      state.workers[0].dispatchEvent(new Event("error"));
      resolve();
    });
  });
  await checked;
  for (const event of ["message", "error", "messageerror"])
    assert.equal(getEventListeners(producer, event).length, 0);
  stopped(state, controller);
});
