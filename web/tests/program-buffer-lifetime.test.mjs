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
async function fixture(t, targetHeader = "") {
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
        targetHeader +
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
function adapterFor(f, run, close = () => {}, workerOutputOwnership = "borrowed") {
  return createProgramRewriterAdapter({
    trustedCatalog: f.catalog,
    workerOutputOwnership,
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

test("owned worker outputs are adopted by identity and retained only until consumed", async (t) => {
  const f = await fixture(t);
  const originalInputs = Object.values(f.inputs).map(sha);
  const adapter = adapterFor(f, undefined, undefined, "owned");
  const entries = await adapter.generateProgram();
  for (const [module, files] of Object.entries(f.outputs))
    for (const [name, bytes] of Object.entries(files)) {
      assert.equal(f.copiedFiles.get(`${module}/${name}`), bytes);
      const retained =
        name.endsWith("fixups.tsv") || name.endsWith("gates.tsv") || name === "main.cuts.tsv";
      if (retained) assert.ok(bytes.some((value) => value !== 0));
      else empty(bytes);
    }
  const chunks = [];
  for (const entry of entries)
    for await (const bytes of entry.chunks()) chunks.push({ bytes, digest: sha(bytes) });
  adapter.dispose();
  for (const files of Object.values(f.outputs))
    for (const bytes of Object.values(files)) empty(bytes);
  for (const { bytes, digest } of chunks) assert.equal(sha(bytes), digest);
  assert.deepEqual(Object.values(f.inputs).map(sha), originalInputs);
});

test("owned digest failure wipes even response files not yet hashed", async (t) => {
  const f = await fixture(t);
  f.catalog.versions[0].modules[0].files["build_src.sha256"] = "0".repeat(64);
  const adapter = adapterFor(f, undefined, undefined, "owned");
  await assert.rejects(adapter.generateProgram(), { code: "PROGRAM_OUTPUT_DIGEST_MISMATCH" });
  for (const bytes of Object.values(f.outputs.main)) empty(bytes);
  for (const bytes of Object.values(f.outputs.sdk)) assert.ok(bytes.some((value) => value !== 0));
});

test("owned malformed response shape still wipes transferred eligible files", async (t) => {
  const f = await fixture(t);
  const adapter = adapterFor(
    f,
    () => ({ ok: true, status: "invalid", files: f.outputs.main }),
    undefined,
    "owned",
  );
  await assert.rejects(adapter.generateProgram(), { code: "PROGRAM_REWRITE_REJECTED" });
  for (const bytes of Object.values(f.outputs.main)) empty(bytes);
});

for (const kind of ["buffer", "subview", "shared", "resizable", "alias"])
  test(`owned output rejects ${kind} without wiping ineligible storage`, async (t) => {
    const f = await fixture(t);
    const original = f.outputs.main["main.gates.tsv"];
    let invalid;
    if (kind === "buffer") invalid = Buffer.from(original);
    if (kind === "subview") {
      invalid = new Uint8Array(original.length + 1).fill(7).subarray(1);
    }
    if (kind === "shared") invalid = new Uint8Array(new SharedArrayBuffer(original.length)).fill(7);
    if (kind === "resizable")
      invalid = new Uint8Array(
        new ArrayBuffer(original.length, { maxByteLength: original.length + 1 }),
      ).fill(7);
    if (kind === "alias") invalid = f.outputs.main["main.cuts.tsv"];
    const expected = sha(invalid);
    f.outputs.main["main.gates.tsv"] = invalid;
    const adapter = adapterFor(f, undefined, undefined, "owned");
    await assert.rejects(adapter.generateProgram(), { code: "PROGRAM_INVALID_OUTPUT" });
    if (kind !== "alias") assert.equal(sha(invalid), expected);
    for (const bytes of Object.values(f.outputs.main))
      if (bytes !== invalid || kind === "alias") empty(bytes);
  });

for (const workerOutputOwnership of ["borrowed", "owned"])
  for (const interruption of ["abort", "dispose"])
    test(`${workerOutputOwnership} late successful response after ${interruption} respects ownership`, async (t) => {
      const f = await fixture(t);
      let resolveResult, started;
      const running = new Promise((resolve) => {
        started = resolve;
      });
      const controller = new AbortController();
      const adapter = adapterFor(
        f,
        () => {
          started();
          return new Promise((resolve) => {
            resolveResult = resolve;
          });
        },
        undefined,
        workerOutputOwnership,
      );
      const generation = adapter.generateProgram({ signal: controller.signal });
      await running;
      if (interruption === "abort") controller.abort();
      else adapter.dispose();
      await assert.rejects(generation, {
        code: interruption === "abort" ? "PROGRAM_CANCELLED" : "PROGRAM_DISPOSED",
      });
      const before = Object.values(f.outputs.main).map(sha);
      resolveResult({ ok: true, status: "synthetic-only", files: f.outputs.main });
      await new Promise((resolve) => setImmediate(resolve));
      if (workerOutputOwnership === "owned")
        for (const bytes of Object.values(f.outputs.main)) empty(bytes);
      else assert.deepEqual(Object.values(f.outputs.main).map(sha), before);
      for (const bytes of Object.values(f.inputs)) assert.ok(bytes.some((value) => value !== 0));
    });

test("owned Guest verification failure wipes both modules", async (t) => {
  const f = await fixture(t);
  f.catalog.versions[0].guestSha256 = "0".repeat(64);
  const adapter = adapterFor(f, undefined, undefined, "owned");
  await assert.rejects(adapter.generateProgram(), { code: "PROGRAM_GUEST_DIGEST_MISMATCH" });
  for (const files of Object.values(f.outputs))
    for (const bytes of Object.values(files)) empty(bytes);
  for (const bytes of f.snapshots.values()) empty(bytes);
});

test("owned unexpected file is also wiped on file-set rejection", async (t) => {
  const f = await fixture(t);
  f.outputs.main["unexpected.bin"] = new Uint8Array([7, 8]);
  const adapter = adapterFor(f, undefined, undefined, "owned");
  await assert.rejects(adapter.generateProgram(), { code: "PROGRAM_REWRITE_REJECTED" });
  for (const bytes of Object.values(f.outputs.main)) empty(bytes);
});

test("owned detached output cannot interrupt cleanup of later files", async (t) => {
  const f = await fixture(t);
  const detached = f.outputs.main["build_src.sha256"];
  structuredClone(detached, { transfer: [detached.buffer] });
  const adapter = adapterFor(f, undefined, undefined, "owned");
  await assert.rejects(adapter.generateProgram(), { code: "PROGRAM_INVALID_OUTPUT" });
  for (const bytes of Object.values(f.outputs.main)) if (bytes !== detached) empty(bytes);
});

test("owned genuine empty sidecars remain valid", async (t) => {
  const f = await fixture(t);
  f.outputs.main["main.sites.tsv"] = new Uint8Array();
  f.catalog.versions[0].modules[0].files["main.sites.tsv"] = sha(new Uint8Array());
  const adapter = adapterFor(f, undefined, undefined, "owned");
  await adapter.generateProgram();
  adapter.dispose();
});

for (const target of ["0", "0x0"]) {
  test(`explicit Apple TARGET ${target} preserves synthetic Guest assembly`, async (t) => {
    const f = await fixture(t, `# TARGET\t${target}\n`);
    const adapter = adapterFor(f);
    try {
      const entries = await adapter.generateProgram();
      assert.deepEqual(
        await collect(entries.find((entry) => entry.path.endsWith("/Guest"))),
        Buffer.from(f.guest),
      );
    } finally {
      adapter.dispose();
    }
  });
}
for (const targetHeader of [
  "# TARGET\t1\n",
  "# TARGET\t0x2\n",
  "# TARGET\t3\n",
  "# TARGET\t0\n# TARGET\t0\n",
  "# TARGET\t-1\n",
]) {
  test(`non-Apple or invalid TARGET rejects before Guest assembly: ${JSON.stringify(targetHeader)}`, async (t) => {
    const f = await fixture(t, targetHeader);
    const adapter = adapterFor(f);
    try {
      await assert.rejects(adapter.generateProgram(), { code: "PROGRAM_INVALID_FIXUPS" });
      for (const bytes of f.snapshots.values()) empty(bytes);
      for (const bytes of f.copiedFiles.values()) empty(bytes);
      for (const bytes of Object.values(f.inputs)) assert.ok(bytes.some((value) => value !== 0));
    } finally {
      adapter.dispose();
    }
  });
}
