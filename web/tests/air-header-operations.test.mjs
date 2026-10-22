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

test("the guarded standard umbrella exposes atomic and barrier declarations", async () => {
  const stdlib = await read("include/metal_stdlib");
  const atomic = await read("include/metal_atomic");
  const apiSource = await read("air_compiler.cpp");
  assert.match(stdlib, /#include <metal_atomic>\s*#endif\s*$/);
  assert(stdlib.indexOf("#include <metal_atomic>") > stdlib.indexOf("#include <metal_control>"));
  assert(
    stdlib.indexOf("#define D2R_EXPERIMENTAL_METAL_STDLIB") <
      stdlib.indexOf("#include <metal_atomic>"),
  );
  assert(
    atomic.indexOf("#define D2R_EXPERIMENTAL_METAL_ATOMIC") <
      atomic.indexOf("#include <metal_stdlib>"),
  );
  assert(atomic.includes("enum class mem_flags { mem_threadgroup = 2 };"));
  assert(atomic.includes("void threadgroup_barrier(mem_flags flags)"));
  assert(
    apiSource.includes(
      'if (file->getName() == "/include/metal_atomic") return trustedAtomicDeclaration(function, attr);',
    ),
  );
  assert(
    apiSource.includes(
      'if (name=="air.wg.barrier" && (llvm::StringRef(stage)!="air.kernel" || !constant(0,2) || !constant(1,1))) return false;',
    ),
  );
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

test("quad tessellation factors use the verified shader half layout", async () => {
  const tessellation = await read("include/metal_tessellation");
  const fixtures = await read("operations_smoke.h");
  assert.match(
    tessellation,
    /struct MTLQuadTessellationFactorsHalf\s*\{\s*half edgeTessellationFactor\[4\];\s*half insideTessellationFactor\[2\];\s*\};/,
  );
  for (const assertion of [
    "sizeof(MTLQuadTessellationFactorsHalf)==12",
    "alignof(MTLQuadTessellationFactorsHalf)==2",
    "__builtin_offsetof(MTLQuadTessellationFactorsHalf,edgeTessellationFactor)==0",
    "__builtin_offsetof(MTLQuadTessellationFactorsHalf,insideTessellationFactor)==8",
  ]) {
    assert(tessellation.includes(assertion), assertion);
    assert(fixtures.includes(assertion), assertion);
  }
  assert(fixtures.includes("quad factors retain half-array IR layout"));
  assert(fixtures.includes("quad factors use half stores, not numeric integer conversion"));
});

test("Metal activates exactly the shared fp16 semantic gate before creating codegen", async () => {
  const apiSource = await read("air_compiler.cpp");
  const fixtures = await read("operations_smoke.h");
  const activation = 'compiler.getASTContext().getOpenCLFeatures().enable("cl_khr_fp16");';
  assert(apiSource.includes('#include "clang/AST/ASTContext.h"'));
  assert.match(
    apiSource,
    /if \(compiler\.getLangOpts\(\)\.Metal\)\s*compiler\.getASTContext\(\)\.getOpenCLFeatures\(\)\.enable\("cl_khr_fp16"\);/,
  );
  assert.equal(apiSource.split(activation).length - 1, 1);
  assert(apiSource.indexOf(activation) > apiSource.indexOf("CreateASTConsumer("));
  assert(
    apiSource.indexOf(activation) <
      apiSource.indexOf("auto codegen = clang::EmitLLVMOnlyAction::CreateASTConsumer"),
  );
  assert.doesNotMatch(apiSource, /-cl-ext=|#pragma OPENCL EXTENSION/);
  assert(fixtures.includes("for (const unsigned profile : {0u, 1u})"));
  for (const marker of [
    "native Metal half semantics in both profiles",
    "half helper preserves native argument and return ABI",
    "scalar and vector half arithmetic stay native",
    "half memory and explicit float conversions remain typed",
  ])
    assert(fixtures.includes(marker), marker);
});

test("only reference-established device uint add extends atomics to fragments", async () => {
  const apiSource = await read("air_compiler.cpp");
  const trust = await read("atomic_trust.inc");
  const fixtures = await read("operations_smoke.h");
  assert.match(
    apiSource,
    /const bool fragmentAdd=llvm::StringRef\(stage\)=="air\.fragment" &&\s*name=="air\.atomic\.global\.add\.u\.i32";/,
  );
  assert(
    apiSource.includes('(llvm::StringRef(stage)!="air.kernel" && !fragmentAdd) || !constant(2,0)'),
  );
  assert(
    apiSource.includes(
      '!constant(3,name.startswith("air.atomic.global.") ? 2 : 1) || !constant(4,1)',
    ),
  );
  assert(
    trust.includes(
      'const bool global=name=="air.atomic.global.add.u.i32" || name=="air.atomic.global.min.u.i32";',
    ),
  );
  assert(trust.includes("function->getNumParams()!=5 || !is(function->getReturnType(),B::UInt)"));
  assert(
    trust.includes(
      "pointee.getAddressSpace()!=(global ? clang::LangAS::opencl_global : clang::LangAS::opencl_local)",
    ),
  );
  for (const marker of [
    "fragment device atomic add",
    "fragment global min remains rejected",
    "fragment local atomics remain rejected",
    "vertex global add remains rejected",
    "fragment barrier remains rejected",
    "fragment atomic flags remain exact",
  ])
    assert(fixtures.includes(marker), marker);
});

test("real-WASM CI canary includes all five live operations in a fourth authored fixture", async () => {
  const canary = await read("../ci-compile-canary.mjs");
  const fixture = await read("../fixtures/msl-scalar-operations.metal");
  const cases = [...canary.matchAll(/stage: "(vertex|fragment|kernel)",\s*filename: "([^"]+)"/g)];
  assert.equal(cases.length, 10);
  assert.equal(new Set(cases.map((entry) => entry[1])).size, 3);
  assert(
    cases.some((entry) => entry[1] === "kernel" && entry[2] === "msl-scalar-operations.metal"),
  );
  assert(canary.includes("maxCompilations: cases.length"));
  assert(canary.includes("authored-ten-fixture-three-stage-compilation-and-container-integrity"));
  assert.match(canary, /adapter\.compile\(source,[\s\S]*?output: "metallib"/);
  assert.match(canary, /inspectCompiledMetalLibrary\(output\.bytes,/);
  assert.match(fixture, /kernel void main0\(constant float \*input/);
  assert.match(fixture, /constant int \*bits/);
  assert.match(fixture, /device MTLQuadTessellationFactorsHalf \*tess_output/);
  assert.match(fixture, /constant half \*half_input/);
  assert.match(
    fixture,
    /static __attribute__\(\(noinline\)\) half canary_half_sum\(half a, half b\)\s*\{\s*return a \+ b;/,
  );
  assert.match(fixture, /#include <metal_stdlib>/);
  assert.doesNotMatch(fixture, /#include <metal_atomic>/);
  for (const statement of [
    "math_output[0] = sin(input[0]);",
    "math_output[1] = cos(input[1]);",
    "math_output[2] = ceil(input[2]);",
    "math_output[3] = float(canary_half_sum(half_input[0], half_input[1]));",
    "integer_output[0] = reverse_bits(bits[0]);",
    "vote_output[0] = simd_all(bits[1] != 0) ? 1u : 0u;",
    "threadgroup_barrier(mem_flags::mem_threadgroup);",
    "tess_output[0].edgeTessellationFactor[i] = half(input[i + 3]);",
    "tess_output[0].insideTessellationFactor[i] = half(input[i + 7]);",
  ])
    assert(fixture.includes(statement), statement);
  assert(
    cases.some((entry) => entry[1] === "fragment" && entry[2] === "msl-fragment-atomic-add.metal"),
  );
  const fragmentFixture = await read("../fixtures/msl-fragment-atomic-add.metal");
  assert.match(
    fragmentFixture,
    /fragment AtomicFragmentResult main0\(device atomic_uint \*counters/,
  );
  assert.match(fragmentFixture, /constant uint \*input/);
  assert(
    fragmentFixture.includes(
      "atomic_fetch_add_explicit(&counters[input[0]], input[1], memory_order_relaxed)",
    ),
  );
  assert(fragmentFixture.includes("float4(previous == input[2] ? 1.0f : 0.0f)"));

  // Source delivery already includes every tracked file under the compiler
  // prefix, including this fixture once committed; no archive exception needed.
  const sourceArtifact = await readFile(
    new URL("../runtime-build/prepare-air-compiler-source.mjs", import.meta.url),
    "utf8",
  );
  assert(sourceArtifact.includes('const prefix = "web/toolchain/metal-air-compiler/";'));
  assert(sourceArtifact.includes('run("git", ["ls-files", "-z", "--", prefix])'));
});

test("real-WASM canaries retain named entries and public compiler regression inputs", async () => {
  const canary = await read("../ci-compile-canary.mjs");
  const cases = [...canary.matchAll(/stage: "(vertex|fragment|kernel)",\s*filename: "([^"]+)"/g)];
  assert.equal(new Set(cases.map((entry) => entry[2])).size, cases.length);
  for (const [stage, filename] of [
    ["fragment", "msl-internal-helper-function-constant.metal"],
    ["kernel", "msl-optimizer-bit-reversal.metal"],
    ["vertex", "msl-patch-entry-name.metal"],
    ["fragment", "constant-vector-pointer-reads.metal"],
    ["fragment", "direct-buffer-vector-pointer.metal"],
  ]) {
    assert(
      cases.some((entry) => entry[1] === stage && entry[2] === filename),
      filename,
    );
  }
  for (const entry of [
    "patch_linkage_probe",
    "constant_vector_pointer_reads",
    "direct_buffer_vector_pointer",
  ])
    assert(canary.includes(`entry: "${entry}"`), entry);
  assert.match(
    canary,
    /inspectCompiledMetalLibrary\(output\.bytes,\s*\{\s*entry: fixture\.entry \?\? "main0",\s*stage: fixture\.stage,/,
  );
  assert(canary.includes("minimumOS: [18, 0]"));
  assert(canary.includes("languageVersion: [3, 2]"));
  assert(canary.includes("metadataLengthIncludesPrefix: false"));
  assert(canary.includes("output?.bytes.fill(0)"));
  assert(canary.includes("adapter.dispose()"));

  const linkage = await read("../fixtures/msl-internal-helper-function-constant.metal");
  assert(linkage.includes("static __attribute__((noinline)) float add_bias(float value)"));
  assert(linkage.includes("constant bool enable_color [[function_constant(17)]]"));
  assert(linkage.includes("function_constant(enable_color)"));
  assert(linkage.includes("float4(add_bias(values[0]))"));
  const reversal = await read("../fixtures/msl-optimizer-bit-reversal.metal");
  assert(reversal.includes("uint bits = values[0]"));
  for (const width of [16, 8, 4, 2, 1]) {
    assert(reversal.includes(`bits >> ${width}`));
    assert(reversal.includes(`bits << ${width}`));
  }
  assert(reversal.includes("values[0] = bits"));
  assert.doesNotMatch(reversal, /\breverse_bits\s*\(/);

  const patch = await read("../fixtures/msl-patch-entry-name.metal");
  assert(patch.includes("#define PATCH_ENTRY_NAME patch_linkage_probe"));
  assert(patch.includes("[[patch(triangle, PATCH_CONTROL_POINTS)]] vertex"));
  assert(patch.includes("entry_bias(float value)"));
  assert(patch.includes("entry_bias(uint value)"));
  assert(patch.includes("input.points[0].position"));
  assert(patch.includes("entry_bias(coordinate.x)"));

  const pointer = await read("../fixtures/constant-vector-pointer-reads.metal");
  assert(pointer.includes("fragment float4 constant_vector_pointer_reads("));
  assert(pointer.includes("constant VectorStorage* data [[id(0)]]"));
  assert(pointer.includes("reinterpret_cast<constant int4*>(args.data)"));
  assert(pointer.includes("int4 selected = words[row]"));
  assert(pointer.includes("int seed = words[0][lane]"));
  assert(pointer.includes("return float4(float(selected.x ^ seed)"));
  const directPointer = await read("../fixtures/direct-buffer-vector-pointer.metal");
  assert(directPointer.includes("fragment float4 direct_buffer_vector_pointer("));
  assert(directPointer.includes("constant VectorStorage* data [[buffer(0)]]"));
  assert(directPointer.includes("reinterpret_cast<constant int4*>(data)"));
  assert(directPointer.includes("int4 selected = words[row]"));
  assert(directPointer.includes("int seed = words[0][lane]"));
  assert(directPointer.includes("return float4(float(selected.x ^ seed)"));

  // All fixed fixture paths stay within the tracked compiler-prefix source
  // copy closure; this does not execute or import the WASM canary.
  for (const entry of cases) {
    assert.match(entry[2], /^[A-Za-z0-9_-]+\.metal$/);
    assert((await read(`../fixtures/${entry[2]}`)).includes("#include <metal_stdlib>"));
  }
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
