// 用合成公开字节、外壳注册表和工作线程验证引导顺序；不读取私有输入或执行真实编码器。
// Verify bootstrap ordering with synthetic public bytes, shell registry and workers; no private inputs or actual codecs.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OPTIONAL_RUNTIME_ASSET_GROUPS } from "../../runtime-asset-groups.mjs";
const encode = (text) => new TextEncoder().encode(text),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  shell = encode("synthetic pinned shell");
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
      assert.equal(signal, state.signal);
      assert.deepEqual(
        assets.map(([name]) => name),
        ["astc-encoder.mjs", "astc-encoder.wasm", "png-codec.wasm", "sha256.wasm"],
      );
      const buffers = assets.map(([, value]) => value);
      structuredClone(assets, { transfer: buffers });
      assert.ok(buffers.every((value) => value.byteLength === 0));
      if (state.initializationError) throw state.initializationError;
      const client = Object.freeze({
        initialized: !state.badProof,
        produce() {
          state.privateCalls++;
        },
        async close() {
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
class Worker {
  constructor(url) {
    this.url = url;
    this.terminated = false;
    state.workers.push(this);
  }
  postMessage(message, transfers) {
    const cloned = structuredClone(message, { transfer: transfers });
    assert.equal(cloned.type, "initialize");
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
async function setup({ enabled = false, absent = false } = {}) {
  state = {
    fetches: [],
    workers: [],
    helperCalls: 0,
    privateCalls: 0,
    producerCloses: 0,
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
      assets,
      totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    },
    raw = encode(JSON.stringify(manifest));
  data.set("runtime-manifest.json", raw);
  state.expectedFetches =
    5 + (enabled && !absent ? OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].length : 0);
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
      components: ["program"],
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
