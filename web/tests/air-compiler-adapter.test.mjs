import assert from "node:assert/strict";
import test from "node:test";
import { createAirCompilerAdapter } from "../air-compiler-adapter.mjs";
const fingerprint = "a".repeat(64),
  encoder = new TextEncoder();
// 这里只模拟 C ABI 和内存增长，不编译着色器，也不构成 WASM 执行证据。
// These tests simulate the C ABI and memory growth, not shader compilation or WASM execution.
function fake() {
  const calls = [],
    output = new Uint8Array([1, 2, 3, 4]);
  const module = {
    HEAPU8: new Uint8Array(1024),
    status: 0,
    diagnosticSize: 0,
    resultSize: output.length,
  };
  module.HEAPU8.set(encoder.encode(fingerprint + "\0"), 16);
  const grow = () => {
    const next = new Uint8Array(module.HEAPU8.length * 2);
    next.set(module.HEAPU8);
    structuredClone(module.HEAPU8.buffer, { transfer: [module.HEAPU8.buffer] });
    module.HEAPU8 = next;
  };
  Object.assign(module, {
    _air_compiler_header_sha256: () => 16,
    _malloc(size) {
      module.inputSize = size;
      calls.push(["malloc", size]);
      grow();
      return 128;
    },
    _free(pointer) {
      calls.push(["free", pointer]);
      assert.ok(module.HEAPU8.subarray(pointer, pointer + module.inputSize).every((x) => x === 0));
    },
    _air_compile_v1(pointer, size, ios, kind) {
      module.inputSize = size;
      module.input = new TextDecoder().decode(module.HEAPU8.subarray(pointer, pointer + size));
      calls.push(["compile", pointer, size, ios, kind]);
      grow();
      module.HEAPU8.set(output, 512);
      module.HEAPU8.set(encoder.encode("private_shader_identifier"), 768);
      module.onCompile?.();
      return 256;
    },
    _air_result_status: () => module.status,
    _air_result_data() {
      grow();
      return 512;
    },
    _air_result_size: () => module.resultSize,
    _air_result_diagnostics: () => 768,
    _air_result_diagnostics_size: () => module.diagnosticSize,
    _air_result_free(pointer) {
      calls.push(["result_free", pointer]);
      module.HEAPU8.fill(0, 512, 516);
      grow();
    },
  });
  return {
    module,
    calls,
    output,
    grow,
    create: (options = {}) =>
      createAirCompilerAdapter(module, { expectedHeaderSha256: fingerprint, ...options }),
  };
}
test("copies before result cleanup and reacquires heap after multiple detached-view growths", () => {
  const f = fake(),
    adapter = f.create();
  const result = adapter.compile("a\r\nb\n");
  assert.equal(f.module.input, "a\nb\n");
  assert.deepEqual(result.bytes, f.output);
  assert.equal(result.status, "experimental-output-unvalidated");
  assert.equal(result.requiresWorkerTermination, true);
  assert.equal(adapter.headerSha256, fingerprint);
  assert.equal(adapter.status, "experimental-floor-metal-3.2-not-apple-msl-compatible");
  assert.equal(adapter.used, true);
  assert.deepEqual(
    f.calls.map((x) => x[0]),
    ["malloc", "compile", "result_free", "free"],
  );
  assert.throws(() => adapter.compile("x"), { code: "AIR_MODULE_ALREADY_USED" });
});
test("supports only the exact output-kind, source-language and target ABI", () => {
  for (const options of [
    { output: "spirv" },
    { iosMajor: 17 },
    { sourceLanguage: "apple-msl-2.3" },
    { sourceLanguage: "floor-metal-3.0" },
  ]) {
    const f = fake();
    assert.throws(() => f.create().compile("x", options), { code: "AIR_BAD_OPTIONS" });
    assert.equal(f.calls.length, 0);
  }
  const f = fake();
  f.create().compile("x", {
    iosMajor: 26,
    output: "llvm-text",
    sourceLanguage: "floor-metal-3.2",
  });
  assert.deepEqual(f.calls.find((c) => c[0] === "compile").slice(-2), [26, 1]);
});
test("validates the pinned header fingerprint and exports without exposing module exceptions", () => {
  const f = fake();
  assert.throws(
    () => createAirCompilerAdapter(f.module, { expectedHeaderSha256: "b".repeat(64) }),
    { code: "AIR_HEADER_IDENTITY_MISMATCH" },
  );
  f.module._air_compiler_header_sha256 = () => {
    throw new Error("private_shader_identifier");
  };
  assert.throws(
    () => f.create(),
    (e) => e.code === "AIR_RUNTIME_FAILED" && !String(e).includes("private_shader_identifier"),
  );
  delete f.module._air_compile_v1;
  assert.throws(() => f.create(), { code: "AIR_EXPORT_MISSING" });
});
test("reports bounded diagnostic count but never raw source identifiers", () => {
  const f = fake();
  f.module.status = 3;
  f.module.diagnosticSize = 25;
  assert.throws(
    () => f.create().compile("x"),
    (e) =>
      e.code === "AIR_FRONTEND_FAILED" &&
      e.diagnosticBytes === 25 &&
      !JSON.stringify(e).includes("private_shader_identifier") &&
      !String(e).includes("private_shader_identifier"),
  );
  assert.deepEqual(
    f.calls.slice(-2).map((x) => x[0]),
    ["result_free", "free"],
  );
});
for (const [name, mutate, code] of [
  ["invalid output pointer", (m) => (m._air_result_data = () => 0xfffffff0), "AIR_POINTER_INVALID"],
  ["null output pointer", (m) => (m._air_result_data = () => 0), "AIR_POINTER_INVALID"],
  ["oversized output", (m) => (m.resultSize = 64 * 1024 * 1024 + 1), "AIR_OUTPUT_LIMIT"],
  ["empty output", (m) => (m.resultSize = 0), "AIR_EMPTY_OUTPUT"],
  ["negative output size", (m) => (m.resultSize = -1), "AIR_OUTPUT_LIMIT"],
  ["fractional output size", (m) => (m.resultSize = 1.5), "AIR_OUTPUT_LIMIT"],
  ["invalid status", (m) => (m.status = 99), "AIR_STATUS_INVALID"],
  ["diagnostic overflow", (m) => (m.diagnosticSize = 65537), "AIR_DIAGNOSTIC_LIMIT"],
  [
    "diagnostic invalid pointer",
    (m) => {
      m.diagnosticSize = 1;
      m._air_result_diagnostics = () => 0;
    },
    "AIR_POINTER_INVALID",
  ],
  [
    "getter trap",
    (m) =>
      (m._air_result_size = () => {
        throw new Error("private_shader_identifier");
      }),
    "AIR_RUNTIME_FAILED",
  ],
])
  test(`cleans both allocations after ${name}`, () => {
    const f = fake();
    mutate(f.module);
    assert.throws(() => f.create().compile("x"), { code });
    assert.deepEqual(
      f.calls.slice(-2).map((x) => x[0]),
      ["result_free", "free"],
    );
  });
test("frees input when compiler traps or returns no result", () => {
  for (const compile of [
    () => 0,
    () => {
      throw new Error("private_shader_identifier");
    },
  ]) {
    const f = fake();
    f.module._air_compile_v1 = compile;
    assert.throws(() => f.create().compile("x"));
    assert.equal(f.calls.at(-1)[0], "free");
    assert.equal(
      f.calls.some((x) => x[0] === "result_free"),
      false,
    );
  }
});
test("continues input cleanup when result cleanup traps", () => {
  const f = fake();
  f.module._air_result_free = () => {
    throw new Error("private_shader_identifier");
  };
  assert.throws(() => f.create().compile("x"), { code: "AIR_CLEANUP_FAILED" });
  assert.equal(f.calls.at(-1)[0], "free");
});
test("rejects reentrant compilation and requires a fresh module after use", () => {
  const f = fake(),
    adapter = f.create();
  f.module.onCompile = () =>
    assert.throws(() => adapter.compile("nested"), { code: "AIR_COMPILER_BUSY" });
  adapter.compile("x");
  assert.throws(() => adapter.compile("again"), { code: "AIR_MODULE_ALREADY_USED" });
});
test("pre-abort allocates nothing; abort noticed after synchronous return frees both allocations", () => {
  const f = fake(),
    adapter = f.create(),
    controller = new AbortController();
  controller.abort();
  assert.throws(() => adapter.compile("x", { signal: controller.signal }), { code: "AIR_ABORTED" });
  assert.equal(f.calls.length, 0);
  assert.equal(adapter.used, false);
  const other = new AbortController();
  f.module.onCompile = () => other.abort();
  assert.throws(() => adapter.compile("x", { signal: other.signal }), { code: "AIR_ABORTED" });
  assert.deepEqual(
    f.calls.slice(-2).map((x) => x[0]),
    ["result_free", "free"],
  );
});
test("dispose prevents work and is checked after synchronous compiler returns", () => {
  const f = fake(),
    adapter = f.create();
  f.module.onCompile = () => adapter.dispose();
  assert.throws(() => adapter.compile("x"), { code: "AIR_ADAPTER_DISPOSED" });
  assert.deepEqual(
    f.calls.slice(-2).map((x) => x[0]),
    ["result_free", "free"],
  );
  assert.throws(() => adapter.compile("x"), { code: "AIR_ADAPTER_DISPOSED" });
});
test("source limits apply to UTF8 bytes and reject empty or embedded NUL input", () => {
  for (const source of ["", "a\0b", "é".repeat(2097153)]) {
    const f = fake();
    assert.throws(() => f.create().compile(source), { code: "AIR_BAD_INPUT" });
    assert.equal(f.calls.length, 0);
  }
});

test("cannot wrap a module twice to evade single-use isolation", () => {
  const f = fake();
  const adapter = f.create();
  adapter.dispose();
  assert.throws(() => f.create(), { code: "AIR_MODULE_ALREADY_WRAPPED" });
});
test("allocation failure and invalid allocation pointers do not enter compiler", () => {
  for (const pointer of [0, -1, 0xffffffff]) {
    const f = fake();
    f.module._malloc = () => pointer;
    assert.throws(() => f.create().compile("x"));
    assert.equal(f.calls.length, 0);
  }
});

test("does not publish copied output if cancellation happens during cleanup callbacks", () => {
  const f = fake(),
    controller = new AbortController();
  const originalFree = f.module._free;
  f.module._free = (pointer) => {
    originalFree(pointer);
    controller.abort();
  };
  assert.throws(() => f.create().compile("x", { signal: controller.signal }), {
    code: "AIR_ABORTED",
  });
});

function fakeV2() {
  const f = fake();
  const compileV1 = f.module._air_compile_v1;
  f.module._air_compiler_header_bundle_version = () => 2;
  f.module._air_compile_v2 = (...args) => {
    const result = compileV1(...args.slice(0, 4));
    const call = f.calls.find((entry) => entry[0] === "compile");
    call[0] = "compile-v2";
    call.push(args[4]);
    return result;
  };
  return f;
}
test("v1 remains the default even when the module supports v2", () => {
  const f = fakeV2();
  const adapter = f.create();
  const result = adapter.compile("x");
  assert.equal(adapter.apiVersion, 1);
  assert.equal(result.apiVersion, 1);
  assert.equal(result.mathProfile, "conservative");
  assert.equal(result.headerBundleVersion, undefined);
  assert.equal(f.calls.find((entry) => entry[0] === "compile").length, 5);
});
test("explicit v2 selects the exact math profile and records provenance", () => {
  for (const mathProfile of [undefined, "conservative", "fast-f32"]) {
    const f = fakeV2();
    delete f.module._air_compile_v1;
    const adapter = f.create({ apiVersion: 2 });
    const result = adapter.compile("x", { mathProfile, iosMajor: 26, output: "llvm-text" });
    assert.equal(adapter.apiVersion, 2);
    assert.deepEqual(f.calls.find((entry) => entry[0] === "compile-v2").slice(-3), [
      26,
      1,
      mathProfile === "fast-f32" ? 1 : 0,
    ]);
    assert.deepEqual(result.bytes, f.output);
    assert.equal(result.apiVersion, 2);
    assert.equal(result.mathProfile, mathProfile ?? "conservative");
    assert.equal(result.headerBundleVersion, 2);
    assert.equal(result.headerSha256, fingerprint);
    assert.equal(result.status, "experimental-output-unvalidated");
    assert.throws(() => adapter.compile("again"), { code: "AIR_MODULE_ALREADY_USED" });
    assert.throws(() => f.create({ apiVersion: 1 }), { code: "AIR_MODULE_ALREADY_WRAPPED" });
  }
});
test("fast math requires explicit v2 and invalid profiles allocate nothing", () => {
  for (const [apiVersion, mathProfile] of [
    [1, "fast-f32"],
    [1, "fast"],
    [2, "fast"],
    [2, null],
    [2, 1],
  ]) {
    const f = fakeV2();
    const adapter = f.create({ apiVersion });
    assert.throws(() => adapter.compile("x", { mathProfile }), { code: "AIR_BAD_OPTIONS" });
    assert.equal(adapter.used, false);
    assert.equal(f.calls.length, 0);
  }
  for (const apiVersion of [0, 3, "2", null, NaN])
    assert.throws(() => fakeV2().create({ apiVersion }), { code: "AIR_BAD_OPTIONS" });
});
test("v2 requires its own export and exact header bundle version without fallback", () => {
  for (const name of ["_air_compile_v2", "_air_compiler_header_bundle_version"]) {
    const f = fakeV2();
    delete f.module[name];
    assert.throws(() => f.create({ apiVersion: 2 }), { code: "AIR_EXPORT_MISSING" });
    assert.equal(f.calls.length, 0);
  }
  for (const version of [1, 3, "2", undefined, NaN]) {
    const f = fakeV2();
    f.module._air_compiler_header_bundle_version = () => version;
    assert.throws(() => f.create({ apiVersion: 2 }), {
      code: "AIR_HEADER_BUNDLE_VERSION_MISMATCH",
    });
  }
});
test("v2 keeps header pinning and private runtime errors", () => {
  const f = fakeV2();
  assert.throws(() => f.create({ apiVersion: 2, expectedHeaderSha256: "b".repeat(64) }), {
    code: "AIR_HEADER_IDENTITY_MISMATCH",
  });
  f.module._air_compiler_header_bundle_version = () => {
    throw Error("private_shader_identifier");
  };
  assert.throws(
    () => f.create({ apiVersion: 2 }),
    (e) => e.code === "AIR_RUNTIME_FAILED" && !String(e).includes("private_shader_identifier"),
  );
});
test("v2 failure and cancellation preserve allocation cleanup and diagnostic privacy", () => {
  for (const abort of [false, true]) {
    const f = fakeV2(),
      controller = new AbortController();
    if (abort) f.module.onCompile = () => controller.abort();
    else {
      f.module.status = 3;
      f.module.diagnosticSize = 25;
    }
    assert.throws(
      () =>
        f
          .create({ apiVersion: 2 })
          .compile("x", { mathProfile: "fast-f32", signal: controller.signal }),
      (e) =>
        e.code === (abort ? "AIR_ABORTED" : "AIR_FRONTEND_FAILED") &&
        !String(e).includes("private_shader_identifier"),
    );
    assert.deepEqual(
      f.calls.slice(-2).map((entry) => entry[0]),
      ["result_free", "free"],
    );
  }
});

test("explicit bounded v2 reuse copies each output and stops at its compilation budget", () => {
  const f = fakeV2();
  const adapter = f.create({ apiVersion: 2, maxCompilations: 2 });
  const first = adapter.compile("first", { mathProfile: "fast-f32" });
  const second = adapter.compile("second", { mathProfile: "fast-f32" });
  assert.equal(first.requiresWorkerTermination, false);
  assert.equal(second.requiresWorkerTermination, true);
  assert.equal(adapter.compilationCount, 2);
  assert.deepEqual(first.bytes, f.output);
  assert.deepEqual(second.bytes, f.output);
  assert.notEqual(first.bytes.buffer, second.bytes.buffer);
  assert.throws(() => adapter.compile("third"), { code: "AIR_BATCH_LIMIT" });
});

test("bounded reuse is v2-only and poisons the module after a failed compile", () => {
  for (const options of [
    { maxCompilations: 2 },
    { apiVersion: 2, maxCompilations: 0 },
    { apiVersion: 2, maxCompilations: 257 },
  ])
    assert.throws(() => fakeV2().create(options), { code: "AIR_BAD_OPTIONS" });
  const f = fakeV2();
  const adapter = f.create({ apiVersion: 2, maxCompilations: 2 });
  f.module.status = 3;
  assert.throws(() => adapter.compile("invalid"), { code: "AIR_FRONTEND_FAILED" });
  f.module.status = 0;
  assert.throws(() => adapter.compile("valid"), { code: "AIR_ADAPTER_DISPOSED" });
});
