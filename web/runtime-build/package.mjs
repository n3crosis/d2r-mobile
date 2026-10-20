import { SHADER_CATALOG_SOURCES } from "../shader-catalog-adapter.mjs";
import {
  readFile,
  writeFile,
  mkdir,
  lstat,
  readdir,
  rename,
  rm,
  mkdtemp,
  realpath,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, relative, sep } from "node:path";

const web = resolve(fileURLToPath(new URL("../", import.meta.url)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const maximumFile = 64 * 1024 * 1024;
const maximumTotal = 512 * 1024 * 1024;
const safe = (name) => {
  if (
    typeof name !== "string" ||
    name.length > 512 ||
    !/^[A-Za-z0-9_.+/-]+$/.test(name) ||
    name.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("Unsafe runtime path");
  return name;
};
export async function assembleRuntime({ build } = {}) {
  if (
    build?.emscripten !== "4.0.20" ||
    build?.dotnet !== "10.0.402" ||
    build?.crossCommit !== "f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7" ||
    !/^[a-f0-9]{40}$/.test(build?.sourceRevision || "")
  )
    throw new Error("Missing exact build receipt");
  const parent = resolve(web, "runtime-build/.build");
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(resolve(parent, "bundle-"));
  const assets = [],
    seen = new Set();
  let total = 0;
  async function add(path, bytes, source) {
    safe(path);
    const key = path.toLowerCase();
    if (
      seen.has(key) ||
      !bytes.length ||
      bytes.length > maximumFile ||
      (total += bytes.length) > maximumTotal ||
      assets.length >= 4096
    )
      throw new Error("Runtime inventory limit or duplicate");
    seen.add(key);
    const destination = resolve(staging, path);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, bytes);
    assets.push({ path, bytes: bytes.length, sha256: hash(bytes), source });
  }
  async function copy(path, expected, destination = path) {
    safe(path);
    const file = resolve(web, path);
    const info = await lstat(file);
    const canonical = await realpath(file);
    if (
      !file.startsWith(web + sep) ||
      !canonical.startsWith(web + sep) ||
      !info.isFile() ||
      info.isSymbolicLink() ||
      !info.size ||
      info.size > maximumFile
    )
      throw new Error("Runtime input is not a bounded regular file");
    const bytes = await readFile(file);
    if (expected && (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256))
      throw new Error(`Runtime manifest mismatch: ${path}`);
    await add(destination, bytes, path);
  }
  async function licenseDirectory(path) {
    for (const item of await readdir(resolve(web, path), { withFileTypes: true })) {
      if (!item.isFile() || !/^[A-Za-z0-9_.+-]+$/.test(item.name))
        throw new Error("Unexpected license entry");
      await copy(`${path}/${item.name}`);
    }
  }
  async function sealed(directory) {
    const path = `${directory}/manifest.json`;
    const manifest = JSON.parse(await readFile(resolve(web, path), "utf8"));
    if (manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 1024)
      throw new Error("Unexpected sealed runtime manifest");
    await copy(path);
    for (const entry of manifest.assets) {
      if (!Number.isSafeInteger(entry.bytes) || !/^[a-f0-9]{64}$/.test(entry.sha256))
        throw new Error("Invalid sealed runtime record");
      await copy(`${directory}/${safe(entry.path)}`, entry);
    }
    await copy(`${directory}/bootstrap.mjs`);
    await licenseDirectory(`${directory}/licenses`);
    return manifest.assets;
  }
  try {
    const offline = "toolchain/offline-runtime-spike";
    await sealed(`${offline}/dist`);
    const python = await sealed(`${offline}/pyodide-dist`);
    await copy(`${offline}/pyodide-dist/loader-provenance.json`);
    await sealed(`${offline}/dotnet-dist`);
    // Include production worker entry points with their original relative URL
    // layout. Do not copy synthetic fixtures, proof HTML, browser harnesses,
    // native binaries, build caches, key files or user-selected resources.
    for (const path of [
      "sealed-runtime/clients.mjs",
      "sealed-runtime/texture-worker.mjs",
      "sealed-runtime/dotnet-worker.mjs",
      "native-art-texture.mjs",
      "nsp-input.mjs",
      "preflight.mjs",
      "content-selection.mjs",
      "d2r-expansion-policy.mjs",
      "toolchain/nsp-extract-spike/extraction-worker.mjs",
      "toolchain/nsp-extract-spike/extraction-engine.mjs",
      "toolchain/nsp-extract-spike/browser-boundary.mjs",
      "toolchain/nsp-extract-spike/dist/hactool-boundary.mjs",
      "toolchain/nsp-extract-spike/dist/hactool-boundary.wasm",
      "toolchain/nsp-extract-spike/dist/UPSTREAM_COMMIT",
      "toolchain/texture-spike/texture-worker.mjs",
      "toolchain/texture-spike/browser-texture.mjs",
      "toolchain/texture-spike/texture-encode-worker.mjs",
      "toolchain/texture-spike/browser-texture-encoder.mjs",
      "toolchain/texture-spike/bounded_encoder.py",
      "toolchain/texture-spike/dist/texture.mjs",
      "toolchain/texture-spike/dist/texture.wasm",
      "toolchain/texture-spike/dist/original_bc3.py",
      "toolchain/texture-spike/dist/encoder-provenance.json",
      "toolchain/asset-generation-spike/public/worker.mjs",
      "toolchain/spirv-cross-spike/wwwroot/worker.mjs",
      "toolchain/spirv-cross-spike/wwwroot/convert.mjs",
      "toolchain/spirv-cross-spike/wwwroot/spirv-contract.mjs",
      "toolchain/spirv-cross-spike/wwwroot/replay-reflection.mjs",
      "toolchain/spirv-cross-spike/wwwroot/spirv-cross.mjs",
      "toolchain/spirv-cross-spike/wwwroot/spirv-cross.wasm",
      "toolchain/spirv-cross-spike/wwwroot/SPIRV-Cross-LICENSE.txt",
    ])
      await copy(path);
    try {
      await copy("toolchain/spirv-cross-spike/wwwroot/SPIRV-Cross-NOTICE.txt");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      (
        await readFile(resolve(web, "toolchain/nsp-extract-spike/dist/UPSTREAM_COMMIT"), "utf8")
      ).trim() !== "1d64a83450e025622f3468c28fc4164dad2c5ef6"
    )
      throw new Error("Extraction source pin mismatch");
    for (const prefix of [
      "toolchain/nsp-extract-spike/dist",
      "toolchain/texture-spike/dist",
      "toolchain/program-rewrite-spike/dist",
    ])
      await licenseDirectory(`${prefix}/licenses`);
    const program = "toolchain/program-rewrite-spike/dist";
    for (const name of [
      "capstone-lz4.mjs",
      "capstone-lz4.wasm",
      "patch_nso.py",
      "rewrite-core.mjs",
      "python-adapters.py",
      "worker.mjs",
      "program-rewriter-adapter.mjs",
      "program-release-catalog.mjs",
      "guest-framework.mjs",
      "toolchain-lock.json",
    ])
      await copy(`${program}/${name}`);
    for (const name of [
      "pyodide.mjs",
      "pyodide.asm.js",
      "pyodide.asm.wasm",
      "python_stdlib.zip",
      "pyodide-lock.json",
    ])
      await copy(`${program}/runtime/${name}`);
    const asset = "toolchain/asset-generation-spike/public";
    const vendor = JSON.parse(
      await readFile(resolve(web, `${asset}/vendor/pyodide/vendor-manifest.json`), "utf8"),
    );
    if (vendor.version !== "0.27.7") throw new Error("Asset runtime version drift");
    await copy(`${asset}/vendor/pyodide/vendor-manifest.json`);
    for (const [name, sha256] of Object.entries(vendor.sha256)) {
      const path = `${asset}/vendor/pyodide/${safe(name)}`;
      const bytes = await readFile(resolve(web, path));
      await copy(path, { bytes: bytes.length, sha256 });
    }
    for (const record of python.filter((entry) => entry.path.endsWith(".py")))
      await copy(`${asset}/generated/${record.path}`, record);
    for (const [name, pin] of [
      ["shader_map.tsv", SHADER_CATALOG_SOURCES.map],
      ["bf_want.tsv", "8e91845e3b2e8793a97b7a0e7c33c58ad92761e7d2ed7ffe60f8fb0e196649cf"],
      ["shader_facts.tsv", SHADER_CATALOG_SOURCES.facts],
      ["shader_map.tsv.conflicts.tsv", SHADER_CATALOG_SOURCES.conflicts],
    ]) {
      const source = `dm/gfx/nvn/${name}`;
      const file = resolve(web, "..", source);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
        throw new Error("Invalid public shader metadata");
      const bytes = await readFile(file);
      if (hash(bytes) !== pin) throw new Error("Public shader metadata source drift");
      await add(`catalog/${name}`, bytes, `repository/${source}`);
    }
    const profilePins = {};
    for (const name of ["native-art-provenance.json", "hud-provenance.json"]) {
      Object.assign(
        profilePins,
        JSON.parse(await readFile(resolve(web, `${asset}/../${name}`), "utf8")),
      );
    }
    for (const source of [
      "dm/ios/tools/native_art/implementation.c.inc",
      "dm/ios/Sources/TouchArt/native_art_manifest.json",
      "dm/ios/docs/native_art_v1_geometry.json",
      "dm/ios/docs/touch_layout_spec_native_binding_v5.json",
      "dm/ios/tools/touchrectv1_patch.json",
      "dm/i18n/ui_text.tsv",
    ]) {
      const file = resolve(web, "..", source);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
        throw new Error("Invalid public profile input");
      const bytes = await readFile(file);
      if (hash(bytes) !== profilePins[source])
        throw new Error(`Public profile source drift: ${source}`);
      await add(`profile/${source.split("/").at(-1)}`, bytes, `repository/${source}`);
    }
    for (const name of ["nsp-worker.mjs", "cross-worker.mjs", "program-worker.mjs"]) {
      await copy(
        `runtime-build/.build/sealed-workers/${name}`,
        undefined,
        `sealed-workers/${name}`,
      );
    }
    await copy("toolchain/shell-release-evidence/v1.0.18.json", undefined, "profile/shell.json");
    await copy(
      "runtime-build/.build/shell.zip",
      {
        bytes: 4884778,
        sha256: "a383552871851ddb5923033639358e2a3c205ae411676e6538cd098743bbe37b",
      },
      "profile/shell.zip",
    );
    const manifest = {
      version: 1,
      build,
      totalBytes: total,
      assets: assets.sort((a, b) => a.path.localeCompare(b.path)),
      components: {
        extraction: {
          sealedEntry: "sealed-workers/nsp-worker.mjs",
          entry: "toolchain/nsp-extract-spike/extraction-worker.mjs",
          sealedJobAdapter: false,
        },
        texture: {
          sealedEntry: "sealed-runtime/texture-worker.mjs",
          entry: "toolchain/texture-spike/texture-worker.mjs",
          sealedProof: `${offline}/dist/manifest.json`,
          sealedJobAdapter: false,
        },
        textureEncoder: {
          sealedEntries: [
            `${offline}/pyodide-dist/worker.mjs`,
            "sealed-runtime/texture-worker.mjs",
          ],
          entry: "toolchain/texture-spike/texture-encode-worker.mjs",
          sealedJobAdapter: false,
        },
        assets: {
          sealedEntry: `${offline}/pyodide-dist/worker.mjs`,
          entry: `${asset}/worker.mjs`,
          sealedProof: `${offline}/pyodide-dist/manifest.json`,
          sealedJobAdapter: false,
        },
        program: {
          sealedEntry: "sealed-workers/program-worker.mjs",
          entry: `${program}/worker.mjs`,
          sealedJobAdapter: false,
        },
        translator: {
          sealedEntry: "sealed-runtime/dotnet-worker.mjs",
          entry: `${offline}/dotnet-dist/worker.mjs`,
          sealedProof: `${offline}/dotnet-dist/manifest.json`,
          sealedJobAdapter: false,
        },
        spirvCross: {
          sealedEntry: "sealed-workers/cross-worker.mjs",
          entry: "toolchain/spirv-cross-spike/wwwroot/worker.mjs",
          sealedJobAdapter: false,
        },
      },
      productionEnabled: false,
      remainingGates: [
        "unified sealed worker clients",
        "complete production recipe and shader stages",
        "shell compatibility",
        "full-title output verification",
      ],
    };
    const json = JSON.stringify(manifest, null, 2) + "\n";
    await writeFile(resolve(staging, "runtime-manifest.json"), json);
    await writeFile(
      resolve(staging, "runtime-integrity.mjs"),
      `export const runtimeManifestSha256 = ${JSON.stringify(hash(json))};\nexport const productionEnabled = false;\n`,
    );
    const out = resolve(web, "runtime-build/out");
    // Only the generated, fixed output directory is replaced, after complete
    // bounded packaging. A missing component never yields a partial success.
    await rm(out, { recursive: true, force: true });
    await rename(staging, out);
    console.log(
      JSON.stringify({
        directory: relative(web, out),
        files: assets.length,
        totalBytes: total,
        manifestSha256: hash(json),
        productionEnabled: false,
      }),
    );
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
