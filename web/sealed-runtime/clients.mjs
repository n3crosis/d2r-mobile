import { nativeArtAtlasDescriptor } from "../native-art-texture.mjs";
import { validateEncodeRequest } from "../toolchain/texture-spike/browser-texture-encoder.mjs";
const OFFLINE = "toolchain/offline-runtime-spike";
const TEXTURE = "toolchain/texture-spike";
const LIMIT = Object.freeze({
  file: 64 * 1024 * 1024,
  total: 512 * 1024 * 1024,
  manifest: 2 * 1024 * 1024,
  files: 4096,
});
let attempted = false;
const sealedRuntimes = new WeakSet();
/** Accept only live sessions created by this module after verified preload and initialization. */
export function assertSealedRuntime(value) {
  if (!sealedRuntimes.has(value)) fail("A live verified sealed runtime is required");
  return value;
}
const hash = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
function fail(message) {
  throw new Error(message);
}
function safePath(path) {
  return (
    typeof path === "string" &&
    path.length <= 512 &&
    /^[A-Za-z0-9_.+/-]+$/.test(path) &&
    path.split("/").every((p) => p && p !== "." && p !== "..")
  );
}
/** Pure inventory validation; the caller separately verifies the trusted top digest. */
export function validateRuntimeInventory(manifest) {
  if (
    manifest?.version !== 1 ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.length ||
    manifest.assets.length > LIMIT.files
  )
    fail("Invalid runtime manifest");
  const names = new Set();
  let total = 0;
  for (const asset of manifest.assets) {
    if (
      !safePath(asset.path) ||
      names.has(asset.path.toLowerCase()) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 1 ||
      asset.bytes > LIMIT.file ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      fail("Invalid runtime inventory");
    names.add(asset.path.toLowerCase());
    total += asset.bytes;
  }
  if (total > LIMIT.total || manifest.totalBytes !== total) fail("Runtime byte budget mismatch");
  return manifest.assets;
}
/** Transport is optional: old manifests continue to fetch their logical paths. */
function runtimeTransport(manifest, inventory) {
  if (manifest.transport === undefined)
    return { files: inventory, totalBytes: manifest.totalBytes, entries: undefined };
  const transport = manifest.transport;
  if (
    transport?.version !== 1 ||
    !Array.isArray(transport.entries) ||
    !transport.entries.length ||
    transport.entries.length > inventory.length
  )
    fail("Invalid runtime transport");
  const files = validateRuntimeInventory({
    version: 1,
    assets: transport.files,
    totalBytes: transport.totalBytes,
  });
  let decodedTotal = 0;
  for (const file of files) {
    if (
      !["identity", "gzip"].includes(file.encoding) ||
      !Number.isSafeInteger(file.decodedBytes) ||
      file.decodedBytes < 1 ||
      file.decodedBytes > LIMIT.file ||
      (file.encoding === "identity" && file.decodedBytes !== file.bytes)
    )
      fail("Invalid runtime transport encoding");
    decodedTotal += file.decodedBytes;
  }
  if (decodedTotal > LIMIT.total) fail("Decoded runtime byte budget exceeded");
  const physical = new Map(files.map((file) => [file.path, file]));
  const expected = new Set(inventory.map((asset) => `${asset.sha256}-${asset.bytes}`));
  const entries = new Map();
  const ranges = new Map(files.map((file) => [file.path, []]));
  for (const entry of transport.entries) {
    const key = `${entry.sha256}-${entry.bytes}`;
    const file = physical.get(entry.file);
    if (
      !expected.has(key) ||
      entries.has(key) ||
      !file ||
      !Number.isSafeInteger(entry.offset) ||
      entry.offset < 0 ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.offset + entry.bytes > file.decodedBytes
    )
      fail("Invalid runtime transport entry");
    entries.set(key, entry);
    ranges.get(entry.file).push(entry);
  }
  if (entries.size !== expected.size) fail("Incomplete runtime transport");
  for (const [path, segments] of ranges) {
    let end = 0;
    for (const entry of segments.sort((a, b) => a.offset - b.offset)) {
      if (entry.offset !== end) fail("Runtime transport overlap or gap");
      end += entry.bytes;
    }
    if (end !== physical.get(path).decodedBytes) fail("Unused runtime transport bytes");
  }
  return { files, totalBytes: transport.totalBytes, entries };
}
// Only verified public inventory assets enter this cache, before private inputs are opened.
const PUBLIC_CACHE = "d2r-public-runtime-sha256-v1";
const DOWNLOAD_CONCURRENCY = 4;
async function responseBytes(response, cap, onChunk) {
  if (!response.ok || !response.body) fail("Missing public runtime asset");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > cap) fail("Public runtime byte cap");
      chunks.push(value);
      onChunk?.(value.length);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function read(url, cap, signal, onChunk) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(
    () => controller.abort(new Error("Application download timed out. Reload to retry.")),
    90000,
  );
  try {
    const response = await fetch(url, {
      // Preserve the hosting session for owner-private Sites; URLs are same-origin.
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    return await responseBytes(response, cap, onChunk);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
// A browser storage failure must not prevent the uncached public-download path.
async function optionalStorage(operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Public cache unavailable")), 3000);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
function progressReporter(onProgress) {
  const state = {
    phase: "manifest",
    loadedBytes: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    cachedBytes: 0,
    completedFiles: 0,
    totalFiles: 0,
    label: "Reading application file list…",
  };
  let last = 0;
  return (change, force = false) => {
    Object.assign(state, change);
    const now = performance.now();
    if (force || now - last >= 100) {
      last = now;
      onProgress?.({ ...state });
    }
  };
}
function jsonOptions(value, cap = 65536) {
  const text = JSON.stringify(value);
  if (typeof text !== "string" || new TextEncoder().encode(text).length > cap)
    fail("Runtime metadata cap");
  return JSON.parse(text);
}
function input(bytes, cap) {
  if (
    !(bytes instanceof Uint8Array) ||
    !(bytes.buffer instanceof ArrayBuffer) ||
    bytes.length > cap
  )
    fail("Runtime input cap");
  return bytes.slice();
}
function channel(worker, onFatal, onStage) {
  let next = 1,
    closed = false,
    entry;
  const stop = (reason = new Error("Sealed runtime closed")) => {
    if (closed) return;
    closed = true;
    worker.terminate();
    if (entry) {
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener("abort", entry.abort);
      entry.reject(reason);
      entry = undefined;
    }
  };
  worker.onmessage = ({ data }) => {
    if (entry?.id === 0 && data?.type === "initialization-stage") {
      onStage?.(data.stage);
      return;
    }
    if (!entry || data?.id !== entry.id) return;
    const p = entry;
    entry = undefined;
    clearTimeout(p.timer);
    p.signal?.removeEventListener("abort", p.abort);
    data.ok
      ? p.resolve(data.result === undefined ? data : data.result)
      : p.reject(
          new Error(
            p.id === 0
              ? String(data.error ?? "Runtime initialization failed").slice(0, 1200)
              : "Runtime operation failed",
          ),
        );
  };
  worker.onerror = (event) => {
    stop(
      new Error(
        entry?.id === 0
          ? String(event.message || "Worker initialization failed").slice(0, 1200)
          : "Runtime worker failed",
      ),
    );
    onFatal();
  };
  worker.onmessageerror = () => {
    stop();
    onFatal();
  };
  return {
    stop,
    takeWorker() {
      if (closed || entry) fail("Runtime unavailable");
      worker.onmessage = null;
      return worker;
    },
    get busy() {
      return Boolean(entry);
    },
    request(message, transfers = [], signal, initialize = false) {
      if (closed || entry || signal?.aborted)
        return Promise.reject(new Error("Runtime unavailable, busy or cancelled"));
      const id = initialize ? 0 : next++;
      return new Promise((resolve, reject) => {
        const abort = () => {
          stop(new DOMException("Runtime cancelled", "AbortError"));
          onFatal();
        };
        const timer = setTimeout(
          () => {
            stop(new Error("Runtime deadline exceeded"));
            onFatal();
          },
          initialize ? 60000 : 120000,
        );
        entry = { id, resolve, reject, timer, signal, abort };
        signal?.addEventListener("abort", abort, { once: true });
        try {
          worker.postMessage({ ...message, id }, transfers);
        } catch (error) {
          stop(error);
          onFatal();
        }
      });
    },
  };
}
/** Trusted application bootstrap only. Call before asking for private files/keys.
 * manifestSha256 MUST come from the built runtime-integrity.mjs, never user input.
 * Resolves only after every requested actual runtime has initialized with verified public bytes.
 */
export async function prepareSealedRuntime({
  baseUrl,
  manifestSha256,
  components = ["assets", "texture", "translator", "extraction", "program", "spirvCross"],
  signal,
  onProgress,
} = {}) {
  if (attempted) fail("Runtime bootstrap is one-shot per page");
  attempted = true;
  if (
    !isSecureContext ||
    !crypto?.subtle ||
    typeof Worker !== "function" ||
    typeof WebAssembly !== "object" ||
    navigator.serviceWorker?.controller
  )
    fail("Required clean browser capabilities unavailable");
  if (
    !/^[a-f0-9]{64}$/.test(manifestSha256) ||
    !Array.isArray(components) ||
    !components.length ||
    new Set(components).size !== components.length ||
    components.some(
      (x) =>
        !["assets", "texture", "translator", "extraction", "program", "spirvCross"].includes(x),
    )
  )
    fail("Invalid trusted runtime configuration");
  const base = new URL(baseUrl, location.href);
  if (
    base.origin !== location.origin ||
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !base.pathname.endsWith("/")
  )
    fail("Runtime base must be same-origin directory");
  const report = progressReporter(onProgress);
  report({}, true);
  const publicBytes = await read(new URL("runtime-manifest.json", base), LIMIT.manifest, signal);
  if ((await hash(publicBytes)) !== manifestSha256) fail("Runtime manifest integrity mismatch");
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(publicBytes));
  const inventory = validateRuntimeInventory(manifest),
    assets = new Map();
  const transport = runtimeTransport(manifest, inventory);
  const downloadFiles = transport.files;
  const downloadedAssets = new Map();
  let cache = await optionalStorage(() => caches.open(PUBLIC_CACHE));
  const cacheKey = (record) =>
    new URL(`__public-runtime-cache__/${record.sha256}-${record.bytes}`, base).href;
  let downloadedBytes = 0,
    cachedBytes = 0,
    completedFiles = 0,
    cursor = 0;
  const update = (force = false) =>
    report(
      {
        phase: "download",
        loadedBytes: downloadedBytes + cachedBytes,
        downloadedBytes,
        cachedBytes,
        completedFiles,
        totalFiles: downloadFiles.length,
        totalBytes: transport.totalBytes,
        label: "Loading application files…",
      },
      force,
    );
  update(true);
  const downloads = new AbortController();
  const abortDownloads = () => downloads.abort(signal?.reason);
  signal?.addEventListener("abort", abortDownloads, { once: true });
  if (signal?.aborted) abortDownloads();
  const deadline = setTimeout(
    () => downloads.abort(new Error("Application loading timed out. Reload to retry.")),
    300000,
  );
  async function download() {
    while (cursor < downloadFiles.length) {
      if (downloads.signal.aborted) throw downloads.signal.reason;
      const record = downloadFiles[cursor++];
      const key = cacheKey(record);
      let bytes;
      if (cache) {
        const publicCache = cache;
        const cached = await optionalStorage(async () => {
          const response = await publicCache.match(key);
          if (!response) return { value: undefined };
          try {
            const value = await responseBytes(response, record.bytes);
            if (value.length === record.bytes && (await hash(value)) === record.sha256)
              return { value };
          } catch {
            // A truncated or oversized cache record is never trusted or retained.
          }
          await publicCache.delete(key);
          return { value: undefined };
        });
        if (!cached) cache = undefined;
        if (cached?.value) {
          bytes = cached.value;
          cachedBytes += bytes.length;
          update();
        }
      }
      if (!bytes) {
        bytes = await read(new URL(record.path, base), record.bytes, downloads.signal, (size) => {
          downloadedBytes += size;
          update();
        });
        if (bytes.length !== record.bytes || (await hash(bytes)) !== record.sha256)
          fail("Runtime asset integrity mismatch. Reload to retry.");
        if (cache) {
          const publicCache = cache;
          const stored = await optionalStorage(async () => {
            await publicCache.put(key, new Response(bytes));
            return true;
          });
          if (!stored) cache = undefined;
        }
      }
      downloadedAssets.set(record.path, bytes);
      completedFiles++;
      update();
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, downloadFiles.length) }, download),
    );
    if (downloads.signal.aborted) throw downloads.signal.reason;
    if (cache) {
      // Evict only obsolete entries from our public cache, never any private browser storage.
      const activeKeys = new Set(downloadFiles.map(cacheKey));
      await optionalStorage(async () => {
        for (const request of await cache.keys())
          if (!activeKeys.has(request.url)) await cache.delete(request);
      });
    }
  } catch (error) {
    downloads.abort(error);
    throw error;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abortDownloads);
  }
  update(true);
  report({ phase: "initializing", label: "Preparing application…" }, true);
  if (transport.entries) {
    for (const file of downloadFiles) {
      if (signal?.aborted) throw new DOMException("Runtime cancelled", "AbortError");
      if (file.encoding === "gzip") {
        if (typeof DecompressionStream !== "function")
          fail(
            "This browser cannot decompress application files. Use current desktop Chrome or Edge.",
          );
        const stream = new Blob([downloadedAssets.get(file.path)])
          .stream()
          .pipeThrough(new DecompressionStream("gzip"));
        const decoded = await responseBytes(new Response(stream), file.decodedBytes);
        if (decoded.length !== file.decodedBytes) fail("Decoded runtime size mismatch");
        downloadedAssets.set(file.path, decoded);
      }
    }
  }
  const verifiedContents = new Map();
  for (const record of inventory) {
    if (signal?.aborted) throw new DOMException("Runtime cancelled", "AbortError");
    if (!transport.entries) {
      assets.set(record.path, downloadedAssets.get(record.path));
      continue;
    }
    const key = `${record.sha256}-${record.bytes}`;
    let value = verifiedContents.get(key);
    if (!value) {
      const entry = transport.entries.get(key);
      value = downloadedAssets.get(entry.file).subarray(entry.offset, entry.offset + entry.bytes);
      if (value.length !== record.bytes || (await hash(value)) !== record.sha256)
        fail("Packed runtime asset integrity mismatch");
      verifiedContents.set(key, value);
    }
    assets.set(record.path, value);
  }
  downloadedAssets.clear();
  verifiedContents.clear();
  // Validate executable closure before allowing private inputs.
  function bytes(path) {
    const value = assets.get(path);
    if (!value) fail(`Missing verified runtime asset: ${path}`);
    return value;
  }
  function closure(directory) {
    const sub = JSON.parse(new TextDecoder().decode(bytes(`${directory}/manifest.json`)));
    if (sub.version !== 1 || !Array.isArray(sub.assets) || sub.assets.length > 1024)
      fail("Invalid component manifest");
    const seen = new Set();
    return sub.assets
      .filter((a) => a.path !== "worker.mjs")
      .map((a) => {
        if (!safePath(a.path) || a.path.includes("/") || seen.has(a.path))
          fail("Invalid component asset");
        seen.add(a.path);
        const path = `${directory}/${a.path}`,
          record = inventory.find((x) => x.path === path);
        if (!record || record.bytes !== a.bytes || record.sha256 !== a.sha256)
          fail("Component manifest mismatch");
        return [a.path, bytes(path)];
      });
  }
  const plans = {};
  if (components.includes("assets"))
    plans.assets = {
      entry: `${OFFLINE}/pyodide-dist/worker.mjs`,
      assets: closure(`${OFFLINE}/pyodide-dist`),
    };
  if (components.includes("translator"))
    plans.translator = {
      entry: "sealed-runtime/dotnet-worker.mjs",
      assets: closure(`${OFFLINE}/dotnet-dist`),
    };
  if (components.includes("texture"))
    plans.texture = {
      entry: "sealed-runtime/texture-worker.mjs",
      assets: [
        ["texture.mjs", bytes(`${TEXTURE}/dist/texture.mjs`)],
        ["texture.wasm", bytes(`${TEXTURE}/dist/texture.wasm`)],
        ...(assets.has(`${TEXTURE}/dist/bc3.wasm`)
          ? [["bc3.wasm", bytes(`${TEXTURE}/dist/bc3.wasm`)]]
          : []),
        ["browser-texture.mjs", bytes(`${TEXTURE}/browser-texture.mjs`)],
        ["browser-texture-encoder.mjs", bytes(`${TEXTURE}/browser-texture-encoder.mjs`)],
      ],
    };
  if (components.includes("extraction"))
    plans.extraction = {
      entry: "sealed-workers/nsp-worker.mjs",
      assets: [
        ["hactool-boundary.wasm", bytes("toolchain/nsp-extract-spike/dist/hactool-boundary.wasm")],
      ],
    };
  if (components.includes("spirvCross"))
    plans.spirvCross = {
      entry: "sealed-workers/cross-worker.mjs",
      assets: [["spirv-cross.wasm", bytes("toolchain/spirv-cross-spike/wwwroot/spirv-cross.wasm")]],
    };
  if (components.includes("program"))
    plans.program = {
      entry: "sealed-workers/program-worker.mjs",
      assets: [
        ["capstone-lz4.wasm", bytes("toolchain/program-rewrite-spike/dist/capstone-lz4.wasm")],
      ],
    };
  for (const plan of Object.values(plans)) bytes(plan.entry);
  if (signal?.aborted) throw new DOMException("Runtime cancelled", "AbortError");
  // Prototype: no page-level CSP lockdown. Input handling remains local.
  const channels = {},
    urls = [];
  let closed = false;
  let session;
  function close() {
    if (closed) return;
    closed = true;
    if (session) sealedRuntimes.delete(session);
    for (const c of Object.values(channels)) c.stop();
    for (const url of urls) URL.revokeObjectURL(url);
    assets.clear();
  }
  try {
    const initialized = {};
    for (const [name, plan] of Object.entries(plans)) {
      const url = URL.createObjectURL(new Blob([bytes(plan.entry)], { type: "text/javascript" }));
      urls.push(url);
      const labels = {
        assets: "game resources",
        texture: "textures",
        translator: "shaders",
        extraction: "package reader",
        program: "application compiler",
        spirvCross: "shader converter",
      };
      const label = `Preparing ${labels[name] ?? "application"}…`;
      report({ phase: "initializing", label }, true);
      let initializationStage = "starting";
      const c = (channels[name] = channel(new Worker(url, { type: "module" }), close, (stage) => {
        initializationStage = String(stage).slice(0, 80);
        const stages = {
          "probe-before": "starting runtime",
          "config-module": "reading configuration",
          "loader-module": "loading engine",
          "runtime-create": "starting engine",
          "assembly-exports": "loading functions",
          "probe-after": "finishing startup",
        };
        report(
          { phase: "initializing", label: stages[stage] ? `${label} ${stages[stage]}` : label },
          true,
        );
      }));
      const transferred = plan.assets.map(([local, value]) => [local, value.slice().buffer]);
      const buffers = transferred.map(([, buffer]) => buffer);
      let result;
      try {
        result = await c.request(
          { type: "initialize", assets: transferred },
          buffers,
          signal,
          true,
        );
      } catch (error) {
        throw new Error(
          `${name} initialization (${initializationStage}): ${String(error?.message ?? error).slice(0, 1200)}`,
        );
      }
      if (result?.initialized !== true || buffers.some((buffer) => buffer.byteLength !== 0))
        fail("Actual runtime initialization/transfer failed");
      initialized[name] = result;
    }
    // Public inventory bytes remain available by copy, never via a loader/fetch callback.
    // They contain no private job inputs and are discarded when this session closes.
    function readPublicAsset(path) {
      if (closed) fail("Runtime session closed");
      if (!safePath(path)) fail("Invalid public asset path");
      return bytes(path).slice();
    }
    function lease(name) {
      if (closed || !channels[name]) fail("Runtime component unavailable");
      let released = false,
        active = false;
      return {
        request(message, transfers, signal) {
          if (released || closed || active)
            return Promise.reject(new Error("Runtime lease closed or busy"));
          active = true;
          return channels[name].request(message, transfers, signal).finally(() => {
            active = false;
          });
        },
        close() {
          if (released) return;
          released = true;
          if (active) close();
        },
      };
    }
    function createAssetWorker() {
      const l = lease("assets");
      return {
        run(operation, value, options = {}) {
          const cap =
            (operation === "overlay-recipe"
              ? 128
              : ["hud-v4", "casc-overlay"].includes(operation)
                ? 64
                : 20) *
            1024 *
            1024;
          const payload = input(
            value,
            operation === "encode-linear-bc3" ? 16 * 1024 * 1024 : cap,
          ).buffer;
          return l.request(
            {
              type: "run",
              operation,
              payload,
              options: jsonOptions(options, operation === "casc-overlay" ? 1048576 : 4096),
            },
            [payload],
          );
        },
        close: l.close,
      };
    }
    function createTextureClient() {
      const l = lease("texture");
      return {
        layout(descriptor, options = {}) {
          return l.request({
            operation: "layout",
            descriptor: jsonOptions(descriptor),
            options: jsonOptions(options),
          });
        },
        decode(descriptor, value, options = {}) {
          const source = input(value, 64 * 1024 * 1024);
          return l.request(
            {
              operation: "decode",
              descriptor: jsonOptions(descriptor),
              source,
              options: jsonOptions(options),
            },
            [source.buffer],
          );
        },
        decodeV61(value) {
          const source = input(value, 64 * 1024 * 1024 + 40);
          return l.request({ operation: "decodeV61", source }, [source.buffer]);
        },
        async decodeAtlas(value, { signal } = {}) {
          const { descriptor, ...geometry } = nativeArtAtlasDescriptor(value);
          const source = value.slice(40);
          const result = await l.request(
            { operation: "decode", descriptor, source },
            [source.buffer],
            signal,
          );
          return { ...result, ...geometry };
        },
        encodeAndPack({ templateHeader, rgba, width, height }, { signal } = {}) {
          if (signal?.aborted) throw new DOMException("Encoding cancelled", "AbortError");
          validateEncodeRequest(templateHeader, width, height);
          if (
            ![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 8192) ||
            width * height > 4194304 ||
            rgba?.byteLength !== width * height * 4
          )
            fail("RGBA dimensions mismatch");
          const header = input(templateHeader, 40),
            pixels = input(rgba, 16 * 1024 * 1024);
          return l.request(
            { operation: "encodeAndPack", templateHeader: header, rgba: pixels, width, height },
            [header.buffer, pixels.buffer],
            signal,
          );
        },
        packLinearBC3({ templateHeader, linearBC3, width, height }, { signal } = {}) {
          const header = input(templateHeader, 40),
            linear = input(linearBC3, 16 * 1024 * 1024);
          return l.request(
            {
              operation: "packLinearBC3",
              templateHeader: header,
              linearBC3: linear,
              width,
              height,
            },
            [header.buffer, linear.buffer],
            signal,
          );
        },
        close: l.close,
      };
    }
    function createTextureEncoder() {
      const texture = createTextureClient();
      // The integrity-verified inventory advertises capability by including the Rust binary.
      // A present but broken binary fails initialization; it never falls back.
      if (assets.has(`${TEXTURE}/dist/bc3.wasm`))
        return {
          packLinearBC3: texture.packLinearBC3,
          encodeAndPack: texture.encodeAndPack,
          close: texture.close,
        };
      let asset;
      try {
        asset = createAssetWorker();
      } catch (error) {
        texture.close();
        throw error;
      }
      return {
        packLinearBC3: texture.packLinearBC3,
        async encodeAndPack({ templateHeader, rgba, width, height }, { signal } = {}) {
          if (signal?.aborted) throw new DOMException("Encoding cancelled", "AbortError");
          validateEncodeRequest(templateHeader, width, height);
          if (
            ![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 8192) ||
            width * height > 4194304 ||
            rgba?.byteLength !== width * height * 4
          )
            fail("RGBA dimensions mismatch");
          const stop = () => close();
          signal?.addEventListener("abort", stop, { once: true });
          try {
            const encoded = await asset.run("encode-linear-bc3", rgba, { width, height });
            const linearBC3 = new Uint8Array(encoded.files["linear.bc3"]);
            const packed = await texture.packLinearBC3(
              { templateHeader, linearBC3, width, height },
              { signal },
            );
            return { ...packed, linearBC3 };
          } finally {
            signal?.removeEventListener("abort", stop);
          }
        },
        close() {
          asset.close();
          texture.close();
        },
      };
    }
    function createTranslator() {
      const l = lease("translator");
      return {
        translate({ job, code, signal }) {
          const payload = input(code, 1024 * 1024).buffer;
          return l.request({ type: "run", job: jsonOptions(job), payload }, [payload], signal);
        },
        close: l.close,
      };
    }
    function workerFacade(client, invoke) {
      let stopped = false;
      const events = new Map();
      const bridge = {
        onmessage: null,
        onerror: null,
        addEventListener(type, listener) {
          if (!events.has(type)) events.set(type, new Set());
          events.get(type).add(listener);
        },
        removeEventListener(type, listener) {
          events.get(type)?.delete(listener);
        },
        postMessage(data) {
          if (stopped) fail("Runtime worker closed");
          Promise.resolve()
            .then(() => invoke(data))
            .then(
              (reply) => emit(reply),
              () =>
                emit({
                  id: data?.id,
                  requestId: data?.requestId,
                  ok: false,
                  error: "Sealed operation failed",
                }),
            );
        },
        terminate() {
          if (stopped) return;
          stopped = true;
          events.clear();
          client.close();
        },
      };
      function emit(data) {
        if (stopped) return;
        const event = { data };
        bridge.onmessage?.(event);
        for (const listener of events.get("message") ?? []) listener(event);
      }
      return bridge;
    }
    function createTranslatorWorker() {
      const client = createTranslator();
      return workerFacade(client, async (data) => ({
        requestId: data.requestId,
        result: await client.translate({ job: data.job, code: data.code }),
      }));
    }
    function createCrossWorker() {
      const l = lease("spirvCross");
      return workerFacade(l, async (data) => {
        if (data?.type !== "convert" || !(data.spirv instanceof ArrayBuffer))
          fail("Invalid Cross request");
        const spirv = input(new Uint8Array(data.spirv), 16 * 1024 * 1024).buffer;
        const result = await l.request(
          { type: "convert", spirv, replayContext: jsonOptions(data.replayContext) },
          [spirv],
        );
        return { id: data.id, ok: true, result };
      });
    }
    function createProgramWorker() {
      const l = lease("program");
      return {
        run({ bytes, moduleName, releaseId, caseName }) {
          if (caseName !== undefined)
            fail("Synthetic program profiles are not accepted by sealed application client");
          const copy = input(bytes, 32 * 1024 * 1024);
          return l.request({ bytes: copy, moduleName, releaseId }, [copy.buffer]);
        },
        close: l.close,
      };
    }
    let extractionTaken = false;
    function createExtractionWorker() {
      if (closed || !channels.extraction || extractionTaken)
        fail("Extraction worker unavailable or already acquired");
      extractionTaken = true;
      return channels.extraction.takeWorker();
    }
    const workerUrls = Object.freeze(
      Object.fromEntries(
        ["translator", "spirvCross"]
          .filter((name) => plans[name])
          .map((name) => [name, new URL(plans[name].entry, base).href]),
      ),
    );
    function createShaderWorkerFactory() {
      return (url) => {
        if (url === workerUrls.translator) return createTranslatorWorker();
        if (url === workerUrls.spirvCross) return createCrossWorker();
        fail("Unknown sealed shader worker URL");
      };
    }
    session = Object.freeze({
      initialized: Object.freeze(initialized),
      readPublicAsset,
      createAssetWorker,
      createTextureClient,
      createTextureEncoder,
      createTranslator,
      createTranslatorWorker,
      createCrossWorker,
      createProgramWorker,
      createExtractionWorker,
      createShaderWorkerFactory,
      workerUrls,
      close,
    });
    sealedRuntimes.add(session);
    report({ phase: "initializing", label: "Preparing application profile…" }, true);
    return session;
  } catch (error) {
    close();
    throw error;
  }
}
