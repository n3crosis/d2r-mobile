import { loadPyodide } from "./vendor/pyodide/pyodide.mjs";
let runtime;
async function initialize() {
  const py = await loadPyodide({ indexURL: new URL("./vendor/pyodide/", import.meta.url).href });
  await py.loadPackage(["pillow", "numpy"], { checkIntegrity: true });
  for (const name of [
    "native_functions.py",
    "core.py",
    "derived.py",
    "native_art_original.py",
    "native_art.py",
    "hud_original.py",
    "hud_design_original.py",
    "hud_support_original.py",
    "hud.py",
    "map_goal_original.py",
    "map_goal.py",
    "casc_overlay_original.py",
    "casc_overlay.py",
    "mercenary_original.py",
    "mercenary.py",
    "overlay_recipe_sources.py",
    "overlay_recipe.py",
    "remaining_art_original.py",
    "trove_original.py",
    "remaining_art.py",
    "original_bc3.py",
    "bounded_encoder.py",
  ]) {
    const response = await fetch(new URL(`./generated/${name}`, import.meta.url));
    if (!response.ok) throw new Error(`Missing packaged core: ${name}`);
    py.FS.writeFile(`/home/pyodide/${name}`, await response.text());
  }
  await py.runPythonAsync("from core import execute");
  return py;
}
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
        const transfers = [];
        for (const [name, bytes] of Object.entries(result.files)) {
          const copy = new Uint8Array(bytes);
          result.files[name] = copy.buffer;
          transfers.push(copy.buffer);
        }
        self.postMessage({ id, ok: true, result }, transfers);
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
