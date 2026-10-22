import assert from "node:assert/strict";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
assert(process.argv[2], "Usage: node run-nan-fixtures.mjs /path/to/clang [header-directory]");
const clang = resolve(process.argv[2]);
const headers = resolve(process.argv[3] || join(root, "api/include"));
const args = [
  "-cc1",
  "-triple",
  "air64-apple-ios18.0.0",
  "-x",
  "metal",
  "-std=metal3.2",
  "-O2",
  "-flegacy-pass-manager",
  "-Werror=unknown-attributes",
  "-I",
  headers,
  "-DD2R_AIR_FAST_MATH=1",
  "-cl-single-precision-constant",
  "-ffast-math",
  "-ffp-contract=fast",
  "-fno-signed-zeros",
  "-menable-no-infs",
  "-menable-no-nans",
  "-emit-llvm",
  "-o",
  "-",
];
function compile(extra, input) {
  const r = spawnSync(clang, [...args, ...extra], {
    input,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const dynamic = compile([join(root, "fixtures/nan-select.metal")]);
assert(
  dynamic.includes("2147483647") && dynamic.includes("2139095040") && dynamic.includes("icmp ugt"),
);
assert(dynamic.includes("select "), "Vector sanitization must survive fast math");
for (const [bits, expected] of [
  [0, 0],
  [0x80000000, 0],
  [0x3f800000, 0],
  [0xbf800000, 0],
  [0x7f800000, 0],
  [0xff800000, 0],
  [0x7fc00000, 1],
  [0xffc00000, 1],
  [0x7f800001, 1],
  [0xff800001, 1],
]) {
  const source = `#include <metal_stdlib>\nusing namespace metal; kernel void k(device uint *out [[buffer(0)]]) {out[0]=isnan(as_type<float>((uint)0x${bits.toString(16)}));}`;
  const ir = compile(["-"], source);
  assert(
    new RegExp(`store i32 ${expected},`).test(ir),
    `Unexpected constant classification for ${bits.toString(16)}`,
  );
}
console.log(
  "Dynamic NaN classification/vector select and ten IEEE constant-pattern IR cases passed. No shader runtime evaluation claimed.",
);
