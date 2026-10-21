// 合成缓冲区生命周期测试；不测量浏览器内存或断言真实游戏兼容性。
// Synthetic buffer lifetime tests; no browser-memory measurement or real-game compatibility claim.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildGuestFramework, guestInfoPlist } from "../guest-framework.mjs";
import {
  createProgramRewriterAdapter,
  PROGRAM_REWRITER_SOURCE,
} from "../program-rewriter-adapter.mjs";

const encode = (text) => new TextEncoder().encode(text);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const empty = (bytes) => assert.ok(bytes.every((value) => value === 0));
const buildId = "534e5448455449430000000000000000";
async function fixture(t) {
  const snapshots = new Map(),
    copiedFiles = new Map(),
    inputs = {},
    outputs = {},
    modules = [],
    images = [];
  for (const [index, name] of ["main", "sdk"].entries()) {
    const input = new Uint8Array(128).fill(index + 1);
    input.set(Buffer.from(buildId, "hex"), 0x40);
    inputs[name] = input;
    const image = new Uint8Array(65540).fill(index + 3);
    const files = {
      "build_src.sha256": encode(`${PROGRAM_REWRITER_SOURCE}  patch_nso.py\n`),
      [`${name}.patched.bin`]: image,
      [`${name}.fixups.tsv`]: encode(
        "# TEXT_END\t4\n# PATCH_OFF\t65536\n# KEY_PAGE_OFF\t49152\n# KEY_PAGE_SIZE\t16384\n# RO_OFF\t16384\n# DATA_OFF\t32768\n",
      ),
    };
    for (const suffix of ["gates", "sites", "cuts", "params", "obs"])
      files[`${name}.${suffix}.tsv`] = encode(`${name} ${suffix}\n`);
    outputs[name] = files;
    modules.push({
      name,
      caseName: name,
      buildId,
      ruleset: "native",
      inputSha256: sha(input),
      files: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, sha(bytes)])),
    });
    images.push({ name, image, textEnd: 4, patchOff: 65536 });
  }
  const guest = await buildGuestFramework(images);
  const plist = encode(guestInfoPlist());
  const catalog = {
    schemaVersion: 2,
    scope: "synthetic-only",
    sourceSha256: PROGRAM_REWRITER_SOURCE,
    versions: [{ id: "lifetime", modules, guestSha256: sha(guest), plistSha256: sha(plist) }],
  };
  // 在摘要边界观察独占字节，不依赖可重写的 slice 方法。
  // Observe owned bytes at the digest boundary, without relying on overridable slice methods.
  const pending = new Map();
  const observe = (bytes, name, copies) => {
    const key = sha(bytes);
    if (!pending.has(key)) pending.set(key, []);
    pending.get(key).push({ name, copies });
  };
  for (const [name, bytes] of Object.entries(inputs)) observe(bytes, name, snapshots);
  for (const [name, files] of Object.entries(outputs))
    for (const file of Object.keys(files).sort())
      observe(files[file], `${name}/${file}`, copiedFiles);
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(globalThis.crypto.subtle, "digest", (algorithm, bytes) => {
    const match = pending.get(sha(bytes))?.shift();
    if (match) match.copies.set(match.name, bytes);
    return digest(algorithm, bytes);
  });
  return { inputs, outputs, snapshots, copiedFiles, guest, plist, catalog };
}
function adapterFor(f, run, close = () => {}) {
  return createProgramRewriterAdapter({
    trustedCatalog: f.catalog,
    resolveInput: () => ({ versionId: "lifetime", programModules: f.inputs }),
    createWorker: () => ({
      run:
        run ??
        (({ moduleName }) => ({
          ok: true,
          status: "synthetic-only",
          files: f.outputs[moduleName],
        })),
      close,
    }),
  });
}
async function collect(entry) {
  const chunks = [];
  for await (const chunk of entry.chunks()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("program generation releases scratch only after Guest consumes it and preserves exact streamed bytes", async (t) => {
  const f = await fixture(t);
  const originalInputs = Object.fromEntries(
    Object.entries(f.inputs).map(([name, bytes]) => [name, sha(bytes)]),
  );
  const originalOutputs = Object.fromEntries(
    Object.entries(f.outputs).map(([name, files]) => [
      name,
      Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, sha(bytes)])),
    ]),
  );
  let guestBuffer,
    closed = 0;
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(globalThis.crypto.subtle, "digest", (algorithm, bytes) => {
    if (bytes.byteLength === f.guest.length) {
      guestBuffer = bytes;
      // 全部快照和镜像在最终输出哈希检查之前仍保持完整。
      // All snapshots and images remain intact through the final output digest check.
      for (const [name, snapshot] of f.snapshots) assert.equal(sha(snapshot), originalInputs[name]);
      for (const name of ["main", "sdk"])
        assert.equal(
          sha(f.copiedFiles.get(`${name}/${name}.patched.bin`)),
          originalOutputs[name][`${name}.patched.bin`],
        );
    }
    return digest(algorithm, bytes);
  });
  const adapter = adapterFor(f, undefined, () => {
    closed++;
  });
  const entries = await adapter.generateProgram();
  assert.equal(closed, 1);
  assert.equal(f.snapshots.size, 2);
  assert.equal(f.copiedFiles.size, 16);
  assert.ok(guestBuffer);
  for (const bytes of f.snapshots.values()) empty(bytes);
  const retained = new Set([
    "main/main.fixups.tsv",
    "main/main.gates.tsv",
    "main/main.cuts.tsv",
    "sdk/sdk.fixups.tsv",
    "sdk/sdk.gates.tsv",
  ]);
  for (const [name, bytes] of f.copiedFiles) {
    if (retained.has(name)) assert.ok(bytes.some((value) => value !== 0));
    else empty(bytes);
  }
  assert.equal(entries.length, 7);
  const consumed = [];
  for (const entry of entries) {
    const bytes = await collect(entry);
    const expected = entry.path.endsWith("/Guest")
      ? f.guest
      : entry.path.endsWith("Info.plist")
        ? f.plist
        : f.outputs[entry.path.slice(3).split(".")[0]][entry.path.slice(3)];
    assert.deepEqual(bytes, Buffer.from(expected));
    consumed.push({ bytes, digest: sha(bytes) });
  }
  adapter.dispose();
  adapter.dispose();
  empty(guestBuffer);
  for (const bytes of f.copiedFiles.values()) empty(bytes);
  for (const entry of entries) await assert.rejects(collect(entry), { code: "PROGRAM_DISPOSED" });
  for (const { bytes, digest: expected } of consumed) assert.equal(sha(bytes), expected);
  for (const [name, bytes] of Object.entries(f.inputs))
    assert.equal(sha(bytes), originalInputs[name]);
  for (const [name, files] of Object.entries(f.outputs))
    for (const [file, bytes] of Object.entries(files))
      assert.equal(sha(bytes), originalOutputs[name][file]);
});

test("failed Guest verification wipes staged inputs and all owned worker copies", async (t) => {
  const f = await fixture(t);
  f.catalog.versions[0].guestSha256 = "0".repeat(64);
  const adapter = adapterFor(f);
  await assert.rejects(adapter.generateProgram(), { code: "PROGRAM_GUEST_DIGEST_MISMATCH" });
  assert.equal(f.snapshots.size, 2);
  assert.equal(f.copiedFiles.size, 16);
  for (const bytes of f.snapshots.values()) empty(bytes);
  for (const bytes of f.copiedFiles.values()) empty(bytes);
  for (const bytes of Object.values(f.inputs)) assert.ok(bytes.some((value) => value !== 0));
  adapter.dispose();
});

test("cancellation during rewrite still wipes owned snapshots without mutating borrowed input", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const adapter = adapterFor(f, () => {
    controller.abort();
    return new Promise(() => {});
  });
  await assert.rejects(adapter.generateProgram({ signal: controller.signal }), {
    code: "PROGRAM_CANCELLED",
  });
  for (const bytes of f.snapshots.values()) empty(bytes);
  for (const bytes of Object.values(f.inputs)) assert.ok(bytes.some((value) => value !== 0));
  adapter.dispose();
});

test("dispose during rewrite rejects generation and wipes snapshots", async (t) => {
  const f = await fixture(t);
  let started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  const adapter = adapterFor(f, () => {
    started();
    return new Promise(() => {});
  });
  const generation = adapter.generateProgram();
  await running;
  adapter.dispose();
  await assert.rejects(generation, { code: "PROGRAM_DISPOSED" });
  for (const bytes of f.snapshots.values()) empty(bytes);
  for (const bytes of Object.values(f.inputs)) assert.ok(bytes.some((value) => value !== 0));
});

test("Buffer inputs and worker outputs stay borrowed and emitted chunks survive disposal", async (t) => {
  const f = await fixture(t);
  for (const name of Object.keys(f.inputs)) f.inputs[name] = Buffer.from(f.inputs[name]);
  for (const files of Object.values(f.outputs))
    for (const name of Object.keys(files)) files[name] = Buffer.from(files[name]);
  const borrowed = [...Object.values(f.inputs), ...Object.values(f.outputs).flatMap(Object.values)];
  const expected = borrowed.map(sha);
  const adapter = adapterFor(f);
  const entries = await adapter.generateProgram();
  assert.deepEqual(borrowed.map(sha), expected);
  assert.equal(f.snapshots.size, 2);
  assert.equal(f.copiedFiles.size, 16);
  const chunks = [];
  for (const entry of entries)
    for await (const bytes of entry.chunks()) chunks.push({ bytes, digest: sha(bytes) });
  adapter.dispose();
  assert.deepEqual(borrowed.map(sha), expected);
  for (const { bytes, digest } of chunks) assert.equal(sha(bytes), digest);
  for (const bytes of [...f.snapshots.values(), ...f.copiedFiles.values()]) empty(bytes);
});
