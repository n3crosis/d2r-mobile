/** Bounded adapter for the CI-proven image subset, NOT a complete asset pipeline. */
export const ASSET_ADAPTER_CAPABILITIES = Object.freeze({
  completeAssetPipeline: false,
  imageDefaultFrameV31: true,
  imageDefaultFrameV61: false,
  cascOverlayPacking: false,
  originalFontGeneration: false,
});
export const ASSET_ADAPTER_LIMITS = Object.freeze({
  recipes: 32,
  inputBytes: 20 * 1024 * 1024,
  totalInputBytes: 128 * 1024 * 1024,
  responseBytes: 64 * 1024 * 1024,
  retainedOutputBytes: 64 * 1024 * 1024,
  chunkBytes: 64 * 1024,
});
export class AssetAdapterError extends Error {
  constructor(code) {
    super(code); // Never include local paths, user data or worker exception text.
    this.name = "AssetAdapterError";
    this.code = code;
  }
}
const fail = (code) => {
  throw new AssetAdapterError(code);
};
function checkAbort(signal) {
  if (signal?.aborted) fail("ASSET_CANCELLED");
}
function safePath(value) {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^[a-zA-Z0-9_./ -]+$/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail("ASSET_INVALID_PATH");
  }
  return value;
}
function checkedRecipes(recipes) {
  if (!Array.isArray(recipes) || !recipes.length || recipes.length > ASSET_ADAPTER_LIMITS.recipes)
    fail("ASSET_INVALID_RECIPES");
  const destinations = new Set();
  return recipes.map((recipe) => {
    if (!recipe || typeof recipe !== "object" || recipe.operation !== "image-default-frame")
      fail("ASSET_UNSUPPORTED_RECIPE");
    const input = safePath(recipe.input).toLowerCase();
    if (!input.startsWith("data/")) fail("ASSET_INVALID_LOGICAL_PATH");
    if (!Number.isSafeInteger(recipe.frame ?? 0) || (recipe.frame ?? 0) < 0)
      fail("ASSET_INVALID_FRAME");
    if (!recipe.outputs || typeof recipe.outputs !== "object" || Array.isArray(recipe.outputs))
      fail("ASSET_INVALID_OUTPUTS");
    const outputs = Object.entries(recipe.outputs).map(([name, path]) => {
      // Raw RGBA, generated C and overlay plans are not packaged application assets.
      if (!["frame.png", "frame.sprite"].includes(name)) fail("ASSET_UNSUPPORTED_OUTPUT");
      path = safePath(path);
      if (path.startsWith("Payload/") || !/\.(png|sprite)$/i.test(path))
        fail("ASSET_INVALID_OUTPUT_PATH");
      if (!path.endsWith(name.endsWith(".png") ? ".png" : ".sprite"))
        fail("ASSET_OUTPUT_TYPE_MISMATCH");
      const key = path.toLowerCase();
      if (destinations.has(key)) fail("ASSET_DUPLICATE_OUTPUT");
      destinations.add(key);
      return Object.freeze([name, path]);
    });
    if (!outputs.length) fail("ASSET_INVALID_OUTPUTS");
    return Object.freeze({ input, frame: recipe.frame ?? 0, outputs: Object.freeze(outputs) });
  });
}
async function abortable(action, signal) {
  checkAbort(signal);
  if (!signal) return action();
  let abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => reject(new AssetAdapterError("ASSET_CANCELLED"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    // Listener is installed before invoking a reader/worker which could abort synchronously.
    return await Promise.race([Promise.resolve().then(action), interrupted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
/**
 * @param {object} options Trusted build configuration, never read from game content.
 * @param {Array<{operation:'image-default-frame',input:string,frame?:number,outputs:object}>} options.recipes
 * @param {()=>{run:Function,close:Function}} options.createWorker Existing AssetWorker factory.
 * @param {(extracted:unknown)=>{read:Function}} [options.resolveReader]
 *   Reader.read(logicalPath,{maxBytes,signal})->Promise<Uint8Array>, resolves CASC itself.
 * @returns {{capabilities:object,generateAssets:Function,dispose:Function}}
 */
export function createAssetGeneratorAdapter({
  recipes,
  createWorker,
  resolveReader,
  enableV61Png = false,
} = {}) {
  if (typeof enableV61Png !== "boolean") fail("ASSET_INVALID_V61_OPTION");
  const jobs = checkedRecipes(recipes); // Validate whole plan before reading any user data.
  if (typeof createWorker !== "function") fail("ASSET_WORKER_UNAVAILABLE");
  if (resolveReader !== undefined && typeof resolveReader !== "function")
    fail("ASSET_READER_UNAVAILABLE");
  let started = false,
    disposed = false,
    activeWorker,
    workerCleanupFailed = false;
  const ownedOutputs = [];
  function closeWorker() {
    const worker = activeWorker;
    activeWorker = undefined;
    try {
      worker?.close();
    } catch {
      workerCleanupFailed = true;
      fail("ASSET_WORKER_CLEANUP_FAILED");
    }
  }
  function wipe() {
    for (const bytes of ownedOutputs) bytes.fill(0);
    ownedOutputs.length = 0;
  }
  async function dispose() {
    disposed = true;
    try {
      closeWorker();
    } finally {
      wipe();
    }
  }
  async function generateAssets({ extracted, signal } = {}) {
    checkAbort(signal);
    if (disposed || started) fail("ASSET_ADAPTER_SINGLE_USE");
    started = true;
    let reader;
    try {
      reader = resolveReader ? resolveReader(extracted) : extracted?.logicalAssets;
    } catch {
      fail("ASSET_READER_UNAVAILABLE");
    }
    if (!reader || typeof reader.read !== "function") fail("ASSET_READER_UNAVAILABLE");
    const entries = [];
    let inputTotal = 0,
      outputTotal = 0;
    const onAbort = () => {
      try {
        closeWorker();
      } catch {
        // The abort race still rejects promptly; cleanup never reveals worker details.
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      activeWorker = createWorker();
      if (
        !activeWorker ||
        typeof activeWorker.run !== "function" ||
        typeof activeWorker.close !== "function"
      )
        fail("ASSET_WORKER_UNAVAILABLE");
      for (const job of jobs) {
        checkAbort(signal);
        if (disposed) fail("ASSET_DISPOSED");
        const bytes = await abortable(
          () => reader.read(job.input, { maxBytes: ASSET_ADAPTER_LIMITS.inputBytes, signal }),
          signal,
        );
        checkAbort(signal);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > ASSET_ADAPTER_LIMITS.inputBytes)
          fail("ASSET_INPUT_LIMIT");
        inputTotal += bytes.byteLength;
        if (inputTotal > ASSET_ADAPTER_LIMITS.totalInputBytes) fail("ASSET_TOTAL_INPUT_LIMIT");
        // Reject v61 here as well as in the current worker. Never silently substitute pixels.
        if (bytes.length >= 6 && bytes[4] === 61 && bytes[5] === 0) fail("ASSET_V61_NOT_CONNECTED");
        const worker = activeWorker;
        const result = await abortable(
          () => worker.run("image-default-frame", bytes, { frame: job.frame }),
          signal,
        );
        checkAbort(signal);
        if (disposed) fail("ASSET_DISPOSED");
        if (!result?.files || typeof result.files !== "object") fail("ASSET_INVALID_RESULT");
        let responseBytes = 0;
        for (const value of Object.values(result.files)) {
          if (!(value instanceof ArrayBuffer)) fail("ASSET_INVALID_RESULT");
          responseBytes += value.byteLength;
        }
        if (responseBytes > ASSET_ADAPTER_LIMITS.responseBytes) fail("ASSET_RESPONSE_LIMIT");
        for (const [name, path] of job.outputs) {
          const buffer = result.files[name];
          if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) fail("ASSET_MISSING_OUTPUT");
          outputTotal += buffer.byteLength;
          if (outputTotal > ASSET_ADAPTER_LIMITS.retainedOutputBytes) fail("ASSET_OUTPUT_LIMIT");
          const owned = new Uint8Array(buffer.slice(0));
          ownedOutputs.push(owned);
          entries.push(
            Object.freeze({
              path,
              size: owned.byteLength,
              mode: 0o100644,
              async *chunks() {
                if (disposed) fail("ASSET_DISPOSED");
                for (
                  let offset = 0;
                  offset < owned.byteLength;
                  offset += ASSET_ADAPTER_LIMITS.chunkBytes
                ) {
                  checkAbort(signal);
                  if (disposed) fail("ASSET_DISPOSED");
                  yield owned.slice(offset, offset + ASSET_ADAPTER_LIMITS.chunkBytes);
                }
              },
            }),
          );
        }
      }
      closeWorker();
      return entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
    } catch (error) {
      wipe();
      let cleanupFailed = workerCleanupFailed;
      try {
        closeWorker();
      } catch {
        cleanupFailed = true;
      }
      const primary = signal?.aborted
        ? new AssetAdapterError("ASSET_CANCELLED")
        : error instanceof AssetAdapterError
          ? error
          : new AssetAdapterError("ASSET_GENERATION_FAILED");
      if (cleanupFailed) primary.cleanupCode = "ASSET_WORKER_CLEANUP_FAILED";
      throw primary;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
  return Object.freeze({
    capabilities: Object.freeze({ ...ASSET_ADAPTER_CAPABILITIES, v61PngImport: enableV61Png }),
    generateAssets,
    dispose,
  });
}
