// 验证 air-header-operations 的约定与边界；依据 ./fixtures/air-fork-source/fork-source.mjs、./check-buffer-reflection.mjs 及本文件的测试断言。
// Verify air-header-operations contracts and boundaries against ./fixtures/air-fork-source/fork-source.mjs、./check-buffer-reflection.mjs and this file's assertions.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  sourceReviewOptions,
  readForkSource,
  readReviewedSourceLock,
} from "./fixtures/air-fork-source/fork-source.mjs";

const compiler = new URL("../toolchain/metal-air-compiler/", import.meta.url);
const nativeFixtures = new Set([
  "control_smoke.cpp",
  "header_smoke.cpp",
  "operations_smoke.h",
  "smoke.cpp",
]);
const read = (path) => {
  if (path.startsWith("../")) return readFile(new URL(path.slice(3), compiler), "utf8");
  if (nativeFixtures.has(path))
    return readFile(new URL(`fixtures/native-api/${path}`, compiler), "utf8");
  return readForkSource(`wasm/api/${path}`);
};
const digest = (value) => createHash("sha256").update(value).digest("hex");

// 仅检查源码约定；有编译器构建时，由自编头文件冒烟用例检查真实前端/IR 行为。
// These are source-contract checks only. Actual frontend/IR behavior is checked
// by the authored header smoke cases when a compiler build is available.
test(
  "scalar sin, cos and ceil use exact AIR labels and explicit fast exports",
  sourceReviewOptions,
  async () => {
    const math = await read("include/metal_math");
    const apiSource = await read("air_compiler.cpp");
    const profileStart = math.indexOf("#if defined(AIR_FAST_MATH)");
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
          `AIR_INLINE float ${operation}(float x) { return __air_detail::${operation}(x); }`,
        ),
      );
      const exports = [...math.matchAll(new RegExp(`using fast::${operation};`, "g"))];
      assert.equal(exports.length, 1);
      assert(exports[0].index > profileStart && exports[0].index < profileEnd);
      assert(apiSource.includes(`"air.fast_${operation}.f32"`));
    }
    assert.doesNotMatch(math, /__builtin_(?:sin|cos|ceil)|\bfmod\s*\(/);
  },
);

test(
  "bit reversal uses uint AIR ABI and bit-preserving signed wrappers",
  sourceReviewOptions,
  async () => {
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
  },
);

test(
  "SIMD all is convergent, boolean, and limited to compute by the API",
  sourceReviewOptions,
  async () => {
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
  },
);

test(
  "assembly trust remains tied to physical header provenance and exact declarations",
  sourceReviewOptions,
  async () => {
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
  },
);

test(
  "the guarded standard umbrella exposes atomic and barrier declarations",
  sourceReviewOptions,
  async () => {
    const stdlib = await read("include/metal_stdlib");
    const atomic = await read("include/metal_atomic");
    const apiSource = await read("air_compiler.cpp");
    assert.match(stdlib, /#include <metal_atomic>\s*#endif\s*$/);
    assert(stdlib.indexOf("#include <metal_atomic>") > stdlib.indexOf("#include <metal_control>"));
    assert(
      stdlib.indexOf("#define FLOOR_AIR_METAL_STDLIB") < stdlib.indexOf("#include <metal_atomic>"),
    );
    assert(
      atomic.indexOf("#define FLOOR_AIR_METAL_ATOMIC") < atomic.indexOf("#include <metal_stdlib>"),
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
  },
);

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

test(
  "quad tessellation factors use the verified shader half layout",
  sourceReviewOptions,
  async () => {
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
  },
);

test(
  "the authenticated Metal umbrella enables fp16 during parsing after semantic initialization",
  sourceReviewOptions,
  async () => {
    const apiSource = await read("air_compiler.cpp");
    const stdlib = await read("include/metal_stdlib");
    const fixtures = await read("operations_smoke.h");
    const activation = "#pragma OPENCL EXTENSION cl_khr_fp16 : enable";
    assert.equal(stdlib.split(activation).length - 1, 1);
    assert(stdlib.indexOf(activation) > stdlib.indexOf("#define FLOOR_AIR_METAL_STDLIB"));
    assert(stdlib.indexOf(activation) < stdlib.indexOf("namespace metal"));
    assert(stdlib.indexOf(activation) < stdlib.indexOf("AIR_VECTOR_TYPES(half)"));
    assert.doesNotMatch(stdlib, /#pragma OPENCL EXTENSION (?!cl_khr_fp16\s*: enable)/);
    // CreateASTConsumer 时机过早，Metal 的 C++20 模块读取器随后在 Sema::Initialize 中覆盖 OpenCLFeatures，不能恢复那个钩子。
    // CreateASTConsumer is too early: Metal's C++20 module reader subsequently
    // overwrites OpenCLFeatures during Sema::Initialize. Do not restore that hook.
    assert.doesNotMatch(apiSource, /getOpenCLFeatures\(\)\.enable/);
    assert.doesNotMatch(apiSource, /-cl-ext=|#pragma OPENCL EXTENSION/);
    assert(apiSource.includes('"-I/include", "-include", "metal_stdlib"'));
    assert(fixtures.includes("for (const unsigned profile : {0u, 1u})"));
    for (const marker of [
      "native Metal half semantics in both profiles",
      "half helper preserves native argument and return ABI",
      "scalar and vector half arithmetic stay native",
      "half memory and explicit float conversions remain typed",
    ])
      assert(fixtures.includes(marker), marker);
  },
);

test(
  "only reference-established device uint add extends atomics to fragments",
  sourceReviewOptions,
  async () => {
    const apiSource = await read("air_compiler.cpp");
    const trust = await read("atomic_trust.inc");
    const fixtures = await read("operations_smoke.h");
    assert.match(
      apiSource,
      /const bool fragmentAdd=llvm::StringRef\(stage\)=="air\.fragment" &&\s*name=="air\.atomic\.global\.add\.u\.i32";/,
    );
    assert(
      apiSource.includes(
        '(llvm::StringRef(stage)!="air.kernel" && !fragmentAdd) || !constant(2,0)',
      ),
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
  },
);

test("real-WASM CI canary includes all five live operations in a fourth authored fixture", async () => {
  const canary = await read("../ci-compile-canary.mjs");
  const fixture = await read("../fixtures/msl-scalar-operations.metal");
  const cases = [...canary.matchAll(/stage: "(vertex|fragment|kernel)",\s*filename: "([^"]+)"/g)];
  assert.equal(cases.length, 19);
  assert.equal(new Set(cases.map((entry) => entry[1])).size, 3);
  assert(
    cases.some((entry) => entry[1] === "kernel" && entry[2] === "msl-scalar-operations.metal"),
  );
  assert(canary.includes("maxCompilations: cases.length"));
  assert(
    canary.includes("authored-nineteen-fixture-three-stage-compilation-and-container-integrity"),
  );
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

  // D2R 自有样例留在本地，发布源码归档另行镜像；不能声称通用编译器的源码归档包含这些探针。
  // D2R-owned fixtures stay local; the release archive is mirrored separately.
  // Do not claim that the generic compiler's source archive contains these probes.
  assert.equal(
    digest(canary),
    "19415766142c77a9443478e74d5413a300397c28a1a0395b2f99d22d3547eeca",
    "the strict 31-call D2R canary remains byte-identical",
  );
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
    ["fragment", "conditional-distinct-buffer-rows.metal"],
    ["fragment", "loop-carried-buffer-pointer.metal"],
    ["kernel", "msl-stage-record-threadgroup.metal"],
    ["kernel", "msl-stage-record-buffers.metal"],
    ["kernel", "msl-buffer-reflection-mixed.metal"],
    ["kernel", "msl-buffer-reflection-array.metal"],
    ["kernel", "msl-buffer-reflection-float3.metal"],
    ["kernel", "msl-buffer-reflection-nested.metal"],
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
    "conditional_distinct_buffer_rows",
    "loop_carried_buffer_pointer",
    "stage_record_threadgroup",
    "stage_record_buffers",
    "reflection_mixed",
    "reflection_array",
    "reflection_float3",
    "reflection_nested",
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

  // 保留证明 select/PHI 失败的精确公开输入。哈希认证自编样例字节，不代表编译成功，也不是私有数据证明。
  // Keep the exact public inputs that demonstrated select/PHI failures. Hashes
  // authenticate authored fixture bytes, not compiler success or private data.
  for (const [filename, entry, expectedHash] of [
    [
      "conditional-distinct-buffer-rows.metal",
      "conditional_distinct_buffer_rows",
      "92a97acb7f5c670953d634b2a1635da98db32c283cfe98e53312728c81277ef4",
    ],
    [
      "loop-carried-buffer-pointer.metal",
      "loop_carried_buffer_pointer",
      "99e11691adfe5cef525fccfa3d64e5b21d03800f36bb351d1db50e6316247314",
    ],
  ]) {
    const source = await read(`../fixtures/${filename}`);
    assert.equal(digest(source), expectedHash, filename);
    assert(source.includes(`fragment float4 ${entry}(`), filename);
    assert(source.includes("constant VectorStorage* first [[id(0)]]"));
    assert(source.includes("constant VectorStorage* second [[id(1)]]"));
  }

  // 所有 D2R 自编样例路径保持本地可读；这不会执行或导入 WASM 探针。
  // All D2R-authored fixture paths remain local and readable; this does not
  // execute or import the WASM canary.
  for (const entry of cases) {
    assert.match(entry[2], /^[A-Za-z0-9_-]+\.metal$/);
    assert((await read(`../fixtures/${entry[2]}`)).includes("#include <metal_stdlib>"));
  }
});

test("real-WASM canary checks emitted reflection and actual float3 storage, not only containers", async () => {
  const canary = await read("../ci-compile-canary.mjs");
  for (const marker of [
    'from "./check-buffer-reflection.mjs"',
    'new URL("./fixtures/buffer-reflection.json", import.meta.url)',
    "maxCompilations: cases.length + reflectionFixtures.length",
    'assert.equal(sourceSha256, reflection.sha256, "reviewed reflection fixture identity")',
    'output: "llvm-text"',
    'new TextDecoder("utf-8", { fatal: true }).decode(irOutput.bytes)',
    "checkReflection(ir, reflection)",
    'if (fixture.entry === "reflection_float3") checkFloat3Storage(ir)',
    "irOutput?.bytes.fill(0)",
    'assert.equal(llvmValidation.length, reflectionFixtures.length, "all reflection probes ran")',
  ])
    assert(canary.includes(marker), marker);
  assert(
    canary.indexOf("checkReflection(ir, reflection)") < canary.indexOf("llvmValidation.push("),
  );
});

test("real-WASM canary preserves strict containers and binary flags for four liveness variants", async () => {
  const canary = await read("../ci-compile-canary.mjs");
  for (const marker of [
    'from "./check-fragment-input-liveness.mjs"',
    'from "./check-fragment-input-reflection.mjs"',
    "maxCompilations: cases.length + reflectionFixtures.length + livenessVariants.length * 2",
    'const livenessFilename = "msl-fragment-input-liveness.metal"',
    "0820f23da050fa12a4031a45c09dec58a4394f7179032570c1acd85a20d434d5",
    "#define LIVENESS_KEEP_VARYING ${Number(keepVarying)}\\n#define LIVENESS_KEEP_POSITION ${Number(keepPosition)}\\n${livenessText}",
    'entry: "fragment_input_liveness"',
    "checkFragmentInputLiveness(ir, { keepVarying, keepPosition })",
    "checkFragmentInputReflection(output.bytes, { keepVarying, keepPosition })",
    'validation: "exact-api-input-descriptors-final-argument-uses-and-binary-reflection"',
  ])
    assert(canary.includes(marker), marker);
  const variants = [
    ...canary.matchAll(
      /\{ name: "([^"]+)", keepVarying: (true|false), keepPosition: (true|false) \}/g,
    ),
  ].map((match) => match.slice(1));
  assert.deepEqual(variants, [
    ["dead", "false", "false"],
    ["live", "true", "true"],
    ["varying-dead", "false", "true"],
    ["position-dead", "true", "false"],
  ]);
  assert.equal(19 + 4 + variants.length * 2, 31);
  const loop = canary.slice(
    canary.indexOf("for (const { name, keepVarying, keepPosition } of livenessVariants)"),
  );
  assert.match(
    loop,
    /output: "metallib"[\s\S]*inspectCompiledMetalLibrary\(output.bytes,[\s\S]*entry: "fragment_input_liveness",\s*stage: "fragment",\s*minimumOS: \[18, 0\],\s*languageVersion: \[3, 2\],\s*metadataLengthIncludesPrefix: false/,
  );
  assert.match(
    loop,
    /output: "llvm-text"[\s\S]*checkFragmentInputLiveness\(ir, \{ keepVarying, keepPosition \}\)/,
  );
  assert(
    loop.indexOf("inspectCompiledMetalLibrary(output.bytes") <
      loop.indexOf("checkFragmentInputReflection(output.bytes"),
  );
  assert(
    loop.indexOf("checkFragmentInputReflection(output.bytes") <
      loop.indexOf("fragmentInputLiveness.push("),
  );
  assert.match(loop, /finally \{\s*output\?\.bytes.fill\(0\);\s*irOutput\?\.bytes.fill\(0\);/);
});

test(
  "generic header identity fingerprints all ten authenticated headers in its own domain",
  sourceReviewOptions,
  async () => {
    const cmake = await read("CMakeLists.txt");
    const paths = cmake
      .match(/set\(AIR_HEADER_PATHS\s+([^)]*)\)/)[1]
      .trim()
      .split(/\s+/)
      .sort();
    for (const header of ["metal_math", "metal_integer", "metal_simd"])
      assert(paths.includes(header));
    assert.equal(paths.length, 10);
    let fingerprint = "floor-air-header-bundle-v2\n";
    for (const path of paths) fingerprint += `${path}:${digest(await read(`include/${path}`))}\n`;
    assert.equal(
      digest(fingerprint),
      "694371baef693289d23f75c9b5721227b8290281c513dc81cc6f8f696b3ec7eb",
    );
    const lock = await readReviewedSourceLock();
    assert.deepEqual(
      paths,
      Object.keys(lock.sdkFiles)
        .filter((path) => path.startsWith("api/include/"))
        .map((path) => path.slice(12))
        .sort(),
    );
    assert(cmake.includes('set(AIR_HEADER_FINGERPRINT "floor-air-header-bundle-v2\\n")'));
  },
);
