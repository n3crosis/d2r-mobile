// Dedicated synthetic-only worker. Private-input jobs are accepted only after initialization.
const RUNTIME_ORIGIN = "https://offline.invalid";
let initialized = false;
let starting = false;
let py;
let phase = "validate";
let queue = Promise.resolve();
const objectUrls = [];
const digest = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
async function probe(urls) {
  let rejected = 0;
  for (const url of urls) {
    try {
      await fetch(url);
    } catch {
      rejected++;
    }
    try {
      await import(url);
    } catch {
      rejected++;
    }
  }
  if (rejected !== 4) throw new Error("Network seal failed");
  return rejected;
}
async function initialize(data) {
  if (starting || initialized) throw new Error("Already initialized");
  starting = true;
  if (
    !Array.isArray(data.assets) ||
    data.assets.length > 32 ||
    !Array.isArray(data.probes) ||
    data.probes.length !== 2 ||
    !data.probes.every((url) => /^http:\/\/127\.0\.0\.1:\d+\/probe\/[a-z]+$/.test(url))
  )
    throw new Error("Invalid proof initialization");
  const assets = new Map();
  let total = 0;
  for (const [name, bytes] of data.assets) {
    if (
      typeof name !== "string" ||
      !/^[a-zA-Z0-9_.+-]+$/.test(name) ||
      assets.has(name) ||
      !(bytes instanceof ArrayBuffer) ||
      !bytes.byteLength ||
      bytes.byteLength > 32 * 1024 * 1024
    )
      throw new Error("Invalid bounded runtime asset");
    total += bytes.byteLength;
    assets.set(name, new Uint8Array(bytes));
  }
  if (total > 96 * 1024 * 1024) throw new Error("Runtime cap exceeded");
  let reads = 0;
  // This callback is used only at three source-locked Pyodide internal call sites.
  // Global fetch, import, XHR and the browser CSP are never replaced.
  Object.defineProperty(globalThis, "__readOfflinePyodide", {
    value: async (value, integrity) => {
      const url = new URL(value);
      const prefix = "/v0.27.7/";
      if (
        url.origin !== RUNTIME_ORIGIN ||
        !url.pathname.startsWith(prefix) ||
        url.search ||
        url.hash
      )
        throw new Error("Unknown offline resource");
      const name = url.pathname.slice(prefix.length);
      const bytes = assets.get(name);
      if (!bytes) throw new Error("Unpackaged offline resource");
      if (integrity !== undefined && integrity !== `sha256-${b64(await digest(bytes))}`)
        throw new Error("Offline package integrity mismatch");
      reads++;
      return new Response(bytes, {
        headers: {
          "Content-Type": name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
        },
      });
    },
  });
  const before = await probe(data.probes);
  function moduleUrl(name) {
    const bytes = assets.get(name);
    if (!bytes) throw new Error("Missing runtime code");
    const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
    objectUrls.push(url);
    return url;
  }
  phase = "import-runtime";
  await import(moduleUrl("pyodide.asm.js"));
  const { loadPyodide } = await import(moduleUrl("pyodide.mjs"));
  phase = "initialize-python";
  py = await loadPyodide({
    indexURL: `${RUNTIME_ORIGIN}/v0.27.7/`,
    stdout() {},
    stderr() {},
  });
  phase = "load-packages";
  const packageErrors = [];
  await py.loadPackage(["pillow", "numpy"], {
    checkIntegrity: true,
    messageCallback() {},
    errorCallback(message) {
      if (packageErrors.length < 4) packageErrors.push(String(message).slice(0, 1000));
    },
  });
  const packages = {
    numpy: Object.hasOwn(py.loadedPackages, "numpy"),
    pillow: Object.hasOwn(py.loadedPackages, "pillow"),
  };
  if (py.version !== "0.27.7" || !packages.numpy || !packages.pillow)
    throw new Error(
      `Runtime package initialization incomplete ${JSON.stringify(packages)}: ${packageErrors.join("; ")}`,
    );
  for (const name of [
    "native_functions.py",
    "core.py",
    "derived.py",
    "native_art_original.py",
    "native_art.py",
  ]) {
    const bytes = assets.get(name);
    if (!bytes) throw new Error("Missing packaged Python source");
    py.FS.writeFile(`/home/pyodide/${name}`, bytes);
  }
  for (const [stage, code] of [
    ["import-numpy", "import numpy"],
    ["import-pillow", "from PIL import Image"],
    ["import-native-functions", "import native_functions"],
    ["import-derived", "import derived"],
    ["import-native-art", "import native_art"],
    ["import-core", "from core import execute"],
  ]) {
    phase = stage;
    await py.runPythonAsync(code);
  }
  const after = await probe(data.probes);
  // Unknown/missing dependencies never fall back to network.
  let missingRejected = false;
  try {
    await globalThis.__readOfflinePyodide(`${RUNTIME_ORIGIN}/v0.27.7/missing.whl`);
  } catch {
    missingRejected = true;
  }
  if (!missingRejected) throw new Error("Unknown resource accepted");
  initialized = true;
  phase = "ready";
  return { initialized: true, blocked: before + after, reads, version: py.version, packages };
}
async function run(data) {
  if (
    !initialized ||
    !Number.isSafeInteger(data.id) ||
    data.id < 1 ||
    !["image-default-frame", "experience-table", "overlay-paths"].includes(data.operation) ||
    !(data.payload instanceof ArrayBuffer) ||
    data.payload.byteLength > 20 * 1024 * 1024 ||
    typeof data.options !== "object" ||
    data.options === null ||
    JSON.stringify(data.options).length > 4096
  )
    throw new Error("Invalid bounded synthetic request");
  py.globals.set("_op", data.operation);
  py.globals.set("_payload", new Uint8Array(data.payload));
  py.globals.set("_options_json", JSON.stringify(data.options));
  let proxy;
  try {
    proxy = py.runPython('execute(_op, bytes(_payload), __import__("json").loads(_options_json))');
    const result = proxy.toJs({ dict_converter: Object.fromEntries });
    const transfers = [];
    for (const [name, bytes] of Object.entries(result.files)) {
      const copy = new Uint8Array(bytes);
      result.files[name] = copy.buffer;
      transfers.push(copy.buffer);
    }
    self.postMessage({ id: data.id, ok: true, result }, transfers);
  } finally {
    proxy?.destroy();
    py.globals.delete("_op");
    py.globals.delete("_payload");
    py.globals.delete("_options_json");
  }
}
self.onmessage = ({ data }) => {
  // Do not queue jobs arriving while initialization is network-unproven.
  if (data?.type !== "initialize" && !initialized) {
    self.postMessage({ id: data?.id, ok: false, error: "Runtime not initialized" });
    return;
  }
  queue = queue.then(async () => {
    try {
      if (data?.type === "initialize")
        self.postMessage({ id: 0, ok: true, result: await initialize(data) });
      else await run(data);
    } catch (error) {
      // Initialization cannot receive job input. Its bounded diagnostics contain
      // only public runtime/source information; job failures remain sanitized.
      const detail =
        !initialized && data?.type === "initialize"
          ? `: ${String(error?.message ?? error).slice(0, 4000)}`
          : "";
      self.postMessage({
        id: data?.id ?? 0,
        ok: false,
        error: `Offline Pyodide operation failed (${phase})${detail}`,
      });
    }
  });
};
