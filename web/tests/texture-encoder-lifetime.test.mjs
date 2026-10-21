// 合成模块只验证所有权与失败清理，不构成原生编码或浏览器证明。
// Synthetic module checks ownership and failure cleanup, not native codec or browser proof.
import test from "node:test";
import assert from "node:assert/strict";
import { createTextureEncoder } from "../toolchain/texture-spike/browser-texture-encoder.mjs";
function fixture(failure) {
  const heap = new ArrayBuffer(4096);
  let next = 64,
    allocations = 0;
  const module = {
    HEAPU8: new Uint8Array(heap),
    HEAPU32: new Uint32Array(heap),
    _malloc(size) {
      if (++allocations === 3 && failure === "allocation") return 0;
      const pointer = next;
      next += Math.ceil(size / 8) * 8;
      return pointer;
    },
    _free() {},
    _texture_info(_pointer, _level, _layer, info) {
      if (failure === "layout") return -4;
      module.HEAPU32.set([16, 16, 4, 4, 70, 4, 16, 1], info / 4);
      return 0;
    },
    _texture_pack_bc3(_descriptor, _input, _length, output, size) {
      module.HEAPU8.fill(7, output, output + size);
      return failure === "pack" ? -4 : 0;
    },
  };
  const header = new Uint8Array(40),
    view = new DataView(header.buffer);
  view.setUint32(0, 0x31417053, true);
  view.setUint16(4, 61, true);
  view.setUint16(6, 4, true);
  view.setUint32(8, 4, true);
  view.setUint32(12, 4, true);
  view.setUint16(20, 1, true);
  return { module, header, rgba: new Uint8Array(64).fill(3) };
}
test("encoding wipes independent BC3 output when layout, allocation, length or packing fails", async () => {
  for (const failure of ["layout", "allocation", "length", "pack", "type"]) {
    const f = fixture(failure),
      savedHeader = f.header.slice(),
      savedRgba = f.rgba.slice();
    const encoded = new Uint8Array(failure === "length" ? 15 : 16).fill(9);
    const encoder = await createTextureEncoder(
      async () => f.module,
      async () => (failure === "type" ? encoded.buffer : encoded),
    );
    await assert.rejects(encoder.encodeAndPack(f.header, f.rgba, 4, 4));
    assert.ok(encoded.every((byte) => byte === 0));
    assert.deepEqual(f.header, savedHeader);
    assert.deepEqual(f.rgba, savedRgba);
  }
});
test("packing failure preserves injected encoder aliases to caller inputs", async () => {
  for (const source of ["header", "rgba"]) {
    const f = fixture("pack"),
      savedHeader = f.header.slice(),
      savedRgba = f.rgba.slice();
    const encoder = await createTextureEncoder(
      async () => f.module,
      async () => f[source].subarray(0, 16),
    );
    await assert.rejects(encoder.encodeAndPack(f.header, f.rgba, 4, 4));
    assert.deepEqual(f.header, savedHeader);
    assert.deepEqual(f.rgba, savedRgba);
  }
});
test("successful encoding preserves returned BC3 and sprite and caller inputs", async () => {
  const f = fixture(),
    savedHeader = f.header.slice(),
    savedRgba = f.rgba.slice();
  const encoded = new Uint8Array(16).fill(9);
  const encoder = await createTextureEncoder(
    async () => f.module,
    async () => encoded,
  );
  const result = await encoder.encodeAndPack(f.header, f.rgba, 4, 4);
  assert.equal(result.linearBC3, encoded);
  assert.ok(encoded.every((byte) => byte === 9));
  assert.equal(result.sprite.length, 56);
  assert.ok(result.sprite.subarray(40).every((byte) => byte === 7));
  assert.deepEqual(f.header, savedHeader);
  assert.deepEqual(f.rgba, savedRgba);
});
