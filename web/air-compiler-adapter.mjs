// 实验性 floor-Metal C API 的内存边界；不加载资产、不联网，也不声称兼容 Apple MSL。
// Memory boundary for the experimental floor-Metal C API; no asset loading, network, or Apple MSL compatibility claim.
const LIMITS = Object.freeze({
  source: 4 * 1024 * 1024,
  output: 64 * 1024 * 1024,
  diagnostics: 64 * 1024,
});
const STATUS = Object.freeze([
  "AIR_OK",
  "AIR_BAD_INPUT",
  "AIR_BAD_OPTIONS",
  "AIR_FRONTEND_FAILED",
  "AIR_INVALID_IR",
  "AIR_UNRESOLVED_SYMBOL",
  "AIR_NO_ENTRY",
  "AIR_OUTPUT_LIMIT",
]);
const EXPORTS = [
  "malloc",
  "free",
  "air_compile_v1",
  "air_result_status",
  "air_result_data",
  "air_result_size",
  "air_result_diagnostics",
  "air_result_diagnostics_size",
  "air_result_free",
  "air_compiler_header_sha256",
];
const encoder = new TextEncoder();
const errors = new WeakSet();
const wrappedModules = new WeakSet();
function failure(code, diagnosticBytes = 0) {
  const error = new Error(`Experimental shader compiler failed [${code}].`);
  error.code = code;
  error.diagnosticBytes = diagnosticBytes;
  error.requiresWorkerTermination = true;
  errors.add(error);
  return error;
}
function checkNumber(value, maximum, code) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw failure(code);
  return value;
}

// 调用方须先验证编译器 WASM 资产，传入已实例化模块和受信任头文件指纹。
// The caller must authenticate compiler WASM assets first and pass the instantiated module and trusted header fingerprint.
// 缓存生命周期补丁尚未通过批量复用验证，原型暂时仅允许每模块编译一次。
// Cache-lifetime patches await batch-reuse validation; this prototype temporarily permits one compile per module.
// 同步 WASM 执行无法协作取消；真正中断须由外部终止专用 Worker。
// Synchronous WASM cannot cooperatively cancel; the owner must terminate the dedicated Worker to interrupt it.
export function createAirCompilerAdapter(module, { expectedHeaderSha256 } = {}) {
  if (typeof expectedHeaderSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedHeaderSha256))
    throw failure("AIR_HEADER_IDENTITY_INVALID");
  if (wrappedModules.has(module)) throw failure("AIR_MODULE_ALREADY_WRAPPED");
  const api = Object.create(null);
  for (const name of EXPORTS) {
    if (typeof module?.[`_${name}`] !== "function") throw failure("AIR_EXPORT_MISSING");
    api[name] = module[`_${name}`].bind(module);
  }
  const heap = () => {
    const bytes = module.HEAPU8;
    if (
      !(bytes instanceof Uint8Array) ||
      !(bytes.buffer instanceof ArrayBuffer) ||
      bytes.byteOffset !== 0 ||
      bytes.byteLength !== bytes.buffer.byteLength
    )
      throw failure("AIR_HEAP_INVALID");
    return bytes;
  };
  const region = (pointer, size, allowEmpty = false) => {
    checkNumber(pointer, 0xffffffff, "AIR_POINTER_INVALID");
    checkNumber(size, 0xffffffff, "AIR_SIZE_INVALID");
    const bytes = heap();
    if (
      (!allowEmpty && pointer === 0) ||
      pointer > bytes.length ||
      size > bytes.length - pointer ||
      (size > 0 && pointer === 0)
    )
      throw failure("AIR_POINTER_INVALID");
    return bytes.subarray(pointer, pointer + size);
  };
  let headerSha256;
  try {
    const bytes = region(api.air_compiler_header_sha256(), 65);
    if (bytes[64] !== 0) throw failure("AIR_HEADER_IDENTITY_INVALID");
    headerSha256 = String.fromCharCode(...bytes.subarray(0, 64));
    if (headerSha256 !== expectedHeaderSha256) throw failure("AIR_HEADER_IDENTITY_MISMATCH");
  } catch (error) {
    if (errors.has(error)) throw error;
    throw failure("AIR_RUNTIME_FAILED");
  }
  wrappedModules.add(module);
  let used = false,
    active = false,
    disposed = false;
  const check = (signal) => {
    if (disposed) throw failure("AIR_ADAPTER_DISPOSED");
    if (signal?.aborted) throw failure("AIR_ABORTED");
  };
  return Object.freeze({
    status: "experimental-floor-metal-3.0-not-apple-msl-compatible",
    limits: LIMITS,
    get headerSha256() {
      return headerSha256;
    },
    get used() {
      return used;
    },
    // dispose 只阻止新请求，不会终止已经运行的同步 WASM。
    // dispose only prevents new requests; it cannot terminate already-running synchronous WASM.
    dispose() {
      disposed = true;
    },
    compile(
      source,
      { iosMajor = 18, output = "metallib", sourceLanguage = "floor-metal-3.0", signal } = {},
    ) {
      check(signal);
      if (active) throw failure("AIR_COMPILER_BUSY");
      if (used) throw failure("AIR_MODULE_ALREADY_USED");
      if (
        sourceLanguage !== "floor-metal-3.0" ||
        ![18, 26].includes(iosMajor) ||
        !["metallib", "llvm-text"].includes(output)
      )
        throw failure("AIR_BAD_OPTIONS");
      if (
        typeof source !== "string" ||
        !source.length ||
        source.length > LIMITS.source ||
        source.includes("\0")
      )
        throw failure("AIR_BAD_INPUT");
      const input = encoder.encode(source.replaceAll("\r\n", "\n"));
      if (input.length > LIMITS.source) {
        input.fill(0);
        throw failure("AIR_BAD_INPUT");
      }
      used = true;
      active = true;
      let inputPointer = 0,
        resultPointer = 0,
        copied,
        problem;
      try {
        const allocated = api.malloc(input.length);
        if (allocated === 0) throw failure("AIR_ALLOCATION_FAILED");
        const target = region(allocated, input.length);
        inputPointer = allocated;
        check(signal);
        target.set(input);
        const result = api.air_compile_v1(
          inputPointer,
          input.length,
          iosMajor,
          output === "metallib" ? 0 : 1,
        );
        if (result === 0) throw failure("AIR_ALLOCATION_FAILED");
        region(result, 1);
        resultPointer = result;
        check(signal);
        const status = checkNumber(
          api.air_result_status(resultPointer),
          STATUS.length - 1,
          "AIR_STATUS_INVALID",
        );
        const diagnosticSize = checkNumber(
          api.air_result_diagnostics_size(resultPointer),
          LIMITS.diagnostics,
          "AIR_DIAGNOSTIC_LIMIT",
        );
        const diagnosticPointer = api.air_result_diagnostics(resultPointer);
        region(diagnosticPointer, diagnosticSize, diagnosticSize === 0);
        check(signal);
        // 不读取或泄露含源码标识符的诊断文本，只传递稳定状态及字节数。
        // Do not read or expose diagnostic text containing source identifiers; expose stable status and byte count only.
        if (status !== 0) throw failure(STATUS[status], diagnosticSize);
        const size = checkNumber(
          api.air_result_size(resultPointer),
          LIMITS.output,
          "AIR_OUTPUT_LIMIT",
        );
        if (!size) throw failure("AIR_EMPTY_OUTPUT");
        const pointer = api.air_result_data(resultPointer);
        check(signal);
        copied = new Uint8Array(region(pointer, size));
        check(signal);
      } catch (error) {
        problem = errors.has(error) ? error : failure("AIR_RUNTIME_FAILED");
      } finally {
        // getter/编译/释放均可能扩展内存；清理时重新获取 HEAP，不保存旧视图。
        // Getters, compilation and cleanup may grow memory; reacquire HEAP for cleanup, never reuse stale views.
        if (resultPointer) {
          try {
            api.air_result_free(resultPointer);
          } catch {
            problem ??= failure("AIR_CLEANUP_FAILED");
          }
        }
        if (inputPointer) {
          try {
            region(inputPointer, input.length).fill(0);
          } catch {
            problem ??= failure("AIR_CLEANUP_FAILED");
          }
          try {
            api.free(inputPointer);
          } catch {
            problem ??= failure("AIR_CLEANUP_FAILED");
          }
        }
        input.fill(0);
        active = false;
      }
      if (!problem) {
        try {
          check(signal);
        } catch (error) {
          problem = error;
        }
      }
      if (problem) {
        copied?.fill(0);
        throw problem;
      }
      return Object.freeze({
        bytes: copied,
        output,
        iosMajor,
        headerSha256,
        status: "experimental-output-unvalidated",
        requiresWorkerTermination: true,
      });
    },
  });
}
