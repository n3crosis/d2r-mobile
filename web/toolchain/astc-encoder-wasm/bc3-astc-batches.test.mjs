// 仅用注入的模拟编码器验证批处理契约，不验证真实 WASM 转码或保真度。
// Test batch orchestration using an injected fake encoder only; not real WASM transcoding or fidelity.
import test from "node:test";
import assert from "node:assert/strict";
import { transcodeBC3Batches } from "./bc3-astc-batches.mjs";
const readSource = (size) => ({
  size,
  async readAt(offset, length) {
    return new Uint8Array(length);
  },
});
const fakeCodec = async ({ width, height }) => new ArrayBuffer(width * height);
async function collect(iterator) {
  const output = [];
  for await (const chunk of iterator) output.push(chunk);
  return output;
}
test("fake codec: serial lazy batches, ordered raw blocks, exact tail trimming and monotonic counts", async () => {
  const reads = [],
    calls = [];
  let running = 0,
    batch = 0;
  const source = {
    size: (65536 + 3) * 16,
    async readAt(offset, length) {
      reads.push([offset, length]);
      return new Uint8Array(length);
    },
  };
  const encode = async ({ width, height, profile, rgba }) => {
    assert.equal(++running, 1);
    assert.equal(profile, "srgb");
    assert.equal(rgba.byteLength, width * height * 4);
    calls.push([width, height]);
    await Promise.resolve();
    const bytes = new Uint8Array(width * height);
    for (let block = 0; block < bytes.length / 16; ++block)
      bytes.fill((batch * 11 + block) % 251, block * 16, block * 16 + 16);
    batch++;
    running--;
    return bytes.buffer;
  };
  const iterator = transcodeBC3Batches(source, { profile: "srgb", encode });
  assert.equal(reads.length, 0);
  const first = (await iterator.next()).value;
  assert.equal(reads.length, 1);
  assert.equal(first.blocks.byteLength, 1048576);
  assert.equal(first.blockOffset, 0);
  assert.equal(first.completedBlocks, 65536);
  assert.equal(first.blocks[16], 1);
  await Promise.resolve();
  assert.equal(reads.length, 1);
  const second = (await iterator.next()).value;
  assert.equal(second.blocks.byteLength, 48);
  assert.equal(second.blocks.buffer.byteLength, 48);
  assert.deepEqual(
    [...second.blocks],
    [
      ...new Uint8Array(16).fill(11),
      ...new Uint8Array(16).fill(12),
      ...new Uint8Array(16).fill(13),
    ],
  );
  assert.equal(second.blockOffset, 65536);
  assert.equal(second.completedBlocks, 65539);
  assert.equal(second.totalBlocks, 65539);
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(reads, [
    [0, 1048576],
    [1048576, 48],
  ]);
  assert.deepEqual(calls, [
    [4096, 256],
    [4096, 4],
  ]);
});
test("fake codec: invalid sizes, short reads, explicit profile, encoded output, and empty source", async () => {
  for (const size of [-16, 1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(
      collect(transcodeBC3Batches(readSource(size), { profile: "linear", encode: fakeCodec })),
    );
  for (const profile of [undefined, "hdr", null])
    await assert.rejects(
      collect(transcodeBC3Batches(readSource(16), { profile, encode: fakeCodec })),
    );
  for (const batchBlocks of [0, 65537, 1.5])
    await assert.rejects(
      collect(
        transcodeBC3Batches(readSource(16), { profile: "linear", batchBlocks, encode: fakeCodec }),
      ),
    );
  await assert.rejects(
    collect(
      transcodeBC3Batches(
        { size: 16, readAt: () => new Uint8Array(15) },
        { profile: "linear", encode: () => assert.fail("Must not encode short read") },
      ),
    ),
    /short/,
  );
  await assert.rejects(
    collect(
      transcodeBC3Batches(readSource(16), { profile: "linear", encode: () => new ArrayBuffer(16) }),
    ),
    /padded/,
  );
  assert.deepEqual(
    await collect(
      transcodeBC3Batches(
        { size: 0, readAt: () => assert.fail("No empty read") },
        { profile: "linear", encode: fakeCodec },
      ),
    ),
    [],
  );
});
test("fake codec: abort before read, while read hangs, during codec, and no reads after consumer stop", async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    collect(
      transcodeBC3Batches(readSource(16), {
        profile: "linear",
        signal: before.signal,
        encode: fakeCodec,
      }),
    ),
    { name: "AbortError" },
  );
  for (const phase of ["read", "encode"]) {
    const controller = new AbortController();
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const hang = (_a, _b, options) => {
      assert.equal(options?.signal ?? _b.signal, controller.signal);
      started();
      return new Promise(() => {});
    };
    const source = phase === "read" ? { size: 16, readAt: hang } : readSource(16);
    const result = collect(
      transcodeBC3Batches(source, {
        profile: "linear",
        signal: controller.signal,
        encode: phase === "encode" ? hang : fakeCodec,
      }),
    );
    await ready;
    controller.abort();
    await assert.rejects(result, { name: "AbortError" });
  }
  let reads = 0;
  const source = {
    size: 48,
    readAt: (_offset, length) => {
      reads++;
      return new Uint8Array(length);
    },
  };
  for await (const chunk of transcodeBC3Batches(source, {
    profile: "linear",
    batchBlocks: 1,
    encode: fakeCodec,
  })) {
    assert.equal(chunk.blockCount, 1);
    break;
  }
  assert.equal(reads, 1);
});
// 将输入端点映射为模拟输出标记，验证跨批读取偏移与实际解码图像顺序。
// Map input endpoints to fake output markers to verify cross-batch offsets and actual decoded image order.
test("fake codec: source block identity survives decoding and multiple batches", async () => {
  const input = new Uint8Array(7 * 16);
  for (let block = 0; block < 7; ++block) {
    input[block * 16] = 255;
    input[block * 16 + 9] = (block + 1) << 3;
  }
  const source = {
    size: input.length,
    readAt: (offset, length) => input.subarray(offset, offset + length),
  };
  const encode = async ({ rgba, width, height }) => {
    const pixels = new Uint8Array(rgba),
      output = new Uint8Array(width * height);
    for (let block = 0; block < output.length / 16; ++block) {
      const x = block % (width / 4),
        y = Math.floor(block / (width / 4));
      output.fill(pixels[(y * 4 * width + x * 4) * 4], block * 16, block * 16 + 16);
    }
    return output.buffer;
  };
  const markers = [];
  for await (const { blocks } of transcodeBC3Batches(source, {
    profile: "linear",
    batchBlocks: 3,
    encode,
  }))
    for (let byte = 0; byte < blocks.length; byte += 16) markers.push(blocks[byte]);
  assert.deepEqual(markers, [8, 16, 24, 33, 41, 49, 57]);
});
