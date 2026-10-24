// 合成工作线程及目录验证生命周期；不把编码器替身冒充真实 WASM 或浏览器证据。
// Synthetic workers/directories verify lifecycle; codec doubles are not real WASM or browser evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createAstcProducerClient,
  bindAstcRecordSource,
  validateAstcProducerReceipt,
} from "../astc-producer-client.mjs";
import {
  createAstcProducerWorkerHandler,
  astcProducerFailureCode,
} from "../sealed-runtime/astc-producer-worker.mjs";
import { createArchiveReadRpcClient } from "../archive-read-rpc.mjs";
import { writeCascPack } from "../casc-pack-writer.mjs";
import {
  fixture as extractionFixture,
  open,
  selection,
} from "./helpers/extraction-adapter-fixture.mjs";
const path = "data/hd/texture_desc_cache.json",
  packName = "00-00000002.data";
const md5 = (b) => createHash("md5").update(b).digest("hex");
const assets = () =>
  ["astc-encoder.mjs", "astc-encoder.wasm", "png-codec.wasm", "sha256.wasm"].map((name) => [
    name,
    new ArrayBuffer(1),
  ]);
const tick = () => new Promise((resolve) => setImmediate(resolve));
class WorkerDouble {
  listeners = new Map();
  messages = [];
  terminated = false;
  constructor(run) {
    this.run = run;
  }
  addEventListener(k, f) {
    if (!this.listeners.has(k)) this.listeners.set(k, new Set());
    this.listeners.get(k).add(f);
  }
  removeEventListener(k, f) {
    this.listeners.get(k)?.delete(f);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    for (const f of this.listeners.get("message") ?? []) f({ data });
  }
  postMessage(data, transfers) {
    // 普通对象目录仅作测试替身；真实浏览器通过结构化克隆传递 FileSystemDirectoryHandle。
    // Plain directory objects are test doubles; real browsers structured-clone FileSystemDirectoryHandle.
    const root = data.root;
    const copy = structuredClone({ ...data, root: undefined }, { transfer: transfers });
    copy.root = root;
    this.messages.push(copy);
    queueMicrotask(() => this.run(copy, this));
  }
}
const proof = { type: "initialized", version: 1, astc: true, png: true, sha: true };
function receipt(bytes = Uint8Array.of(91, 93)) {
  const key = md5(bytes).slice(0, 18) + "0002" + "0".repeat(10);
  return {
    type: "complete",
    preset: "thorough",
    file: new File([bytes], "pack"),
    pack: {
      name: packName,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    records: [{ path, newEkey: key, encodedSize: bytes.length, decodedSize: bytes.length }],
    count: 1,
    index: `# pack\t${packName}\n${path}\t${key}\t${bytes.length}\t${bytes.length}\n`,
  };
}
function directory() {
  const entries = new Map();
  let removes = 0;
  return {
    entries,
    get removes() {
      return removes;
    },
    root: {
      kind: "directory",
      async getDirectoryHandle(name, options) {
        if (options?.create) {
          const child = { kind: "directory", isSameEntry: (other) => other === child };
          entries.set(name, child);
          return child;
        }
        if (!entries.has(name)) throw new DOMException("missing", "NotFoundError");
        return entries.get(name);
      },
      async removeEntry(name) {
        removes++;
        entries.delete(name);
      },
    },
  };
}
function romfsImage(files) {
  const entries = Object.entries(files),
    names = entries.map(([n]) => Buffer.from(n)),
    lengths = names.map((n) => 32 + Math.ceil(n.length / 4) * 4);
  const tableSize = lengths.reduce((a, b) => a + b, 0),
    start = 140 + tableSize,
    bytes = new Uint8Array(start + entries.reduce((n, [, b]) => n + b.length, 0)),
    v = new DataView(bytes.buffer);
  const u32 = (p, n) => v.setUint32(p, n, true),
    u64 = (p, n) => v.setBigUint64(p, BigInt(n), true);
  [80, 80, 4, 84, 52, 136, 4, 140, tableSize, start].forEach((n, i) => u64(i * 8, n));
  [0, 0xffffffff, 24, 0xffffffff, 0xffffffff, 0].forEach((n, i) => u32(84 + i * 4, n));
  [0, 0xffffffff, 0xffffffff, 0, 0xffffffff, 4].forEach((n, i) => u32(108 + i * 4, n));
  bytes.set(Buffer.from("data"), 132);
  let table = 0,
    data = 0;
  entries.forEach(([, body], i) => {
    const p = 140 + table,
      next = i === entries.length - 1 ? 0xffffffff : table + lengths[i];
    u32(p, 24);
    u32(p + 4, next);
    u64(p + 8, data);
    u64(p + 16, body.length);
    u32(p + 24, next);
    u32(p + 28, names[i].length);
    bytes.set(names[i], p + 32);
    bytes.set(body, start + data);
    table += lengths[i];
    data += body.length;
  });
  return bytes;
}
async function authenticated() {
  const body = Buffer.from("[]"),
    vfs = Buffer.from("synthetic-vfs"),
    block = Buffer.concat([Buffer.from("N"), vfs]),
    header = Buffer.alloc(36);
  header.write("BLTE");
  header.writeUInt32BE(36, 4);
  header[8] = 15;
  header[11] = 1;
  header.writeUInt32BE(block.length, 12);
  header.writeUInt32BE(vfs.length, 16);
  Buffer.from(md5(block), "hex").copy(header, 20);
  const encoded = Buffer.concat([header, block]),
    archive = Buffer.alloc(100 + encoded.length);
  archive.set(body);
  archive.set(encoded, 100);
  const ekey = md5(body).slice(0, 18) + "0".repeat(14),
    vkey = md5(header).slice(0, 18) + "0000" + (100).toString(16).padStart(10, "0");
  const row = ["0", "0", "0", "0", md5(body), 2, ekey, 2, "n", `data:${path}`, "0"].join("|");
  const config = `vfs-1 = ${md5(vfs)} ${vkey}\nvfs-1-size = ${vfs.length} ${encoded.length}\n`;
  const fixture = extractionFixture({
    romfs: romfsImage({
      "build_manifest.psv": Buffer.from(`header\n${row}\n`),
      ".build.config": Buffer.from(config),
      "00-00000000.data": archive,
    }),
  });
  const session = await open(fixture),
    extracted = await fixture.adapter.extractSelected({ session, selection });
  return { fixture, extracted };
}
const options = (root) => ({
  root,
  maxEncodedBytes: 10000,
  maxDecodedBytes: 10000,
  maxPackBytes: 10000,
  batchBlocks: 1,
});
test("verified initialization transfers four assets and rejects forged extraction before private work", async () => {
  const bytes = assets(),
    worker = new WorkerDouble((data, w) => {
      assert.equal(data.type, "initialize");
      w.emit(proof);
    });
  const client = await createAstcProducerClient({ worker, assets: bytes });
  assert.equal(client.initialized, true);
  assert.ok(bytes.every(([, b]) => b.byteLength === 0));
  await assert.rejects(
    client.produce({}, selection, options(directory().root)),
    /ASTC_PRODUCER_FAILED/,
  );
  assert.equal(worker.messages.length, 1);
  assert.ok(worker.terminated);
  await client.close();
});
test("range wrapper blocks reads outside authenticated record despite larger archive", async () => {
  let reads = 0;
  const bound = bindAstcRecordSource({
    source: {
      size: 1000n,
      readAt: (_at, n) => {
        reads++;
        return new Uint8Array(n);
      },
    },
    record: { offset: 100n, encodedSize: 10 },
  });
  assert.equal(bound.size, 1000n);
  await assert.rejects(bound.readAt(99n, 1), /READ_BOUNDS/);
  await assert.rejects(bound.readAt(109n, 2), /READ_BOUNDS/);
  await bound.readAt(100n, 10);
  assert.equal(reads, 1);
});
test("authenticated producer binds RPC and retains output lease until disposal", async () => {
  const auth = await authenticated(),
    dir = directory();
  let rpc;
  const worker = new WorkerDouble(async (data, w) => {
    if (data.type === "initialize") {
      w.emit(proof);
      return;
    }
    assert.equal(data.packName, packName);
    assert.equal(data.records.length, 1);
    assert.deepEqual(new TextDecoder().decode(data.vfs), "synthetic-vfs");
    rpc = createArchiveReadRpcClient(data.port);
    const source = rpc.open(data.records[0].source);
    const bytes = await source.readAt(0n, 2);
    assert.deepEqual([...bytes], [91, 93]);
    w.emit(receipt(bytes));
  });
  const client = await createAstcProducerClient({ worker, assets: assets() });
  const result = await client.produce(auth.extracted, selection, options(dir.root));
  assert.ok(worker.terminated);
  assert.equal(dir.entries.size, 1);
  assert.equal(result.count, 1);
  assert.deepEqual(result.encoding, { format: "astc", preset: "thorough" });
  assert.ok(Object.isFrozen(result.encoding));
  assert.deepEqual([...(await result.source.readAt(0, 2))], [91, 93]);
  await result.dispose();
  assert.equal(dir.removes, 1);
  await assert.rejects(result.source.readAt(0, 1), /DISPOSED/);
  await client.close();
  assert.equal(dir.removes, 1);
  rpc.close();
  await auth.fixture.adapter.cleanup();
});
test("real pack writer index header and metadata pass receipt validation", async () => {
  let chunks = [],
    size = 0;
  const output = await writeCascPack({
    jobs: (async function* () {
      yield {
        path,
        spec: "n",
        decodedSize: 2,
        source: (async function* () {
          yield Uint8Array.of(91, 93);
        })(),
      };
    })(),
    location: [0, 2],
    locationAvailable: () => true,
    root: {},
    maxPackBytes: 1000,
    expectedEntries: 1,
    codec: {
      genericZlibVersion: "1.2.13",
      compressZlibStream: () => {
        assert.fail();
      },
    },
    hashFile: async (file) => ({
      sha256: createHash("sha256")
        .update(new Uint8Array(await file.arrayBuffer()))
        .digest("hex"),
      bytesHashed: file.size,
    }),
    createStage: async () => ({
      append(bytes) {
        chunks.push(bytes);
        size += bytes.length;
      },
      async finalize() {
        const file = new File(chunks, "pack");
        return { file, size, readAt() {} };
      },
      dispose() {
        chunks = [];
      },
    }),
  });
  const value = {
    type: "complete",
    preset: "thorough",
    file: output.source.file,
    pack: output.pack,
    records: output.records,
    index: output.index,
    count: output.count,
  };
  assert.equal(
    validateAstcProducerReceipt(value, { paths: new Set([path]), packName, maxPackBytes: 1000 })
      .count,
    1,
  );
  for (const bad of [
    { ...value, index: value.index.replace(/^.*\n/, "") },
    { ...value, pack: { ...value.pack, name: "00-00000003.data" } },
    { ...value, count: 2 },
  ])
    assert.throws(
      () =>
        validateAstcProducerReceipt(bad, { paths: new Set([path]), packName, maxPackBytes: 1000 }),
      /RECEIPT/,
    );
});
test("worker requires initialization and rejects concurrent state transitions", async () => {
  const messages = [];
  let finish;
  const handler = createAstcProducerWorkerHandler({
    send: (data) => messages.push(data),
    initialize: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const initializing = handler({ type: "initialize", assets: [] });
  await tick();
  await handler({ type: "produce" });
  finish({});
  await initializing;
  assert.ok(messages.every((message) => message.type === "failure"));
});
test("malformed initialization and abort terminate without accepting private input", async () => {
  const worker = new WorkerDouble((_data, w) => w.emit({ ...proof, png: false }));
  await assert.rejects(createAstcProducerClient({ worker, assets: assets() }), /INITIALIZE/);
  assert.ok(worker.terminated);
  const controller = new AbortController(),
    waiting = new WorkerDouble(() => {});
  const pending = createAstcProducerClient({
    worker: waiting,
    assets: assets(),
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(waiting.terminated);
});

// 只有严格递增的真实工作收据续期；静默、重复进度和显式总期限均会停止作业。
// Only strictly advancing work receipts renew inactivity; silence, duplicate progress and explicit overall deadlines stop jobs.
test("validated progress renews inactivity without a silent overall deadline", async () => {
  const auth = await authenticated(),
    dir = directory();
  const timers = [],
    progress = [];
  const worker = new WorkerDouble((data, w) => {
    if (data.type === "initialize") {
      w.emit(proof);
      return;
    }
    for (let i = 1; i <= 6; i++)
      timers.push(
        setTimeout(() => w.emit({ type: "progress", sequence: i, bytes: i, blocks: 0 }), i * 20),
      );
    timers.push(setTimeout(() => w.emit(receipt()), 145));
  });
  const client = await createAstcProducerClient({ worker, assets: assets() });
  try {
    const result = await client.produce(auth.extracted, selection, {
      ...options(dir.root),
      inactivityTimeoutMs: 45,
      onProgress(value) {
        progress.push({ value, frozen: Object.isFrozen(value), at: performance.now() });
        if (progress.length === 1) throw new Error("observer");
        return Promise.reject(new Error("observer async"));
      },
    });
    assert.equal(result.count, 1);
    assert.ok(
      progress.every(
        (event) =>
          event.frozen &&
          !Object.hasOwn(event.value, "path") &&
          !Object.hasOwn(event.value, "ekey"),
      ),
    );
    assert.equal(progress[0].value.phase, "preparing");
    assert.equal(progress.at(-1).value.phase, "complete");
    const updates = progress.filter((event) => event.value.phase === "converting");
    assert.ok(updates.length >= 1);
    for (let i = 1; i < updates.length; i++) assert.ok(updates[i].at - updates[i - 1].at >= 99);
    await result.dispose();
  } finally {
    for (const timer of timers) clearTimeout(timer);
    await client.close();
    await auth.fixture.adapter.cleanup();
  }
});
test("stale progress, inactivity and explicit overall deadline terminate and clean", async () => {
  for (const mode of ["stale", "idle", "overall"]) {
    const auth = await authenticated(),
      dir = directory(),
      timers = [];
    const worker = new WorkerDouble((data, w) => {
      if (data.type === "initialize") {
        w.emit(proof);
        return;
      }
      if (mode === "stale") {
        w.emit({ type: "progress", sequence: 1, bytes: 1, blocks: 0 });
        w.emit({ type: "progress", sequence: 2, bytes: 1, blocks: 0 });
      } else if (mode === "overall")
        for (let i = 1; i <= 5; i++)
          timers.push(
            setTimeout(
              () => w.emit({ type: "progress", sequence: i, bytes: i, blocks: 0 }),
              i * 10,
            ),
          );
    });
    const client = await createAstcProducerClient({ worker, assets: assets() });
    try {
      await assert.rejects(
        client.produce(auth.extracted, selection, {
          ...options(dir.root),
          inactivityTimeoutMs: 40,
          ...(mode === "overall" ? { overallTimeoutMs: 25 } : {}),
        }),
        /ASTC_PRODUCER_FAILED/,
      );
      assert.ok(worker.terminated);
      assert.equal(dir.entries.size, 0);
    } finally {
      for (const timer of timers) clearTimeout(timer);
      await client.close();
      await auth.fixture.adapter.cleanup();
    }
  }
});
test("failed directory removal retains retryable lease and safe failure codes", async () => {
  const auth = await authenticated(),
    dir = directory(),
    remove = dir.root.removeEntry;
  let deny = true;
  dir.root.removeEntry = async (name) => {
    if (deny) throw new Error("private storage name");
    return remove(name);
  };
  const worker = new WorkerDouble((data, w) =>
    w.emit(data.type === "initialize" ? proof : { type: "failure", code: "CODEC_FAILED" }),
  );
  const client = await createAstcProducerClient({ worker, assets: assets() });
  let failure;
  try {
    await client.produce(auth.extracted, selection, options(dir.root));
  } catch (error) {
    failure = error;
  }
  assert.match(failure.message, /ASTC_PRODUCER_CLEANUP/);
  assert.ok(failure.lease);
  assert.ok(!failure.message.includes("private"));
  assert.equal(dir.entries.size, 1);
  deny = false;
  await client.close();
  assert.equal(dir.entries.size, 0);
  await auth.fixture.adapter.cleanup();
});

for (const preset of ["thorough", "fast"])
  test(`worker shares ${preset} across texture and thumbnail encoding and echoes receipt`, async () => {
    const messages = [],
      channel = new MessageChannel();
    const handler = createAstcProducerWorkerHandler({
      send: (data) => messages.push(data),
      initialize: async () => ({
        encode: (input) => {
          assert.equal(input.preset, preset);
          return new ArrayBuffer(16);
        },
        codec: {},
        hashFile: async (file) => ({ sha256: "a".repeat(64), bytesHashed: file.size }),
      }),
      core: (options) => ({
        maxEntries: 1,
        dispose: async () => {},
        jobs: (async function* () {
          await options.encode({
            width: 4,
            height: 4,
            rgba: new ArrayBuffer(64),
            profile: "linear",
          });
          await options.encode({ width: 4, height: 4, rgba: new ArrayBuffer(64), profile: "srgb" });
          yield 1;
        })(),
      }),
      writePack: async (options) => {
        for await (const ignored of options.jobs) assert.equal(ignored, 1);
        const value = receipt();
        await options.hashFile(value.file, {});
        return { source: { file: value.file }, ...value };
      },
    });
    await handler({ type: "initialize", assets: [] });
    await handler({
      type: "produce",
      preset,
      port: channel.port1,
      root: { kind: "directory" },
      vfs: new ArrayBuffer(1),
      records: [
        {
          path,
          record: { offset: 0n },
          source: { id: "12345678-1234-4123-8123-123456789abc", size: "2" },
        },
      ],
    });
    assert.equal(messages[0].type, "initialized");
    assert.deepEqual(messages[1], { type: "progress", sequence: 1, bytes: 0, blocks: 1 });
    assert.equal(messages.at(-1).type, "complete");
    assert.ok(messages.at(-1).file instanceof File);
    assert.equal(messages.at(-1).preset, preset);
    channel.port2.close();
  });

// 安全诊断只允许固定代码，未知错误中的私有文本不会被返回。
// Safe diagnostics allow only fixed codes; private text in unknown errors is never returned.
test("safe failure diagnostics whitelist quota, limits and integrity", () => {
  assert.equal(
    astcProducerFailureCode(new DOMException("private/path", "QuotaExceededError")),
    "STORAGE_QUOTA",
  );
  assert.equal(astcProducerFailureCode(new Error("CASC_PACK_PACK_SIZE")), "SIZE_LIMIT");
  assert.equal(astcProducerFailureCode(new Error("ARCHIVE_STREAM_CKEY")), "INTEGRITY_FAILED");
  assert.equal(astcProducerFailureCode(new Error("private/key")), "CODEC_FAILED");
});

// 预设只是内部编码选择，不改变外部数据认证边界。
// Presets select internal encoding only; they do not alter external authentication boundaries.
test("receipt rejects missing, wrong or unknown presets", () => {
  const value = receipt();
  const limits = { paths: new Set([path]), packName, maxPackBytes: 1000, preset: "fast" };
  assert.deepEqual(validateAstcProducerReceipt({ ...value, preset: "fast" }, limits).encoding, {
    format: "astc",
    preset: "fast",
  });
  for (const preset of [undefined, "thorough", "other", 1])
    assert.throws(() => validateAstcProducerReceipt({ ...value, preset }, limits), /RECEIPT/);
});
test("producer rejects unknown preset before authenticating or reading input", async () => {
  const worker = new WorkerDouble((_data, w) => w.emit(proof));
  const client = await createAstcProducerClient({ worker, assets: assets() });
  await assert.rejects(
    client.produce(null, null, { ...options(directory().root), preset: "other" }),
    /OPTIONS/,
  );
  assert.equal(worker.messages.length, 1);
  assert.ok(worker.terminated);
});
test("fast producer request and receipt stay bound", async () => {
  const auth = await authenticated(),
    dir = directory();
  const worker = new WorkerDouble((data, w) => {
    if (data.type === "initialize") return w.emit(proof);
    assert.equal(data.preset, "fast");
    w.emit({ ...receipt(), preset: "fast" });
  });
  const client = await createAstcProducerClient({ worker, assets: assets() });
  const result = await client.produce(auth.extracted, selection, {
    ...options(dir.root),
    preset: "fast",
  });
  assert.deepEqual(result.encoding, { format: "astc", preset: "fast" });
  await result.dispose();
  await auth.fixture.adapter.cleanup();
});

test("worker rejects unknown preset before opening record RPC or invoking codec", async () => {
  const messages = [];
  let invoked = false;
  const handler = createAstcProducerWorkerHandler({
    send: (value) => messages.push(value),
    initialize: async () => ({
      encode: () => {
        invoked = true;
      },
    }),
    core: () => {
      invoked = true;
    },
  });
  await handler({ type: "initialize", assets: [] });
  await handler({ type: "produce", preset: "other" });
  assert.equal(invoked, false);
  assert.equal(messages.at(-1).type, "failure");
});

for (const mode of ["cancel", "dispose", "short"])
  test(`producer wipes an owned File read rejected after fulfillment: ${mode}`, async () => {
    const auth = await authenticated(),
      dir = directory(),
      controller = new AbortController(),
      reason = new Error("synthetic read cancellation");
    const worker = new WorkerDouble((data, w) =>
      w.emit(data.type === "initialize" ? proof : receipt()),
    );
    const client = await createAstcProducerClient({ worker, assets: assets() });
    let captured, closing;
    try {
      const result = await client.produce(auth.extracted, selection, options(dir.root));
      result.source.file.slice = () => ({
        async arrayBuffer() {
          captured = mode === "short" ? Uint8Array.of(41) : Uint8Array.of(41, 42);
          if (mode === "cancel") controller.abort(reason);
          if (mode === "dispose") closing = result.dispose();
          return captured.buffer;
        },
      });
      await assert.rejects(result.source.readAt(0, 2, { signal: controller.signal }), (error) => {
        if (mode === "cancel") assert.equal(error, reason);
        else
          assert.equal(
            error.message,
            `ASTC_PRODUCER_${mode === "dispose" ? "DISPOSED" : "SHORT_READ"}`,
          );
        return true;
      });
      await closing;
      assert.ok(captured.every((byte) => byte === 0));
    } finally {
      await client.close();
      await auth.fixture.adapter.cleanup();
    }
  });

for (const mode of ["cancel", "timeout"])
  for (const settle of ["resolve", "reject"])
    test(`producer observes a late File ${settle} after ${mode}`, async (t) => {
      const auth = await authenticated(),
        dir = directory(),
        controller = new AbortController();
      const worker = new WorkerDouble((data, w) =>
        w.emit(data.type === "initialize" ? proof : receipt()),
      );
      const client = await createAstcProducerClient({ worker, assets: assets() });
      let resolve, reject;
      const pending = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      try {
        const result = await client.produce(auth.extracted, selection, options(dir.root));
        result.source.file.slice = () => ({ arrayBuffer: () => pending });
        if (mode === "timeout") t.mock.timers.enable({ apis: ["setTimeout"] });
        const reading = result.source.readAt(0, 2, { signal: controller.signal });
        if (mode === "cancel") controller.abort();
        else t.mock.timers.tick(30000);
        await assert.rejects(
          reading,
          mode === "cancel" ? { name: "AbortError" } : /ASTC_PRODUCER_READ_FAILED/,
        );
        const bytes = Uint8Array.of(41, 42);
        if (settle === "resolve") resolve(bytes.buffer);
        else reject(new Error("synthetic late File failure"));
        await tick();
        if (settle === "resolve") assert.ok(bytes.every((byte) => byte === 0));
      } finally {
        t.mock.timers.reset();
        await client.close();
        await auth.fixture.adapter.cleanup();
      }
    });

test("producer transfers successful File reads without wiping caller-owned bytes", async () => {
  const auth = await authenticated(),
    dir = directory();
  const worker = new WorkerDouble((data, w) =>
    w.emit(data.type === "initialize" ? proof : receipt()),
  );
  const client = await createAstcProducerClient({ worker, assets: assets() });
  try {
    const result = await client.produce(auth.extracted, selection, options(dir.root));
    const captured = Uint8Array.of(41, 42);
    result.source.file.slice = () => ({ arrayBuffer: async () => captured.buffer });
    const bytes = await result.source.readAt(0, 2);
    assert.equal(bytes.buffer, captured.buffer);
    await result.dispose();
    assert.deepEqual(bytes, Uint8Array.of(41, 42));
  } finally {
    await client.close();
    await auth.fixture.adapter.cleanup();
  }
});
