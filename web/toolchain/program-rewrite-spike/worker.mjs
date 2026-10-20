/* Exact repository release inputs or generated synthetic fixtures only. No UI enablement. */
import createNative from "./capstone-lz4.mjs";
import { createProgramRewriter, installProgramNativeBindings } from "./rewrite-core.mjs";
import { loadPyodide } from "./runtime/pyodide.mjs";
import { PROGRAM_REWRITER_SOURCE } from "./program-release-catalog.mjs";
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
    installProgramNativeBindings(native);
    const py = await loadPyodide({
      indexURL: new URL("./runtime/", import.meta.url).href,
      stdout: () => {},
      stderr: () => {},
    });
    const manifest = JSON.parse(new TextDecoder().decode(await read("fixtures/manifest.json")));
    const source = await read("patch_nso.py");
    if (
      (await digest(source)) !== PROGRAM_REWRITER_SOURCE ||
      manifest.sourceSha256 !== PROGRAM_REWRITER_SOURCE
    )
      throw new Error("Original patch_nso.py digest mismatch");
    py.FS.writeFile("/patch_nso.py", source);
    await py.runPythonAsync(new TextDecoder().decode(await read("python-adapters.py")));
    return { py, manifest };
  })();
  return initialized;
}
export const rewriteProgram = createProgramRewriter(initialize);

let queue = Promise.resolve();
self.addEventListener("message", ({ data }) => {
  queue = queue.then(async () => {
    try {
      const result = await rewriteProgram(data);
      self.postMessage(
        { id: data.id, ok: true, ...result },
        Object.values(result.files).map((bytes) => bytes.buffer),
      );
    } catch (error) {
      self.postMessage({ id: data.id, ok: false, error: String(error) });
    }
  });
});
