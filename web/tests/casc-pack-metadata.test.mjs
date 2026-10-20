// 依据原生 25 字节 CFT 布局验证合成补充包元数据，不读取游戏或外部包。
// Verify synthetic supplemental-pack metadata against the native 25-byte CFT layout; no game or external pack reads.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  inspectCascPackStorageSpecs,
  createCascPackStorageLookup,
  patchCascPrebuiltReferences,
  CASC_PACK_METADATA_LIMITS,
} from "../toolchain/casc-overlay-js/overlay.mjs";
const key = (i) => createHash("md5").update(`synthetic-${i}`).digest("hex");
function fixture(count = 3) {
  const specs = new TextEncoder().encode("n\0z\0b:256K*=z\0");
  const bytes = new Uint8Array(46 + count * 25 + specs.length),
    view = new DataView(bytes.buffer);
  bytes.set([84, 86, 70, 83, 1, 46, 16, 0]);
  view.setUint32(8, 10);
  view.setUint32(12, 46);
  view.setUint32(20, 46);
  view.setUint32(28, 46);
  view.setUint32(32, count * 25);
  view.setUint32(38, 46 + count * 25);
  view.setUint32(42, specs.length);
  bytes.set(specs, 46 + count * 25);
  const entries = Array.from({ length: count }, (_, i) => ({
    path: `data/textures/${i}.texture`,
    oldEkey: key(i),
  }));
  entries.forEach((entry, i) => {
    const pos = 46 + i * 25;
    bytes.set(Buffer.from(entry.oldEkey, "hex"), pos);
    view.setUint32(pos + 16, 10 + i);
    bytes[pos + 20] = i % 3;
    view.setUint32(pos + 21, 100 + i);
  });
  return { bytes, entries };
}

test("inspect preserves original n/z/BLTE specs, lengths, order and immutable metadata", () => {
  const { bytes, entries } = fixture(),
    before = bytes.slice();
  const actual = inspectCascPackStorageSpecs(bytes, [entries[2], entries[0], entries[1]]);
  assert.deepEqual(
    actual.map((v) => [v.spec, v.specIndex, v.encodedSize, v.decodedSize]),
    [
      ["b:256K*=z", 2, 12, 102],
      ["n", 0, 10, 100],
      ["z", 1, 11, 101],
    ],
  );
  assert.ok(Object.isFrozen(actual));
  assert.ok(actual.every(Object.isFrozen));
  assert.deepEqual(bytes, before);
});

test("patch preserves all bytes except selected keys and lengths, including original spec bytes", () => {
  const { bytes, entries } = fixture(),
    before = bytes.slice();
  const records = [
    { ...entries[0], newEkey: entries[1].oldEkey, encodedSize: 0xffffffff, decodedSize: 0 },
    { ...entries[1], newEkey: entries[0].oldEkey, encodedSize: 17, decodedSize: 18 },
  ];
  const output = patchCascPrebuiltReferences(bytes, records);
  const expected = bytes.slice(),
    view = new DataView(expected.buffer);
  records.forEach((r, i) => {
    const pos = 46 + i * 25;
    expected.set(Buffer.from(r.newEkey, "hex"), pos);
    view.setUint32(pos + 16, r.encodedSize);
    view.setUint32(pos + 21, r.decodedSize);
  });
  assert.deepEqual(output, expected);
  assert.deepEqual(bytes, before);
  assert.notEqual(output.buffer, bytes.buffer);
  assert.equal(output[66], 0);
  assert.equal(output[91], 1);
  assert.deepEqual(patchCascPrebuiltReferences(bytes, []), bytes);
});

test("patch copies Buffer-backed inputs rather than retaining slice aliases", () => {
  const { bytes, entries } = fixture();
  const input = Buffer.from(bytes),
    before = Buffer.from(input);
  const output = patchCascPrebuiltReferences(input, [
    { ...entries[0], newEkey: key(10), encodedSize: 1, decodedSize: 2 },
  ]);
  assert.deepEqual(input, before);
  assert.notEqual(output.buffer, input.buffer);
  assert.equal(output.constructor, Uint8Array);
});

test("duplicate requests, missing/unaligned/ambiguous keys and unsafe paths reject", () => {
  const { bytes, entries } = fixture();
  for (const requests of [
    [entries[0], entries[0]],
    [entries[0], { ...entries[1], oldEkey: entries[0].oldEkey.toUpperCase() }],
    [{ ...entries[0], oldEkey: key(900) }],
    [{ ...entries[0], oldEkey: Buffer.from(bytes.subarray(47, 63)).toString("hex") }],
    [{ ...entries[0], path: "data/../bad" }],
    [{ ...entries[0], path: "DATA/test" }],
    [{ ...entries[0], path: "data/file\tbad" }],
    [{ ...entries[0], path: "data/file\u007fbad" }],
    [{ ...entries[0], add: true }],
    [{ ...entries[0], oldEkey: "__proto__" }],
  ])
    assert.throws(() => inspectCascPackStorageSpecs(bytes, requests), /CASC_OVERLAY_INVALID/);
  const duplicate = bytes.slice();
  duplicate.set(duplicate.subarray(46, 62), 71);
  assert.throws(() => inspectCascPackStorageSpecs(duplicate, [entries[0]]), /CASC_OVERLAY_INVALID/);
});

test("patch validates every record before mutation and rejects invalid uint32 lengths", () => {
  const { bytes, entries } = fixture(),
    before = bytes.slice();
  for (const value of [-1, 0x100000000, 0.5, NaN, Infinity, "1", 1n]) {
    for (const field of ["encodedSize", "decodedSize"]) {
      const record = {
        ...entries[0],
        newEkey: key(10),
        encodedSize: 1,
        decodedSize: 2,
        [field]: value,
      };
      assert.throws(() => patchCascPrebuiltReferences(bytes, [record]), /CASC_OVERLAY_INVALID/);
    }
  }
  assert.throws(
    () =>
      patchCascPrebuiltReferences(bytes, [
        { ...entries[0], newEkey: key(10), encodedSize: 1, decodedSize: 2 },
        { ...entries[1], newEkey: "bad", encodedSize: 1, decodedSize: 2 },
      ]),
    /CASC_OVERLAY_INVALID/,
  );
  assert.deepEqual(bytes, before);
});

test("independent metadata count supports 27000 entries without raising overlay payload caps", () => {
  const { bytes, entries } = fixture(27000);
  const actual = inspectCascPackStorageSpecs(bytes, entries);
  assert.equal(actual.length, 27000);
  assert.equal(actual.at(-1).oldEkey, entries.at(-1).oldEkey);
  assert.throws(
    () =>
      inspectCascPackStorageSpecs(
        bytes,
        Array(CASC_PACK_METADATA_LIMITS.entries + 1).fill(entries[0]),
      ),
    /CASC_OVERLAY_INVALID/,
  );
  assert.throws(() => inspectCascPackStorageSpecs(new Uint8Array(10), []), /CASC_OVERLAY_INVALID/);
});

// 可复用查询不受原始 Buffer 后续修改影响，且不放宽重复字节规则。
// Reusable lookup ignores later source Buffer mutation and retains duplicate-byte rules.
test("reusable lookup snapshots once and preserves exact occurrence rejection", () => {
  const { bytes, entries } = fixture();
  const expected = inspectCascPackStorageSpecs(bytes, entries);
  const source = Buffer.from(bytes),
    lookup = createCascPackStorageLookup(source);
  source.fill(0);
  assert.ok(Object.isFrozen(lookup));
  for (let i = 0; i < entries.length; i++) assert.deepEqual(lookup([entries[i]]), [expected[i]]);
  assert.throws(() => lookup([entries[0], entries[0]]));
  const malformed = fixture();
  // 第二次出现位于下一条记录内部的非对齐位置。
  // The second occurrence is unaligned inside the following record.
  malformed.bytes.set(Buffer.from(malformed.entries[0].oldEkey, "hex"), 46 + 25 + 1);
  const duplicate = createCascPackStorageLookup(malformed.bytes);
  assert.throws(() => duplicate([malformed.entries[0]]));
  assert.throws(() => createCascPackStorageLookup(new Uint8Array(16 * 1024 * 1024 + 1)));
});
