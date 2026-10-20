// Build-only, exact-source-locked internal loader adaptation. Never patches global fetch.
import { readFile, writeFile, mkdir, cp, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import "../asset-transforms-js/scripts/verify-source.mjs";
import "../casc-overlay-js/scripts/verify-source.mjs";
const here = new URL("./", import.meta.url);
const source = new URL("../asset-generation-spike/public/", here);
const out = new URL("./pyodide-dist/", here);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pins = {
  "pyodide.mjs": "04c052c815abb0bf2981fa38c2dfa58e3120ee5288c956df2b2a15e301782c5f",
  "pyodide.asm.js": "6b4c90de5b7172873f04f21884d0e9d2274e305fe32116558fe3e4fbe3618d51",
};
const substitutions = {
  "pyodide.mjs": [
    ["fetch(o,t?{integrity:t}:{})", "globalThis.__readOfflinePyodide(o,t)"],
    [
      "else return await(await fetch(e)).json()",
      "else return await(await globalThis.__readOfflinePyodide(e)).json()",
    ],
  ],
  "pyodide.asm.js": [["fetch(r,e?{integrity:e}:{})", "globalThis.__readOfflinePyodide(r,e)"]],
};
await mkdir(out, { recursive: true });
const vendor = JSON.parse(await readFile(new URL("vendor/pyodide/vendor-manifest.json", source)));
if (vendor.version !== "0.27.7" || Object.keys(vendor.packages).sort().join(",") !== "pillow")
  throw new Error("Unexpected Pyodide dependency closure; review required");
const assets = [];
for (const name of Object.keys(vendor.sha256).sort()) {
  if (!/^[a-zA-Z0-9_.+-]+$/.test(name)) throw new Error("Unsafe runtime asset name");
  let bytes = await readFile(new URL(`vendor/pyodide/${name}`, source));
  if (hash(bytes) !== vendor.sha256[name]) throw new Error("Vendor digest mismatch");
  if (pins[name]) {
    if (hash(bytes) !== pins[name]) throw new Error("Pyodide loader source drift");
    let text = bytes.toString("utf8");
    for (const [before, after] of substitutions[name]) {
      if (text.split(before).length !== 2) throw new Error("Exact loader adapter match failed");
      text = text.replace(before, after);
    }
    bytes = new TextEncoder().encode(
      "// Modified for bounded offline reads; see loader-provenance.json.\n" + text,
    );
  }
  await add(name, bytes);
}
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
  const bytes = await readFile(new URL(`generated/${name}`, source));
  if (/\b(?:import\s+numpy|from\s+numpy\b)/.test(bytes.toString("utf8")))
    throw new Error(`Unmigrated NumPy dependency: ${name}`);
  await add(name, bytes);
}
await add("art-kernels.mjs", await readFile(new URL("../art-kernels/kernels.mjs", here)));
await add(
  "asset-transforms.mjs",
  await readFile(new URL("../asset-transforms-js/transforms.mjs", here)),
);
for (const [name, sourcePath] of [
  ["casc-overlay.mjs", "../casc-overlay-js/overlay.mjs"],
  ["spark-md5.mjs", "../../vendor/spark-md5-3.0.2/spark-md5.mjs"],
  ["png-codec.mjs", "../png-codec-exact/codec.mjs"],
  ["png-codec.wasm", "../png-codec-exact/dist/png-codec.wasm"],
])
  await add(name, await readFile(new URL(sourcePath, here)));
await add("worker.mjs", await readFile(new URL("pyodide-worker.mjs", here)));
async function add(path, bytes) {
  if (!bytes.length || bytes.length > 32 * 1024 * 1024)
    throw new Error("Runtime asset cap exceeded");
  await writeFile(new URL(path, out), bytes);
  assets.push({ path, bytes: bytes.length, sha256: hash(bytes) });
}
if (assets.reduce((sum, asset) => sum + asset.bytes, 0) > 96 * 1024 * 1024)
  throw new Error("Runtime total cap exceeded");
const manifest = JSON.stringify({ version: 1, assets });
await writeFile(new URL("manifest.json", out), manifest);
let bootstrap = await readFile(new URL("pyodide-bootstrap.mjs", here), "utf8");
for (const [token, replacement] of [
  ["__MANIFEST_SHA256__", hash(manifest)],
  ['["__EXPECTED_ASSETS__"]', JSON.stringify(assets.map((asset) => asset.path))],
]) {
  if (bootstrap.split(token).length !== 2) throw new Error("Bootstrap placeholder drift");
  bootstrap = bootstrap.replace(token, replacement);
}
await writeFile(new URL("bootstrap.mjs", out), bootstrap);
await writeFile(
  new URL("index.html", out),
  `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src blob:; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="icon" href="data:,"><title>Offline Pyodide isolation proof</title>
<script type="module" src="./bootstrap.mjs"></script><p>Synthetic developer proof only.</p>\n`,
);
await writeFile(
  new URL("loader-provenance.json", out),
  JSON.stringify(
    {
      version: "0.27.7",
      upstreamSha256: pins,
      substitutions,
      source: "https://github.com/pyodide/pyodide/tree/0.27.7/src/js",
      manifestSha256: hash(manifest),
    },
    null,
    2,
  ),
);
await mkdir(new URL("licenses/", out), { recursive: true });
await copyFile(
  new URL("../program-rewrite-spike/PYODIDE_LICENSE", here),
  new URL("licenses/PYODIDE_LICENSE", out),
);
await cp(
  new URL("generated/provenance.json", source),
  new URL("licenses/native-source-provenance.json", out),
);
await copyFile(
  new URL("../art-kernels/provenance.json", here),
  new URL("licenses/art-kernel-source-provenance.json", out),
);
await copyFile(
  new URL("../asset-transforms-js/source-provenance.json", here),
  new URL("licenses/asset-transform-source-provenance.json", out),
);
for (const [name, sourcePath] of [
  ["casc-overlay-source-provenance.json", "../casc-overlay-js/source-provenance.json"],
  ["spark-md5-LICENSE.txt", "../../vendor/spark-md5-3.0.2/LICENSE2"],
  ["spark-md5-PROVENANCE.md", "../../vendor/spark-md5-3.0.2/PROVENANCE.md"],
  ["png-codec-LICENSE-Pillow.txt", "../png-codec-exact/reference/LICENSE"],
  ["png-codec-LICENSE-zlib.txt", "../png-codec-exact/reference/LICENSE-zlib"],
  ["png-codec-LICENSE-zlib-legacy.txt", "../png-codec-exact/reference/LICENSE-zlib-legacy"],
  ["png-codec-zlib-source.json", "../png-codec-exact/zlib-source.json"],
  ["png-codec-zlib-legacy-source.json", "../png-codec-exact/zlib-legacy-source.json"],
  ["png-codec-build-report.json", "../png-codec-exact/dist/build-report.json"],
])
  await copyFile(new URL(sourcePath, here), new URL(`licenses/${name}`, out));
console.log(JSON.stringify({ assets, manifestSha256: hash(manifest) }));
