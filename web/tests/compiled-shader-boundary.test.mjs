import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  acceptCompiledShaderOutput,
  inspectCompiledMetalLibrary,
} from "../compiled-shader-boundary.mjs";
const enc = new TextEncoder();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function u64(n) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}
function concat(...parts) {
  const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    b.set(p, o);
    o += p.length;
  }
  return b;
}
const tag = (name, bytes) => concat(enc.encode(name), u16(bytes.length), bytes);
// 合成容器仅测试边界，载荷不是可执行着色器，也不证明真实编译成功。
// Synthetic containers test the boundary only; their payload is not an executable shader or compilation proof.
function fixture({ wrapped = false } = {}) {
  let bitcode = new Uint8Array([0x42, 0x43, 0xc0, 0xde, 0, 0, 0, 0]);
  if (wrapped)
    bitcode = concat(u32(0x0b17c0de), u32(0), u32(20), u32(bitcode.length), u32(0), bitcode);
  const body = concat(
    tag("NAME", enc.encode("main0\0")),
    tag("TYPE", new Uint8Array([1])),
    tag("HASH", new Uint8Array(createHash("sha256").update(bitcode).digest())),
    tag("MDSZ", u64(bitcode.length)),
    tag("OFFT", concat(u64(0), u64(0), u64(0))),
    tag("VERS", concat(u16(2), u16(6), u16(2), u16(3))),
    enc.encode("ENDT"),
  );
  const functions = concat(u32(1), u32(body.length + 4), body);
  const metadata = concat(u32(4), enc.encode("ENDT"));
  const header = new Uint8Array(88),
    view = new DataView(header.buffer);
  header.set(enc.encode("MTLB"));
  view.setUint16(4, 1, true);
  view.setUint16(6, 2, true);
  view.setUint16(8, 7, true);
  header[11] = 0x82;
  view.setUint16(12, 18, true);
  let start = 88;
  for (const [i, part] of [functions, metadata, metadata, bitcode].entries()) {
    header.set(u64(start), 24 + i * 16);
    header.set(u64(part.length - (i === 0 ? 4 : 0)), 32 + i * 16);
    start += part.length;
  }
  header.set(u64(start), 16);
  return concat(header, functions, metadata, metadata, bitcode);
}
function input(binary = fixture()) {
  return {
    source: "fragment float4 main0() { return 1; }\n",
    binary,
    compiler: { id: "test-only", assetSha256: "1".repeat(64) },
    options: { platform: "ios", minimumOS: [18, 0], languageVersion: [2, 3], fastMath: false },
    expected: {
      key: "0000000000000001",
      variant: "b",
      entry: "main0",
      stage: "fragment",
      sourceSetDigest: "be59c864f087b377",
      sourceSha256: hash("fragment float4 main0() { return 1; }\n"),
    },
  };
}
for (const wrapped of [false, true])
  test(`binds source/compiler/options/output for ${wrapped ? "wrapped" : "raw"} bitcode envelope`, async () => {
    const request = input(fixture({ wrapped }));
    const result = await acceptCompiledShaderOutput(request);
    assert.notEqual(result.bytes, request.binary);
    assert.deepEqual(result.bytes, request.binary);
    assert.equal(result.receipt.validation, "container-and-integrity-only");
    assert.equal(result.receipt.outputSha256, hash(request.binary));
    assert.equal(result.receiptSha256, hash(JSON.stringify(result.receipt)));
    assert.equal(result.receipt.sourceSetDigest, request.expected.sourceSetDigest);
    assert.equal(result.receipt.metalCompiled, undefined);
    assert.equal(Object.isFrozen(result.receipt.options.minimumOS), true);
  });
test("normalizes only CRLF just like the existing source-digest contract", async () => {
  const request = input();
  request.source = request.source.replaceAll("\n", "\r\n");
  assert.equal(
    (await acceptCompiledShaderOutput(request)).receipt.sourceSha256,
    request.expected.sourceSha256,
  );
  request.source += "\r";
  await assert.rejects(acceptCompiledShaderOutput(request), /source digest mismatch/);
});
test("snapshots output, identity and options before yielding", async () => {
  const request = input(),
    original = request.binary.slice();
  const pending = acceptCompiledShaderOutput(request);
  request.binary.fill(0);
  request.expected.entry = "wrong";
  request.options.minimumOS[0] = 99;
  request.compiler.id = "wrong";
  const result = await pending;
  assert.deepEqual(result.bytes, original);
  assert.equal(result.receipt.entry, "main0");
  assert.equal(result.receipt.compiler.id, "test-only");
  assert.deepEqual(result.receipt.options.minimumOS, [18, 0]);
});
for (const [name, mutate, error] of [
  [
    "source masquerading as metallib",
    (r) => r.binary.set(enc.encode("source")),
    /not a compiled library/,
  ],
  ["macOS target", (r) => (r.binary[11] = 0x81), /not an iOS/],
  ["simulator target", (r) => (r.binary[11] = 0x87), /not an iOS/],
  ["dynamic library", (r) => (r.binary[10] = 2), /not an iOS/],
  ["OS mismatch", (r) => (r.options.minimumOS[0] = 17), /target OS mismatch/],
  ["language mismatch", (r) => (r.options.languageVersion[1] = 4), /language version mismatch/],
  ["wrong entry", (r) => (r.expected.entry = "other"), /entry or stage mismatch/],
  ["wrong stage", (r) => (r.expected.stage = "vertex"), /entry or stage mismatch/],
  [
    "incorrect source digest",
    (r) => (r.expected.sourceSha256 = "2".repeat(64)),
    /source digest mismatch/,
  ],
  ["size mismatch", (r) => (r.binary[16] ^= 1), /file size mismatch/],
  ["unsafe offset", (r) => r.binary.fill(255, 24, 32), /oversized offset/],
  ["section overlap", (r) => r.binary.set(u64(88), 40), /overlapping sections/],
  ["empty function list", (r) => r.binary.set(u32(0), 88), /invalid function count/],
  ["bad group length", (r) => r.binary.set(u32(0xffffffff), 92), /section out of bounds/],
  ["corrupted bitcode", (r) => (r.binary[r.binary.length - 1] ^= 1), /bitcode digest mismatch/],
  ["invalid bitcode magic", (r) => (r.binary[r.binary.length - 8] = 0), /bitcode envelope/],
  [
    "empty public metadata",
    (r) => {
      const v = new DataView(r.binary.buffer);
      r.binary.set(u32(0), Number(v.getBigUint64(40, true)));
    },
    /invalid metadata group length/,
  ],
])
  test(`rejects ${name}`, async () => {
    const request = input();
    mutate(request);
    await assert.rejects(acceptCompiledShaderOutput(request), error);
  });
test("rejects truncated bytes, detached-like empty output, and shared memory", async () => {
  for (const binary of [
    fixture().subarray(0, 87),
    new Uint8Array(),
    new Uint8Array(new SharedArrayBuffer(100)),
  ])
    await assert.rejects(acceptCompiledShaderOutput(input(binary)), /invalid output bytes/);
});
test("aborts both before work and while hashes are pending without modifying caller bytes", async () => {
  const controller = new AbortController(),
    request = input();
  request.signal = controller.signal;
  const before = request.binary.slice(),
    pending = acceptCompiledShaderOutput(request);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(request.binary, before);
  await assert.rejects(acceptCompiledShaderOutput(request), { name: "AbortError" });
});
test("changing compiler or fast-math options changes the receipt identity", async () => {
  const a = input(),
    b = input(),
    c = input();
  b.compiler.assetSha256 = "3".repeat(64);
  c.options.fastMath = true;
  const results = await Promise.all([a, b, c].map(acceptCompiledShaderOutput));
  assert.equal(new Set(results.map((r) => r.receiptSha256)).size, 3);
  assert.equal(new Set(results.map((r) => r.receipt.outputSha256)).size, 1);
});

test("does not silently omit unknown compiler options from the receipt", async () => {
  const request = input();
  request.options.defines = { CHANGE_SHADER: 1 };
  await assert.rejects(acceptCompiledShaderOutput(request), /invalid compiler options/);
});

for (const sectionOffset of [40, 56]) {
  for (const length of [8, 9, 0xffffffff])
    test(`rejects incorrect metadata group length ${length} at ${sectionOffset}`, async () => {
      const request = input();
      const view = new DataView(request.binary.buffer);
      request.binary.set(u32(length), Number(view.getBigUint64(sectionOffset, true)));
      await assert.rejects(
        acceptCompiledShaderOutput(request),
        /metadata group length|section out of bounds/,
      );
    });
}
test("target OS has separate uint8 minor and patch fields", async () => {
  const request = input();
  request.binary[14] = 3;
  request.options.minimumOS = [18, 3];
  assert.deepEqual((await acceptCompiledShaderOutput(request)).receipt.options.minimumOS, [18, 3]);
  request.binary[15] = 1;
  await assert.rejects(acceptCompiledShaderOutput(request), /unsupported target OS patch version/);
});

test("accepts the selected writer's UUID header extension and rejects malformed tags", async () => {
  const original = fixture(),
    view = new DataView(original.buffer);
  const offset = Number(view.getBigUint64(40, true));
  const extension = concat(tag("UUID", new Uint8Array(16)), enc.encode("ENDT"));
  const binary = concat(original.subarray(0, offset), extension, original.subarray(offset));
  binary.set(u64(binary.length), 16);
  for (const field of [40, 56, 72])
    binary.set(u64(Number(view.getBigUint64(field, true)) + extension.length), field);
  await acceptCompiledShaderOutput(input(binary));
  binary.set(u16(0xffff), offset + 4);
  await assert.rejects(acceptCompiledShaderOutput(input(binary)), /section out of bounds/);
});

test("production accepts only Xcode metadata lengths; legacy floor layout is diagnostic-only", async () => {
  const binary = fixture(),
    view = new DataView(binary.buffer);
  const options = {
    entry: "main0",
    stage: "fragment",
    minimumOS: [18, 0],
    languageVersion: [2, 3],
    metadataLengthIncludesPrefix: false,
  };
  assert.equal(
    (await inspectCompiledMetalLibrary(binary, options)).validation,
    "container-and-integrity-only",
  );
  await acceptCompiledShaderOutput(input(binary));
  await assert.rejects(
    inspectCompiledMetalLibrary(binary, { ...options, metadataLengthIncludesPrefix: true }),
    /invalid metadata group length/,
  );
  for (const field of [40, 56]) binary.set(u32(8), Number(view.getBigUint64(field, true)));
  await assert.rejects(inspectCompiledMetalLibrary(binary, options), /section out of bounds/);
  await assert.rejects(acceptCompiledShaderOutput(input(binary)), /section out of bounds/);
  const result = await inspectCompiledMetalLibrary(binary, {
    ...options,
    metadataLengthIncludesPrefix: true,
  });
  assert.equal(result.compiler, undefined);
  assert.deepEqual(result.functions[0].airVersion, [2, 6]);
  assert.equal(result.outputSha256, hash(binary));
  await assert.rejects(
    inspectCompiledMetalLibrary(binary, { ...options, metadataLengthIncludesPrefix: undefined }),
    /invalid structural expectations/,
  );
});
