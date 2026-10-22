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
  {
    components = ["program"],
    initialize = true,
    sendError,
    onProgress,
    producer = false,
    signing = false,
  } = {},
) {
  const controller = new AbortController();
  const state = {
    workers: [],
    revokedUrls: [],
    timers: new Map(),
    initialize,
    sendError,
    firstInitialize: Promise.withResolvers(),
    producerInitialize: Promise.withResolvers(),
  };
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, "revokeObjectURL", (url) => {
    state.revokedUrls.push(url);
    revokeObjectURL(url);
  });
  let timerId = 0;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const id = ++timerId;
    state.timers.set(id, { callback, delay });
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => state.timers.delete(id));
  const data = new Map(
    [
      "sealed-runtime/dotnet-worker.mjs",
      "toolchain/offline-runtime-spike/dotnet-dist/main.mjs",
      "sealed-workers/cross-worker.mjs",
      "toolchain/spirv-cross-spike/wwwroot/spirv-cross.wasm",
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
  if (components.includes("translator")) {
    const directory = "toolchain/offline-runtime-spike/dotnet-dist";
    const value = data.get(`${directory}/main.mjs`);
    data.set(
      `${directory}/manifest.json`,
      encode(
        JSON.stringify({
          version: 1,
          assets: [{ path: "main.mjs", bytes: value.length, sha256: sha(value) }],
        }),
      ),
    );
  }
  if (components.includes("assets")) {
    const directory = "toolchain/asset-runtime-js/dist";
    const records = [
      "worker.mjs",
      "image-kernels.wasm",
      "png-codec.wasm",
      "font-rasterizer.wasm",
    ].map((path) => {
      const value = encode(`synthetic ${path}`);
      data.set(`${directory}/${path}`, value);
      return { path, bytes: value.length, sha256: sha(value) };
    });
    data.set(`${directory}/manifest.json`, encode(JSON.stringify({ version: 1, assets: records })));
  }
  if (producer) {
    data.set("toolchain/asset-runtime-js/dist/png-codec.wasm", encode("synthetic PNG wasm"));
    for (const path of OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"])
      data.set(path, encode(`synthetic ${path}`));
  }
  if (signing)
    for (const path of OPTIONAL_RUNTIME_ASSET_GROUPS["ipa-signing"])
      data.set(path, encode(`synthetic ${path}`));
  const assets = [...data].map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: sha(bytes),
    ...(OPTIONAL_RUNTIME_ASSET_GROUPS["ipa-signing"].includes(path)
      ? { optionalGroup: "ipa-signing" }
      : {}),
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
    constructor(url) {
      super();
      this.url = url;
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
        onProgress,
        optionalGroups: [...(producer ? ["legacy-astc"] : []), ...(signing ? ["ipa-signing"] : [])],
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

for (const event of ["error", "messageerror"])
  test(`producer ${event} during later signer initialization cannot return a ready runtime`, async (t) => {
    const { start, state, controller } = await setup(t, { producer: true, signing: true });
    const pending = start();
    const producer = await state.producerInitialize.promise;
    state.initialize = false;
    producer.reply({ type: "initialized", version: 1, astc: true, png: true, sha: true });
    await new Promise(setImmediate);
    const signer = state.workers.at(-1);
    assert.notEqual(signer, producer);
    assert.equal(signer.requests[0].assets[0][0], "zsign.wasm");
    producer.dispatchEvent(new Event(event));
    signer.reply({ id: 0, ok: true, result: { initialized: true } });
    await assert.rejects(pending, /ASTC producer unavailable/);
    stopped(state, controller);
  });

test("an idle producer failure cannot be acquired as a live private-input capability", async (t) => {
  const { start, state, controller } = await setup(t, { producer: true });
  const pending = start();
  const producer = await state.producerInitialize.promise;
  producer.reply({ type: "initialized", version: 1, astc: true, png: true, sha: true });
  const runtime = await pending;
  producer.dispatchEvent(new Event("error"));
  assert.throws(() => runtime.createAstcProducerClient(), /unavailable/);
  assert.equal(producer.requests.length, 1, "no private operation is sent");
  await runtime.close();
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

test("claimed preloaded IPA signer survives conversion runtime cleanup and closes independently", async (t) => {
  const setupState = await setup(t, { signing: true });
  const runtime = await setupState.start();
  assert.equal(runtime.initialized.ipaSigning.initialized, true);
  const signer = runtime.takeIpaSigningFactory();
  assert.throws(() => runtime.takeIpaSigningFactory(), /already acquired/);
  const worker = setupState.state.workers.at(-1);
  assert.ok(setupState.state.revokedUrls.includes(worker.url));
  await runtime.close();
  assert.equal(worker.terminations, 0);
  assert.ok(setupState.state.workers[0].terminations > 0);
  const attempt = await signer.prepare();
  const signing = attempt.sign({
    ipa: new Blob([new Uint8Array(22)]),
    credentials: {
      kind: "p12",
      identity: new ArrayBuffer(2),
      profile: new ArrayBuffer(2),
      password: "",
    },
  });
  const result = new Blob([new Uint8Array(23)]);
  worker.reply({ id: 1, ok: true, result: { blob: result } });
  assert.equal((await signing).blob, result);
  assert.equal(worker.terminations, 1);
  const retry = await signer.prepare();
  const retryWorker = setupState.state.workers.at(-1);
  assert.notEqual(retryWorker, worker);
  assert.equal(retryWorker.terminations, 0);
  assert.ok(setupState.state.revokedUrls.includes(retryWorker.url));
  retry.close();
  assert.equal(retryWorker.terminations, 1);
  signer.close();
  assert.equal(worker.terminations, 1);
});

test("unclaimed preloaded IPA signer closes with its runtime", async (t) => {
  const setupState = await setup(t, { signing: true });
  const runtime = await setupState.start();
  const worker = setupState.state.workers.at(-1);
  await runtime.close();
  assert.ok(worker.terminations > 0);
  assert.throws(() => runtime.takeIpaSigningFactory(), /unavailable/);
});

test("default runtime has no signing worker or signable lease", async (t) => {
  const setupState = await setup(t);
  const runtime = await setupState.start();
  assert.equal(runtime.initialized.ipaSigning, undefined);
  assert.equal(setupState.state.workers.length, 1);
  assert.throws(() => runtime.takeIpaSigningFactory(), /unavailable/);
});

test("asset recycling reuses its entry URL and leases ignore retired worker events", async (t) => {
  const { start, state, assertSealedRuntime } = await setup(t, { components: ["assets"] });
  const runtime = await start();
  const client = runtime.createAssetWorker();
  await runtime.recycleAssetWorker();
  await runtime.recycleAssetWorker();
  const current = state.workers.at(-1);
  assert.ok(state.workers.every((worker) => worker.url === current.url));
  const pending = client.run("overlay-recipe", new Uint8Array([1]));
  for (const retired of state.workers.slice(0, -1)) {
    assert.equal(retired.terminations, 1);
    retired.reply({ id: 1, ok: false });
    retired.dispatchEvent(new Event("error"));
    retired.dispatchEvent(new Event("messageerror"));
  }
  assert.equal(assertSealedRuntime(runtime), runtime);
  assert.equal(current.terminations, 0);
  current.reply({ id: 1, ok: true, result: { files: {} } });
  assert.deepEqual(await pending, { files: {} });
  await runtime.close();
  assert.equal(state.revokedUrls.filter((url) => url === current.url).length, 1);
});

test("cancelling an asset restart rejects and clears all workers and request listeners", async (t) => {
  const { start, state, controller } = await setup(t, { components: ["assets"] });
  const runtime = await start();
  state.initialize = false;
  const restart = new AbortController();
  const pending = runtime.recycleAssetWorker({ signal: restart.signal });
  restart.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(getEventListeners(restart.signal, "abort").length, 0);
  stopped(state, controller);
});

for (const action of ["close", "abort"])
  test(`asset restart proof followed by ${action} rejects before continuation`, async (t) => {
    const { start, state, controller, assertSealedRuntime } = await setup(t, {
      components: ["assets"],
    });
    const runtime = await start();
    state.initialize = false;
    const restart = new AbortController();
    const pending = runtime.recycleAssetWorker({ signal: restart.signal });
    state.workers.at(-1).reply({ id: 0, ok: true, result: { initialized: true } });
    if (action === "close") runtime.close();
    else restart.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.throws(() => assertSealedRuntime(runtime), /live verified/);
    stopped(state, controller);
  });

test("asset restart rejects concurrent restarts and lease operations without disrupting initialization", async (t) => {
  const { start, state } = await setup(t, { components: ["assets"] });
  const runtime = await start();
  const client = runtime.createAssetWorker();
  state.initialize = false;
  const pending = runtime.recycleAssetWorker();
  await assert.rejects(runtime.recycleAssetWorker(), /busy/);
  await assert.rejects(client.run("overlay-recipe", new Uint8Array([1])), /busy/);
  const current = state.workers.at(-1);
  assert.equal(current.requests.length, 1);
  current.reply({ id: 0, ok: true, result: { initialized: true } });
  await pending;
  const operation = client.run("overlay-recipe", new Uint8Array([1]));
  await assert.rejects(runtime.recycleAssetWorker(), /busy/);
  current.reply({ id: 1, ok: true, result: {} });
  await operation;
});

// 原生 structuredClone 模拟真实转移，断言不触碰借用输入及失败快照清理。
// Native structuredClone models real transfer, checking borrowed inputs and failed snapshot cleanup.
test("shader facade transfers owned inputs immediately and snapshots metadata", async (t) => {
  const { start, state } = await setup(t, { components: ["translator", "spirvCross"] });
  const runtime = await start();
  const worker = runtime.createTranslatorWorker();
  const code = new Uint8Array([1, 2, 3]);
  const job = { stage: "vertex" };
  const reply = new Promise((resolve) => {
    worker.onmessage = resolve;
  });
  worker.postMessage({ requestId: 7, code, job }, [code.buffer]);
  assert.equal(code.byteLength, 0);
  job.stage = "fragment";
  await Promise.resolve();
  const request = state.workers[0].requests.at(-1);
  assert.deepEqual([...new Uint8Array(request.payload)], [1, 2, 3]);
  assert.deepEqual(request.job, { stage: "vertex" });
  state.workers[0].reply({ id: request.id, ok: true, result: { valid: true } });
  assert.equal((await reply).data.requestId, 7);

  const cross = runtime.createShaderWorkerFactory()(runtime.workerUrls.spirvCross);
  const spirv = new Uint8Array([4, 5]).buffer;
  const context = { stage: "vertex" };
  const crossReply = new Promise((resolve) => {
    cross.onmessage = resolve;
  });
  cross.postMessage({ id: 8, type: "convert", spirv, replayContext: context }, [spirv]);
  assert.equal(spirv.byteLength, 0);
  context.stage = "fragment";
  await Promise.resolve();
  const crossRequest = state.workers[1].requests.at(-1);
  assert.deepEqual([...new Uint8Array(crossRequest.spirv)], [4, 5]);
  assert.equal(crossRequest.replayContext.stage, "vertex");
  state.workers[1].reply({ id: crossRequest.id, ok: true, result: {} });
  assert.equal((await crossReply).data.id, 8);
});

test("shader facade preserves subarray bounds and public borrowed inputs", async (t) => {
  const { start, state } = await setup(t, { components: ["translator"] });
  const runtime = await start();
  const worker = runtime.createTranslatorWorker();
  const backing = new Uint8Array([9, 1, 2, 9]);
  const reply = new Promise((resolve) => {
    worker.onmessage = resolve;
  });
  worker.postMessage({ requestId: 1, code: backing.subarray(1, 3), job: {} }, [backing.buffer]);
  assert.equal(backing.byteLength, 0);
  await Promise.resolve();
  const request = state.workers[0].requests.at(-1);
  assert.deepEqual([...new Uint8Array(request.payload)], [1, 2]);
  state.workers[0].reply({ id: request.id, ok: true, result: {} });
  await reply;
  const borrowed = new Uint8Array([6, 7]);
  const pending = runtime.createTranslator().translate({ job: {}, code: borrowed });
  assert.deepEqual([...borrowed], [6, 7]);
  const next = state.workers[0].requests.at(-1);
  state.workers[0].reply({ id: next.id, ok: true, result: {} });
  await pending;
  assert.deepEqual([...borrowed], [6, 7]);
});

test("shader facade wipes queued cancellation and busy rejection snapshots", async (t) => {
  const { start, state } = await setup(t, { components: ["translator"] });
  const runtime = await start();
  const clone = globalThis.structuredClone;
  const snapshots = [];
  t.mock.method(globalThis, "structuredClone", (value, options) => {
    const result = clone(value, options);
    if (result?.requestId) snapshots.push(result);
    return result;
  });
  const cancelled = runtime.createTranslatorWorker();
  const code = new Uint8Array([1, 2]);
  cancelled.postMessage({ requestId: 1, code, job: {} }, [code.buffer]);
  cancelled.terminate();
  await Promise.resolve();
  assert.equal(code.byteLength, 0);
  assert.deepEqual([...snapshots[0].code], [0, 0]);
  assert.equal(state.workers[0].requests.length, 1);

  const worker = runtime.createTranslatorWorker();
  worker.postMessage({ requestId: 2, code: new Uint8Array([3]), job: {} });
  await Promise.resolve();
  const first = state.workers[0].requests.at(-1);
  const borrowed = new Uint8Array([4, 5]);
  const failure = new Promise((resolve) => {
    worker.onmessage = resolve;
  });
  worker.postMessage({ requestId: 3, code: borrowed, job: {} });
  assert.equal((await failure).data.ok, false);
  assert.deepEqual([...borrowed], [4, 5]);
  assert.deepEqual([...snapshots[2].code], [0, 0]);
  assert.equal(state.workers[0].requests.length, 2);
  state.workers[0].reply({ id: first.id, ok: true, result: {} });
});

test("shader facade forwards the owned buffer itself and wipes failed handoffs", async (t) => {
  const { start, state } = await setup(t, { components: ["translator"] });
  const runtime = await start();
  const clone = globalThis.structuredClone;
  let snapshot;
  t.mock.method(globalThis, "structuredClone", (value, options) => {
    const result = clone(value, options);
    if (result?.requestId === 9) snapshot = result;
    return result;
  });
  let handedOff;
  t.mock.method(state.workers[0], "postMessage", (message) => {
    handedOff = message.payload;
    throw new Error("Synthetic send failure");
  });
  const worker = runtime.createTranslatorWorker();
  const code = new Uint8Array([7, 8]);
  const failure = new Promise((resolve) => {
    worker.onmessage = resolve;
  });
  worker.postMessage({ requestId: 9, job: {}, code }, [code.buffer]);
  assert.equal(code.byteLength, 0);
  assert.equal((await failure).data.ok, false);
  assert.equal(
    handedOff,
    snapshot.code.buffer,
    "full-span owned buffer is forwarded without another copy",
  );
  assert.deepEqual([...new Uint8Array(handedOff)], [0, 0]);
});

// 在任何结构化复制之前拒绝超限输入，且借用子视图不会放大为底层分配。
// Reject oversized inputs before any structured clone; borrowed subviews never amplify to their backing allocation.
test("shader facade caps inputs and metadata before cloning", async (t) => {
  const { start, state } = await setup(t, { components: ["translator", "spirvCross"] });
  const runtime = await start();
  let clones = 0;
  const clone = globalThis.structuredClone;
  t.mock.method(globalThis, "structuredClone", (...args) => {
    clones++;
    return clone(...args);
  });
  const translator = runtime.createTranslatorWorker();
  const cross = runtime.createShaderWorkerFactory()(runtime.workerUrls.spirvCross);
  for (const [worker, data] of [
    [translator, { requestId: 1, code: new Uint8Array(1024 * 1024 + 1), job: {} }],
    [
      cross,
      { id: 2, type: "convert", spirv: new ArrayBuffer(16 * 1024 * 1024 + 1), replayContext: {} },
    ],
    [translator, { requestId: 3, code: new Uint8Array([1]), job: { large: "x".repeat(65537) } }],
    [
      cross,
      {
        id: 4,
        type: "convert",
        spirv: new ArrayBuffer(4),
        replayContext: { large: "x".repeat(65537) },
      },
    ],
  ]) {
    const reply = new Promise((resolve) => {
      worker.onmessage = resolve;
    });
    assert.doesNotThrow(() => worker.postMessage(data));
    assert.equal((await reply).data.ok, false);
  }
  assert.equal(clones, 0);
  assert.ok(state.workers.every((worker) => worker.requests.length === 1));
});

test("borrowed shader subviews clone only their range and ignore unused fields", async (t) => {
  const { start, state } = await setup(t, { components: ["translator"] });
  const runtime = await start();
  const clone = globalThis.structuredClone;
  let sourceBytes;
  t.mock.method(globalThis, "structuredClone", (value, options) => {
    if (value?.requestId === 10) {
      sourceBytes = value.code.buffer.byteLength;
      assert.equal(Object.hasOwn(value, "ignored"), false);
    }
    return clone(value, options);
  });
  const backing = new Uint8Array(2 * 1024 * 1024);
  backing.set([3, 4], 99);
  const extraTransfer = new ArrayBuffer(1);
  const worker = runtime.createTranslatorWorker();
  const reply = new Promise((resolve) => {
    worker.onmessage = resolve;
  });
  worker.postMessage(
    { requestId: 10, code: backing.subarray(99, 101), job: {}, ignored: backing },
    [extraTransfer],
  );
  assert.equal(sourceBytes, 2);
  assert.equal(extraTransfer.byteLength, 0);
  assert.equal(backing.byteLength, 2 * 1024 * 1024);
  backing[99] = 8;
  await Promise.resolve();
  const request = state.workers[0].requests.at(-1);
  assert.deepEqual([...new Uint8Array(request.payload)], [3, 4]);
  state.workers[0].reply({ id: request.id, ok: true, result: {} });
  await reply;
  assert.deepEqual([...backing.subarray(99, 101)], [8, 4]);
});

test("invalid shader transfer lists wipe private subview copies without touching borrowed bytes", async (t) => {
  const { start } = await setup(t, { components: ["translator"] });
  const runtime = await start();
  const clone = globalThis.structuredClone;
  let privateCode;
  t.mock.method(globalThis, "structuredClone", (value, options) => {
    if (value?.requestId === 11) privateCode = value.code;
    return clone(value, options);
  });
  const backing = new Uint8Array([9, 3, 4, 9]);
  const extra = new ArrayBuffer(1);
  const worker = runtime.createTranslatorWorker();
  assert.throws(
    () =>
      worker.postMessage({ requestId: 11, code: backing.subarray(1, 3), job: {} }, [extra, extra]),
    { name: "DataCloneError" },
  );
  assert.deepEqual([...privateCode], [0, 0]);
  assert.deepEqual([...backing], [9, 3, 4, 9]);
});

test("shader facade rejects object and oversized correlation IDs without cloning or echoing them", async (t) => {
  const { start } = await setup(t, { components: ["translator", "spirvCross"] });
  const runtime = await start();
  const clone = globalThis.structuredClone;
  let clones = 0;
  t.mock.method(globalThis, "structuredClone", (...args) => {
    clones++;
    return clone(...args);
  });
  const translator = runtime.createTranslatorWorker();
  const cross = runtime.createShaderWorkerFactory()(runtime.workerUrls.spirvCross);
  for (const id of [{ nested: "id" }, [], new ArrayBuffer(1024 * 1024), "x".repeat(257)]) {
    for (const [worker, data] of [
      [translator, { requestId: id, code: new Uint8Array([1]), job: {} }],
      [cross, { id, type: "convert", spirv: new ArrayBuffer(4), replayContext: {} }],
    ]) {
      const reply = new Promise((resolve) => {
        worker.onmessage = resolve;
      });
      worker.postMessage(data);
      assert.deepEqual((await reply).data, { ok: false, error: "Sealed operation failed" });
    }
  }
  for (const id of [undefined, null, true, 1, "x".repeat(256)]) {
    const reply = new Promise((resolve) => {
      translator.onmessage = resolve;
    });
    translator.postMessage({ requestId: id, code: null, job: {} });
    assert.deepEqual((await reply).data, {
      requestId: id,
      ok: false,
      error: "Sealed operation failed",
    });
  }
  assert.equal(clones, 0);
});

// 观察者异常与工作线程初始化结果隔离，进度状态仍继续更新。
// Observer failures are isolated from worker initialization while progress state keeps advancing.
for (const mode of ["throw", "reject", "thenable"]) {
  test(`startup progress observer ${mode} does not interrupt initialization`, async (t) => {
    const progress = [];
    let failObserver = false;
    const { start, state } = await setup(t, {
      initialize: false,
      onProgress(value) {
        progress.push(value);
        if (!failObserver) return;
        if (mode === "throw") throw new Error("Synthetic observer throw");
        if (mode === "reject") return Promise.reject(new Error("Synthetic observer rejection"));
        return {
          get then() {
            throw new Error("Synthetic thenable getter");
          },
        };
      },
    });
    const pending = start();
    const worker = await state.firstInitialize.promise;
    failObserver = true;
    assert.doesNotThrow(() =>
      worker.reply({ type: "initialization-stage", stage: "config-module" }),
    );
    assert.match(progress.at(-1).label, /reading configuration/);
    assert.doesNotThrow(() => worker.reply({ type: "initialization-stage", stage: "probe-after" }));
    assert.match(progress.at(-1).label, /finishing startup/);
    worker.reply({ id: 0, ok: true, result: { initialized: true } });
    const runtime = await pending;
    assert.equal(runtime.initialized.program.initialized, true);
    assert.equal(worker.terminations, 0);
    assert.equal(state.timers.size, 0);
    assert.ok(progress.length >= 3);
    assert.notEqual(progress.at(-1), progress.at(-2));
  });
}

test("program retirement releases only the completed component and is idempotent", async (t) => {
  const { start, state, assertSealedRuntime } = await setup(t, {
    components: ["program", "texture"],
  });
  const runtime = await start();
  const client = runtime.createProgramWorker();
  const pending = runProgram(client);
  assert.equal(runtime.retireProgramWorker(), false);
  state.workers[1].reply({ id: 1, ok: true, files: {} });
  await pending;
  assert.equal(runtime.retireProgramWorker(), false);
  client.close();
  client.close();
  assert.ok(state.workers.every((worker) => worker.terminations === 0));
  assert.equal(runtime.retireProgramWorker(), true);
  assert.equal(runtime.retireProgramWorker(), true);
  assert.equal(state.workers[1].terminations, 1);
  assert.equal(state.workers[0].terminations, 0);
  assert.doesNotThrow(() => assertSealedRuntime(runtime));
  assert.throws(() => runtime.createProgramWorker(), /Program worker retired/);
  const texture = runTexture(runtime.createTextureClient());
  state.workers[0].reply({ id: 1, ok: true, result: { sprite: new Uint8Array([7]) } });
  assert.deepEqual(await texture, { sprite: new Uint8Array([7]) });
  await runtime.close();
  assert.equal(state.workers[1].terminations, 1);
  assert.equal(state.workers[0].terminations, 1);
});

test("program retirement preserves idle siblings and their future requests", async (t) => {
  const { start, state } = await setup(t);
  const runtime = await start();
  const first = runtime.createProgramWorker();
  const sibling = runtime.createProgramWorker();
  first.close();
  assert.equal(runtime.retireProgramWorker(), false);
  assert.equal(state.workers[0].terminations, 0);
  const pending = runProgram(sibling);
  state.workers[0].reply({ id: 1, ok: true, files: {} });
  await pending;
  sibling.close();
  assert.equal(runtime.retireProgramWorker(), true);
});

test("program retirement after cancelled active work is a harmless no-op", async (t) => {
  const { start, state } = await setup(t);
  const runtime = await start();
  const client = runtime.createProgramWorker();
  const pending = runProgram(client);
  client.close();
  await assert.rejects(pending, /Sealed runtime closed/);
  assert.equal(runtime.retireProgramWorker(), false);
  assert.equal(state.workers[0].terminations, 1);
});

test("completed asset and shader groups retire without touching extraction", async (t) => {
  const { start, state, assertSealedRuntime } = await setup(t, {
    components: ["assets", "texture", "translator", "spirvCross", "extraction"],
  });
  const runtime = await start();
  const asset = runtime.createAssetWorker();
  const texture = runtime.createTextureEncoder();
  assert.equal(runtime.retireAssetWorkers(), false);
  asset.close();
  assert.equal(runtime.retireAssetWorkers(), false);
  assert.equal(state.workers.filter((worker) => worker.terminations).length, 0);
  texture.close();
  assert.equal(runtime.retireAssetWorkers(), true);
  assert.equal(runtime.retireAssetWorkers(), true);
  assert.equal(state.workers.filter((worker) => worker.terminations).length, 2);
  assert.throws(() => runtime.createAssetWorker(), /retired/);
  assert.throws(() => runtime.createTextureClient(), /retired/);
  await assert.rejects(runtime.recycleAssetWorker(), /unavailable/);
  assert.equal(state.workers.length, 5);
  const translator = runtime.createTranslator();
  const cross = runtime.createCrossWorker();
  const pending = translator.translate({ job: {}, code: new Uint8Array([1]) });
  assert.equal(runtime.retireShaderWorkers(), false);
  const worker = state.workers.find((item) => item.requests.at(-1).type === "run");
  worker.reply({ id: 1, ok: true, result: { translated: true } });
  assert.deepEqual(await pending, { translated: true });
  translator.close();
  assert.equal(runtime.retireShaderWorkers(), false);
  cross.terminate();
  cross.terminate();
  assert.equal(runtime.retireShaderWorkers(), true);
  assert.equal(runtime.retireShaderWorkers(), true);
  assert.equal(state.workers.filter((item) => item.terminations).length, 4);
  assert.throws(() => runtime.createTranslator(), /retired/);
  assert.throws(() => runtime.createCrossWorker(), /retired/);
  assert.equal(runtime.createExtractionWorker().terminations, 0);
  assert.doesNotThrow(() => assertSealedRuntime(runtime));
});

test("asset retirement skips an in-progress restart and can retire its replacement", async (t) => {
  const { start, state } = await setup(t, { components: ["assets", "texture"] });
  const runtime = await start();
  state.initialize = false;
  const pending = runtime.recycleAssetWorker();
  const replacement = state.workers.at(-1);
  assert.equal(runtime.retireAssetWorkers(), false);
  assert.equal(replacement.terminations, 0);
  replacement.reply({ id: 0, ok: true, result: { initialized: true } });
  await pending;
  assert.equal(runtime.retireAssetWorkers(), true);
  assert.equal(replacement.terminations, 1);
});

test("stage retirement after active cancellation does not stop workers twice", async (t) => {
  const { start, state } = await setup(t, {
    components: ["assets", "texture", "translator", "spirvCross"],
  });
  const runtime = await start();
  const asset = runtime.createAssetWorker();
  const pending = asset.run("overlay-recipe", new Uint8Array([1]));
  assert.equal(runtime.retireAssetWorkers(), false);
  asset.close();
  await assert.rejects(pending, /closed/);
  assert.equal(runtime.retireAssetWorkers(), false);
  assert.equal(runtime.retireShaderWorkers(), false);
  assert.ok(state.workers.every((worker) => worker.terminations === 1));
});
