// 模拟字体 ABI 仅验证 JS 输入边界；不代表真实字体或 WASM 光栅化验证。
// Mock font ABI tests cover JS input boundaries, not real fonts or WASM rasterization.
import test from "node:test";
import assert from "node:assert/strict";
import { createFontRasterizer } from "../toolchain/font-rasterizer-exact/font.mjs";

async function fixture(t) {
  const memory = { buffer: new ArrayBuffer(67108864) },
    counts = [];
  const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  t.mock.method(WebAssembly, "instantiate", async () => ({
    exports: {
      memory,
      font_version: () => 20600,
      font_close() {},
      font_input: () => 8192,
      font_open: () => 0,
      font_text: () => 0,
      font_info: () => 16384,
      font_measure(count) {
        counts.push(count);
        return 0;
      },
      font_ft_error: () => 0,
    },
  }));
  const font = await createFontRasterizer(module);
  font.open(new Uint8Array([1]), 48);
  return { font, counts, memory };
}

test("oversized font text is rejected before codepoint-array allocation", async (t) => {
  const { font, counts } = await fixture(t);
  const text = "a".repeat(2 * 1024 * 1024);
  const original = Array.from;
  let expanded = false;
  t.mock.method(Array, "from", function (value, ...args) {
    if (value === text) {
      expanded = true;
      throw Error("oversized allocation attempted");
    }
    return original.call(this, value, ...args);
  });
  assert.throws(() => font.measure(text), /Single-line Unicode text limit/);
  assert.equal(expanded, false);
  assert.deepEqual(counts, []);
});

test("font limit counts Unicode codepoints, not UTF-16 code units", async (t) => {
  const { font, counts, memory } = await fixture(t);
  font.measure("😀".repeat(2048));
  assert.deepEqual(counts, [2048]);
  assert.ok(new Uint32Array(memory.buffer, 0, 2048).every((point) => point === 0x1f600));
  for (const text of ["a".repeat(2049), "😀".repeat(2049), "bad\nline", "\ud800"]) {
    assert.throws(() => font.measure(text), /Single-line Unicode text limit/);
  }
  assert.deepEqual(counts, [2048]);
  font.close();
  assert.throws(() => font.measure("a"), /Open a font/);
});
