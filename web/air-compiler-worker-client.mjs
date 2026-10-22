// 密封加载器拥有工作线程代码的认证；本客户端验证公开编译器副本并复用有限批次。
// The sealed loader authenticates worker code; this client verifies public compiler snapshots and reuses bounded batches.
import {
  AIR_COMPILER_LIMITS as limits,
  AIR_COMPILER_OPTIONS,
  AIR_COMPILER_PHASES,
  airCompilerFailure,
  airCompilerIdentity,
  validateAirCompilerRequest,
} from "./air-compiler-contract.mjs";

const hash = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
const fail = (code) => {
  throw airCompilerFailure(code);
};
function report(callback, phase) {
  try {
    Promise.resolve(callback?.(Object.freeze({ phase }))).catch(() => {});
  } catch {
    /* Synchronous throws, rejected promises and thenables cannot break ownership. */
  }
}
function snapshot(value, maximum) {
  if (value instanceof ArrayBuffer) value = new Uint8Array(value);
  if (
    !(value instanceof Uint8Array) ||
    !(value.buffer instanceof ArrayBuffer) ||
    value.buffer.resizable ||
    !value.length ||
    value.length > maximum
  )
    fail("AIR_ASSET_INVALID");
  return new Uint8Array(value);
}
function check(signal) {
  if (signal?.aborted) fail("AIR_ABORTED");
}
async function waitFor(promise, signal, timeout, code) {
  let timer, cancel;
  try {
    check(signal);
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(airCompilerFailure(code)), timeout);
        cancel = () => reject(airCompilerFailure("AIR_ABORTED"));
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

/**
 * Only call with the sealed loader's verified worker constructor and manifest-pinned assets.
 * Initialization finishes before returning; there is no source queue and only one active compile.
 * A cancelled/failed/recycled worker is discarded, while verified public code can serve the next batch.
 */
export async function createAirCompilerWorkerClient({
  createWorker,
  assets,
  signal,
  onProgress,
} = {}) {
  check(signal);
  if (typeof createWorker !== "function" || !assets) fail("AIR_ASSET_INVALID");
  const compiler = airCompilerIdentity(assets);
  let factoryBytes,
    wasmBytes,
    wasmModule,
    current,
    disposed = false,
    active = false,
    nextId = 0,
    compilerPhase = "verifying";
  function stop(reason) {
    const state = current;
    current = undefined;
    if (!state) return;
    state.worker.removeEventListener("message", state.message);
    state.worker.removeEventListener("error", state.error);
    state.worker.removeEventListener("messageerror", state.error);
    state.worker.terminate();
    state.pending?.reject(reason ?? airCompilerFailure("AIR_WORKER_FAILED"));
    state.pending = undefined;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stop(airCompilerFailure("AIR_COMPILER_DISPOSED"));
    factoryBytes?.fill(0);
    factoryBytes = undefined;
    wasmModule = undefined;
  }
  function ensureLive(requestSignal) {
    if (disposed) fail("AIR_COMPILER_DISPOSED");
    check(requestSignal);
  }
  function connect() {
    let worker;
    try {
      worker = createWorker();
    } catch {
      fail("AIR_WORKER_UNAVAILABLE");
    }
    if (
      !worker ||
      ["addEventListener", "removeEventListener", "postMessage", "terminate"].some(
        (method) => typeof worker[method] !== "function",
      )
    ) {
      worker?.terminate?.();
      fail("AIR_WORKER_UNAVAILABLE");
    }
    const state = { worker, pending: undefined, initialized: false };
    state.error = (event) => {
      event?.preventDefault?.();
      if (current === state) stop(airCompilerFailure("AIR_WORKER_FAILED"));
    };
    state.message = ({ data }) => {
      const pending = state.pending;
      if (current !== state || !pending || data?.id !== pending.id) {
        if (data?.bytes instanceof ArrayBuffer) new Uint8Array(data.bytes).fill(0);
        if (current === state) stop(airCompilerFailure("AIR_PROTOCOL_FAILED"));
        return;
      }
      if (data.type === "progress") {
        if (!AIR_COMPILER_PHASES.includes(data.phase)) {
          stop(airCompilerFailure("AIR_PROTOCOL_FAILED"));
          return;
        }
        compilerPhase = data.phase;
        report(pending.onProgress, data.phase);
      } else if (data.type === "error") {
        stop(airCompilerFailure(data.code, data, { compilerPhase }));
      } else {
        state.pending = undefined;
        pending.resolve(data);
      }
    };
    worker.addEventListener("message", state.message);
    worker.addEventListener("error", state.error);
    worker.addEventListener("messageerror", state.error);
    current = state;
    return state;
  }
  async function request(
    state,
    message,
    transfers,
    requestSignal,
    callback,
    initialization = false,
  ) {
    ensureLive(requestSignal);
    if (current !== state || state.pending) fail("AIR_COMPILER_BUSY");
    let timer, abort;
    try {
      return await new Promise((resolve, reject) => {
        const id = ++nextId;
        state.pending = { id, resolve, reject, onProgress: callback };
        abort = () => stop(airCompilerFailure("AIR_ABORTED"));
        requestSignal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(
          () =>
            stop(
              airCompilerFailure(
                initialization ? "AIR_INITIALIZATION_TIMEOUT" : "AIR_COMPILATION_TIMEOUT",
              ),
            ),
          initialization ? limits.initializationMs : limits.compilationMs,
        );
        if (requestSignal?.aborted) {
          abort();
          return;
        }
        try {
          state.worker.postMessage({ ...message, id }, transfers);
        } catch {
          stop(airCompilerFailure("AIR_PROTOCOL_FAILED"));
        }
      });
    } finally {
      clearTimeout(timer);
      requestSignal?.removeEventListener("abort", abort);
    }
  }
  async function start(requestSignal, callback) {
    ensureLive(requestSignal);
    if (current?.initialized) return current;
    compilerPhase = "initializing";
    report(callback, "initializing");
    ensureLive(requestSignal);
    const state = connect();
    const copy = factoryBytes.slice();
    try {
      const result = await request(
        state,
        {
          type: "initialize",
          factoryBytes: copy.buffer,
          wasmModule,
          factorySha256: compiler.factorySha256,
          wasmSha256: compiler.assetSha256,
          headerSha256: compiler.headerSha256,
        },
        [copy.buffer],
        requestSignal,
        callback,
        true,
      );
      ensureLive(requestSignal);
      if (
        result?.type !== "initialized" ||
        !Number.isSafeInteger(result.heapBytes) ||
        result.heapBytes < 1 ||
        result.heapBytes > limits.maxObservedHeapBytes
      )
        fail("AIR_PROTOCOL_FAILED");
      state.initialized = true;
      return state;
    } catch (error) {
      stop(error);
      throw error;
    } finally {
      if (copy.byteLength) copy.fill(0);
    }
  }
  try {
    factoryBytes = snapshot(assets.factoryBytes, limits.factoryBytes);
    wasmBytes = snapshot(assets.wasmBytes, limits.wasmBytes);
    report(onProgress, "verifying");
    // Preparation has no private input. Abort abandons its result; WebAssembly.compile itself is not cancellable.
    const preparation = (async () => {
      if (
        (await hash(factoryBytes)) !== compiler.factorySha256 ||
        (await hash(wasmBytes)) !== compiler.assetSha256
      )
        fail("AIR_ASSET_MISMATCH");
      check(signal);
      compilerPhase = "preparing";
      report(onProgress, "preparing");
      return await WebAssembly.compile(wasmBytes);
    })();
    // Keep WASM bytes intact until its asynchronous compilation has actually settled.
    const inputBytes = wasmBytes;
    preparation.finally(() => inputBytes.fill(0)).catch(() => {});
    wasmModule = await waitFor(
      preparation,
      signal,
      limits.initializationMs,
      "AIR_INITIALIZATION_TIMEOUT",
    );
    wasmBytes = undefined;
    await start(signal, onProgress);
  } catch (error) {
    dispose();
    throw airCompilerFailure(error?.code, error, { compilerPhase });
  }
  return Object.freeze({
    initialized: true,
    get ready() {
      return !disposed && !!wasmModule;
    },
    compiler,
    options: AIR_COMPILER_OPTIONS,
    limits,
    dispose,
    close: dispose,
    async compile(source, { entry, stage, signal: requestSignal, onProgress: callback } = {}) {
      ensureLive(requestSignal);
      if (active) fail("AIR_COMPILER_BUSY");
      validateAirCompilerRequest(source, entry, stage);
      active = true;
      let bytes;
      try {
        const state = await start(requestSignal, callback);
        compilerPhase = "compiling";
        const result = await request(
          state,
          { type: "compile", source, entry, stage },
          [],
          requestSignal,
          callback,
        );
        source = undefined;
        if (result?.bytes instanceof ArrayBuffer) bytes = new Uint8Array(result.bytes);
        ensureLive(requestSignal);
        if (
          result?.type !== "compiled" ||
          !bytes ||
          bytes.buffer.resizable ||
          bytes.length < 88 ||
          bytes.length > limits.outputBytes ||
          typeof result.recycle !== "boolean" ||
          !Number.isSafeInteger(result.compilationCount) ||
          result.compilationCount < 1 ||
          result.compilationCount > limits.batchCompilations ||
          !Number.isSafeInteger(result.heapBytes) ||
          result.heapBytes < 1 ||
          result.heapBytes > limits.maxObservedHeapBytes ||
          result.inspection?.validation !== "container-and-integrity-only" ||
          result.inspection.outputSize !== bytes.length
        )
          fail("AIR_PROTOCOL_FAILED");
        if (result.recycle) stop();
        report(callback, "complete");
        ensureLive(requestSignal);
        const output = Object.freeze({
          bytes,
          compiler,
          options: AIR_COMPILER_OPTIONS,
          inspection: result.inspection,
        });
        bytes = undefined;
        return output;
      } catch (error) {
        stop(error);
        throw airCompilerFailure(error?.code, error, { compilerPhase });
      } finally {
        bytes?.fill(0);
        source = undefined;
        active = false;
      }
    },
  });
}
