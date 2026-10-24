// 用真实清单认证与合成线程验证着色器退休时的公开字节所有权；绝不编译或执行 WASM。
// Verify public-byte ownership at shader retirement with real manifest authentication and inert workers; never compile or execute WASM.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  AIR_COMPILER_RUNTIME as AIR,
  airCompilerRuntimeComponent,
} from "../../air-compiler-runtime-contract.mjs";

const encode = (text) => new TextEncoder().encode(text);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CROSS = "toolchain/spirv-cross-spike/wwwroot/spirv-cross.wasm";
const DOTNET = "toolchain/offline-runtime-spike/dotnet-dist";
const shell = encode("synthetic shell");
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

async function setup(t, { transport = "direct", alias = false, components } = {}) {
  const files = new Map([
    [profile.archivePath, shell],
    ["profile/metadata.json", encode("synthetic profile metadata")],
    ["catalog/shader_map.tsv", encode("synthetic shader catalog")],
    ["sealed-runtime/dotnet-worker.mjs", encode("inert translator worker")],
    [`${DOTNET}/runtime.wasm`, encode("synthetic translator WASM")],
    ["sealed-workers/cross-worker.mjs", encode("inert Cross worker")],
    [CROSS, encode("synthetic Cross WASM")],
    [AIR.entry, encode("inert AIR worker")],
    [AIR.factory, encode("inert AIR factory")],
    [AIR.wasm, encode("synthetic AIR WASM")],
    ["sealed-workers/program-worker.mjs", encode("inert program worker")],
    ["toolchain/program-rewrite-spike/dist/capstone-lz4.wasm", encode("synthetic program WASM")],
  ]);
  const record = (path) => ({ path, bytes: files.get(path).length, sha256: sha(files.get(path)) });
  files.set(
    `${DOTNET}/manifest.json`,
    encode(
      JSON.stringify({
        version: 1,
        assets: [{ ...record(`${DOTNET}/runtime.wasm`), path: "runtime.wasm" }],
      }),
    ),
  );
  const receipt = {
    version: AIR.version,
    id: AIR.id,
    apiVersion: AIR.apiVersion,
    headerBundleVersion: AIR.headerBundleVersion,
    sourceLanguage: AIR.sourceLanguage,
    emscripten: "4.0.20",
    headerSha256: sha(encode("synthetic headers")),
    sourceFingerprintSha256: sha(encode("synthetic source")),
    sourceManifestSha256: sha(encode("synthetic source manifest")),
    sourceCommit: "a".repeat(40),
    sourceInputs: { "toolchain.mjs": sha(encode("synthetic toolchain")) },
    files: {
      "d2r_air_wasm.mjs": {
        bytes: files.get(AIR.factory).length,
        sha256: sha(files.get(AIR.factory)),
      },
      "d2r_air_wasm.wasm": { bytes: files.get(AIR.wasm).length, sha256: sha(files.get(AIR.wasm)) },
    },
  };
  files.set(AIR.receipt, encode(JSON.stringify(receipt)));
  if (alias) {
    if (alias === true || alias === AIR.wasm)
      files.set("profile/air-alias.bin", files.get(AIR.wasm));
    if (alias === true || alias === CROSS) files.set("profile/cross-alias.bin", files.get(CROSS));
  }
  const assets = [...files.keys()].map(record);
  const manifest = {
    version: 1,
    assets,
    totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    components: { airCompiler: airCompilerRuntimeComponent(receipt) },
  };
  const downloads = new Map(files);
  if (transport !== "direct") {
    const unique = [...new Map(assets.map((asset) => [asset.sha256, asset])).values()];
    const groups = transport === "shared" ? [unique] : unique.map((asset) => [asset]);
    const payloads = [],
      entries = [];
    for (const [index, group] of groups.entries()) {
      const path = `payload/${index}.bin`;
      const decoded = new Uint8Array(group.reduce((sum, item) => sum + item.bytes, 0));
      let offset = 0;
      for (const asset of group) {
        decoded.set(files.get(asset.path), offset);
        entries.push({ file: path, offset, bytes: asset.bytes, sha256: asset.sha256 });
        offset += asset.bytes;
      }
      const encoded = transport === "gzip" ? new Uint8Array(gzipSync(decoded)) : decoded;
      downloads.set(path, encoded);
      payloads.push({
        path,
        bytes: encoded.length,
        sha256: sha(encoded),
        encoding: transport === "gzip" ? "gzip" : "identity",
        decodedBytes: decoded.length,
      });
    }
    manifest.transport = {
      version: 1,
      files: payloads,
      entries,
      totalBytes: payloads.reduce((sum, file) => sum + file.bytes, 0),
    };
  }
  const raw = encode(JSON.stringify(manifest));
  downloads.set("runtime-manifest.json", raw);
  const state = { workers: [], fetches: 0, preparations: 0, originals: new Map(), revoked: [] };
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", (algorithm, bytes) => {
    for (const path of [AIR.wasm, CROSS]) {
      if (!state.originals.has(path) && sha(bytes) === sha(files.get(path)))
        state.originals.set(path, bytes);
    }
    return digest(algorithm, bytes);
  });
  t.mock.method(WebAssembly, "compile", async (bytes) => {
    state.preparations++;
    assert.deepEqual(bytes, files.get(AIR.wasm));
    assert.notEqual(bytes.buffer, state.originals.get(AIR.wasm).buffer);
    return { inertModule: true };
  });
  const revoke = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, "revokeObjectURL", (url) => {
    state.revoked.push(url);
    revoke(url);
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    state.fetches++;
    const bytes = downloads.get(new URL(url).pathname.slice("/runtime/".length));
    assert.ok(bytes, "fetch only authenticated synthetic public inventory");
    return new Response(bytes);
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
    reply(data) {
      const event = new MessageEvent("message", { data });
      this.onmessage?.(event);
      this.dispatchEvent(event);
    }
    postMessage(message, transfers = []) {
      const copy = structuredClone(message, { transfer: transfers });
      this.requests.push(copy);
      if (copy.type !== "initialize") return;
      this.air = copy.factoryBytes instanceof ArrayBuffer;
      queueMicrotask(() =>
        this.reply(
          this.air
            ? { type: "initialized", id: copy.id, heapBytes: 4096 }
            : { id: copy.id, ok: true, result: { initialized: true } },
        ),
      );
    }
    terminate() {
      this.terminations++;
    }
  };
  const { prepareSealedRuntime, assertSealedRuntime } = await import(
    `../../sealed-runtime/clients.mjs?retirement=${++serial}`
  );
  const runtime = await prepareSealedRuntime({
    baseUrl: "https://example.test/runtime/",
    manifestSha256: sha(raw),
    components: components ?? ["translator", "spirvCross", "program"],
  });
  t.after(() => runtime.close());
  return { runtime, state, files, assertSealedRuntime };
}

const release = { releasePublicWasm: true };
function assertReadable(runtime, files, paths = [AIR.wasm, CROSS]) {
  for (const path of paths) assert.deepEqual(runtime.readPublicAsset(path), files.get(path));
}
function assertOriginalsIntact(state, files) {
  for (const path of [AIR.wasm, CROSS])
    assert.deepEqual(state.originals.get(path), files.get(path));
}
function compile(client) {
  return client.compile("kernel void main0() {}", { entry: "main0", stage: "kernel" });
}
function compiled(worker, { recycle = false } = {}) {
  const output = new Uint8Array(88).fill(7);
  worker.reply({
    type: "compiled",
    id: worker.requests.at(-1).id,
    bytes: output.buffer,
    recycle,
    heapBytes: 4096,
    compilationCount: 1,
    inspection: { validation: "container-and-integrity-only", outputSize: output.length },
  });
  return output;
}

for (const transport of ["direct", "identity", "gzip"])
  test(`default retirement preserves all public reads (${transport})`, async (t) => {
    const { runtime, state, files } = await setup(t, { transport });
    assert.equal(runtime.retireShaderWorkers(), true);
    assert.equal(runtime.retireShaderWorkers({ releasePublicWasm: false }), true);
    assertReadable(runtime, files, [...files.keys()]);
    assertOriginalsIntact(state, files);
    assert.equal(state.revoked.length, 0);
  });

for (const transport of ["direct", "identity", "gzip"])
  test(`production opt-in drops only dedicated shader WASM references (${transport})`, async (t) => {
    const { runtime, state, files, assertSealedRuntime } = await setup(t, { transport });
    const copies = [runtime.readPublicAsset(AIR.wasm), runtime.readPublicAsset(CROSS)];
    const fetches = state.fetches;
    assert.equal(runtime.retireShaderWorkers(release), true);
    assert.equal(runtime.retireShaderWorkers(release), true);
    for (const path of [AIR.wasm, CROSS])
      assert.throws(() => runtime.readPublicAsset(path), /Missing verified runtime asset/);
    assertReadable(
      runtime,
      files,
      [...files.keys()].filter((path) => ![AIR.wasm, CROSS].includes(path)),
    );
    assert.deepEqual(copies, [files.get(AIR.wasm), files.get(CROSS)]);
    assertOriginalsIntact(state, files);
    assert.equal(state.fetches, fetches);
    assert.equal(state.revoked.length, 0);
    assert.equal(assertSealedRuntime(runtime), runtime);
    assert.equal(
      state.workers.filter((worker) => worker.terminations === 1).length,
      2 + state.workers.filter((worker) => worker.air).length,
    );
    assert.throws(() => runtime.createAirCompilerClient(), /unavailable/);
    assert.throws(() => runtime.createTranslator(), /retired/);
    assert.throws(() => runtime.createCrossWorker(), /retired/);
    const program = runtime.createProgramWorker();
    const pending = program.run({
      bytes: new Uint8Array([1]),
      moduleName: "synthetic",
      releaseId: "synthetic",
    });
    const worker = state.workers.find(
      (item) => item.requests[0].assets?.[0]?.[0] === "capstone-lz4.wasm",
    );
    worker.reply({ id: worker.requests.at(-1).id, ok: true, files: {} });
    await pending;
    program.close();
    await runtime.close();
    assertOriginalsIntact(state, files);
    assert.throws(() => runtime.readPublicAsset(profile.archivePath), /closed/);
  });

for (const options of [{ transport: "shared" }, { transport: "identity", alias: true }])
  test(`opt-in preserves shared backing and whole-buffer aliases (${JSON.stringify(options)})`, async (t) => {
    const { runtime, state, files } = await setup(t, options);
    if (options.transport === "shared")
      assert.equal(state.originals.get(AIR.wasm).buffer, state.originals.get(CROSS).buffer);
    else
      for (const original of state.originals.values())
        assert.equal(original.byteLength, original.buffer.byteLength);
    assert.equal(runtime.retireShaderWorkers(release), true);
    assert.equal(runtime.retireShaderWorkers(release), true);
    assertReadable(runtime, files, [...files.keys()]);
    assertOriginalsIntact(state, files);
  });

for (const alias of [AIR.wasm, CROSS])
  test(`one aliased candidate does not block the other dedicated release (${alias})`, async (t) => {
    const { runtime, state, files } = await setup(t, { transport: "identity", alias });
    assert.equal(runtime.retireShaderWorkers(release), true);
    assertReadable(runtime, files, [alias]);
    const released = alias === AIR.wasm ? CROSS : AIR.wasm;
    assert.throws(() => runtime.readPublicAsset(released), /Missing verified runtime asset/);
    assertOriginalsIntact(state, files);
  });

test("idle sibling leases and active work block all retirement cleanup", async (t) => {
  const { runtime, state, files } = await setup(t);
  const translator = runtime.createTranslator();
  const cross = runtime.createCrossWorker();
  const compiler = runtime.createAirCompilerClient();
  const sibling = runtime.createAirCompilerClient();
  for (const close of [
    () => translator.close(),
    () => cross.terminate(),
    () => compiler.dispose(),
  ]) {
    assert.equal(runtime.retireShaderWorkers(release), false);
    assertReadable(runtime, files);
    assert.ok(state.workers.every((worker) => worker.terminations === 0));
    close();
  }
  const pending = compile(sibling);
  await nextTurn();
  assert.equal(runtime.retireShaderWorkers(release), false);
  assertReadable(runtime, files);
  const output = compiled(state.workers.find((worker) => worker.air));
  assert.equal((await pending).bytes.buffer, output.buffer);
  assert.equal(runtime.retireShaderWorkers(release), false);
  sibling.dispose();
  assert.equal(runtime.retireShaderWorkers(release), true);
  assert.deepEqual(output, new Uint8Array(88).fill(7));
  assertOriginalsIntact(state, files);
});

test("compiler failure stops its pool but keeps public originals until retirement", async (t) => {
  const { runtime, state, files } = await setup(t);
  const compiler = runtime.createAirCompilerClient();
  const first = compile(compiler);
  await nextTurn();
  const initial = state.workers.find((worker) => worker.air);
  initial.reply({ type: "error", id: initial.requests.at(-1).id, code: "AIR_FRONTEND_FAILED" });
  await assert.rejects(first, { code: "AIR_FRONTEND_FAILED" });
  assert.equal(compiler.ready, false);
  assert.ok(
    state.workers.filter((worker) => worker.air).every((worker) => worker.terminations === 1),
  );
  await assert.rejects(compile(compiler), { code: "AIR_COMPILER_DISPOSED" });
  assert.equal(runtime.retireShaderWorkers(release), false);
  assertReadable(runtime, files);
  compiler.dispose();
  assert.equal(runtime.retireShaderWorkers(release), true);
  assertOriginalsIntact(state, files);
});

test("compiler recycling reuses prepared code and keeps originals until successful retirement", async (t) => {
  const { runtime, state, files } = await setup(t);
  const compiler = runtime.createAirCompilerClient();
  const initialCount = state.workers.filter((worker) => worker.air).length;
  const first = compile(compiler);
  await nextTurn();
  const recycledOutput = compiled(
    state.workers.find((worker) => worker.air),
    { recycle: true },
  );
  assert.equal((await first).bytes.buffer, recycledOutput.buffer);
  assertReadable(runtime, files);
  const second = compile(compiler);
  await nextTurn();
  const finalOutput = compiled(state.workers.at(-1));
  await second;
  assert.equal(state.preparations, 1, "recycling reuses the prepared inert module");
  assert.equal(state.workers.filter((worker) => worker.air).length, initialCount + 1);
  compiler.dispose();
  assert.equal(runtime.retireShaderWorkers(release), true);
  assertOriginalsIntact(state, files);
  for (const output of [recycledOutput, finalOutput])
    assert.deepEqual(output, new Uint8Array(88).fill(7));
});

test("missing shader components cannot release public WASM", async (t) => {
  const { runtime, state, files } = await setup(t, { components: ["airCompiler"] });
  assert.equal(runtime.retireShaderWorkers(release), false);
  assertReadable(runtime, files);
  assertOriginalsIntact(state, files);
  assert.ok(state.workers.every((worker) => worker.terminations === 0));
});

test("invalid opt-in fails before retirement and explicit later cleanup is idempotent", async (t) => {
  const { runtime, state, files } = await setup(t);
  for (const releasePublicWasm of [null, 1, "true", {}, []]) {
    assert.throws(
      () => runtime.retireShaderWorkers({ releasePublicWasm }),
      /Invalid shader retirement option/,
    );
    assertReadable(runtime, files);
    assert.ok(state.workers.every((worker) => worker.terminations === 0));
  }
  assert.equal(runtime.retireShaderWorkers(), true);
  assertReadable(runtime, files);
  assert.equal(runtime.retireShaderWorkers(release), true);
  assert.equal(runtime.retireShaderWorkers(release), true);
  assert.throws(() => runtime.readPublicAsset(AIR.wasm), /Missing verified runtime asset/);
  assertOriginalsIntact(state, files);
});
