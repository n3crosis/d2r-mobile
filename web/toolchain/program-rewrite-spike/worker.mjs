/* Synthetic-only proof boundary: does not authorize or enable real-game builds. */
import createNative from "./capstone-lz4.mjs";
import { loadPyodide } from "./runtime/pyodide.mjs";
const MAX_FIXTURE = 1024 * 1024;
const hex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
const digest = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
async function read(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Missing pinned runtime input: ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}
let initialized;
function initialize() {
  initialized ??= (async () => {
    const native = await createNative();
    globalThis.programDecode = (word, address) =>
      native.ccall("decode_word", "string", ["number", "number"], [word, address]);
    globalThis.programLz4 = (inputHex, size) => {
      if (!Number.isInteger(size) || size < 0 || size > MAX_FIXTURE)
        throw new Error("LZ4 output exceeds synthetic bound");
      const input = Uint8Array.from(inputHex.match(/../g) ?? [], (x) => parseInt(x, 16));
      const src = native._malloc(Math.max(input.length, 1));
      const dst = native._malloc(Math.max(size, 1));
      if (!src || !dst) {
        native._free(src);
        native._free(dst);
        throw new Error("WASM allocation failed");
      }
      try {
        native.HEAPU8.set(input, src);
        const count = native._LZ4_decompress_safe(src, dst, input.length, size);
        if (count !== size) throw new Error("LZ4 decompression size mismatch");
        return hex(native.HEAPU8.slice(dst, dst + count));
      } finally {
        native._free(src);
        native._free(dst);
      }
    };
    const py = await loadPyodide({
      indexURL: new URL("./runtime/", import.meta.url).href,
      stdout: () => {},
      stderr: () => {},
    });
    const manifest = JSON.parse(new TextDecoder().decode(await read("fixtures/manifest.json")));
    const source = await read("patch_nso.py");
    if ((await digest(source)) !== manifest.sourceSha256)
      throw new Error("Original patch_nso.py digest mismatch");
    py.FS.writeFile("/patch_nso.py", source);
    await py.runPythonAsync(new TextDecoder().decode(await read("python-adapters.py")));
    return { py, manifest };
  })();
  return initialized;
}
export async function rewriteSynthetic({ bytes, caseName }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FIXTURE)
    throw new Error("Invalid bounded synthetic input");
  const { py, manifest } = await initialize();
  const fixture = manifest.cases.find((entry) => entry.name === caseName);
  if (!fixture || (await digest(bytes)) !== fixture.sha256)
    throw new Error(
      "Unsupported input: real builds remain fail-closed; only exact generated synthetic fixtures are enabled",
    );
  py.FS.writeFile("/input.nso", bytes);
  py.globals.set("fixture_ruleset", fixture.ruleset);
  await py.runPythonAsync(`
import os, sys, runpy, shutil
shutil.rmtree('/result', ignore_errors=True)
os.environ['DM_RULESET'] = fixture_ruleset
os.environ['DM_PRIVATE_GATES'] = '1'
sys.argv = ['/patch_nso.py', '/input.nso', '/result', 'main']
runpy.run_path('/patch_nso.py', run_name='__main__')
`);
  const files = {};
  for (const name of py.FS.readdir("/result").filter((name) => !name.startsWith(".")))
    files[name] = py.FS.readFile(`/result/${name}`);
  return { status: "synthetic-only", files };
}
let queue = Promise.resolve();
self.addEventListener("message", ({ data }) => {
  queue = queue.then(async () => {
    try {
      const result = await rewriteSynthetic(data);
      self.postMessage(
        { id: data.id, ok: true, ...result },
        Object.values(result.files).map((bytes) => bytes.buffer),
      );
    } catch (error) {
      self.postMessage({ id: data.id, ok: false, error: String(error) });
    }
  });
});
