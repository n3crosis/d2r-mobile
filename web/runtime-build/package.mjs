// 根据固定构建凭据、封装清单及资产策略，组装并校验浏览器运行时发布包。
// Assemble and validate browser runtime bundles based on pinned build receipts, sealed manifests, and asset policies.
import {
  ASSET_RUNTIME_DIRECTORY,
  assertNoPythonRuntimeAsset,
  validateAssetRuntimeInventory,
} from "../toolchain/asset-runtime-js/payload-policy.mjs";
import { createRuntimeTransport } from "./transport.mjs";
import { resolveShellProfile } from "../shell-profiles.mjs";
import { SHADER_CATALOG_SOURCES } from "../shader-catalog-adapter.mjs";
import { OPTIONAL_RUNTIME_ASSET_GROUPS } from "../runtime-asset-groups.mjs";
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
import { isDeepStrictEqual } from "node:util";

const web = resolve(fileURLToPath(new URL("../", import.meta.url)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
// 下载和打包共同使用独立固定的发布输入；配置注册表漂移必须在网络读取前失败。
// Download and packaging share independently pinned release inputs; registry drift fails before network reads.
export const SHELL_BUILD_INPUTS = Object.freeze(
  [
    {
      profileId: "v1.0.18-ios26",
      sourceUrl:
        "https://github.com/jhaizhou-ops/d2r-mobile/releases/download/v1.0.18/D2RMobile-shell-build-input.zip",
      bytes: 4884778,
      sha256: "a383552871851ddb5923033639358e2a3c205ae411676e6538cd098743bbe37b",
      archivePath: "profile/shell.zip",
      evidencePath: "toolchain/shell-release-evidence/v1.0.18.json",
      metadataPath: "profile/shell.json",
    },
    {
      profileId: "v1.0.18-ios18",
      sourceUrl:
        "https://github.com/jhaizhou-ops/d2r-mobile/releases/download/v1.0.18/D2RMobile-shell-ios18-build-input.zip",
      bytes: 4880624,
      sha256: "e52c119ffacf8aaafd9457f92b8e57384ab04c7ce289eecd84972743d14570e4",
      archivePath: "profile/shell-ios18.zip",
      evidencePath: "toolchain/shell-release-evidence/v1.0.18-ios18.json",
      metadataPath: "profile/shell-ios18.json",
    },
  ].map((input) => {
    const profile = resolveShellProfile(input.profileId);
    if (
      profile.archivePath !== input.archivePath ||
      profile.evidence.sourceUrl !== input.sourceUrl ||
      profile.evidence.archiveBytes !== input.bytes ||
      profile.evidence.sha256 !== input.sha256
    )
      throw new Error("Pinned public shell registry drift");
    return Object.freeze({
      ...input,
      buildPath: `runtime-build/.build/${input.archivePath.slice("profile/".length)}`,
    });
  }),
);
// 原始客户端和独立适配器保留相对导入；两处都携带同一份公开配置闭包。
// Raw clients and standalone adapters retain relative imports; both carry the same public registry closure.
const shellProfileSources = [
  "shell-profiles.mjs",
  "toolchain/shell-release-evidence/v1.0.18.json",
  "toolchain/shell-release-evidence/v1.0.18-derived-capacities.mjs",
  "toolchain/shell-release-evidence/v1.0.18-ios18.json",
  "toolchain/shell-release-evidence/v1.0.18-ios18-derived-capacities.json",
];
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
/**
 * 可选编解码器仍须提供固定源码、编译器和有界 SHA ABI 的构建凭据。
 * Optional codecs still require pinned source/compiler receipts and the bounded SHA ABI build contract.
 */
export function validateOptionalCodecReceipts({
  astcCommit,
  astcCompiler,
  shaReport,
  shaSourcePin,
}) {
  if (
    astcCommit.trim() !== "2ff200e08c98a61775351687ea2b5d38e455ad8b" ||
    !/^emcc .* 4\.0\.20(?:\s|$)/.test(astcCompiler.split("\n")[0]) ||
    shaSourcePin?.commit !== "1d64a83450e025622f3468c28fc4164dad2c5ef6" ||
    !isDeepStrictEqual(shaReport?.source, shaSourcePin) ||
    shaReport.schemaVersion !== 1 ||
    shaReport.emsdk !== "4.0.20" ||
    !/^emcc .*4\.0\.20\b/m.test(shaReport.compilerVersion ?? "") ||
    shaReport.memoryBytes !== 262144 ||
    shaReport.stackBytes !== 16384 ||
    shaReport.chunkBytes !== 65536 ||
    shaReport.hostImports !== 0 ||
    shaReport.memoryGrowth !== false ||
    !Number.isSafeInteger(shaReport.bytes) ||
    shaReport.bytes < 1 ||
    shaReport.bytes > maximumFile ||
    !/^[a-f0-9]{64}$/.test(shaReport.sha256)
  )
    throw new Error("Invalid optional codec build receipt");
  return { bytes: shaReport.bytes, sha256: shaReport.sha256 };
}
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
    seen = new Set(),
    contents = new Map();
  let total = 0;
  async function add(path, bytes, source, optionalGroup) {
    safe(path);
    assertNoPythonRuntimeAsset(path);
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
    const sha256 = hash(bytes);
    contents.set(`${sha256}:${bytes.length}`, { sha256, bytes: bytes.length, data: bytes });
    assets.push({
      path,
      bytes: bytes.length,
      sha256,
      source,
      ...(optionalGroup ? { optionalGroup } : {}),
    });
  }
  async function copy(path, expected, destination = path, optionalGroup) {
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
    await add(destination, bytes, path, optionalGroup);
  }
  async function licenseDirectory(path) {
    for (const item of await readdir(resolve(web, path), { withFileTypes: true })) {
      if (!item.isFile() || !/^[A-Za-z0-9_.+-]+$/.test(item.name))
        throw new Error("Unexpected license entry");
      await copy(`${path}/${item.name}`);
    }
  }
  async function sealed(directory, { bootstrap = true, validate } = {}) {
    const path = `${directory}/manifest.json`;
    const manifest = JSON.parse(await readFile(resolve(web, path), "utf8"));
    if (manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 1024)
      throw new Error("Unexpected sealed runtime manifest");
    validate?.(manifest);
    await copy(path);
    for (const entry of manifest.assets) {
      if (!Number.isSafeInteger(entry.bytes) || !/^[a-f0-9]{64}$/.test(entry.sha256))
        throw new Error("Invalid sealed runtime record");
      await copy(`${directory}/${safe(entry.path)}`, entry);
    }
    if (bootstrap) await copy(`${directory}/bootstrap.mjs`);
    await licenseDirectory(`${directory}/licenses`);
    return manifest.assets;
  }
  try {
    const offline = "toolchain/offline-runtime-spike";
    await sealed(`${offline}/dist`);
    await sealed(ASSET_RUNTIME_DIRECTORY, {
      bootstrap: false,
      validate: validateAssetRuntimeInventory,
    });
    await sealed(`${offline}/dotnet-dist`);
    // 保留生产 worker 入口原有的相对 URL 布局。
    // 不复制合成测试数据、验证 HTML、浏览器测试工具、原生二进制、构建缓存、密钥文件或用户选择的资源。
    // Include production worker entry points with their original relative URL
    // layout. Do not copy synthetic fixtures, proof HTML, browser harnesses,
    // native binaries, build caches, key files or user-selected resources.
    for (const path of [
      "sealed-runtime/clients.mjs",
      "astc-producer-client.mjs",
      "astc-job-directory.mjs",
      "archive-read-rpc.mjs",
      "archive-reader.mjs",
      "casc-logical-reader.mjs",
      "casc-overlay-writer.mjs",
      "checksum-verifier.mjs",
      "extraction-job-adapter.mjs",
      "extraction-worker-client.mjs",
      "romfs-tree.mjs",
      "toolchain/casc-overlay-js/overlay.mjs",
      "vendor/spark-md5-3.0.2/spark-md5.mjs",
      "runtime-asset-groups.mjs",
      "toolchain/asset-runtime-js/payload-policy.mjs",
      "toolchain/asset-runtime-js/contract.mjs",
      "sealed-runtime/texture-worker.mjs",
      "sealed-runtime/dotnet-worker.mjs",
      "native-art-texture.mjs",
      "nsp-input.mjs",
      "extraction-errors.mjs",
      "i18n.mjs",
      "i18n-catalog.mjs",
      "preflight.mjs",
      "content-selection.mjs",
      "d2r-expansion-policy.mjs",
      "toolchain/nsp-extract-spike/extraction-worker.mjs",
      "toolchain/nsp-extract-spike/extraction-engine.mjs",
      "toolchain/nsp-extract-spike/browser-boundary.mjs",
      "toolchain/nsp-extract-spike/dist/hactool-boundary.mjs",
      "toolchain/nsp-extract-spike/dist/hactool-boundary.wasm",
      "toolchain/nsp-extract-spike/dist/UPSTREAM_COMMIT",
      "toolchain/texture-spike/browser-texture.mjs",
      "toolchain/texture-spike/browser-texture-encoder.mjs",
      "toolchain/texture-spike/dist/texture.mjs",
      "toolchain/texture-spike/dist/texture.wasm",
      "toolchain/texture-spike/dist/bc3.wasm",
      "toolchain/texture-spike/dist/encoder-provenance.json",
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
    for (const path of shellProfileSources) {
      await copy(path);
      const sourceBytes = await readFile(resolve(web, path));
      await copy(`${program}/${path}`, {
        bytes: sourceBytes.length,
        sha256: hash(sourceBytes),
      });
    }
    for (const name of [
      "capstone-lz4.mjs",
      "capstone-lz4.wasm",
      "rewrite-core.mjs",
      "worker.mjs",
      "program-rewriter-adapter.mjs",
      "program-release-catalog.mjs",
      "guest-framework.mjs",
      "toolchain-lock.json",
    ])
      await copy(`${program}/${name}`);
    for (const name of [
      "binary.mjs",
      "arm64.mjs",
      "relocations.mjs",
      "rewrite.mjs",
      "rules.mjs",
      "rule-data.mjs",
      "outputs.mjs",
    ])
      await copy(`${program}/js/${name}`);
    const asset = "toolchain/asset-generation-spike/public";
    // 生产只使用闭合 JS/WASM 资产运行时；旧 Python worker/vendor/generated 仅供手动参考。
    // Production uses only the closed JS/WASM asset runtime; legacy Python worker/vendor/generated mirrors are reference-only.
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
    const astc = "toolchain/astc-encoder-wasm/dist",
      sha = "toolchain/sha256-stream-wasm",
      shaSourcePin = JSON.parse(await readFile(resolve(web, `${sha}/source-pin.json`), "utf8")),
      shaReport = JSON.parse(await readFile(resolve(web, `${sha}/dist/build-report.json`), "utf8")),
      shaWasm = validateOptionalCodecReceipts({
        astcCommit: await readFile(resolve(web, `${astc}/ARM-COMMIT.txt`), "utf8"),
        astcCompiler: await readFile(resolve(web, `${astc}/compiler-version.txt`), "utf8"),
        shaReport,
        shaSourcePin,
      });
    for (const name of [
      "bridge.c",
      "sha256_config.h",
      "adapter.mjs",
      "build.mjs",
      "source-pin.json",
    ])
      if (hash(await readFile(resolve(web, `${sha}/${name}`))) !== shaReport.localSha256?.[name])
        throw new Error("SHA-256 local source receipt mismatch");
    for (const path of OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"]) {
      const source = path.startsWith("sealed-workers/") ? `runtime-build/.build/${path}` : path;
      let expected;
      if (path === `${sha}/dist/sha256.wasm`) expected = shaWasm;
      else if ([`${sha}/dist/LICENSE`, `${sha}/dist/apache-2.0.txt`].includes(path))
        expected = shaSourcePin.files[`mbedtls/${path.split("/").at(-1)}`];
      await copy(source, expected, path, "legacy-astc");
    }
    // 大外壳文件各自生成独立传输载荷；客户端只选择需要的配置。
    // Large shell archives receive separate transport payloads; clients select only the needed profile.
    for (const input of SHELL_BUILD_INPUTS) {
      await copy(input.evidencePath, undefined, input.metadataPath);
      await copy(input.buildPath, input, input.archivePath);
    }
    const { transport, payloads } = createRuntimeTransport(contents, { assets });
    await mkdir(resolve(staging, "payloads"));
    for (const [path, bytes] of payloads) await writeFile(resolve(staging, path), bytes);
    const manifest = {
      transport,
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
          entry: "sealed-runtime/texture-worker.mjs",
          sealedProof: `${offline}/dist/manifest.json`,
          sealedJobAdapter: false,
        },
        textureEncoder: {
          sealedEntries: ["sealed-runtime/texture-worker.mjs"],
          entry: "sealed-runtime/texture-worker.mjs",
          sealedJobAdapter: false,
        },
        assets: {
          sealedEntry: `${ASSET_RUNTIME_DIRECTORY}/worker.mjs`,
          entry: `${ASSET_RUNTIME_DIRECTORY}/worker.mjs`,
          sealedProof: `${ASSET_RUNTIME_DIRECTORY}/manifest.json`,
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
        astcProducer: {
          sealedEntry: "sealed-workers/astc-producer-worker.mjs",
          entry: "sealed-workers/astc-producer-worker.mjs",
          optionalGroup: "legacy-astc",
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
    // 完成有界打包后，只替换固定的生成输出目录。
    // 缺失任何组件都不能视为部分成功。
    // Only the generated, fixed output directory is replaced, after complete
    // bounded packaging. A missing component never yields a partial success.
    await rm(out, { recursive: true, force: true });
    await rename(staging, out);
    console.log(
      JSON.stringify({
        directory: relative(web, out),
        files: assets.length,
        transportFiles: transport.files.length,
        transportBytes: transport.totalBytes,
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
