// 验证 checksum-verifier 的约定与边界；依据 ../vendor/spark-md5-3.0.2/spark-md5.mjs、../checksum-verifier.mjs 及本文件的测试断言。
// Verify checksum-verifier contracts and boundaries against ../vendor/spark-md5-3.0.2/spark-md5.mjs、../checksum-verifier.mjs and this file's assertions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import SparkMD5 from "../vendor/spark-md5-3.0.2/spark-md5.mjs";
import { MD5_CHUNK_BYTES, verifyMd5 } from "../checksum-verifier.mjs";
import { fileSource } from "../preflight.mjs";
import { decodeArchiveRecord } from "../archive-reader.mjs";

const digest = (bytes) => createHash("md5").update(bytes).digest("hex");
const encode = (text) => new TextEncoder().encode(text);

// RFC 1321 第 A.5 节测试集，使用公开的合成算法测试向量。
// RFC 1321 section A.5 test suite. Synthetic, public algorithm test vectors.
const vectors = [
  ["", "d41d8cd98f00b204e9800998ecf8427e"],
  ["a", "0cc175b9c0f1b6a831c399e269772661"],
  ["abc", "900150983cd24fb0d6963f7d28e17f72"],
  ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
  ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
  [
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    "d174ab98d277d9f5a5611c2c9f419d9f",
  ],
  [
    "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
    "57edf4a22be3c955ac49da2e2107b67a",
  ],
];

for (const [input, expected] of vectors) {
  test(`RFC 1321 vector: ${JSON.stringify(input)}`, async () => {
    assert.equal(await verifyMd5(encode(input), expected), true);
    assert.equal(await verifyMd5(encode(input), expected.toUpperCase()), true);
  });
}

test("exact nonzero-offset views match independent Node crypto across block/chunk boundaries", async () => {
  for (const length of [
    0,
    1,
    55,
    56,
    63,
    64,
    65,
    MD5_CHUNK_BYTES - 1,
    MD5_CHUNK_BYTES,
    MD5_CHUNK_BYTES + 1,
    MD5_CHUNK_BYTES * 3 + 63,
  ]) {
    for (const offset of [1, 7, 65]) {
      const backing = Uint8Array.from(
        { length: offset + length + 91 },
        (_, i) => (i * 37 + 19) % 256,
      );
      const view = backing.subarray(offset, offset + length);
      assert.equal(await verifyMd5(view, digest(view)), true, `${offset}/${length}`);
      assert.equal(
        await verifyMd5(view, digest(backing)),
        false,
        `${offset}/${length} excludes padding`,
      );
    }
  }
});

test("rejects malformed digests and non-Uint8Array input", async () => {
  for (const expected of [
    null,
    undefined,
    1,
    "",
    "0".repeat(31),
    "0".repeat(33),
    "g".repeat(32),
    `${"0".repeat(32)}\n`,
  ]) {
    await assert.rejects(verifyMd5(new Uint8Array(), expected), /32-character MD5/);
  }
  for (const bytes of [null, [], new ArrayBuffer(1), new DataView(new ArrayBuffer(1))]) {
    await assert.rejects(verifyMd5(bytes, vectors[0][1]), /Uint8Array/);
  }
});

test("digest mismatch returns exactly false", async () => {
  assert.equal(await verifyMd5(encode("abc"), vectors[0][1]), false);
});

test("already-aborted signals reject with their original reason, including empty input", async () => {
  const reason = new Error("cancel checksum");
  const signal = AbortSignal.abort(reason);
  await assert.rejects(
    verifyMd5(new Uint8Array(), vectors[0][1], { signal }),
    (error) => error === reason,
  );
});

test("task-level cancellation interrupts incremental hashing", async () => {
  const controller = new AbortController();
  const reason = new Error("stop between chunks");
  const bytes = new Uint8Array(MD5_CHUNK_BYTES * 4);
  const verification = verifyMd5(bytes, digest(bytes), { signal: controller.signal });
  setTimeout(() => controller.abort(reason), 0);
  await assert.rejects(verification, (error) => error === reason);
  assert.equal(await verifyMd5(encode("abc"), vectors[2][1]), true);
});

test("concurrent calls do not share hash state", async () => {
  const inputs = [encode("abc"), new Uint8Array(MD5_CHUNK_BYTES + 7).fill(17)];
  assert.deepEqual(await Promise.all(inputs.map((bytes) => verifyMd5(bytes, digest(bytes)))), [
    true,
    true,
  ]);
});

test("archive decoder accepts adapter and still rejects mismatching CKey", async () => {
  const bytes = encode("synthetic archive checksum fixture");
  const source = fileSource(new Blob([bytes]));
  const record = {
    offset: 0,
    encodedSize: bytes.length,
    decodedSize: bytes.length,
    encoding: "n",
    ckey: digest(bytes),
  };
  assert.deepEqual(await decodeArchiveRecord(source, record, { verifyMd5 }), bytes);
  await assert.rejects(
    decodeArchiveRecord(source, { ...record, ckey: vectors[0][1] }, { verifyMd5 }),
    /MD5 mismatch/,
  );
});

test("incremental calls never exceed the bounded chunk size or widen the input view", async () => {
  const original = SparkMD5.ArrayBuffer.prototype.append;
  const backing = new Uint8Array(MD5_CHUNK_BYTES * 3 + 100).fill(29);
  const bytes = backing.subarray(13, backing.length - 19);
  const chunks = [];
  SparkMD5.ArrayBuffer.prototype.append = function (view) {
    assert.ok(view instanceof Uint8Array);
    assert.ok(view.byteLength <= MD5_CHUNK_BYTES);
    assert.equal(view.buffer, bytes.buffer);
    assert.equal(view.byteOffset, bytes.byteOffset + chunks.reduce((sum, size) => sum + size, 0));
    chunks.push(view.byteLength);
    return original.call(this, view);
  };
  try {
    assert.equal(await verifyMd5(bytes, digest(bytes)), true);
    assert.equal(
      chunks.reduce((sum, size) => sum + size, 0),
      bytes.byteLength,
    );
    assert.equal(chunks.length, Math.ceil(bytes.byteLength / MD5_CHUNK_BYTES));
  } finally {
    SparkMD5.ArrayBuffer.prototype.append = original;
  }
});

test("vendored source and MIT license match documented SHA-256 fingerprints", () => {
  for (const [file, expected] of [
    ["spark-md5.mjs", "bf574e66f46dca229613e716e02146cd45859f46b92014f2503db535475d9605"],
    ["LICENSE2", "6e7abbd885f650c938cf377a6edcad56c7dcb61de092853af6141d806f8c9f04"],
  ]) {
    const contents = readFileSync(new URL(`../vendor/spark-md5-3.0.2/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(contents).digest("hex"), expected);
  }
});
