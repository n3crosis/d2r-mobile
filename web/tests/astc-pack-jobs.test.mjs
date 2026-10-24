// 合成内核输入及编码器替身；不宣称它们具有提取认证来源。
// Synthetic core inputs and encoder doubles; they do not claim authenticated extraction provenance.
import assert from "node:assert/strict";
import test from "node:test";
import {
  fixture as extractionFixture,
  open,
  selection,
} from "./helpers/extraction-adapter-fixture.mjs";
import { createHash } from "node:crypto";
import { createAstcPackJobsCore, createAuthenticatedAstcPackJobs } from "../astc-pack-jobs.mjs";
import { readAuthenticatedCascVfs } from "../casc-overlay-writer.mjs";
const md5 = (b) => createHash("md5").update(b).digest("hex");
function texture(format) {
  const b = new Uint8Array(64);
  b[4] = format;
  new DataView(b.buffer).setUint32(40, 8, true);
  return b;
}
function fixture({
  signal,
  encode = async ({ width, height }) => new Uint8Array(width * height).buffer,
  dependencies = {},
} = {}) {
  const payloads = [
    texture(0x3d),
    texture(2),
    texture(0x3e),
    new TextEncoder().encode(
      JSON.stringify([
        { filename: "data/a.texture", format: 61 },
        { filename: "data/c.texture", format: 62 },
      ]),
    ),
  ];
  const paths = [
    "data/a.texture",
    "data/b.texture",
    "data/c.texture",
    "data/hd/texture_desc_cache.json",
  ];
  const tokens = paths.map((path) => ({ path }));
  const records = payloads.map((b, i) => ({
    offset: BigInt(i * 1000),
    encodedSize: b.length,
    decodedSize: b.length,
    encoding: "n",
    ckey: md5(b),
    ekey: md5(b).slice(0, 18) + "0000" + (i * 1000).toString(16).padStart(10, "0"),
  }));
  const vfs = new Uint8Array(46 + 25 * 4 + 2),
    v = new DataView(vfs.buffer);
  vfs.set([84, 86, 70, 83, 1, 46, 16, 0]);
  v.setUint32(8, 10);
  v.setUint32(12, 46);
  v.setUint32(20, 46);
  v.setUint32(28, 46);
  v.setUint32(32, 100);
  v.setUint32(38, 146);
  v.setUint32(42, 2);
  vfs[146] = 110;
  records.forEach((r, i) => {
    const p = 46 + i * 25;
    vfs.set(Buffer.from(r.ekey, "hex"), p);
    v.setUint32(p + 16, r.encodedSize);
    v.setUint32(p + 21, r.decodedSize);
  });
  const state = { created: 0, disposed: 0, active: 0, peak: 0, opens: [] };
  const createStage = async () => {
    state.created++;
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    let parts = [],
      data,
      disposed = false;
    return {
      async append(b) {
        parts.push(b.slice());
      },
      async finalize() {
        data = Buffer.concat(parts);
        parts = [];
        return {
          file: new Blob([data]),
          size: data.length,
          async readAt(at, count) {
            return new Uint8Array(data.subarray(at, at + count));
          },
        };
      },
      async dispose() {
        if (!disposed) {
          disposed = true;
          state.disposed++;
          state.active--;
          data?.fill(0);
          parts = [];
        }
      },
    };
  };
  const header = Buffer.alloc(36),
    block = Buffer.concat([Buffer.from("N"), vfs]);
  header.write("BLTE");
  header.writeUInt32BE(36, 4);
  header[8] = 15;
  header[11] = 1;
  header.writeUInt32BE(block.length, 12);
  header.writeUInt32BE(vfs.length, 16);
  Buffer.from(md5(block), "hex").copy(header, 20);
  const encoded = Buffer.concat([header, block]),
    archive = Buffer.alloc(4000 + encoded.length);
  payloads.forEach((b, i) => archive.set(b, i * 1000));
  archive.set(encoded, 4000);
  const vfsKey = md5(header).slice(0, 18) + "0000" + (4000).toString(16).padStart(10, "0");
  const config = `vfs-1 = ${md5(vfs)} ${vfsKey}\nvfs-1-size = ${vfs.length} ${encoded.length}\n`;
  const manifest =
    "header\n" +
    records
      .map((r, i) =>
        [
          "0",
          "0",
          "0",
          "0",
          r.ckey,
          r.decodedSize,
          r.ekey,
          r.encodedSize,
          "n",
          `data:${paths[i]}`,
          "0",
        ].join("|"),
      )
      .join("\n") +
    "\n";
  const files = {
    "build_manifest.psv": Buffer.from(manifest),
    ".build.config": Buffer.from(config),
    "00-00000000.data": archive,
  };
  const core = createAstcPackJobsCore(
    {
      selected: { textures: tokens.slice(0, 3), descriptor: tokens[3] },
      vfs,
      openRecord(token) {
        const i = tokens.indexOf(token);
        state.opens.push(i);
        return {
          record: records[i],
          source: {
            size: records[i].offset + BigInt(payloads[i].length),
            async readAt(at, count) {
              return payloads[i].slice(
                Number(at - records[i].offset),
                Number(at - records[i].offset) + count,
              );
            },
          },
        };
      },
      root: {},
      maxEncodedBytes: 10000,
      maxDecodedBytes: 10000,
      batchBlocks: 1,
      encode,
      signal,
      createStage,
    },
    dependencies,
  );
  return { core, state, files, createStage, encode };
}
async function consume(source) {
  const parts = [];
  for await (const bytes of source) parts.push(bytes.slice());
  return Buffer.concat(parts);
}
test("one verified stage at a time, skip once, descriptor last with converted paths", async () => {
  const { core, state } = fixture(),
    jobs = [];
  for await (const job of core.jobs) {
    jobs.push({ path: job.path, bytes: await consume(job.source) });
    assert.equal(state.active, 0);
  }
  assert.equal(core.maxEntries, 4);
  assert.equal(jobs.length, 3);
  assert.deepEqual(state.opens, [0, 1, 2, 3]);
  assert.equal(state.created, 4);
  assert.equal(state.disposed, 4);
  assert.equal(state.peak, 1);
  assert.equal(jobs[0].bytes[4], 95);
  assert.equal(jobs[1].bytes[4], 81);
  assert.deepEqual(
    JSON.parse(jobs[2].bytes).map((v) => v.format),
    [95, 81],
  );
});
test("outer return, unconsumed advance, and paused abort dispose current stage", async () => {
  for (const mode of ["return", "advance", "abort"]) {
    const controller = new AbortController(),
      { core, state } = fixture({ signal: controller.signal }),
      it = core.jobs[Symbol.asyncIterator]();
    await it.next();
    assert.equal(state.active, 1);
    if (mode === "return") await it.return();
    if (mode === "advance") await assert.rejects(it.next(), /SOURCE_NOT_CONSUMED/);
    if (mode === "abort") {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(state.active, 0);
      await it.return();
    }
    assert.equal(state.disposed, 1);
  }
});
test("conversion failure retains primary error and cleans staged bytes", async () => {
  const { core, state } = fixture({
      encode: async () => {
        throw new Error("synthetic encoder failure");
      },
    }),
    it = core.jobs[Symbol.asyncIterator](),
    job = (await it.next()).value;
  await assert.rejects(consume(job.source), /conversion failed/);
  await it.return();
  assert.equal(state.active, 0);
});
test("unstarted disposal and fake extraction identities cannot open production facade", async () => {
  const { core, state } = fixture();
  await core.dispose();
  await assert.rejects(core.jobs[Symbol.asyncIterator]().next(), /abort/i);
  assert.equal(state.created, 0);
  await assert.rejects(
    createAuthenticatedAstcPackJobs(
      {},
      {},
      {
        root: {},
        maxEncodedBytes: 100,
        maxDecodedBytes: 100,
        batchBlocks: 1,
        encode: async () => {},
      },
    ),
    /PROVENANCE/,
  );
  await assert.rejects(readAuthenticatedCascVfs({}, {}), /PROVENANCE/);
});

function romfsImage(files) {
  const entries = Object.entries(files),
    names = entries.map(([name]) => Buffer.from(name)),
    lengths = names.map((b) => 32 + Math.ceil(b.length / 4) * 4);
  const tableSize = lengths.reduce((a, b) => a + b, 0),
    dataStart = 140 + tableSize;
  const bytes = new Uint8Array(dataStart + entries.reduce((n, [, b]) => n + b.length, 0)),
    view = new DataView(bytes.buffer);
  const u32 = (p, n) => view.setUint32(p, n, true),
    u64 = (p, n) => view.setBigUint64(p, BigInt(n), true);
  [80, 80, 4, 84, 52, 136, 4, 140, tableSize, dataStart].forEach((n, i) => u64(i * 8, n));
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
    bytes.set(body, dataStart + data);
    table += lengths[i];
    data += body.length;
  });
  return bytes;
}
test("authenticated facade obtains config/TVFS itself and emits the same synthetic jobs", async () => {
  const f = fixture();
  await f.core.dispose();
  const extraction = extractionFixture({ romfs: romfsImage(f.files) }),
    session = await open(extraction);
  const extracted = await extraction.adapter.extractSelected({ session, selection });
  const producer = await createAuthenticatedAstcPackJobs(extracted, selection, {
    root: {},
    maxEncodedBytes: 10000,
    maxDecodedBytes: 10000,
    batchBlocks: 1,
    encode: f.encode,
    createStage: f.createStage,
  });
  const paths = [];
  for await (const job of producer.jobs) {
    await consume(job.source);
    paths.push(job.path);
  }
  assert.deepEqual(paths, ["data/a.texture", "data/c.texture", "data/hd/texture_desc_cache.json"]);
  assert.equal(f.state.peak, 1);
  assert.equal(f.state.disposed, 4);
  await producer.dispose();
  await extraction.adapter.cleanup();
});

// 兼容重导出必须指向同一内核，而非包装或复制父级认证实现。
// Compatibility reexports must identify the same core, not wrap or duplicate parent authentication.
test("facade reexports the standalone core and cleanup limit unchanged", async () => {
  const facade = await import("../astc-pack-jobs.mjs");
  const core = await import("../astc-pack-jobs-core.mjs");
  assert.equal(facade.createAstcPackJobsCore, core.createAstcPackJobsCore);
  assert.equal(facade.ASTC_JOB_CLEANUP_WAIT_MS, core.ASTC_JOB_CLEANUP_WAIT_MS);
});
