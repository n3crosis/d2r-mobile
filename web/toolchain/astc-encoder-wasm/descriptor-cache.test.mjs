// 用手写缩略图与注入编码器检查原生描述布局；不读取游戏或运行真实编码器。
// Check native descriptor layout with authored thumbnails and an injected codec; no game or real encoder.
import test from "node:test";
import assert from "node:assert/strict";
import { transformTextureDescriptorCache, DESCRIPTOR_CACHE_LIMITS } from "./descriptor-cache.mjs";
const json = (value) => new TextEncoder().encode(JSON.stringify(value));
const read = (result) => JSON.parse(new TextDecoder().decode(result.bytes));
const base64 = (bytes) => Buffer.from(bytes).toString("base64");
const from64 = (value) => new Uint8Array(Buffer.from(value, "base64"));
function thumbnail() {
  const b = new Uint8Array(112).fill(177),
    v = new DataView(b.buffer);
  v.setUint32(0, 2, true);
  v.setInt32(4, 4, true);
  v.setUint32(8, 16, true);
  v.setInt32(12, 48 - 12, true);
  v.setUint32(16, 16, true);
  v.setInt32(20, 80 - 20, true);
  b.fill(0, 48, 64);
  b.fill(0, 80, 96);
  return b;
}
const entry = (filename = "one.texture", format = 61, b = thumbnail()) => ({
  filename,
  format,
  thumbnailBase64: base64(b),
  other: { width: 7, note: "保留", values: [null, true, 2.5] },
});
const fake = async ({ width, height }) => new ArrayBuffer(width * height);
test("selected formats and metadata; serial mips preserve header, gaps, trailer and caller input", async () => {
  const original = thumbnail(),
    rows = [
      entry("ONE.TEXTURE"),
      entry("two.texture", 62),
      entry("skip.texture", 61),
      { filename: "unsupported.texture", format: 60, thumbnailBase64: "unparsed" },
    ];
  const input = json(rows),
    before = input.slice(),
    calls = [];
  let running = 0;
  const result = await transformTextureDescriptorCache(
    input,
    new Map([
      ["one.texture", false],
      ["two.texture", true],
      ["unsupported.texture", false],
    ]),
    {
      encode: async ({ width, height, profile }) => {
        assert.equal(++running, 1);
        calls.push(profile);
        await Promise.resolve();
        running--;
        return new Uint8Array(width * height).fill(calls.length).buffer;
      },
      batchBlocks: 1,
    },
  );
  assert.deepEqual(calls, ["linear", "linear", "srgb", "srgb"]);
  assert.deepEqual(input, before);
  const output = read(result);
  assert.equal(result.convertedEntries, 2);
  assert.equal(result.thumbnailCount, 2);
  assert.equal(output[0].format, 95);
  assert.equal(output[1].format, 81);
  assert.deepEqual(output[0].other, rows[0].other);
  assert.deepEqual(output.slice(2), rows.slice(2));
  for (let j = 0; j < 2; j++) {
    const b = from64(output[j].thumbnailBase64);
    for (let i = 0; i < b.length; i++)
      assert.equal(
        b[i],
        i >= 48 && i < 64 ? j * 2 + 1 : i >= 80 && i < 96 ? j * 2 + 2 : original[i],
      );
  }
});
test("empty, absent and null thumbnails retain shape; unselected malformed thumbnail stays untouched", async () => {
  const rows = [
    { filename: "a", format: 61 },
    { filename: "b", format: 62, thumbnailBase64: "" },
    { filename: "c", format: 61, thumbnailBase64: null },
    { filename: "d", format: 62, thumbnailBase64: "bad" },
  ];
  const r = await transformTextureDescriptorCache(
    json(rows),
    new Map([
      ["a", false],
      ["b", true],
      ["c", false],
    ]),
    { encode: () => assert.fail("No codec") },
  );
  assert.deepEqual(
    read(r),
    rows.map((e, i) => (i < 3 ? { ...e, format: i === 1 ? 81 : 95 } : e)),
  );
  assert.equal(r.thumbnailCount, 0);
});
test("all thumbnail metadata is checked before first codec call, including profile mismatch", async () => {
  let calls = 0;
  for (const bad of [entry("b", 62), { ...entry("b"), thumbnailBase64: "bad" }])
    await assert.rejects(
      transformTextureDescriptorCache(
        json([entry("a"), bad]),
        new Map([
          ["a", false],
          ["b", false],
        ]),
        {
          encode: () => {
            calls++;
            return fake({ width: 4096, height: 4 });
          },
        },
      ),
      /ASTC_DESCRIPTOR_INVALID/,
    );
  assert.equal(calls, 0);
});
test("signed pointers, counts, lengths, table bounds and overlapping payload ranges reject", async () => {
  const mutations = [
    (v) => v.setUint32(0, 0, true),
    (v) => v.setUint32(0, 65, true),
    (v) => v.setInt32(4, -8, true),
    (v) => v.setInt32(4, 100, true),
    (v) => v.setInt32(12, -40, true),
    (v) => v.setInt32(12, 0x7fffffff, true),
    (v) => v.setUint32(8, 0, true),
    (v) => v.setUint32(8, 15, true),
    (v) => v.setUint32(8, 128, true),
    (v) => v.setInt32(20, 48 - 20, true),
    (v) => v.setInt32(12, 8 - 12, true),
  ];
  for (const mutate of mutations) {
    const b = thumbnail();
    mutate(new DataView(b.buffer));
    await assert.rejects(
      transformTextureDescriptorCache(json([entry("a", 61, b)]), new Map([["a", false]]), {
        encode: () => assert.fail("Invalid layout"),
      }),
      /ASTC_DESCRIPTOR_INVALID/,
    );
  }
});
test("table order, not physical order, determines codec sequence; gaps remain legal", async () => {
  const b = thumbnail(),
    v = new DataView(b.buffer);
  v.setInt32(12, 80 - 12, true);
  v.setInt32(20, 48 - 20, true);
  let n = 0;
  const r = await transformTextureDescriptorCache(
    json([entry("a", 61, b)]),
    new Map([["a", false]]),
    { encode: async ({ width, height }) => new Uint8Array(width * height).fill(++n).buffer },
  );
  const out = from64(read(r)[0].thumbnailBase64);
  assert.equal(out[80], 1);
  assert.equal(out[48], 2);
  assert.equal(out[64], 177);
});
test("input bounds, canonical base64, map shape and unsafe metadata reject without private errors", async () => {
  for (const input of [
    new Uint8Array([255]),
    json({}),
    json([{}]),
    json([{ filename: "a", format: 61, n: 1e30 }]),
    new Uint8Array(DESCRIPTOR_CACHE_LIMITS.inputBytes + 1),
  ])
    await assert.rejects(
      transformTextureDescriptorCache(input, new Map()),
      /ASTC_DESCRIPTOR_INVALID/,
    );
  for (const map of [{}, new Map([["A", false]]), new Map([["a", "linear"]])])
    await assert.rejects(transformTextureDescriptorCache(json([]), map), /ASTC_DESCRIPTOR_INVALID/);
  for (const value of [" " + base64(thumbnail()), base64(thumbnail()).replace(/=$/, ""), "AB==", 9])
    await assert.rejects(
      transformTextureDescriptorCache(
        json([{ filename: "secret.texture", format: 61, thumbnailBase64: value }]),
        new Map([["secret.texture", false]]),
      ),
      { message: "ASTC_DESCRIPTOR_INVALID" },
    );
});
test("codec errors are sanitized and abort interrupts a hung codec without exposing filenames", async () => {
  const input = json([entry("private.texture")]),
    map = new Map([["private.texture", false]]);
  await assert.rejects(
    transformTextureDescriptorCache(input, map, {
      encode: () => {
        throw Error("private.texture /secrets");
      },
    }),
    { message: "ASTC_DESCRIPTOR_TRANSCODE" },
  );
  const c = new AbortController();
  let start;
  const started = new Promise((r) => {
    start = r;
  });
  const pending = transformTextureDescriptorCache(input, map, {
    signal: c.signal,
    encode: () => {
      start();
      return new Promise(() => {});
    },
  });
  await started;
  c.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(transformTextureDescriptorCache(input, map, { signal: c.signal }), {
    name: "AbortError",
  });
});
