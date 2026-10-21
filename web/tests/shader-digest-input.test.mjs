// 合成差分检查保留原生文件名/原始哈希顺序，不使用游戏数据。
// Synthetic differential checks preserve native filename/raw-hash ordering without game data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildShaderSourceDigestInput } from "../shader-pipeline.mjs";
const key = (n) => n.toString(16).padStart(16, "0");
const digest = (value) => createHash("sha256").update(value).digest();

test("single-buffer layout equals legacy concatenation and sequential native-style hashing", () => {
  for (const count of [1, 2, 6927, 16384]) {
    const keys = Array.from({ length: count }, (_, i) => key(i));
    const completed = new Map(keys.map((value) => [value, digest(`source ${value}\n`)]));
    const original = Buffer.concat(
      keys.map((value) => Buffer.concat([Buffer.from(`${value}_b.metal`), completed.get(value)])),
    );
    const actual = buildShaderSourceDigestInput(keys, completed);
    assert.equal(actual.byteLength, 56 * count);
    assert.equal(actual.buffer.byteLength, actual.byteLength);
    assert.deepEqual(Buffer.from(actual), original);
    const native = createHash("sha256");
    for (const value of keys) native.update(`${value}_b.metal`).update(completed.get(value));
    assert.equal(digest(actual).toString("hex"), native.digest("hex"));
    assert.deepEqual(completed.get(keys[0]), digest(`source ${keys[0]}\n`));
  }
});

test("digest input rejects excess counts, malformed hashes and noncanonical ordering", () => {
  const a = key(1),
    b = key(2),
    hashes = new Map([
      [a, new Uint8Array(32)],
      [b, new Uint8Array(32)],
    ]);
  for (const keys of [[], Array(16385).fill(a), [b, a], [a, a], ["INVALID"], [a, key(3)]])
    assert.throws(() => buildShaderSourceDigestInput(keys, hashes));
  for (const hash of [new Uint8Array(31), new Uint8Array(33), Array(32).fill(0), null])
    assert.throws(() => buildShaderSourceDigestInput([a], new Map([[a, hash]])));
});
