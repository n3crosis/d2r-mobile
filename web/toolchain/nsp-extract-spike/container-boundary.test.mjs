// 依据合成 PFS0 数据验证容器索引的格式与范围约束。
// Verify container-index format and range constraints using synthetic PFS0 data.
import test from "node:test";
import assert from "node:assert/strict";
import { indexPfs0, blobReader } from "./container-boundary.mjs";
function fixture(name = "content.nca", offset = 0n, size = 3n) {
  const names = new TextEncoder().encode(name + "\0");
  const bytes = new Uint8Array(40 + names.length);
  bytes.set([80, 70, 83, 48]);
  const v = new DataView(bytes.buffer);
  v.setUint32(4, 1, true);
  v.setUint32(8, names.length, true);
  v.setBigUint64(16, offset, true);
  v.setBigUint64(24, size, true);
  bytes.set(names, 40);
  return bytes;
}
test("synthetic entry beyond 4GiB is indexed without reading payload", async () => {
  const header = fixture("synthetic.nca", 5n * 1024n ** 3n);
  let totalRead = 0;
  const size = BigInt(header.length) + 5n * 1024n ** 3n + 3n;
  const entries = await indexPfs0(async (at, count) => {
    totalRead += count;
    return header.slice(Number(at), Number(at) + count);
  }, size);
  assert.equal(entries[0].offset, size - 3n);
  assert.equal(totalRead, header.length);
});
test("small Blob adapter reads metadata only", async () => {
  const header = fixture();
  const blob = new Blob([header, new Uint8Array(3)]);
  assert.equal((await indexPfs0(blobReader(blob), BigInt(blob.size)))[0].name, "content.nca");
});
test("rejects traversal, truncated payload, and oversized metadata", async () => {
  for (const name of ["../x", "a\\b", "/x"]) {
    const h = fixture(name);
    await assert.rejects(
      indexPfs0(async (a, n) => h.slice(Number(a), Number(a) + n), BigInt(h.length + 3)),
    );
  }
  const h = fixture();
  await assert.rejects(
    indexPfs0(async (a, n) => h.slice(Number(a), Number(a) + n), BigInt(h.length)),
  );
  new DataView(h.buffer).setUint32(4, 0xffffffff, true);
  await assert.rejects(indexPfs0(async (a, n) => h.slice(Number(a), Number(a) + n), 100000000000n));
});

const indexBytes = (bytes) =>
  indexPfs0(async (at, count) => bytes.slice(Number(at), Number(at) + count), BigInt(bytes.length));
function namedEntries(names) {
  const strings = new TextEncoder().encode(names.join("\0") + "\0");
  const bytes = new Uint8Array(16 + names.length * 24 + strings.length);
  bytes.set(new TextEncoder().encode("PFS0"));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, names.length, true);
  view.setUint32(8, strings.length, true);
  let offset = 0;
  for (let i = 0; i < names.length; i++) {
    view.setUint32(16 + i * 24 + 16, offset, true);
    offset += new TextEncoder().encode(names[i]).length + 1;
  }
  bytes.set(strings, 16 + names.length * 24);
  return bytes;
}

test("name byte boundary accepts 255 bytes and rejects longer or unterminated names", async () => {
  for (const name of ["a".repeat(255), "é".repeat(127) + "a"])
    assert.equal((await indexBytes(namedEntries([name])))[0].name, name);
  for (const name of ["a".repeat(256), "é".repeat(128), ""])
    await assert.rejects(indexBytes(namedEntries([name])));
  const truncated = namedEntries(["a".repeat(255)]);
  truncated[truncated.length - 1] = 65;
  await assert.rejects(indexBytes(truncated));
});

test("mid-string suffix entries cannot amplify a small metadata table", async () => {
  const bytes = namedEntries(["a".repeat(128), "other"]);
  new DataView(bytes.buffer).setUint32(16 + 24 + 16, 1, true);
  await assert.rejects(indexBytes(bytes));
  const duplicates = namedEntries(["first", "second"]);
  new DataView(duplicates.buffer).setUint32(16 + 24 + 16, 0, true);
  await assert.rejects(indexBytes(duplicates));
});

test("many bounded names retain no more bytes than their string table", async () => {
  const names = Array.from({ length: 4096 }, (_, i) => `${i}`.padStart(255, "a"));
  const bytes = namedEntries(names);
  const entries = await indexBytes(bytes);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    names,
  );
  assert.equal(
    entries.reduce((total, entry) => total + entry.name.length, 0),
    4096 * 255,
  );
});
