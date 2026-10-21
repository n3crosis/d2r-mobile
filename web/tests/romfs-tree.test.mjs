import test from "node:test";
import assert from "node:assert/strict";
import { indexRomfs, ROMFS_LIMITS } from "../romfs-tree.mjs";

const EMPTY = 0xffffffff;
const encoder = new TextEncoder();
const align = (n) => Math.ceil(n / 4) * 4;
function fixture({ dataOffset = 256n, size = 8n, name = "hello.bin", directory = null } = {}) {
  const encoded = encoder.encode(name);
  const dirName = encoder.encode(directory ?? "");
  const dirSize = directory === null ? 24 : 48 + align(dirName.length);
  const dirStart = 84;
  const fileHashStart = dirStart + dirSize;
  const fileStart = fileHashStart + 4;
  const fileSize = 32 + align(encoded.length);
  const bytes = new Uint8Array(fileStart + fileSize);
  const view = new DataView(bytes.buffer);
  const set32 = (p, v) => view.setUint32(p, v, true);
  const set64 = (p, v) => view.setBigUint64(p, BigInt(v), true);
  [80, 80, 4, dirStart, dirSize, fileHashStart, 4, fileStart, fileSize, dataOffset].forEach(
    (v, i) => set64(i * 8, v),
  );
  set32(80, 0);
  set32(fileHashStart, 0);
  set32(dirStart, 0);
  set32(dirStart + 4, EMPTY);
  set32(dirStart + 8, directory === null ? EMPTY : 24);
  set32(dirStart + 12, directory === null ? 0 : EMPTY);
  set32(dirStart + 16, EMPTY);
  if (directory !== null) {
    const p = dirStart + 24;
    set32(p, 0);
    set32(p + 4, EMPTY);
    set32(p + 8, EMPTY);
    set32(p + 12, 0);
    set32(p + 16, EMPTY);
    set32(p + 20, dirName.length);
    bytes.set(dirName, p + 24);
  }
  set32(fileStart, directory === null ? 0 : 24);
  set32(fileStart + 4, EMPTY);
  set64(fileStart + 8, 0);
  set64(fileStart + 16, size);
  set32(fileStart + 24, EMPTY);
  set32(fileStart + 28, encoded.length);
  bytes.set(encoded, fileStart + 32);
  const reads = [];
  const source = {
    size: dataOffset + size,
    async readAt(offset, count) {
      reads.push([offset, count]);
      assert.ok(count <= ROMFS_LIMITS.readBytes);
      if (offset < BigInt(bytes.length)) return bytes.slice(Number(offset), Number(offset) + count);
      assert.ok(offset >= dataOffset, "no metadata gap/hash table scanning");
      return new Uint8Array(count).fill(0x5a);
    },
  };
  return {
    source,
    bytes,
    view,
    set32,
    set64,
    reads,
    dirStart,
    fileStart,
    fileHashStart,
    dataOffset,
  };
}

test("indexes nested synthetic RomFS without reading payload; lazy bounded reads retain BigInt offsets", async () => {
  const f = fixture({ directory: "rom", dataOffset: 2n ** 54n, size: 2n ** 40n });
  const index = await indexRomfs(f.source);
  assert.deepEqual(index.directories, ["", "rom"]);
  assert.equal(index.files.length, 1);
  assert.ok(f.reads.every(([offset]) => offset < 256n));
  const member = index.getFile("rom/hello.bin");
  assert.equal(member.size, 2n ** 40n);
  assert.ok(Object.isFrozen(index) && Object.isFrozen(index.files) && Object.isFrozen(member));
  assert.deepEqual(await member.readAt(2n ** 39n, 3), new Uint8Array([90, 90, 90]));
  assert.deepEqual(f.reads.at(-1), [2n ** 54n + 2n ** 39n, 3]);
  await assert.rejects(member.readAt(0n, 65537), /read limit/);
  await assert.rejects(member.readAt(member.size, 1), /out of bounds/);
  await assert.rejects(member.readAt(-1n, 1), /out of bounds/);
  await assert.rejects(member.readAt(0, 1), /read limit/);
  assert.equal((await member.readAt(member.size, 0)).length, 0);
});

test("indexes RomFS metadata stored after file data and rejects overlap", async () => {
  const original = fixture({ dataOffset: 512n, size: 8n });
  const metadataStart = 520;
  const bytes = new Uint8Array(metadataStart + original.bytes.length - 80);
  bytes.set(original.bytes.subarray(0, 80));
  bytes.fill(0x5a, 512, metadataStart);
  bytes.set(original.bytes.subarray(80), metadataStart);
  const view = new DataView(bytes.buffer);
  for (const at of [8, 24, 40, 56])
    view.setBigUint64(at, view.getBigUint64(at, true) + BigInt(metadataStart - 80), true);
  const source = {
    size: BigInt(bytes.length),
    readAt: async (offset, count) => bytes.slice(Number(offset), Number(offset) + count),
  };
  const index = await indexRomfs(source);
  assert.equal(index.files.length, 1);
  assert.deepEqual(await index.files[0].readAt(0n, 8), new Uint8Array(8).fill(0x5a));
  view.setBigUint64(metadataStart + original.fileStart - 80 + 16, 12n, true);
  await assert.rejects(indexRomfs(source), /file data and metadata overlap/);
});

test("rejects malformed header/table sizes before bulk reads", async () => {
  for (const change of [
    (f) => f.set64(0, 79),
    (f) => f.set64(24, 85),
    (f) => f.set64(56, 84),
    (f) => f.set64(72, 85),
    (f) => {
      f.set64(32, ROMFS_LIMITS.metadataBytes);
      f.set64(72, 2n ** 40n);
      f.source.size = 2n ** 41n;
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(indexRomfs(f.source), /Invalid RomFS/);
    assert.ok(f.reads.length <= 1);
  }
  await assert.rejects(indexRomfs({ size: 80, readAt() {} }), /reader contract/);
  const f = fixture();
  f.source.readAt = async () => new Uint8Array(0);
  await assert.rejects(indexRomfs(f.source), /short read/);
});

test("rejects cycles, bad parents, invalid links and unreachable records", async () => {
  for (const change of [
    (f) => f.set32(f.dirStart + 8, 0),
    (f) => f.set32(f.dirStart + 4, 0),
    (f) => f.set32(f.dirStart + 8, 3),
    (f) => f.set32(f.dirStart + 8, 24),
    (f) => f.set32(f.fileStart + 4, 0),
    (f) => f.set32(f.fileStart, 24),
    (f) => f.set32(f.fileStart + 4, 4),
    (f) => f.set32(f.dirStart + 12, EMPTY),
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(indexRomfs(f.source), /Invalid RomFS/);
  }
});

test("rejects unsafe names, oversized names and invalid UTF-8", async () => {
  for (const name of [
    "",
    ".",
    "..",
    "../x",
    "a/b",
    "a\\b",
    "C:x",
    "nul.txt",
    "x ",
    "x.",
    "x\0y",
    "e\u0301",
  ]) {
    await assert.rejects(indexRomfs(fixture({ name }).source), /Invalid RomFS/);
  }
  const f = fixture();
  f.bytes[f.fileStart + 32] = 0xff;
  await assert.rejects(indexRomfs(f.source), /UTF-8/);
  const large = fixture();
  large.set32(large.fileStart + 28, 256);
  await assert.rejects(indexRomfs(large.source), /name limit/);
});

test("rejects out-of-image data and metadata/name extents", async () => {
  const f = fixture();
  f.set64(f.fileStart + 16, 100);
  await assert.rejects(indexRomfs(f.source), /file data out of bounds/);
  const n = fixture();
  n.set32(n.fileStart + 28, 255);
  await assert.rejects(indexRomfs(n.source), /record name out of bounds/);
});

test("checks cancellation before/after asynchronous reads and on lazy reads", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const f = fixture();
  await assert.rejects(indexRomfs(f.source, { signal: controller.signal }), /cancelled/);
  assert.equal(f.reads.length, 0);
  const next = new AbortController();
  const original = f.source.readAt;
  f.source.readAt = async (...args) => {
    const bytes = await original(...args);
    next.abort(new Error("during read"));
    return bytes;
  };
  await assert.rejects(indexRomfs(f.source, { signal: next.signal }), /during read/);
  const index = await indexRomfs(fixture().source);
  await assert.rejects(index.files[0].readAt(0n, 1, { signal: controller.signal }), /cancelled/);
  const lifetime = new AbortController();
  const lifetimeIndex = await indexRomfs(fixture().source, { signal: lifetime.signal });
  lifetime.abort(new Error("closed"));
  await assert.rejects(lifetimeIndex.files[0].readAt(0n, 1), /closed/);
});

test("copies lazy bytes so reusable reader buffers cannot mutate prior results", async () => {
  const f = fixture();
  const original = f.source.readAt;
  const scratch = new Uint8Array([1, 2, 3]);
  f.source.readAt = (offset, count) => (offset >= f.dataOffset ? scratch : original(offset, count));
  const index = await indexRomfs(f.source);
  const result = await index.files[0].readAt(0n, 3);
  scratch.fill(0);
  assert.deepEqual(result, new Uint8Array([1, 2, 3]));
});

function multipleFiles({ secondName = "other.bin", secondOffset = 8n } = {}) {
  const f = fixture({ dataOffset: 512n, size: 16n });
  const firstSize = f.bytes.length - f.fileStart;
  const name = encoder.encode(secondName);
  const bytes = new Uint8Array(f.bytes.length + 32 + align(name.length));
  bytes.set(f.bytes);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(64, BigInt(bytes.length - f.fileStart), true);
  view.setUint32(f.fileStart + 4, firstSize, true);
  view.setBigUint64(f.fileStart + 16, 8n, true);
  const second = f.bytes.length;
  view.setUint32(second + 4, EMPTY, true);
  view.setBigUint64(second + 8, secondOffset, true);
  view.setBigUint64(second + 16, 8n, true);
  view.setUint32(second + 24, EMPTY, true);
  view.setUint32(second + 28, name.length, true);
  bytes.set(name, second + 32);
  return {
    size: 528n,
    readAt: async (offset, count) => bytes.slice(Number(offset), Number(offset) + count),
  };
}

test("rejects duplicate/case-colliding paths and overlapping nonempty payloads", async () => {
  const normal = await indexRomfs(multipleFiles());
  assert.equal(normal.files.length, 2);
  for (const secondName of ["hello.bin", "HELLO.BIN"])
    await assert.rejects(indexRomfs(multipleFiles({ secondName })), /duplicate path/);
  await assert.rejects(indexRomfs(multipleFiles({ secondOffset: 7n })), /file data overlap/);
  // Root-level file and directory with the same name share one namespace.
  const f = fixture({ directory: "hello.bin", name: "hello.bin" });
  f.set32(f.dirStart + 12, 0);
  f.set32(f.dirStart + 24 + 12, EMPTY);
  f.set32(f.fileStart, 0);
  await assert.rejects(indexRomfs(f.source), /duplicate path/);
});

function directoryChain(depth, nameLength = 1) {
  const recordSize = 24 + align(nameLength);
  const tableSize = 24 + recordSize * depth;
  const dirStart = 84,
    hashStart = dirStart + tableSize,
    end = hashStart + 4;
  const bytes = new Uint8Array(end),
    view = new DataView(bytes.buffer);
  [80, 80, 4, dirStart, tableSize, hashStart, 4, end, 0, end].forEach((v, i) =>
    view.setBigUint64(i * 8, BigInt(v), true),
  );
  for (let i = 0; i <= depth; i++) {
    const offset = i === 0 ? 0 : 24 + (i - 1) * recordSize;
    const parent = i <= 1 ? 0 : 24 + (i - 2) * recordSize;
    const start = dirStart + offset;
    view.setUint32(start, parent, true);
    view.setUint32(start + 4, EMPTY, true);
    view.setUint32(start + 8, i === depth ? EMPTY : i === 0 ? 24 : offset + recordSize, true);
    view.setUint32(start + 12, EMPTY, true);
    view.setUint32(start + 16, EMPTY, true);
    view.setUint32(start + 20, i === 0 ? 0 : nameLength, true);
    if (i) bytes.fill(0x61, start + 24, start + 24 + nameLength);
  }
  return {
    size: BigInt(end),
    readAt: async (offset, count) => bytes.slice(Number(offset), Number(offset) + count),
  };
}

test("rejects deep and overlong paths without recursive traversal", async () => {
  assert.equal((await indexRomfs(directoryChain(64))).directories.length, 65);
  await assert.rejects(indexRomfs(directoryChain(65)), /depth limit/);
  await assert.rejects(indexRomfs(directoryChain(17, 255)), /path budget/);
});

// 所有四个元数据表均不得与非空文件相交；零长度范围仍不占用空间。
// All four metadata tables reject nonempty file intersections; empty extents still occupy no space.
test("file extents reject each metadata table, but allow empty tables and empty files", async () => {
  for (const tableAt of [8, 24, 40, 56]) {
    const f = fixture({ dataOffset: 80n, size: 1n });
    f.source.size = 1024n;
    const tableStart = f.view.getBigUint64(tableAt, true);
    f.set64(f.fileStart + 8, tableStart - 80n);
    await assert.rejects(indexRomfs(f.source), /file data and metadata overlap/);
    f.set64(f.fileStart + 16, 0n);
    assert.equal((await indexRomfs(f.source)).files[0].size, 0n);
  }
  const f = fixture({ dataOffset: 256n });
  f.set64(8, 260n);
  f.set64(16, 0n);
  f.set64(40, 260n);
  f.set64(48, 0n);
  assert.equal((await indexRomfs(f.source)).files.length, 1);
});
