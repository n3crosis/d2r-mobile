// 纯合成清单与 RomFS；不含游戏内容或真实密钥。
// Synthetic manifests and RomFS only; no game content or real keys.
import assert from "node:assert/strict";
import test from "node:test";
import {
  createCascAstcRecords,
  createCascLogicalAssets,
  ASTC_MANIFEST_LIMITS,
} from "../casc-logical-reader.mjs";
import {
  enumerateAuthenticatedAstcRecords,
  openAuthenticatedAstcRecord,
} from "../extraction-job-adapter.mjs";
import { fixture, open, selection } from "./helpers/extraction-adapter-fixture.mjs";
const encoder = new TextEncoder();
const row = (path, offset = 0) =>
  [
    "0",
    "0",
    "0",
    "0",
    "a".repeat(32),
    "1",
    "0".repeat(22) + offset.toString(16).padStart(10, "0"),
    "1",
    "n",
    path,
    "0",
  ].join("|");
const manifest = (rows) => encoder.encode(`header\n${rows.join("\n")}\n`);
function source(bytes) {
  const reads = [];
  return {
    reads,
    getFile(path) {
      const data = path === "data/build_manifest.psv" ? bytes : Uint8Array.of(11, 22);
      return {
        size: BigInt(data.length),
        readAt(offset, count) {
          reads.push({ path, count });
          return data.slice(Number(offset), Number(offset) + count);
        },
      };
    },
  };
}
function image(bytes) {
  const names = ["build_manifest.psv", "00-00000000.data"].map((v) => encoder.encode(v));
  const lengths = names.map((v) => 32 + Math.ceil(v.length / 4) * 4);
  const fileStart = 140,
    dataStart = fileStart + lengths[0] + lengths[1];
  const result = new Uint8Array(dataStart + bytes.length + 2),
    view = new DataView(result.buffer);
  const u32 = (p, v) => view.setUint32(p, v, true),
    u64 = (p, v) => view.setBigUint64(p, BigInt(v), true);
  [80, 80, 4, 84, 52, 136, 4, 140, lengths[0] + lengths[1], dataStart].forEach((v, i) =>
    u64(i * 8, v),
  );
  [0, 0xffffffff, 24, 0xffffffff, 0xffffffff, 0].forEach((v, i) => u32(84 + i * 4, v));
  [0, 0xffffffff, 0xffffffff, 0, 0xffffffff, 4].forEach((v, i) => u32(108 + i * 4, v));
  result.set(encoder.encode("data"), 132);
  let position = fileStart;
  for (let i = 0; i < 2; i++) {
    u32(position, 24);
    u32(position + 4, i === 0 ? lengths[0] : 0xffffffff);
    u64(position + 8, i === 0 ? 0 : bytes.length);
    u64(position + 16, i === 0 ? bytes.length : 2);
    u32(position + 24, i === 0 ? lengths[0] : 0xffffffff);
    u32(position + 28, names[i].length);
    result.set(names[i], position + 32);
    position += lengths[i];
  }
  result.set(bytes, dataStart);
  result.set([11, 22], dataStart + bytes.length);
  return result;
}
test("ASTC first normalized row and descriptor differ from unchanged generic last row", async () => {
  const bytes = manifest([
    row("data:DATA/A.texture"),
    row("data:data/a.texture", 1),
    row("DATA:data/hd/texture_desc_cache.json"),
    row("data:data/hd/texture_desc_cache.json", 1),
  ]);
  const romfs = source(bytes),
    astc = await createCascAstcRecords(romfs),
    generic = await createCascLogicalAssets(romfs);
  assert.deepEqual([...astc.entries()], ["data/a.texture", "data/hd/texture_desc_cache.json"]);
  assert.equal(astc.open("data/a.texture").record.offset, 0n);
  assert.equal(astc.open("data/hd/texture_desc_cache.json").record.offset, 0n);
  assert.ok(generic.lookup("data/a.texture")[6].endsWith("01"));
  const opened = astc.open("data/a.texture");
  assert.deepEqual(await opened.source.readAt(0n, 1), Uint8Array.of(11));
  await assert.rejects(opened.source.readAt(0n, 65537), /extent/);
  await assert.rejects(opened.source.readAt(1n, 1), /extent/);
  assert.ok(romfs.reads.every(({ count }) => count <= 65536));
});
test("ASTC scan bounds reads, count, retained metadata, paths and cancellation", async () => {
  const romfs = source(
    manifest(Array.from({ length: 1000 }, (_, i) => row(`data:data/${i}.texture`))),
  );
  assert.equal([...(await createCascAstcRecords(romfs)).entries()].length, 1000);
  assert.ok(romfs.reads.length > 1 && romfs.reads.every(({ count }) => count <= 65536));
  await assert.rejects(
    createCascAstcRecords(
      source(
        manifest(
          Array.from({ length: ASTC_MANIFEST_LIMITS.records + 1 }, (_, i) =>
            row(`data:data/${i}.texture`),
          ),
        ),
      ),
    ),
    /metadata budget/,
  );
  await assert.rejects(
    createCascAstcRecords(
      source(
        manifest(
          Array.from({ length: 2200 }, (_, i) => row(`data:data/${"x".repeat(3900)}${i}.texture`)),
        ),
      ),
    ),
    /metadata budget/,
  );
  await assert.rejects(
    createCascAstcRecords(source(manifest([row("data:data/../a.texture")]))),
    /unsafe/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createCascAstcRecords(romfs, { signal: controller.signal }), /abort/i);
});
test("authenticated tokens reject copies, wrong selection, and revoked sessions", async () => {
  const f = fixture({
    romfs: image(
      manifest([
        row("data:data/a.texture"),
        row("data:data/a.texture", 1),
        row("data:data/hd/texture_desc_cache.json"),
      ]),
    ),
  });
  const session = await open(f),
    extracted = await f.adapter.extractSelected({ session, selection });
  await assert.rejects(
    enumerateAuthenticatedAstcRecords({ ...extracted }, selection),
    /PROVENANCE/,
  );
  await assert.rejects(
    enumerateAuthenticatedAstcRecords(extracted, { ...selection, effectiveVersion: 999 }),
    /PROVENANCE/,
  );
  const records = await enumerateAuthenticatedAstcRecords(extracted, selection);
  assert.equal(records.textures.length, 1);
  assert.ok(records.descriptor);
  const token = records.textures[0];
  assert.throws(() => openAuthenticatedAstcRecord({ ...token }), /PROVENANCE/);
  assert.throws(
    () => openAuthenticatedAstcRecord({ path: token.path, authenticated: true }),
    /PROVENANCE/,
  );
  const opened = openAuthenticatedAstcRecord(token);
  assert.deepEqual(await opened.source.readAt(0n, 1), Uint8Array.of(11));
  await session.dispose();
  assert.throws(() => openAuthenticatedAstcRecord(token), /DISPOSED/);
  await assert.rejects(opened.source.readAt(0n, 1), /DISPOSED/);
  await f.adapter.cleanup();
});
test("enumeration cancellation revokes retained tokens even without a read", async () => {
  const f = fixture({ romfs: image(manifest([row("data:data/a.texture")])) }),
    session = await open(f);
  const extracted = await f.adapter.extractSelected({ session, selection }),
    controller = new AbortController();
  const { textures } = await enumerateAuthenticatedAstcRecords(extracted, selection, {
    signal: controller.signal,
  });
  const opened = openAuthenticatedAstcRecord(textures[0]);
  controller.abort();
  assert.throws(() => openAuthenticatedAstcRecord(textures[0]), /abort/i);
  await assert.rejects(opened.source.readAt(0n, 1), /abort/i);
  await f.adapter.cleanup();
});

test("native ASTC considers the first physical row and rejects malformed locator metadata", async () => {
  const astc = await createCascAstcRecords(source(encoder.encode(row("data:data/a.texture"))));
  assert.deepEqual([...astc.entries()], ["data/a.texture"]);
  for (const [field, value, error] of [
    [1, "1", /key layout/],
    [2, "1", /mismatch/],
    [5, "4294967296", /record size/],
    [7, "3", /extent/],
    [4, "bad", /CKey/],
  ]) {
    const fields = row("data:data/a.texture").split("|");
    fields[field] = value;
    const records = await createCascAstcRecords(source(manifest([fields.join("|")])));
    assert.throws(() => records.open("data/a.texture"), error);
  }
});

test("canceling a pending trusted record read closes the extraction session", async () => {
  const f = fixture({ romfs: image(manifest([row("data:data/a.texture")])) }),
    session = await open(f);
  const extracted = await f.adapter.extractSelected({ session, selection });
  const { textures } = await enumerateAuthenticatedAstcRecords(extracted, selection);
  const opened = openAuthenticatedAstcRecord(textures[0]),
    controller = new AbortController();
  f.worker.handler = undefined;
  const pending = opened.source.readAt(0n, 1, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /DISPOSED/);
  assert.equal(f.worker.terminated, true);
  assert.throws(() => openAuthenticatedAstcRecord(textures[0]), /DISPOSED/);
  await f.adapter.cleanup();
});
