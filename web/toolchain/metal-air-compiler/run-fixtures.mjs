import process from "node:process";
// Native bootstrap checks only. This is not the browser runtime or iOS acceptance.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";
const root = dirname(fileURLToPath(import.meta.url));
const clang = process.argv[2] || join(root, "build/bin/clang");
const out = process.env.AIR_TEST_OUTPUT_DIR || join(root, "fixture-results");
mkdirSync(out, { recursive: true });
const base = [
  "-cc1",
  "-triple",
  "air64-apple-ios18.0.0",
  "-x",
  "metal",
  "-std=metal3.0",
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
