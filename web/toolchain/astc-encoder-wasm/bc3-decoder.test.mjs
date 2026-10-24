// 根据原生 NumPy 纯函数与确定性自造块，验证字节、取整和拼接顺序；不含游戏资源。
// Verify bytes, rounding and grid order against native NumPy pure functions with deterministic synthetic blocks; no game assets.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodeBC3Blocks, decodeBC3BlockGrid, MAX_BC3_BLOCKS } from "./bc3-decoder.mjs";
function fixture() {
  const input = new Uint8Array(1031 * 16);
  let seed = 0x19283746;
  for (let i = 0; i < input.length; ++i) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    input[i] = seed & 255;
  }
  for (let block = 0; block < 12; ++block) {
    const start = block * 16;
    input[start] = [0, 255, 42][block % 3];
    input[start + 1] = [255, 0, 42][block % 3];
    let indices = 0n;
    for (let pixel = 0; pixel < 16; ++pixel) indices |= BigInt(pixel % 8) << BigInt(pixel * 3);
    for (let byte = 0; byte < 6; ++byte)
      input[start + 2 + byte] = Number((indices >> BigInt(byte * 8)) & 255n);
    input[start + 8] = 0;
    input[start + 9] = 0;
    input[start + 10] = 255;
    input[start + 11] = 255;
    input.fill(0xe4, start + 12, start + 16);
  }
  return input;
}
test("all synthetic bytes match actual native NumPy decoder and native block-grid stitching", (t) => {
  const numpy = spawnSync("python3", ["-c", "import numpy"], { encoding: "utf8" });
  if (numpy.error || numpy.status !== 0)
    return t.skip("Existing Python/NumPy unavailable; no install attempted");
  const input = fixture();
  const result = spawnSync(
    "python3",
    [fileURLToPath(new URL("./bc3-native-reference.py", import.meta.url))],
    {
      input: JSON.stringify({ bc3: Buffer.from(input).toString("base64") }),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const expected = JSON.parse(result.stdout);
  assert.deepEqual(decodeBC3Blocks(input), new Uint8Array(Buffer.from(expected.rgba, "base64")));
  const grid = decodeBC3BlockGrid(input);
  assert.equal(grid.width, expected.width);
  assert.equal(grid.height, expected.height);
  assert.equal(grid.paddedBlocks, 1017);
  assert.deepEqual(new Uint8Array(grid.rgba), new Uint8Array(Buffer.from(expected.grid, "base64")));
});
test("unconditional four-color mode, alpha special indices, views and no input mutation", () => {
  const raw = fixture().subarray(0, 16),
    copy = raw.slice();
  const rgba = decodeBC3Blocks(raw);
  assert.deepEqual([...rgba.subarray(8, 11)], [85, 85, 85]);
  assert.deepEqual([...rgba.subarray(12, 15)], [170, 170, 170]);
  assert.equal(rgba[6 * 4 + 3], 0);
  assert.equal(rgba[7 * 4 + 3], 255);
  assert.deepEqual(raw, copy);
  const padded = new Uint8Array(48);
  padded.set(raw, 16);
  assert.deepEqual(decodeBC3Blocks(padded.subarray(16, 32)), rgba);
  assert.deepEqual(new Uint8Array(decodeBC3BlockGrid(raw, { rowBlocks: 1 }).rgba), rgba);
});
test("reject malformed input and padded image overflow; largest primitive stays bounded", () => {
  for (const raw of [
    new Uint8Array(0),
    new Uint8Array(15),
    new Uint8Array(MAX_BC3_BLOCKS * 16 + 16),
    new ArrayBuffer(16),
  ])
    assert.throws(() => decodeBC3Blocks(raw));
  if (typeof SharedArrayBuffer !== "undefined")
    assert.throws(() => decodeBC3Blocks(new Uint8Array(new SharedArrayBuffer(16))));
  for (const rowBlocks of [0, -1, 1.5, NaN, Infinity, 1025])
    assert.throws(() => decodeBC3BlockGrid(new Uint8Array(16), { rowBlocks }));
  const max = new Uint8Array(MAX_BC3_BLOCKS * 16);
  assert.equal(decodeBC3Blocks(max).byteLength, 4 * 1024 * 1024);
  const grid = decodeBC3BlockGrid(max);
  assert.equal(grid.rgba.byteLength, 4 * 1024 * 1024);
  assert.equal(grid.paddedBlocks, 0);
  assert.throws(() => decodeBC3BlockGrid(max, { rowBlocks: 1023 }));
  assert.throws(() => decodeBC3BlockGrid(max, { rowBlocks: 1 }));
});
