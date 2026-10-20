import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createDeflateBoundary } from "../deflate-boundary.mjs";
const fixtures = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      String.raw`
import json, random, zlib
rng = random.Random(19)
content = bytes(rng.choices(range(40), weights=range(1,41), k=65536))
result = []
for name, data, level, strategy in [('stored',content,0,zlib.Z_DEFAULT_STRATEGY), ('dynamic',content,6,zlib.Z_DEFAULT_STRATEGY), ('fixed', b'public synthetic bytes' * 1000, 6,zlib.Z_FIXED), ('empty',b'',6,zlib.Z_DEFAULT_STRATEGY)]:
 c = zlib.compressobj(level,zlib.DEFLATED,-15,8,strategy)
 encoded = c.compress(data) + c.flush()
 if name == 'dynamic': assert (encoded[0] >> 1) & 3 == 2
 assert zlib.decompress(encoded,-15) == data
 result.append({'name':name,'size':len(data),'encoded':encoded.hex()})
print(json.dumps(result))
`,
    ],
    { encoding: "utf8" },
  ),
);
for (const f of fixtures) {
  for (const chunkSize of [1, 7, 1024]) {
    test(`independent zlib ${f.name} with ${chunkSize}-byte boundaries`, () => {
      const scanner = createDeflateBoundary(f.size),
        encoded = Buffer.from(f.encoded, "hex");
      for (let p = 0; p < encoded.length; p += chunkSize)
        scanner.push(encoded.subarray(p, p + chunkSize));
      scanner.finish();
    });
  }
  test(`rejects ${f.name} trailing input independent of native decompressor`, () => {
    const scanner = createDeflateBoundary(f.size),
      encoded = Buffer.from(f.encoded, "hex");
    for (let p = 0; p < encoded.length; p += 1024) scanner.push(encoded.subarray(p, p + 1024));
    scanner.finish();
    assert.throws(() => scanner.push(Uint8Array.of(0)), /structure/);
  });
  test(`rejects ${f.name} truncation`, () => {
    const scanner = createDeflateBoundary(f.size),
      encoded = Buffer.from(f.encoded, "hex");
    for (let p = 0; p < encoded.length - 1; p += 1024)
      scanner.push(encoded.subarray(p, Math.min(p + 1024, encoded.length - 1)));
    assert.throws(() => scanner.finish(), /structure/);
  });
}
test("rejects reserved block and mismatched stored complement", () => {
  assert.throws(() => createDeflateBoundary(0).push(Uint8Array.of(7)), /structure/);
  assert.throws(() => createDeflateBoundary(1).push(Uint8Array.of(1, 1, 0, 0, 0, 65)), /structure/);
});

test("public scanner bounds expected size before parsing or allocation", () => {
  for (const size of [
    -1,
    1.5,
    NaN,
    Infinity,
    undefined,
    "1",
    64 * 1024 * 1024 + 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    assert.throws(() => createDeflateBoundary(size), /expected size/);
  }
  assert.doesNotThrow(() => createDeflateBoundary(0));
  assert.doesNotThrow(() => createDeflateBoundary(64 * 1024 * 1024));
});

test("public scanner rejects wrong input type and oversized slice before copying", () => {
  const scanner = createDeflateBoundary(0);
  const oversized = new Uint8Array(1025);
  oversized.subarray = () => assert.fail("must reject before copying input");
  for (const bytes of [
    null,
    undefined,
    [3, 0],
    new ArrayBuffer(2),
    new Uint16Array(2),
    oversized,
  ]) {
    assert.throws(() => scanner.push(bytes), /input slice/);
  }
  scanner.push(Uint8Array.of(3, 0));
  scanner.finish();
});
