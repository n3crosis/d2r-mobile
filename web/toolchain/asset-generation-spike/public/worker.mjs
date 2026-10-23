// 在工作线程中调度受限资源生成；依据 ./vendor/pyodide/pyodide.mjs、./generated/art-kernels.mjs 的模块与调用约定。
// Dispatch bounded asset generation in a worker using the module and calling contracts in ./vendor/pyodide/pyodide.mjs、./generated/art-kernels.mjs.
import { loadPyodide } from "./vendor/pyodide/pyodide.mjs";
import * as kernels from "./generated/art-kernels.mjs";
import { hasAssetTransform, executeAssetTransform } from "../../asset-transforms-js/transforms.mjs";
import { createPinnedCascOverlayTransform } from "../../casc-overlay-js/overlay.mjs";
import { createPngCodec } from "../../png-codec-exact/codec.mjs";
import SparkMD5 from "../../../vendor/spark-md5-3.0.2/spark-md5.mjs";
let runtime;
let cascRuntime;
async function initializeCasc() {
  const response = await fetch(
    new URL("../../png-codec-exact/dist/png-codec.wasm", import.meta.url),
  );
  if (!response.ok) throw new Error("Missing packaged CASC codec");
  const codec = await createPngCodec(await response.arrayBuffer());
  return createPinnedCascOverlayTransform({ codec, SparkMD5 });
}
async function initialize() {
  const py = await loadPyodide({ indexURL: new URL("./vendor/pyodide/", import.meta.url).href });
  await py.loadPackage(["pillow"], { checkIntegrity: true });
  py.registerJsModule("art_kernel_bridge", kernels);
  for (const name of [
    "art_pixels.py",
    "native_functions.py",
    "core.py",
    "native_art_original.py",
    "native_art.py",
    "hud_original.py",
    "hud_design_original.py",
    "hud_support_original.py",
    "hud.py",
    "map_goal_original.py",
    "map_goal.py",
    "mercenary_original.py",
    "mercenary.py",
    "overlay_recipe_sources.py",
    "overlay_recipe.py",
    "remaining_art_original.py",
    "trove_original.py",
    "remaining_art.py",
  ]) {
    const response = await fetch(new URL(`./generated/${name}`, import.meta.url));
    if (!response.ok) throw new Error(`Missing packaged core: ${name}`);
    py.FS.writeFile(`/home/pyodide/${name}`, await response.text());
  }
  await py.runPythonAsync("from core import execute");
  return py;
}
function postResult(id, result) {
  const transfers = [];
  for (const [name, bytes] of Object.entries(result.files)) {
    const copy = new Uint8Array(bytes);
    result.files[name] = copy.buffer;
    transfers.push(copy.buffer);
  }
  self.postMessage({ id, ok: true, result }, transfers);
}
// 串行队列避免并发访问 Python 全局状态和重复初始化。
// Serial queue avoids concurrent Python globals and double initialization.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, operation, payload, options = {} } = data ?? {};
    try {
      if (
        !Number.isSafeInteger(id) ||
        typeof operation !== "string" ||
        !(payload instanceof ArrayBuffer)
      )
        throw new Error("Invalid worker request");
      if (
        payload.byteLength >
        (operation === "encode-linear-bc3"
          ? 16
          : operation === "overlay-recipe"
            ? 128
            : ["hud-v4", "casc-overlay"].includes(operation)
              ? 64
              : 20) *
          1024 *
          1024
      )
        throw new Error("Input exceeds operation byte limit");
      if (hasAssetTransform(operation)) {
        const result = await executeAssetTransform(operation, payload, options);
        postResult(id, result);
        return;
      }
      if (operation === "casc-overlay") {
        const generate = await (cascRuntime ??= initializeCasc());
        postResult(id, await generate(payload, options));
        return;
      }
      const py = await (runtime ??= initialize());
      py.globals.set("_op", operation);
      py.globals.set("_payload", new Uint8Array(payload));
      py.globals.set("_options_json", JSON.stringify(options));
      let proxy;
      try {
        proxy = py.runPython(
          'execute(_op, bytes(_payload), __import__("json").loads(_options_json))',
        );
        const result = proxy.toJs({ dict_converter: Object.fromEntries });
        postResult(id, result);
      } finally {
        proxy?.destroy();
        py.globals.delete("_op");
        py.globals.delete("_payload");
        py.globals.delete("_options_json");
      }
    } catch (error) {
      self.postMessage({ id, ok: false, error: String(error.message ?? error) });
    }
  });
};
