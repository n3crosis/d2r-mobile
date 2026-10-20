// 通过合成构建凭据验证可选模块的固定编译器、来源与内存契约。
// Verify pinned compiler, source and memory contracts through synthetic optional-module receipts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateOptionalCodecReceipts } from "../runtime-build/package.mjs";
const source = JSON.parse(
  await readFile(
    new URL("../toolchain/sha256-stream-wasm/source-pin.json", import.meta.url),
    "utf8",
  ),
);
function fixture() {
  return {
    astcCommit: "2ff200e08c98a61775351687ea2b5d38e455ad8b\n",
    astcCompiler: "emcc (Emscripten gcc/clang-like replacement) 4.0.20\n",
    shaSourcePin: structuredClone(source),
    shaReport: {
      schemaVersion: 1,
      source: structuredClone(source),
      emsdk: "4.0.20",
      compilerVersion: "emcc (Emscripten gcc/clang-like replacement) 4.0.20",
      memoryBytes: 262144,
      stackBytes: 16384,
      chunkBytes: 65536,
      hostImports: 0,
      memoryGrowth: false,
      bytes: 1024,
      sha256: "a".repeat(64),
    },
  };
}
test("optional codecs retain exact pinned source/compiler and SHA memory receipts", () => {
  assert.deepEqual(validateOptionalCodecReceipts(fixture()), {
    bytes: 1024,
    sha256: "a".repeat(64),
  });
});
test("changed source, compiler, SHA ABI or artifact receipt rejects", () => {
  for (const mutate of [
    (value) => (value.astcCommit = "0".repeat(40)),
    (value) => (value.astcCompiler = value.astcCompiler.replace("4.0.20", "4.0.21")),
    (value) => (value.shaReport.source.commit = "0".repeat(40)),
    (value) => (value.shaReport.source.files["mbedtls/LICENSE"].sha256 = "0".repeat(64)),
    (value) => (value.shaReport.emsdk = "4.0.21"),
    (value) => (value.shaReport.compilerVersion = "emcc 4.0.21"),
    (value) => value.shaReport.memoryBytes++,
    (value) => value.shaReport.stackBytes++,
    (value) => value.shaReport.chunkBytes++,
    (value) => (value.shaReport.hostImports = 1),
    (value) => (value.shaReport.memoryGrowth = true),
    (value) => (value.shaReport.bytes = 0),
    (value) => (value.shaReport.bytes = 64 * 1024 * 1024 + 1),
    (value) => (value.shaReport.sha256 = "bad"),
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => validateOptionalCodecReceipts(value), /codec build receipt/);
  }
});
