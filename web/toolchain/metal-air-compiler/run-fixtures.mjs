// 运行 AIR 编译器的固定输入用例；依据 web/toolchain/metal-air-compiler 的模块与调用约定。
// Run fixed-input cases for the AIR compiler using the module and calling contracts in web/toolchain/metal-air-compiler.
import process from "node:process";
// 仅为原生引导检查，不是浏览器运行时或 iOS 验收。
// Native bootstrap checks only. This is not the browser runtime or iOS acceptance.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";
const root = dirname(fileURLToPath(import.meta.url));
assert(process.argv[2], "An explicit externally built fork clang path is required");
const clang = process.argv[2];
const out = process.env.AIR_TEST_OUTPUT_DIR || join(root, "fixture-results");
mkdirSync(out, { recursive: true });
const base = [
  "-cc1",
  "-triple",
  "air64-apple-ios18.0.0",
  "-x",
  "metal",
  "-std=metal3.2",
  "-Werror=unknown-attributes",
  "-emit-llvm",
  "-o",
  "-",
];
function compile(file, extra = []) {
  return spawnSync(clang, [...base, ...extra, file], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}
const positive = compile(join(root, "fixtures/buffer-bindings.metal"));
writeFileSync(join(out, "positive.stderr"), positive.stderr || String(positive.error || ""));
assert.equal(positive.status, 0, "compiler rejected positive fixture");
writeFileSync(join(out, "positive.ll"), positive.stdout);
// 检查每个参数的精确元数据，而非只确认索引在某处存在。
// Check exact per-parameter metadata, not merely that indices exist somewhere.
const definitions = positive.stdout.split("\n").filter((s) => /^!\d+ = !\{/.test(s));
for (const [name, index] of [
  ["input", 7],
  ["output", 2],
]) {
  const matching = definitions.filter((s) => s.includes(`!"air.arg_name", !"${name}"`));
  assert.equal(matching.length, 1, `one metadata record for ${name}`);
  assert(
    matching[0].includes(`!"air.location_index", i32 ${index},`),
    `${name} must keep explicit binding ${index}`,
  );
}
const errors = [
  "NEGATIVE",
  "RANGE",
  "TYPE",
  "DUPLICATE_ATTRIBUTE",
  "DUPLICATE_INDEX",
  "MIXED",
  "DYNAMIC",
  "PRIVATE",
];
for (const define of errors) {
  const result = compile(join(root, "fixtures/buffer-binding-errors.metal"), [`-D${define}`]);
  writeFileSync(join(out, `${define}.stderr`), result.stderr || String(result.error || ""));
  assert.notEqual(result.status, 0, `${define} should reject`);
  assert.match(result.stderr, /error:/, `${define} should diagnose rather than crash`);
  assert.doesNotMatch(
    result.stderr,
    /PLEASE submit a bug report|Stack dump:/,
    `${define} must not crash`,
  );
}
console.log(
  "Native compiler fixtures passed: explicit sparse buffer locations and eight rejecting cases. No WASM or Metal acceptance claimed.",
);
