// 用合成公开字节、外壳注册表和工作线程验证引导顺序；不读取私有输入或执行真实编码器。
// Verify bootstrap ordering with synthetic public bytes, shell registry and workers; no private inputs or actual codecs.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OPTIONAL_RUNTIME_ASSET_GROUPS } from "../../runtime-asset-groups.mjs";
import { selectAirCompilerConcurrency } from "../../air-compiler-worker-client.mjs";
import {
  AIR_COMPILER_RUNTIME,
  airCompilerRuntimeComponent,
} from "../../air-compiler-runtime-contract.mjs";
import {
  RUNTIME_DIRECT_ASSETS,
  RUNTIME_SEALED_WORKERS,
  SOURCE_ONLY_RUNTIME_ASSETS,
} from "../../runtime-build/payload-policy.mjs";
const encode = (text) => new TextEncoder().encode(text),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  shell = encode("synthetic pinned shell");
const compilerFactory = encode("synthetic compiler factory, never executed");
const compilerWasm = encode("synthetic compiler WASM, preparation is mocked");
const compilerReceipt = {
  version: AIR_COMPILER_RUNTIME.version,
  id: AIR_COMPILER_RUNTIME.id,
  apiVersion: AIR_COMPILER_RUNTIME.apiVersion,
  headerBundleVersion: AIR_COMPILER_RUNTIME.headerBundleVersion,
  sourceLanguage: AIR_COMPILER_RUNTIME.sourceLanguage,
  emscripten: "4.0.20",
  headerSha256: sha(encode("synthetic headers")),
  sourceFingerprintSha256: sha(encode("synthetic source fingerprint")),
  sourceManifestSha256: sha(encode("synthetic source manifest")),
  sourceCommit: "a".repeat(40),
  sourceInputs: { "toolchain.mjs": sha(encode("synthetic toolchain")) },
  files: {
    "d2r_air_wasm.mjs": { bytes: compilerFactory.length, sha256: sha(compilerFactory) },
    "d2r_air_wasm.wasm": { bytes: compilerWasm.length, sha256: sha(compilerWasm) },
  },
};
const profile = {
  id: "synthetic-profile",
  archivePath: "profile/shell.zip",
  evidence: { archiveBytes: shell.length, sha256: sha(shell) },
};
mock.module("../../shell-profiles.mjs", {
  namedExports: { SHELL_PROFILE_IDS: [profile.id], resolveShellProfile: () => profile },
});
let state;
mock.module("../../astc-producer-client.mjs", {
  namedExports: {
    async createAstcProducerClient({ worker, assets, signal }) {
      state.helperCalls++;
      assert.equal(state.fetches.length, state.expectedFetches);
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, state.signal.aborted);
      assert.deepEqual(
        assets.map(([name]) => name),
        ["astc-encoder.mjs", "astc-encoder.wasm", "png-codec.wasm", "sha256.wasm"],
      );
      const buffers = assets.map(([, value]) => value);
      structuredClone(assets, { transfer: buffers });
      assert.ok(buffers.every((value) => value.byteLength === 0));
      state.initializationSignal = signal;
      state.initializationEntered?.resolve();
      await state.initializationPause?.promise;
      if (state.initializationError) throw state.initializationError;
      let clientClosed = false;
      const client = Object.freeze({
        initialized: !state.badProof,
        ready: true,
        produce() {
          state.privateCalls++;
        },
        async close() {
          if (clientClosed) return;
          clientClosed = true;
          state.producerCloses++;
          worker.terminate();
          if (state.cleanupError) throw state.cleanupError;
        },
      });
      state.client = client;
      return client;
    },
  },
});
class Worker extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.terminated = false;
    state.workers.push(this);
  }
  postMessage(message, transfers) {
    const cloned = structuredClone(message, { transfer: transfers });
    assert.equal(cloned.type, "initialize");
    if (cloned.factoryBytes instanceof ArrayBuffer) {
      assert.equal(state.fetches.length, state.expectedFetches);
      assert.deepEqual(new Uint8Array(cloned.factoryBytes), compilerFactory);
      assert.deepEqual(cloned.wasmModule, { syntheticCompilerModule: true });
      assert.equal(cloned.factorySha256, sha(compilerFactory));
      assert.equal(cloned.wasmSha256, sha(compilerWasm));
      assert.equal(cloned.headerSha256, compilerReceipt.headerSha256);
      this.assetNames = ["factory", "wasm"];
      state.compilerInitializations++;
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "initialized", id: cloned.id, heapBytes: 4096 },
          }),
        ),
      );
      return;
    }
    this.assetNames = cloned.assets.map(([name]) => name);
    queueMicrotask(() =>
      this.onmessage({ data: { id: 0, ok: true, result: { initialized: true } } }),
    );
  }
  terminate() {
    this.terminated = true;
  }
}
globalThis.isSecureContext = true;
globalThis.Worker = Worker;
globalThis.location = { href: "https://example.test/", origin: "https://example.test" };
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
globalThis.caches = {
  open() {
    throw new Error("Test cache unavailable");
  },
};
let serial = 0;
async function setup({
  enabled = false,
  absent = false,
  full = false,
  missingAirComponent = false,
} = {}) {
  state = {
    fetches: [],
    workers: [],
    helperCalls: 0,
    privateCalls: 0,
    producerCloses: 0,
    compilerInitializations: 0,
    signal: new AbortController().signal,
  };
  const data = new Map([
    [profile.archivePath, shell],
    ["sealed-workers/program-worker.mjs", encode("synthetic public program worker")],
    [
      "toolchain/program-rewrite-spike/dist/capstone-lz4.wasm",
      encode("synthetic public program wasm"),
    ],
    ["toolchain/asset-runtime-js/dist/png-codec.wasm", encode("synthetic public PNG wasm")],
  ]);
  if (full) {
    for (const path of [...RUNTIME_DIRECT_ASSETS, ...RUNTIME_SEALED_WORKERS])
      if (!data.has(path)) data.set(path, encode(`synthetic ${path}`));
    data.set(AIR_COMPILER_RUNTIME.factory, compilerFactory);
    data.set(AIR_COMPILER_RUNTIME.wasm, compilerWasm);
    data.set(AIR_COMPILER_RUNTIME.receipt, encode(JSON.stringify(compilerReceipt)));
    const closure = (directory, names) => {
      const assets = names.map((path) => {
        const bytes = encode(`synthetic ${directory}/${path}`);
        data.set(`${directory}/${path}`, bytes);
        return { path, bytes: bytes.length, sha256: sha(bytes) };
      });
      data.set(`${directory}/manifest.json`, encode(JSON.stringify({ version: 1, assets })));
    };
    closure("toolchain/asset-runtime-js/dist", [
      "worker.mjs",
      "image-kernels.wasm",
      "png-codec.wasm",
      "font-rasterizer.wasm",
    ]);
    closure("toolchain/offline-runtime-spike/dotnet-dist", [
      "worker.mjs",
      "dotnet.boot.js",
      "dotnet.js",
      "dotnet.native.synthetic.js",
      "dotnet.runtime.synthetic.js",
      "runtime.wasm",
    ]);
  }
  if (!absent)
    for (const path of OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"])
      data.set(path, encode(`synthetic ${path}`));
  const assets = [...data].map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: sha(bytes),
    ...(OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].includes(path)
      ? { optionalGroup: "legacy-astc" }
      : {}),
  }));
  const manifest = {
      version: 1,
      ...(full && !missingAirComponent
        ? { components: { airCompiler: airCompilerRuntimeComponent(compilerReceipt) } }
        : {}),
      assets,
      totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    },
    raw = encode(JSON.stringify(manifest));
  data.set("runtime-manifest.json", raw);
  state.expectedFetches = 1 + assets.filter((asset) => enabled || !asset.optionalGroup).length;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.slice("/runtime/".length);
    state.fetches.push(path);
    assert.ok(data.has(path), `Unexpected public fetch: ${path}`);
    return new Response(data.get(path));
  };
  const module = await import(`../../sealed-runtime/clients.mjs?bootstrap=${serial++}`);
  return {
    ...module,
    data,
    options: {
      baseUrl: "https://example.test/runtime/",
      manifestSha256: sha(raw),
      ...(full ? {} : { components: ["program"] }),
      signal: state.signal,
      ...(enabled ? { optionalGroups: ["legacy-astc"] } : {}),
    },
  };
}
test("default setup downloads no optional closure and creates no producer", async () => {
  const { prepareSealedRuntime, options, assertSealedRuntime } = await setup();
  const runtime = await prepareSealedRuntime(options);
  assert.equal(assertSealedRuntime(runtime), runtime);
  assert.equal(state.workers.length, 1);
  assert.equal(state.helperCalls, 0);
  assert.equal(state.fetches.length, 5);
  assert.ok(
    state.fetches.every((path) => !OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].includes(path)),
  );
  assert.throws(() => runtime.createAstcProducerClient(), /unavailable/);
  assert.equal(state.fetches.length, 5);
  await runtime.close();
  assert.throws(() => assertSealedRuntime(runtime), /live verified/);
});
test("opt-in verifies all public bytes and initializes before single acquisition", async () => {
  const { prepareSealedRuntime, options } = await setup({ enabled: true });
  const runtime = await prepareSealedRuntime(options);
  assert.equal(state.workers.length, 2);
  assert.equal(state.helperCalls, 1);
  assert.equal(state.privateCalls, 0);
  assert.deepEqual(runtime.initialized.astcProducer, { initialized: true });
  assert.equal(runtime.createAstcProducerClient(), state.client);
  assert.throws(() => runtime.createAstcProducerClient(), /already acquired/);
  const pending = runtime.close();
  assert.equal(runtime.close(), pending);
  await pending;
  assert.equal(state.producerCloses, 1);
  assert.ok(state.workers.every((worker) => worker.terminated));
});
test("unknown group rejects before network and unavailable group rejects before workers", async () => {
  const unknown = await setup();
  await assert.rejects(
    unknown.prepareSealedRuntime({ ...unknown.options, optionalGroups: ["unknown"] }),
    /group selection/,
  );
  assert.equal(state.fetches.length, 0);
  const absent = await setup({ enabled: true, absent: true });
  await assert.rejects(absent.prepareSealedRuntime(absent.options), /unavailable/);
  assert.deepEqual(state.fetches, ["runtime-manifest.json"]);
  assert.equal(state.workers.length, 0);
});
test("modified optional codec bytes fail before any worker or private operation", async () => {
  const { prepareSealedRuntime, data, options } = await setup({ enabled: true });
  data.set("toolchain/sha256-stream-wasm/dist/sha256.wasm", encode("tampered"));
  await assert.rejects(prepareSealedRuntime(options), /integrity mismatch/);
  assert.equal(state.workers.length, 0);
  assert.equal(state.privateCalls, 0);
});
test("failed initialization proof closes all workers and cannot create a session", async () => {
  const { prepareSealedRuntime, options } = await setup({ enabled: true });
  state.badProof = true;
  state.cleanupError = new Error("synthetic cleanup failure");
  await assert.rejects(prepareSealedRuntime(options), /initialization\/transfer failed/);
  assert.equal(state.producerCloses, 1);
  assert.ok(state.workers.every((worker) => worker.terminated));
});
test("cleanup failure remains awaitable while runtime identity is revoked", async () => {
  const { prepareSealedRuntime, options, assertSealedRuntime } = await setup({ enabled: true });
  const runtime = await prepareSealedRuntime(options);
  state.cleanupError = new Error("synthetic cleanup failure");
  const closing = runtime.close();
  assert.throws(() => assertSealedRuntime(runtime), /live verified/);
  assert.throws(() => runtime.createAstcProducerClient(), /unavailable/);
  await assert.rejects(closing, /synthetic cleanup failure/);
});
test("incomplete AIR component metadata rejects before worker creation", async () => {
  const { prepareSealedRuntime, options } = await setup({ full: true, missingAirComponent: true });
  await assert.rejects(prepareSealedRuntime(options), /Verified AIR compiler component is missing/);
  assert.deepEqual(state.fetches, ["runtime-manifest.json"]);
  assert.equal(state.workers.length, 0);
  assert.equal(state.privateCalls, 0);
});
test("every production plan initializes from retained assembly paths without raw client sources", async (t) => {
  let compilerPreparations = 0;
  t.mock.method(WebAssembly, "compile", async (bytes) => {
    assert.deepEqual(bytes, compilerWasm);
    compilerPreparations++;
    return { syntheticCompilerModule: true };
  });
  const { prepareSealedRuntime, options, data } = await setup({ enabled: true, full: true });
  assert.ok(SOURCE_ONLY_RUNTIME_ASSETS.every((path) => !data.has(path)));
  const runtime = await prepareSealedRuntime(options);
  assert.deepEqual(Object.keys(runtime.initialized), [
    "assets",
    "translator",
    "texture",
    "extraction",
    "spirvCross",
    "program",
    "airCompiler",
    "astcProducer",
  ]);
  const compilerWorkers = selectAirCompilerConcurrency();
  assert.equal(state.workers.length, Object.keys(runtime.initialized).length - 1 + compilerWorkers);
  assert.equal(compilerPreparations, 1);
  assert.equal(state.compilerInitializations, compilerWorkers);
  assert.equal(state.privateCalls, 0);
  assert.equal(state.fetches.length, state.expectedFetches);
  assert.equal(state.helperCalls, 1);
  assert.deepEqual(
    state.workers.slice(0, -1).map((worker) => worker.assetNames),
    [
      ["image-kernels.wasm", "png-codec.wasm", "font-rasterizer.wasm"],
      [
        "dotnet.boot.js",
        "dotnet.js",
        "dotnet.native.synthetic.js",
        "dotnet.runtime.synthetic.js",
        "runtime.wasm",
      ],
      [
        "texture.mjs",
        "texture.wasm",
        "bc3.wasm",
        "browser-texture.mjs",
        "browser-texture-encoder.mjs",
      ],
      ["hactool-boundary.wasm"],
      ["spirv-cross.wasm"],
      ["capstone-lz4.wasm"],
      ...Array.from({ length: compilerWorkers }, () => ["factory", "wasm"]),
    ],
  );
  for (const path of SOURCE_ONLY_RUNTIME_ASSETS)
    assert.throws(() => runtime.readPublicAsset(path), /Missing verified runtime asset/);
  for (const path of [...RUNTIME_DIRECT_ASSETS, ...RUNTIME_SEALED_WORKERS])
    assert.deepEqual(runtime.readPublicAsset(path), data.get(path));
  await runtime.close();
  assert.ok(state.workers.every((worker) => worker.terminated));
});

test("preloaded ASTC stays dormant until requested, then initializes without any fetch", async () => {
  const { prepareSealedRuntime, options } = await setup({ enabled: true });
  const runtime = await prepareSealedRuntime({ ...options, deferOptionalInitialization: true });
  assert.equal(state.helperCalls, 0);
  assert.equal(runtime.initialized.astcProducer, undefined);
  const before = [...state.fetches];
  await runtime.prepareAstcProducer({ signal: state.signal });
  assert.equal(state.helperCalls, 1);
  assert.deepEqual(state.fetches, before);
  await runtime.prepareAstcProducer({ signal: state.signal });
  assert.equal(state.helperCalls, 1);
  assert.equal(runtime.createAstcProducerClient(), state.client);
  await runtime.close();
  assert.ok(state.workers.every((worker) => worker.terminated));
});

for (const action of ["cancel", "close"])
  test(`${action} during deferred ASTC startup retires a late client without reads or refetch`, async () => {
    const { prepareSealedRuntime, options, assertSealedRuntime } = await setup({ enabled: true });
    const runtime = await prepareSealedRuntime({ ...options, deferOptionalInitialization: true });
    const before = [...state.fetches];
    state.initializationEntered = Promise.withResolvers();
    state.initializationPause = Promise.withResolvers();
    const controller = new AbortController();
    const initializing = runtime.prepareAstcProducer({ signal: controller.signal });
    await state.initializationEntered.promise;
    if (action === "close") await runtime.close();
    else controller.abort();
    assert.equal(state.initializationSignal.aborted, true);
    // Simulate an initializer returning late despite cancellation.
    state.initializationPause.resolve();
    await assert.rejects(initializing, { name: "AbortError" });
    await runtime.close();
    assert.equal(state.producerCloses, 1);
    assert.equal(state.privateCalls, 0);
    assert.ok(state.workers.every((worker) => worker.terminated));
    assert.deepEqual(state.fetches, before);
    assert.throws(() => assertSealedRuntime(runtime), /live verified/);
    assert.throws(() => runtime.createAstcProducerClient(), /unavailable/);
  });
