import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readAirHeaderIdentity } from "../toolchain/metal-air-compiler/header-identity.mjs";

const api = new URL("../toolchain/metal-air-compiler/api/", import.meta.url);
const read = (path) => readFile(new URL(path, api), "utf8");
const digest = (value) => createHash("sha256").update(value).digest("hex");

// These are source-contract checks only. Actual frontend/IR behavior is checked
// by the authored header smoke cases when a compiler build is available.
test("scalar sin, cos and ceil use exact AIR labels and explicit fast exports", async () => {
  const math = await read("include/metal_math");
  const apiSource = await read("air_compiler.cpp");
  const profileStart = math.indexOf("#if defined(D2R_AIR_FAST_MATH)");
  const profileEnd = math.indexOf("#endif", profileStart);
  assert(profileStart >= 0 && profileEnd > profileStart);
  for (const operation of ["sin", "cos", "ceil"]) {
    assert(
      math.includes(
        `float ${operation}(float) __asm__("air.fast_${operation}.f32") __attribute__((const));`,
      ),
    );
    assert(math.includes(`template<class T> T ${operation}(T) = delete;`));
    assert(
      math.includes(
        `D2R_INLINE float ${operation}(float x) { return __air_detail::${operation}(x); }`,
      ),
    );
    const exports = [...math.matchAll(new RegExp(`using fast::${operation};`, "g"))];
    assert.equal(exports.length, 1);
    assert(exports[0].index > profileStart && exports[0].index < profileEnd);
    assert(apiSource.includes(`"air.fast_${operation}.f32"`));
  }
  assert.doesNotMatch(math, /__builtin_(?:sin|cos|ceil)|\bfmod\s*\(/);
});

test("bit reversal uses uint AIR ABI and bit-preserving signed wrappers", async () => {
  const integer = await read("include/metal_integer");
  const apiSource = await read("air_compiler.cpp");
  assert(integer.includes('uint reverse(uint) __asm__("air.reverse_bits.i32");'));
  assert(integer.includes("template<class T> T reverse_bits(T) = delete;"));
  assert(integer.includes("uint reverse_bits(uint x) { return __integer_detail::reverse(x); }"));
  assert(
    integer.includes(
      "int reverse_bits(int x) { return as_type<int>(reverse_bits(as_type<uint>(x))); }",
    ),
  );
  assert.doesNotMatch(integer, /__builtin_bitreverse/);
  assert(apiSource.includes('name=="air.reverse_bits.i32"'));
  const fixtures = await read("operations_smoke.h");
  assert(fixtures.includes('{"short", "ushort", "long", "ulong", "int2", "uint2"}'));
  assert(fixtures.includes("unsupported bit reversal width"));
});

test("SIMD all is convergent, boolean, and limited to compute by the API", async () => {
  const simd = await read("include/metal_simd");
  const apiSource = await read("air_compiler.cpp");
  assert(simd.includes('bool all(bool) __asm__("air.simd_all") __attribute__((convergent));'));
  assert.match(
    simd,
    /bool simd_all\(bool predicate\)\s*\{\s*return __simd_detail::all\(predicate\);/,
  );
  assert.match(
    apiSource,
    /name=="air\.simd_all"\) && llvm::StringRef\(stage\)!="air\.kernel"\) return false;/,
  );
  assert.match(
    apiSource,
    /return name=="air\.simd_all" && function->getReturnType\(\)->isSpecificBuiltinType\(clang::BuiltinType::Bool\);/,
  );
  assert.match(
    apiSource,
    /hasAttr<clang::ConstAttr>\(\) \|\| function->hasAttr<clang::PureAttr>\(\)/,
  );
  assert.match(apiSource, /invocation->getLangOpts\(\)->ConvergentFunctions = true;/);
});

test("assembly trust remains tied to physical header provenance and exact declarations", async () => {
  const apiSource = await read("air_compiler.cpp");
  assert.match(apiSource, /function->isVariadic\(\) \|\| function->hasBody\(\)/);
  assert.match(apiSource, /loc\.isInvalid\(\) \|\| loc\.isMacroID\(\)/);
  for (const location of [
    "sm.getSpellingLoc(decl->getLocation())",
    "sm.getExpansionLoc(decl->getLocation())",
    "attr->getLocation()",
  ])
    assert(apiSource.includes(`!trusted(${location})`));
  assert.match(apiSource, /getFileEntryRefForID\(sm\.getFileID\(loc\)\)/);
  assert.match(apiSource, /function->getNumParams\(\) != count/);
  assert.match(apiSource, /for \(const auto \*parameter : function->parameters\(\)\)/);
});

test("authored executable fixtures are wired into the existing header smoke suite", async () => {
  const smoke = await read("header_smoke.cpp");
  const fixtures = await read("operations_smoke.h");
  assert(smoke.includes('#include "operations_smoke.h"'));
  assert(smoke.includes("failures+=checkMissingOperations();"));
  for (const marker of [
    "exact scalar math AIR signature",
    "exact bit reversal AIR signature",
    "exact SIMD all AIR signature",
    "SIMD all rejected outside compute",
    "SIMD all helper rejected outside compute",
    "counterfeit AIR label rejected",
    "assembly and assembly symbol labels are unsupported",
    "air_result_size(result) == 0",
  ])
    assert(fixtures.includes(marker), marker);
});

test("real-WASM CI canary includes all five live operations in a fourth authored fixture", async () => {
  const canary = await read("../ci-compile-canary.mjs");
  const fixture = await read("../fixtures/msl-scalar-operations.metal");
  const cases = [...canary.matchAll(/stage: "(vertex|fragment|kernel)", filename: "([^"]+)"/g)];
  assert.equal(cases.length, 4);
  assert.equal(new Set(cases.map((entry) => entry[1])).size, 3);
  assert(
    cases.some((entry) => entry[1] === "kernel" && entry[2] === "msl-scalar-operations.metal"),
  );
  assert(canary.includes("maxCompilations: cases.length"));
  assert(canary.includes("authored-four-fixture-three-stage-compilation-and-container-integrity"));
  assert.match(canary, /adapter\.compile\(source,[\s\S]*?output: "metallib"/);
  assert.match(canary, /inspectCompiledMetalLibrary\(output\.bytes,/);
  assert.match(fixture, /kernel void main0\(constant float \*input/);
  assert.match(fixture, /constant int \*bits/);
  for (const statement of [
    "math_output[0] = sin(input[0]);",
    "math_output[1] = cos(input[1]);",
    "math_output[2] = ceil(input[2]);",
    "integer_output[0] = reverse_bits(bits[0]);",
    "vote_output[0] = simd_all(bits[1] != 0) ? 1u : 0u;",
  ])
    assert(fixture.includes(statement), statement);

  // Source delivery already includes every tracked file under the compiler
  // prefix, including this fixture once committed; no archive exception needed.
  const sourceArtifact = await readFile(
    new URL("../runtime-build/prepare-air-compiler-source.mjs", import.meta.url),
    "utf8",
  );
  assert(sourceArtifact.includes('const prefix = "web/toolchain/metal-air-compiler/";'));
  assert(sourceArtifact.includes('run("git", ["ls-files", "-z", "--", prefix])'));
});

test("header identity still fingerprints the full fixed bundle without a pinned replacement", async () => {
  const cmake = await read("CMakeLists.txt");
  const paths = cmake
    .match(/set\(AIR_HEADER_PATHS\s+([^)]*)\)/)[1]
    .trim()
    .split(/\s+/)
    .sort();
  for (const header of ["metal_math", "metal_integer", "metal_simd"])
    assert(paths.includes(header));
  let fingerprint = "d2r-air-header-bundle-v2\n";
  for (const path of paths) fingerprint += `${path}:${digest(await read(`include/${path}`))}\n`;
  assert.equal(await readAirHeaderIdentity(fileURLToPath(api), 2), digest(fingerprint));
});
