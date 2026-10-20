import test from "node:test";
import assert from "node:assert/strict";
import { parseRelocations, planRelocationRead } from "./bktr-relocations.mjs";
function fixture() {
  const bytes = new Uint8Array(0x8000),
    v = new DataView(bytes.buffer);
  v.setUint32(4, 1, true);
  v.setBigUint64(8, 12n, true);
  v.setUint32(0x4004, 3, true);
  v.setBigUint64(0x4008, 12n, true);
  for (let i = 0; i < 3; i++) {
    const at = 0x4010 + i * 20;
    v.setBigUint64(at, BigInt(i * 4), true);
    v.setBigUint64(at + 8, i === 1 ? 5n : 0x100000000n + BigInt(i * 4), true);
    v.setUint32(at + 16, i === 1 ? 1 : 0, true);
  }
  return bytes;
}
const options = { entryCount: 3, baseSize: 0x200000000n, patchDataSize: 20n };
test("bounded BKTR plans split base/patch/base and preserve >4GiB offsets", () => {
  const table = parseRelocations(fixture(), options);
  assert.deepEqual(planRelocationRead(table, 2n, 8), [
    { source: "base", offset: 0x100000002n, count: 2 },
    { source: "patch", offset: 5n, count: 4 },
    { source: "base", offset: 0x100000008n, count: 2 },
  ]);
  assert.deepEqual(planRelocationRead(table, 12n, 0), []);
  assert(Object.isFrozen(table) && Object.isFrozen(table.entries[0]));
  assert.throws(() => planRelocationRead(table, 0n, 65537));
  assert.throws(() => planRelocationRead(table, 11n, 2));
});
test("malformed relocation layout, source, extents and counts fail closed", () => {
  for (const mutate of [
    (v) => v.setUint32(4, 0, true),
    (v) => v.setBigUint64(16, 1n, true),
    (v) => v.setBigUint64(0x4008, 13n, true),
    (v) => v.setUint32(0x4004, 1000, true),
    (v) => v.setBigUint64(0x4024, 0n, true),
    (v) => v.setUint32(0x4020, 2, true),
    (v) => v.setBigUint64(0x4018, 0x200000000n, true),
  ]) {
    const bytes = fixture();
    mutate(new DataView(bytes.buffer));
    assert.throws(() => parseRelocations(bytes, options));
  }
  assert.throws(() => parseRelocations(fixture(), { ...options, entryCount: 2 }));
  assert.throws(() => parseRelocations(fixture().subarray(1), options));
});
