import createNative from "../toolchain/program-rewrite-spike/dist/capstone-lz4.mjs";
import {
  createProgramRewriter,
  installProgramNativeBindings,
} from "../toolchain/program-rewrite-spike/rewrite-core.mjs";
import { PROGRAM_REWRITER_SOURCE } from "../program-release-catalog.mjs";
import { byteFactory } from "./wasm-factory.mjs";
const NAMES = [
  "capstone-lz4.wasm",
  "pyodide.mjs",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
  "patch_nso.py",
  "python-adapters.py",
];
const ORIGIN = "https://offline.invalid";
const PREFIX = "/v0.27.7/";
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const digest = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
let started = false;
let context;
let queue = Promise.resolve();
const urls = [];
const rewrite = createProgramRewriter(() => {
  if (!context) throw new Error("PROGRAM_NOT_INITIALIZED");
  return context;
});
async function initialize(data) {
  if (
    started ||
    data.id !== 0 ||
    Object.keys(data).some((key) => !["id", "type", "assets"].includes(key))
  )
    throw new Error("PROGRAM_INITIALIZATION");
  started = true;
  if (!Array.isArray(data.assets) || data.assets.length !== NAMES.length)
    throw new Error("PROGRAM_ASSET_INVENTORY");
  const assets = new Map();
  let total = 0;
  for (const entry of data.assets) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error("PROGRAM_ASSET_ENTRY");
    const [name, buffer] = entry;
    if (
      !NAMES.includes(name) ||
      assets.has(name) ||
      !(buffer instanceof ArrayBuffer) ||
      !buffer.byteLength ||
      buffer.byteLength > 32 * 1024 * 1024
    )
      throw new Error("PROGRAM_ASSET_ENTRY");
    total += buffer.byteLength;
    assets.set(name, new Uint8Array(buffer));
  }
  if (total > 96 * 1024 * 1024) throw new Error("PROGRAM_ASSET_CAP");
  if (hex(await digest(assets.get("patch_nso.py"))) !== PROGRAM_REWRITER_SOURCE)
    throw new Error("PROGRAM_SOURCE_DRIFT");
  // Same source-locked Pyodide loader adapter as the sealed asset runtime.
  // This does not replace fetch, XHR, import, or any browser networking API.
  Object.defineProperty(globalThis, "__readOfflinePyodide", {
    value: async (value, integrity) => {
      const url = new URL(value);
      const name = url.pathname.slice(PREFIX.length);
      if (
        url.origin !== ORIGIN ||
        !url.pathname.startsWith(PREFIX) ||
        url.search ||
        url.hash ||
        !NAMES.slice(1, 6).includes(name)
      )
        throw new Error("PROGRAM_OFFLINE_RESOURCE");
      const bytes = assets.get(name);
      if (!bytes) throw new Error("PROGRAM_OFFLINE_RESOURCE");
      if (
        integrity !== undefined &&
        integrity !== `sha256-${btoa(String.fromCharCode(...(await digest(bytes))))}`
      )
        throw new Error("PROGRAM_OFFLINE_INTEGRITY");
      return new Response(bytes, {
        headers: {
          "Content-Type": name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
        },
      });
    },
  });
  const moduleUrl = (name) => {
    const url = URL.createObjectURL(new Blob([assets.get(name)], { type: "text/javascript" }));
    urls.push(url);
    return url;
  };
  const native = await byteFactory(createNative, assets.get("capstone-lz4.wasm").buffer)();
  installProgramNativeBindings(native);
  await import(moduleUrl("pyodide.asm.js"));
  const { loadPyodide } = await import(moduleUrl("pyodide.mjs"));
  const py = await loadPyodide({ indexURL: `${ORIGIN}${PREFIX}`, stdout() {}, stderr() {} });
  if (py.version !== "0.27.7") throw new Error("PROGRAM_PYTHON_VERSION");
  py.FS.writeFile("/patch_nso.py", assets.get("patch_nso.py"));
  await py.runPythonAsync(
    new TextDecoder("utf-8", { fatal: true }).decode(assets.get("python-adapters.py")),
  );
  // No fixture manifest, fixture fetch, or synthetic input route is shipped here.
  context = { py, manifest: { cases: [] } };
}
self.addEventListener("message", ({ data }) => {
  if (data?.type === "initialize") {
    initialize(data)
      .then(() => self.postMessage({ id: 0, ok: true, result: { initialized: true } }))
      .catch(() => {
        self.postMessage({ id: 0, ok: false, error: "PROGRAM_INITIALIZATION_FAILED" });
        self.close();
      });
    return;
  }
  if (!context || data?.releaseId === undefined || data?.caseName !== undefined) {
    self.postMessage({ id: data?.id, ok: false, error: "PROGRAM_REQUEST_REJECTED" });
    return;
  }
  queue = queue.then(async () => {
    try {
      const result = await rewrite(data);
      self.postMessage(
        { id: data.id, ok: true, ...result },
        Object.values(result.files).map((bytes) => bytes.buffer),
      );
    } catch {
      self.postMessage({ id: data?.id, ok: false, error: "PROGRAM_REWRITE_FAILED" });
    }
  });
});
