// 使用合成容器和模拟编码器测试结构语义；不验证真实游戏或真实 ASTC 转码。
// Test structural semantics with synthetic containers and a fake encoder; not real game or ASTC transcode validation.
import test from "node:test";
import assert from "node:assert/strict";
import { transcodeTextureStream, TEXTURE_HEADER_CHUNK_BYTES } from "./texture-stream.mjs";
function fixture(format = 0x3d, start = 56, blocks = 4) {
  const bytes = new Uint8Array(start + blocks * 16);
  bytes.fill(37, 0, start);
  bytes[4] = format;
  new DataView(bytes.buffer).setUint32(40, start - 40, true);
  return bytes;
}
const sourceOf = (bytes) => ({
  size: bytes.length,
  readAt: (offset, length) => bytes.subarray(offset, offset + length),
});
const fake = async ({ width, height }) => new Uint8Array(width * height).fill(0xa5).buffer;
async function collect(stream) {
  const items = [];
  for await (const item of stream) items.push(item);
  return items;
}
test("fake codec: both format mappings, exact header preservation, tail positions, and completion", async () => {
  for (const [format, target, profile] of [
    [0x3d, 0x5f, "linear"],
    [0x3e, 0x51, "srgb"],
  ]) {
    const input = fixture(format),
      original = input.slice();
    const events = await collect(
      transcodeTextureStream(sourceOf(input), {
        batchBlocks: 3,
        encode: (image) => {
          assert.equal(image.profile, profile);
          return fake(image);
        },
      }),
    );
    const output = new Uint8Array(input.length);
    let cursor = 0;
    for (const event of events)
      if (event.bytes) {
        assert.equal(event.offset, cursor);
        output.set(event.bytes, event.offset);
        cursor += event.bytes.length;
      }
    assert.equal(cursor, input.length);
    const expectedHeader = input.slice(0, 56);
    expectedHeader[4] = target;
    assert.deepEqual(output.slice(0, 56), expectedHeader);
    assert.deepEqual(output.slice(56), new Uint8Array(64).fill(0xa5));
    assert.deepEqual(input, original);
    assert.deepEqual(
      events.filter((x) => x.kind === "blocks").map((x) => x.completedBlocks),
      [3, 4],
    );
    assert.equal(events.at(-1).kind, "complete");
    assert.equal(events.at(-1).profile, profile);
  }
});
test("bounded header chunks and lazy early stop avoid reading the texture tail", async () => {
  const input = fixture(0x3d, TEXTURE_HEADER_CHUNK_BYTES + 73),
    reads = [];
  const source = {
    size: input.length,
    readAt: (offset, length) => {
      reads.push([offset, length]);
      return input.subarray(offset, offset + length);
    },
  };
  const stream = transcodeTextureStream(source, { encode: fake });
  assert.equal(reads.length, 0);
  const first = (await stream.next()).value;
  assert.equal(first.bytes.length, 48);
  assert.deepEqual(reads, [[0, 48]]);
  await stream.return();
  assert.equal(reads.length, 1);
  reads.length = 0;
  const events = await collect(transcodeTextureStream(source, { encode: fake }));
  assert.deepEqual(
    events.filter((x) => x.kind === "header").map((x) => x.bytes.length),
    [48, 65536, 25],
  );
  assert.ok(
    reads
      .filter(([offset]) => offset < 65609)
      .every(([, length]) => length <= TEXTURE_HEADER_CHUNK_BYTES),
  );
});
test("explicit unsupported/short skips; malformed offsets and short reads fail safely", async () => {
  assert.deepEqual(
    await collect(
      transcodeTextureStream({ size: 47, readAt: () => assert.fail("No short input read") }),
    ),
    [{ kind: "skip", reason: "short-input" }],
  );
  const unsupported = fixture(7);
  assert.deepEqual(await collect(transcodeTextureStream(sourceOf(unsupported))), [
    { kind: "skip", reason: "unsupported-format", format: 7 },
  ]);
  for (const start of [40, 47, 57, 120, 0xffffffff + 40]) {
    const input = fixture();
    new DataView(input.buffer).setUint32(40, start - 40, true);
    await assert.rejects(
      collect(transcodeTextureStream(sourceOf(input), { encode: fake })),
      /bounds/,
    );
  }
  await assert.rejects(
    collect(
      transcodeTextureStream({ size: 64, readAt: () => new Uint8Array(47) }, { encode: fake }),
    ),
    /short texture read/,
  );
  for (const size of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(collect(transcodeTextureStream({ size, readAt() {} })), /safe-sized/);
  const stream = transcodeTextureStream(sourceOf(fixture()), { batchBlocks: 0, encode: fake });
  await assert.rejects(stream.next(), /batch/);
});
test("abort pending header read and abort after header prevent completion and further reads", async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const source = {
    size: 64,
    readAt: (_offset, _length, { signal }) => {
      assert.equal(signal, controller.signal);
      started();
      return new Promise(() => {});
    },
  };
  const result = collect(
    transcodeTextureStream(source, { signal: controller.signal, encode: fake }),
  );
  await ready;
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  const nextController = new AbortController();
  let reads = 0;
  const bytes = fixture();
  const stream = transcodeTextureStream(
    {
      size: bytes.length,
      readAt: (offset, length) => {
        reads++;
        return bytes.subarray(offset, offset + length);
      },
    },
    { signal: nextController.signal, encode: fake },
  );
  assert.equal((await stream.next()).value.kind, "header");
  nextController.abort();
  await assert.rejects(stream.next(), { name: "AbortError" });
  assert.equal(reads, 1);
});
// 外部读取和编码错误仅报告固定类别，不泄漏调用者的私有路径或文件名。
// External read and codec failures expose fixed categories, not caller-private paths or filenames.
test("source and injected codec failure messages are sanitized", async () => {
  const secret = "/private/user/example.texture";
  await assert.rejects(
    collect(
      transcodeTextureStream({
        size: 64,
        readAt() {
          throw new Error(secret);
        },
      }),
    ),
    (error) => error.message === "Texture read failed" && !error.stack.includes(secret),
  );
  await assert.rejects(
    collect(
      transcodeTextureStream(sourceOf(fixture()), {
        encode() {
          throw new Error(secret);
        },
      }),
    ),
    (error) => error.message === "Texture block conversion failed" && !error.stack.includes(secret),
  );
});
