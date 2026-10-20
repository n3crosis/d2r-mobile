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
