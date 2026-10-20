/* Exact repository release inputs or generated synthetic fixtures only. No UI enablement. */
import createNative from "./capstone-lz4.mjs";
import { loadPyodide } from "./runtime/pyodide.mjs";
import {
  REGISTERED_PROGRAM_RELEASE,
  PROGRAM_REWRITER_SOURCE,
  PROGRAM_REWRITE_LIMITS,
} from "./program-release-catalog.mjs";
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
      if (!Number.isInteger(size) || size < 0 || size > PROGRAM_REWRITE_LIMITS.segmentDecodedBytes)
        throw new Error("LZ4 output exceeds decoded segment bound");
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
export async function rewriteProgram({ bytes, caseName, releaseId, moduleName = "main" }) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > PROGRAM_REWRITE_LIMITS.moduleInputBytes ||
    bytes.length < 256
  )
    throw new Error("Invalid bounded program input");
  const inputHash = await digest(bytes);
  let registered;
  if (releaseId !== undefined) {
    registered = REGISTERED_PROGRAM_RELEASE.modules.find((entry) => entry.name === moduleName);
    if (
      releaseId !== REGISTERED_PROGRAM_RELEASE.id ||
      caseName !== undefined ||
      !registered ||
      registered.inputSha256 !== inputHash
    )
      throw new Error("Unsupported registered program input");
    if (registered.buildId && hex(bytes.subarray(0x40, 0x50)) !== registered.buildId)
      throw new Error("Registered build ID mismatch");
  } else if (bytes.length > MAX_FIXTURE) throw new Error("Invalid bounded synthetic input");
  const { py, manifest } = await initialize();
  const fixture = manifest.cases.find(
    (entry) => entry.name === caseName && (entry.moduleName ?? "main") === moduleName,
  );
  if (!registered && (!fixture || inputHash !== fixture.sha256))
    throw new Error(
      "Unsupported input: only exact registered release hashes or generated synthetic fixtures are enabled",
    );
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x304f534e) throw new Error("Invalid NSO header");
  for (let i = 0; i < 3; i++) {
    const offset = header.getUint32(0x10 + 16 * i, true);
    const memory = header.getUint32(0x14 + 16 * i, true);
    const decoded = header.getUint32(0x18 + 16 * i, true);
    const stored = header.getUint32(0x60 + 4 * i, true);
    if (
      stored > bytes.length ||
      offset > bytes.length - stored ||
      decoded > PROGRAM_REWRITE_LIMITS.segmentDecodedBytes ||
      memory + decoded > PROGRAM_REWRITE_LIMITS.imageBytes
    )
      throw new Error("NSO segment budget or range exceeded");
  }
  if (
    header.getUint32(0x34, true) + header.getUint32(0x38, true) + header.getUint32(0x3c, true) >
    PROGRAM_REWRITE_LIMITS.imageBytes
  )
    throw new Error("NSO BSS budget exceeded");
  py.FS.writeFile("/input.nso", bytes);
  py.globals.set(
    "fixture_ruleset",
    registered ? REGISTERED_PROGRAM_RELEASE.ruleset : fixture.ruleset,
  );
  py.globals.set("program_module_name", moduleName);
  await py.runPythonAsync(`
import os, sys, runpy, shutil
shutil.rmtree('/result', ignore_errors=True)
os.environ['DM_RULESET'] = fixture_ruleset
os.environ['DM_PRIVATE_GATES'] = '1'
sys.argv = ['/patch_nso.py', '/input.nso', '/result', program_module_name]
runpy.run_path('/patch_nso.py', run_name='__main__')
None
`);
  const files = {};
  for (const name of py.FS.readdir("/result").filter((name) => !name.startsWith("."))) {
    if (py.FS.stat(`/result/${name}`).size > PROGRAM_REWRITE_LIMITS.totalOutputBytes)
      throw new Error("Rewriter output budget exceeded");
    files[name] = py.FS.readFile(`/result/${name}`);
  }
  const total = Object.values(files).reduce((sum, value) => sum + value.length, 0);
  if (total > PROGRAM_REWRITE_LIMITS.totalOutputBytes)
    throw new Error("Rewriter output budget exceeded");
  return {
    status: registered ? "repository-registered-unverified" : "synthetic-only",
    realGameVerified: false,
    files,
  };
}
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
