// 使用固定 zlib 1.2.13 原生字节样本，检查真实 WASM 的有界流式输出。
// Check bounded streaming output in actual WASM against pinned native zlib 1.2.13 byte fixtures.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPngCodec } from "../codec.mjs";

const codec = await createPngCodec(
  await readFile(new URL("../dist/png-codec.wasm", import.meta.url)),
);
const fixture = JSON.parse(
  await readFile(new URL("stream-smoke-fixtures.json", import.meta.url), "utf8"),
);
const cases = fixture.generic.filter(
  (item) => item.kind === "pattern" && [0, 1, 32768, 65536].includes(item.length),
);
assert.equal(cases.length, 4);
assert.equal(fixture.genericZlib, "1.2.13");
assert.equal(codec.genericZlibVersion, "1.2.13");
for (const item of cases) {
  const raw = Uint8Array.from({ length: item.length }, (_, index) => index % 251);
  const expected = new Uint8Array(Buffer.from(item.compressed, "base64"));
  assert.equal(raw.length, item.length);
  for (const step of [137, 65536]) {
    const input = {
      async *[Symbol.asyncIterator]() {
        for (let offset = 0; offset < raw.length; offset += step)
          yield raw.subarray(offset, offset + step);
      },
    };
    const chunks = [];
    let size = 0;
    for await (const chunk of codec.compressZlibStream(input, {
      maxInputBytes: raw.length,
      maxOutputBytes: expected.length,
    })) {
      assert.ok(chunk.length <= 1024 * 1024);
      size += chunk.length;
      assert.ok(size <= expected.length);
      chunks.push(chunk);
    }
    assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), expected);
  }
}
console.log("Pinned zlib WASM stream smoke: 4 fixtures, 8 fragmented streams; exact bytes.");
