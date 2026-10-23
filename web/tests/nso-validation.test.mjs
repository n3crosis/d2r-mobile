// 验证 nso-validation 的约定与边界；依据 ../nso-validation.mjs、../preflight.mjs 及本文件的测试断言。
// Verify nso-validation contracts and boundaries against ../nso-validation.mjs、../preflight.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { decodeLz4Block, validateNsoSegments } from "../nso-validation.mjs";
import { MAX_READ_BYTES } from "../preflight.mjs";

const hex = (value) => Uint8Array.from(Buffer.from(value, "hex"));
const text = (value) => new TextEncoder().encode(value);
const abcHash = hex("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
const emptyHash = hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
function fixture(flags = 0x38, content = [text("abc"), text("abc"), text("abc")]) {
  const stored = content.map((bytes, i) =>
    flags & (1 << i) ? Uint8Array.of(bytes.length << 4, ...bytes) : bytes,
  );
  const bytes = new Uint8Array(0x100 + stored.reduce((n, s) => n + s.length, 0));
  bytes.set(text("NSO0"));
  const view = new DataView(bytes.buffer);
  view.setUint32(0x0c, flags, true);
  let offset = 0x100;
  for (let i = 0; i < 3; i++) {
    view.setUint32(0x10 + i * 16, offset, true);
    view.setUint32(0x14 + i * 16, i * 0x1000, true);
    view.setUint32(0x18 + i * 16, content[i].length, true);
    view.setUint32(0x60 + i * 4, stored[i].length, true);
    bytes.set(content[i].length ? abcHash : emptyHash, 0xa0 + i * 32);
    bytes.set(stored[i], offset);
    offset += stored[i].length;
  }
  const reads = [];
  return {
    bytes,
    view,
    reads,
    source: {
      size: bytes.length,
      read: async (offset, length) => {
        reads.push([offset, length]);
        return bytes.slice(offset, offset + length);
      },
    },
  };
}

test("independent liblz4 1.10.0 vectors decode overlapping offsets 1 and 3", async () => {
  // 由系统 liblz4 的 LZ4_compress_default 生成，不是本实现生成。
  // Produced with system liblz4 LZ4_compress_default, not this implementation.
  assert.deepEqual(await decodeLz4Block(hex("1f61010007506161616161"), 32), text("a".repeat(32)));
  assert.deepEqual(
    await decodeLz4Block(hex("3f61626303003f506263616263"), 90),
    text("abc".repeat(30)),
  );
});

test("LZ4 specification literal length extension examples and empty block", async () => {
  for (const [size, prefix] of [
    [15, [0xf0, 0]],
    [48, [0xf0, 33]],
    [280, [0xf0, 255, 10]],
  ]) {
    const literal = Uint8Array.from({ length: size }, (_, i) => i & 255);
    assert.deepEqual(await decodeLz4Block(Uint8Array.of(...prefix, ...literal), size), literal);
  }
  assert.deepEqual(await decodeLz4Block(Uint8Array.of(0), 0), new Uint8Array());
});

test("LZ4 rejects malformed, truncated, overflow and missing terminal sequences", async () => {
  for (const [input, size] of [
    [[], 0],
    [[0xf0], 15],
    [[0x30, 97], 3],
    [[0x10, 97, 0, 0], 5],
    [[0x10, 97, 2, 0], 5],
    [[0x10, 97, 1], 5],
    [[0x1f, 97, 1, 0], 30],
    [[0x10, 97, 1, 0], 5],
    [[0x10, 97, 1, 0, 0], 5],
    [[0x20, 97, 98], 1],
    [[0x10, 97], 2],
    [[0x1f, 97, 1, 0, 255], 8],
  ]) {
    await assert.rejects(decodeLz4Block(Uint8Array.from(input), size));
  }
  await assert.rejects(
    decodeLz4Block(Uint8Array.of(0), 100, { limits: { maxSegmentBytes: 99 } }),
    /budget/,
  );
});

test("all legacy compression and hash flag combinations are independent", async () => {
  for (let flags = 0; flags < 64; flags++) {
    const f = fixture(flags);
    const result = await validateNsoSegments(f.source);
    assert.equal(result.supportedGameBuild, false);
    assert.equal(result.versionVerified, false);
    assert.equal(result.allSegmentsHashed, (flags & 0x38) === 0x38);
    result.segments.forEach((s, i) => {
      assert.deepEqual(s.bytes, text("abc"));
      assert.equal(s.hashRequired, Boolean(flags & (1 << (i + 3))));
      assert.equal(s.integrity, s.hashRequired ? "verified" : "not-requested");
    });
  }
});

test("all three required hashes reject tampering; unrequested hashes are not verified", async () => {
  for (let i = 0; i < 3; i++) {
    const f = fixture();
    f.bytes[0xa0 + i * 32] ^= 1;
    await assert.rejects(validateNsoSegments(f.source), /SHA-256 mismatch/);
  }
  const f = fixture(0);
  f.bytes[0xa0] ^= 1;
  assert.equal((await validateNsoSegments(f.source)).segments[0].integrity, "not-requested");
  const empty = fixture(0x3f, [new Uint8Array(), new Uint8Array(), new Uint8Array()]);
  assert.equal((await validateNsoSegments(empty.source)).allSegmentsHashed, true);
});

test("unknown module ID never becomes supported, even with valid hashes", async () => {
  const f = fixture();
  f.bytes.fill(0xab, 0x40, 0x60);
  const r = await validateNsoSegments(f.source);
  assert.equal(r.moduleId, "ab".repeat(32));
  assert.equal(r.supportedGameBuild, false);
});

test("budgets and malformed metadata reject before payload reads", async () => {
  for (const limits of [
    { maxSegmentBytes: 2 },
    { maxTotalDecodedBytes: 8 },
    { maxWorkingBytes: 100 },
    { maxImageBytes: 4096 },
  ]) {
    const f = fixture();
    await assert.rejects(validateNsoSegments(f.source, { limits }), /budget/);
    assert.deepEqual(f.reads, [[0, 256]]);
  }
  for (const [offset, value] of [
    [0x0c, 0x40],
    [0x04, 1],
    [0x20, 0x100],
    [0x24, 0],
    [0x18, 0xffffffff],
  ]) {
    const f = fixture();
    f.view.setUint32(offset, value, true);
    await assert.rejects(validateNsoSegments(f.source));
    assert.deepEqual(f.reads, [[0, 256]]);
  }
  await assert.rejects(
    validateNsoSegments(fixture().source, { limits: { chunkBytes: MAX_READ_BYTES + 1 } }),
    /Chunk/,
  );
  await assert.rejects(
    validateNsoSegments(fixture().source, { limits: { maxSegmentBytes: Infinity } }),
    /Invalid/,
  );
});

test("BSS is bounded and cannot overlap another segment", async () => {
  const f = fixture();
  f.view.setUint32(0x34, 0x100, true);
  f.view.setUint32(0x3c, 0x2000, true);
  await assert.rejects(validateNsoSegments(f.source), /BSS overlaps/);
});

test("payload reads are chunked and short reads rejected", async () => {
  const f = fixture();
  await validateNsoSegments(f.source, { limits: { chunkBytes: 2 } });
  assert.ok(f.reads.slice(1).every(([, length]) => length <= 2));
  const bad = fixture();
  bad.source.read = async () => new Uint8Array(1);
  await assert.rejects(validateNsoSegments(bad.source), /Short or invalid/);
});

test("cancellation before reads and during LZ4 chunks", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  await assert.rejects(validateNsoSegments(f.source, { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(f.reads.length, 0);
  const active = new AbortController();
  const promise = decodeLz4Block(hex("1f61010007506161616161"), 32, {
    signal: active.signal,
    limits: { chunkBytes: 1 },
  });
  setTimeout(() => active.abort(), 0);
  await assert.rejects(promise, { name: "AbortError" });
});

test("cancellation during payload reads is honored", async () => {
  const f = fixture(),
    controller = new AbortController();
  const read = f.source.read;
  f.source.read = async (offset, length) => {
    const bytes = await read(offset, length);
    if (offset >= 256) controller.abort();
    return bytes;
  };
  await assert.rejects(validateNsoSegments(f.source, { signal: controller.signal }), {
    name: "AbortError",
  });
});

test("cancellation during WebCrypto rejects without waiting for digest", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis.crypto.subtle, "digest", () => {
    setTimeout(() => controller.abort(), 0);
    return new Promise(() => {});
  });
  await assert.rejects(validateNsoSegments(fixture().source, { signal: controller.signal }), {
    name: "AbortError",
  });
});

test("compressed declared expansion is budgeted before payload allocation/read", async () => {
  const f = fixture(0x3f);
  f.view.setUint32(0x18, 0x10000000, true);
  f.view.setUint32(0x24, 0x20000000, true);
  f.view.setUint32(0x34, 0x30000000, true);
  await assert.rejects(validateNsoSegments(f.source), /budget/);
  assert.deepEqual(f.reads, [[0, 256]]);
});

test("many short LZ4 sequences yield by accumulated work, not per sequence", async (t) => {
  // 一千个字面量 a、偏移 1、长度四字节的匹配，随后十二个尾部字面量；刻意使用短序列的有效手写块，未使用编码器。
  // 1,000 literal-a / offset-1 / four-byte matches, then 12 final literals.
  // A valid handcrafted block with deliberately short sequences, no encoder.
  const sequences = 1000;
  const input = new Uint8Array(sequences * 4 + 13);
  for (let i = 0; i < sequences; i++) input.set([0x10, 0x61, 1, 0], i * 4);
  input.set([0xc0, ...new Uint8Array(12).fill(0x61)], sequences * 4);
  const originalTimer = globalThis.setTimeout;
  let timerCalls = 0;
  t.mock.method(globalThis, "setTimeout", (...args) => {
    timerCalls++;
    return originalTimer(...args);
  });
  const result = await decodeLz4Block(input, sequences * 5 + 12, { limits: { chunkBytes: 256 } });
  assert.deepEqual(result, new Uint8Array(sequences * 5 + 12).fill(0x61));
  assert.ok(timerCalls > 0, "large decoding must yield for cancellation");
  assert.ok(
    timerCalls <= Math.ceil((input.length + result.length) / 256),
    `Unexpected per-sequence timers: ${timerCalls}`,
  );
});
