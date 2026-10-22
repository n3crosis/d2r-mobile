// 开发者增量桥：只复用来源未变且摘要固定的公开运行时，追加当前真实 AIR 闭包。
// Developer incremental bridge: reuse only digest-pinned public runtimes with unchanged source inputs, then append the current real AIR closure.
import process from "node:process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, lstat, readdir, rm, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { verifyRuntimeInventory } from "./inventory.mjs";
import { createRuntimeTransport } from "./transport.mjs";
import { verifyAirCompilerAssets } from "./air-compiler-assets.mjs";
import {
  AIR_COMPILER_RUNTIME,
  airCompilerRuntimeComponent,
} from "../air-compiler-runtime-contract.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const web = join(root, "web");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const record = (bytes) => ({ bytes: bytes.length, sha256: hash(bytes) });
// 这是为 AIR 集成定义的窄桥，不是允许任意旧原生二进制继续运行的通用缓存。
// This is a narrow AIR-integration bridge, not a general permission to retain stale native binaries.
const allowedIntegrationChanges = new Set([
  "web/air-compiler-adapter.mjs",
  "web/air-compiler-contract.mjs",
  "web/air-compiler-runtime-contract.mjs",
  "web/air-compiler-worker-client.mjs",
  "web/production-shaders.mjs",
  "web/sealed-runtime/air-compiler-worker.mjs",
  "web/sealed-runtime/clients.mjs",
  "web/runtime-sealing/build-workers.mjs",
  "web/runtime-build/air-compiler-assets.mjs",
  "web/runtime-build/reuse-runtime.mjs",
  "web/runtime-build/build.mjs",
  "web/runtime-build/package.mjs",
  "web/runtime-build/inventory.mjs",
  "web/runtime-build/payload-policy.mjs",
]);
function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Cannot verify runtime source bridge: ${result.error?.message ?? result.stderr}`,
    );
  return result.stdout;
}
async function verifySourceBridge(baseRevision) {
  if (!/^[a-f0-9]{40}$/.test(baseRevision ?? ""))
    throw new Error("Exact prior runtime source revision is required");
  if (git(["rev-parse", `${baseRevision}^{commit}`]).trim() !== baseRevision)
    throw new Error("Prior runtime source revision is unavailable");
  const names = new Set([
    ...git(["diff", "--name-only", "-z", baseRevision, "--"]).split("\0").filter(Boolean),
    ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean),
  ]);
  const changedSourceSha256 = {};
  for (const path of [...names].sort()) {
    if (/\.md$/i.test(path) || path.startsWith("web/tests/") || path.endsWith("/.gitignore"))
      continue;
    if (
      !allowedIntegrationChanges.has(path) &&
      !path.startsWith("web/toolchain/metal-air-compiler/")
    )
      throw new Error(`Cannot reuse prior runtime after an unrelated source change: ${path}`);
    const info = await lstat(join(root, path));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
      throw new Error(`Invalid source-bridge input: ${path}`);
    changedSourceSha256[path] = hash(await readFile(join(root, path)));
  }
  // 只允许已知 AIR 接入差异；完整旧构建脚本及旧工作线程生成逻辑必须保持相同。
  // Permit only the known AIR integration additions; preserve the entire old native-build and worker-bundling logic.
  const previousBuild = git(["show", `${baseRevision}:web/runtime-build/build.mjs`]);
  const currentBuild = await readFile(join(web, "runtime-build/build.mjs"), "utf8");
  const legacyBuild = currentBuild
    .replace('import { prepareAirCompilerAssets } from "./air-compiler-assets.mjs";\n', "")
    .replace(
      '        airCompiler: {\n          cache: "web/toolchain/metal-air-compiler/dist/",\n          inputDirectoryEnvironment: "D2R_AIR_COMPILER_ASSET_DIR",\n          receiptDigestEnvironment: "D2R_AIR_COMPILER_RECEIPT_SHA256",\n          rebuildsLlvm: false,\n          required: true,\n        },\n',
      "",
    )
    .replace(
      "  // 编译器只构建一次；前端构建验证并复用源固定缓存，不隐式重建 LLVM。\n  // Build the compiler once; frontend builds verify/reuse the source-bound cache, never implicitly rebuild LLVM.\n  await prepareAirCompilerAssets();\n",
      "",
    );
  if (legacyBuild !== previousBuild)
    throw new Error("Cannot reuse runtime after native build configuration changed");
  const previousWorkers = git(["show", `${baseRevision}:web/runtime-sealing/build-workers.mjs`]);
  const legacyWorkers = (await readFile(join(web, "runtime-sealing/build-workers.mjs"), "utf8"))
    .replace('  "air-compiler-worker",\n', "")
    .replace(
      '  const source = ["astc-producer-worker", "air-compiler-worker"].includes(name)\n    ? `../sealed-runtime/${name}.mjs`\n    : `${name}.mjs`;',
      '  const source = name === "astc-producer-worker" ? `../sealed-runtime/${name}.mjs` : `${name}.mjs`;',
    );
  if (legacyWorkers !== previousWorkers)
    throw new Error("Cannot reuse runtime after existing worker build logic changed");
  return {
    version: 1,
    sourceRevision: baseRevision,
    currentRevision: git(["rev-parse", "HEAD"]).trim(),
    sourceDirty: Boolean(git(["status", "--porcelain", "--untracked-files=normal"]).trim()),
    changedSourceSha256,
  };
}
async function boundedBytes(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 64 * 1024 * 1024)
    throw new Error("Invalid runtime bridge input file");
  return readFile(path);
}

export async function reuseRuntimeWithAir({ directory, manifestSha256, sourceRevision }) {
  if (!directory) throw new Error("A prior runtime directory is required");
  const base = pathToFileURL(resolve(directory) + "/");
  const verified = await verifyRuntimeInventory(base, manifestSha256, sourceRevision);
  if (verified.manifest.components?.airCompiler)
    throw new Error(
      "This bridge only upgrades a pre-AIR runtime; use the normal build for later compiler changes",
    );
  if (verified.manifest.build?.sourceDirty !== false)
    throw new Error("A clean, exact-source prior runtime is required");
  const sourceBridge = await verifySourceBridge(sourceRevision);
  const report = await verifyAirCompilerAssets();
  const assets = verified.manifest.assets.map((asset) => ({ ...asset }));
  const contents = new Map();
  const key = (asset) => `${asset.sha256}:${asset.bytes}`;
  if (verified.manifest.transport) {
    const payloads = new Map();
    for (const file of verified.manifest.transport.files) {
      const encoded = await readFile(new URL(file.path, base));
      payloads.set(
        file.path,
        file.encoding === "gzip"
          ? gunzipSync(encoded, { maxOutputLength: file.decodedBytes })
          : encoded,
      );
    }
    for (const entry of verified.manifest.transport.entries) {
      const bytes = payloads.get(entry.file).subarray(entry.offset, entry.offset + entry.bytes);
      if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
        throw new Error("Prior logical runtime content changed after verification");
      contents.set(key(entry), { ...record(bytes), data: bytes });
    }
  } else {
    for (const asset of assets) {
      const bytes = await readFile(new URL(asset.path, base));
      if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
        throw new Error("Prior runtime asset changed after verification");
      contents.set(key(asset), { ...record(bytes), data: bytes });
    }
  }
  async function add(path, source = path, expected) {
    if (assets.some((asset) => asset.path.toLowerCase() === path.toLowerCase()))
      throw new Error("AIR runtime bridge asset collision");
    const bytes = await boundedBytes(join(web, source));
    const identity = record(bytes);
    if (expected && (identity.sha256 !== expected.sha256 || identity.bytes !== expected.bytes))
      throw new Error("AIR runtime bridge source changed after authentication");
    assets.push({ path, ...identity, source });
    contents.set(key(identity), { ...identity, data: bytes });
  }
  for (const path of [AIR_COMPILER_RUNTIME.factory, AIR_COMPILER_RUNTIME.wasm])
    await add(path, path, report.files[path.split("/").at(-1)]);
  await add(AIR_COMPILER_RUNTIME.receipt);
  const receipt = JSON.parse(
    contents.get(key(assets.find((asset) => asset.path === AIR_COMPILER_RUNTIME.receipt))).data,
  );
  if (JSON.stringify(receipt) !== JSON.stringify(report))
    throw new Error("AIR build receipt changed during reuse");
  const sourceManifest = "toolchain/metal-air-compiler/manifest.json";
  await add(sourceManifest, sourceManifest, {
    bytes: (await boundedBytes(join(web, sourceManifest))).length,
    sha256: report.sourceManifestSha256,
  });
  await add("toolchain/metal-air-compiler/THIRD_PARTY_NOTICES.md");
  for (const name of await readdir(join(web, "toolchain/metal-air-compiler/licenses"))) {
    if (!/^[A-Za-z0-9_.+-]+$/.test(name)) throw new Error("Invalid AIR license path");
    await add(`toolchain/metal-air-compiler/licenses/${name}`);
  }
  // 仅构建新增工作线程；旧已密封字节继续受先前清单认证，不依赖本地缺失的原生胶水。
  // Build only the new worker; existing sealed bytes retain their prior authentication and need no missing local native glue.
  if (typeof globalThis.Bun?.build !== "function")
    throw new Error("Run the AIR reuse bridge with Bun 1.4.3");
  if (globalThis.Bun.version !== "1.4.3") throw new Error("AIR reuse requires pinned Bun 1.4.3");
  const worker = await globalThis.Bun.build({
    entrypoints: [join(web, "sealed-runtime/air-compiler-worker.mjs")],
    target: "browser",
    format: "esm",
    minify: true,
    splitting: false,
    sourcemap: "none",
    env: "disable",
    define: { process: "undefined" },
    external: ["node:*", "module", "fs", "path", "url", "crypto"],
  });
  if (!worker.success || worker.outputs.length !== 1)
    throw new AggregateError(worker.logs, "AIR worker bundle failed");
  const code = await worker.outputs[0].text();
  if (new globalThis.Bun.Transpiler({ loader: "js" }).scanImports(code).length)
    throw new Error("AIR worker has unclosed imports");
  const workerPath = `runtime-build/.build/${AIR_COMPILER_RUNTIME.entry}`;
  await mkdir(join(web, "runtime-build/.build/sealed-workers"), { recursive: true });
  await writeFile(join(web, workerPath), code);
  await add(AIR_COMPILER_RUNTIME.entry, workerPath);
  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  if (totalBytes > 512 * 1024 * 1024 || assets.length > 4096)
    throw new Error("AIR augmented runtime budget exceeded");
  const { transport, payloads } = createRuntimeTransport(contents, { assets });
  const manifest = {
    ...verified.manifest,
    assets: assets.sort((a, b) => a.path.localeCompare(b.path)),
    totalBytes,
    transport,
    build: {
      ...verified.manifest.build,
      sourceRevision: sourceBridge.currentRevision,
      sourceDirty: sourceBridge.sourceDirty,
      reusedRuntime: { sourceRevision, manifestSha256, sourceBridge },
    },
    components: {
      ...verified.manifest.components,
      airCompiler: airCompilerRuntimeComponent(report),
    },
  };
  const json = JSON.stringify(manifest, null, 2) + "\n";
  const digest = hash(json);
  const staging = await mkdtemp(join(web, "runtime-build/.build/reuse-"));
  try {
    await mkdir(join(staging, "payloads"));
    for (const [path, bytes] of payloads) await writeFile(join(staging, path), bytes);
    await writeFile(join(staging, "runtime-manifest.json"), json);
    await writeFile(
      join(staging, "runtime-integrity.mjs"),
      `export const runtimeManifestSha256 = ${JSON.stringify(digest)};\nexport const productionEnabled = false;\n`,
    );
    await verifyRuntimeInventory(
      pathToFileURL(staging + "/"),
      digest,
      sourceBridge.currentRevision,
    );
    // 复用过程结束时再次确认源代码快照，避免把并行修改混进同一构建身份。
    // Recheck the source snapshot before replacing output, keeping concurrent edits out of one build identity.
    if (JSON.stringify(await verifySourceBridge(sourceRevision)) !== JSON.stringify(sourceBridge))
      throw new Error("Runtime source bridge changed during assembly");
    await rm(join(web, "runtime-build/out"), { recursive: true, force: true });
    await rename(staging, join(web, "runtime-build/out"));
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    directory: "web/runtime-build/out/",
    manifestSha256: digest,
    sourceRevision: sourceBridge.currentRevision,
    assets: assets.length,
    totalBytes,
    transportBytes: transport.totalBytes,
    reusedFrom: { sourceRevision, manifestSha256 },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  function option(name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  }
  console.log(
    JSON.stringify(
      await reuseRuntimeWithAir({
        directory: option("--runtime"),
        manifestSha256: option("--sha256"),
        sourceRevision: option("--source-revision"),
      }),
    ),
  );
}
