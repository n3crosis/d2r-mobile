// 开发者构建缓存，不是浏览器依赖；只导入明确固定凭据的真实编译输出。
// Developer build cache, never a browser dependency; import real compiler output with an explicit receipt digest.
import process from "node:process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, lstat, mkdir, mkdtemp, rm, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  AIR_COMPILER_RUNTIME,
  AIR_COMPILER_OUTPUT_NAMES,
  airCompilerOutputMaximumBytes,
  validateAirCompilerBuildReceipt,
} from "../air-compiler-runtime-contract.mjs";

const compiler = fileURLToPath(new URL("../toolchain/metal-air-compiler/", import.meta.url));
const cache = join(compiler, "dist");
// 固定信任锚位于导入目录之外，不能把缓存中自报的摘要当作认证。
// Keep the import trust anchor outside the imported directory; a cache's self-reported digest is not authentication.
const cacheAnchor = fileURLToPath(new URL(".build/air-compiler-receipt.sha256", import.meta.url));
const maximumFile = 64 * 1024 * 1024;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fileRecord = (bytes) => ({ bytes: bytes.length, sha256: hash(bytes) });
async function boundedRead(path, maximum = maximumFile) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum)
    throw new Error(
      `Invalid bounded AIR compiler input: ${path} (${info.size} bytes; cap ${maximum})`,
    );
  const value = await readFile(path);
  if (value.length !== info.size) throw new Error("AIR compiler input changed while reading");
  return value;
}
export async function airCompilerSourceIdentity() {
  const manifestBytes = await boundedRead(join(compiler, "manifest.json"), 1024 * 1024);
  const manifest = JSON.parse(manifestBytes);
  if (!/^[a-f0-9]{40}$/.test(manifest.commit ?? "") || !Array.isArray(manifest.patches))
    throw new Error("Invalid pinned AIR compiler source manifest");
  const inputs = { "toolchain.mjs": hash(await boundedRead(join(compiler, "toolchain.mjs"))) };
  for (const patch of manifest.patches) {
    if (!/^patches\/[A-Za-z0-9_.+-]+\.patch$/.test(patch.path))
      throw new Error("Invalid AIR compiler patch path");
    const digest = hash(await boundedRead(join(compiler, patch.path), 4 * 1024 * 1024));
    if (digest !== patch.sha256) throw new Error("AIR compiler patch source mismatch");
    inputs[patch.path] = digest;
  }
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      if (!/^[A-Za-z0-9_.+-]+$/.test(name)) throw new Error("Invalid AIR API source name");
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error("AIR API source symlink rejected");
      if (info.isDirectory()) await visit(path);
      else inputs[relative(compiler, path).replaceAll("\\", "/")] = hash(await boundedRead(path));
      if (Object.keys(inputs).length > 128) throw new Error("AIR API source file count exceeded");
    }
  }
  await visit(join(compiler, "api"));
  const cmake = await readFile(join(compiler, "api/CMakeLists.txt"), "utf8");
  const match = /set\(AIR_HEADER_PATHS\s+([^)]*)\)/.exec(cmake);
  const headers = match?.[1].trim().split(/\s+/).sort();
  if (
    !headers?.length ||
    new Set(headers).size !== headers.length ||
    headers.some((path) => !inputs[`api/include/${path}`])
  )
    throw new Error("AIR header bundle source list unavailable");
  const headerSha256 = hash(
    "d2r-air-header-bundle-v2\n" +
      headers.map((path) => `${path}:${inputs[`api/include/${path}`]}\n`).join(""),
  );
  const sourceInputs = Object.fromEntries(
    Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const sourceManifestSha256 = hash(manifestBytes);
  return {
    manifest,
    sourceCommit: manifest.commit,
    sourceManifestSha256,
    sourceInputs,
    sourceFingerprintSha256: hash(JSON.stringify({ sourceManifestSha256, sourceInputs })),
    headerSha256,
  };
}
async function validateCurrentSources(report) {
  validateAirCompilerBuildReceipt(report);
  const identity = await airCompilerSourceIdentity();
  for (const key of [
    "sourceCommit",
    "sourceManifestSha256",
    "sourceInputs",
    "sourceFingerprintSha256",
    "headerSha256",
  ])
    if (!isDeepStrictEqual(report[key], identity[key]))
      throw new Error(`AIR compiler cache is stale for current source: ${key}`);
  return identity;
}
export async function verifyAirCompilerAssets(directory = cache, expectedDigest) {
  if (expectedDigest === undefined) {
    if (resolve(directory) !== resolve(cache))
      throw new Error("External AIR compiler assets require a trusted receipt SHA-256");
    expectedDigest = (await boundedRead(cacheAnchor, 128)).toString("utf8").trim();
  }
  if (!/^[a-f0-9]{64}$/.test(expectedDigest))
    throw new Error("Invalid trusted AIR compiler receipt SHA-256");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("AIR compiler cache must be a regular directory");
  if (
    resolve(directory) === resolve(cache) &&
    !isDeepStrictEqual(
      (await readdir(directory)).sort(),
      [...AIR_COMPILER_OUTPUT_NAMES, "build-report.json"].sort(),
    )
  )
    throw new Error("AIR compiler cache contains unlisted files");
  const receipt = await boundedRead(join(directory, "build-report.json"), 1024 * 1024);
  if (hash(receipt) !== expectedDigest)
    throw new Error("AIR compiler build receipt digest mismatch");
  const report = JSON.parse(receipt);
  await validateCurrentSources(report);
  for (const name of AIR_COMPILER_OUTPUT_NAMES) {
    const bytes = await boundedRead(join(directory, name), airCompilerOutputMaximumBytes(name));
    if (!isDeepStrictEqual(fileRecord(bytes), report.files[name]))
      throw new Error(`AIR compiler output receipt mismatch: ${name}`);
  }
  return report;
}

export async function importAirCompilerAssets({ directory, expectedDigest }) {
  if (!directory || !/^[a-f0-9]{64}$/.test(expectedDigest ?? ""))
    throw new Error("AIR compiler import requires an input directory and trusted receipt SHA-256");
  await verifyAirCompilerAssets(directory, expectedDigest);
  await mkdir(compiler, { recursive: true });
  const staging = await mkdtemp(join(compiler, ".dist-"));
  try {
    for (const name of [...AIR_COMPILER_OUTPUT_NAMES, "build-report.json"])
      await writeFile(
        join(staging, name),
        await boundedRead(
          join(directory, name),
          name === "build-report.json" ? 1024 * 1024 : airCompilerOutputMaximumBytes(name),
        ),
      );
    const report = await verifyAirCompilerAssets(staging, expectedDigest);
    await rm(cache, { recursive: true, force: true });
    await rename(staging, cache);
    await mkdir(fileURLToPath(new URL(".build/", import.meta.url)), { recursive: true });
    await writeFile(cacheAnchor, expectedDigest + "\n");
    return report;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function prepareAirCompilerAssets({
  directory = process.env.D2R_AIR_COMPILER_ASSET_DIR,
  expectedDigest = process.env.D2R_AIR_COMPILER_RECEIPT_SHA256,
} = {}) {
  if (directory !== undefined || expectedDigest !== undefined)
    return importAirCompilerAssets({ directory, expectedDigest });
  try {
    return await verifyAirCompilerAssets();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      "AIR compiler assets are missing. Build the pinned toolchain once, record its receipt, then import it with web/runtime-build/air-compiler-assets.mjs. A source-only runtime cannot produce compiled shaders.",
      { cause: error },
    );
  }
}

// 生成凭据前检查源代码与实际 WASM 导出的 ABI/头文件身份；不编译游戏或启动设备。
// Before recording, check source provenance and the actual WASM ABI/header identity; no game compilation or device execution.
export async function recordAirCompilerBuild({ buildDirectory, sourceDirectory, apiDirectory }) {
  if (!buildDirectory || !sourceDirectory || !apiDirectory)
    throw new Error("record requires --build, --source and --api-source directories");
  const identity = await airCompilerSourceIdentity();
  for (const [name, expected] of Object.entries(identity.manifest.patchedFiles ?? {})) {
    if (!/^[A-Za-z0-9_.+/-]+$/.test(name) || name.split("/").includes(".."))
      throw new Error("Invalid compiler source provenance path");
    if (hash(await boundedRead(join(sourceDirectory, name))) !== expected)
      throw new Error(`AIR compiler prepared source mismatch: ${name}`);
  }
  for (const [name, expected] of Object.entries(identity.sourceInputs))
    if (
      name.startsWith("api/") &&
      hash(await boundedRead(join(apiDirectory, name.slice(4)))) !== expected
    )
      throw new Error(`AIR compiler built API source mismatch: ${name}`);
  const version = spawnSync("emcc", ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0 || !/^emcc .* 4\.0\.20(?:\s|$)/.test(version.stdout))
    throw new Error("Activate the pinned Emscripten 4.0.20 SDK before recording AIR assets");
  const files = {};
  for (const name of AIR_COMPILER_OUTPUT_NAMES)
    files[name] = fileRecord(
      await boundedRead(join(buildDirectory, name), airCompilerOutputMaximumBytes(name)),
    );
  await probeAirCompiler(buildDirectory, identity.headerSha256);
  const { manifest: _manifest, ...source } = identity;
  const report = {
    version: AIR_COMPILER_RUNTIME.version,
    id: AIR_COMPILER_RUNTIME.id,
    apiVersion: 2,
    headerBundleVersion: 2,
    sourceLanguage: AIR_COMPILER_RUNTIME.sourceLanguage,
    emscripten: "4.0.20",
    ...source,
    files,
    browserExecutionVerified: false,
    fullGameCompilationVerified: false,
    deviceExecutionVerified: false,
  };
  validateAirCompilerBuildReceipt(report);
  const bytes = JSON.stringify(report, null, 2) + "\n";
  await writeFile(join(buildDirectory, "build-report.json"), bytes);
  return { report, receiptSha256: hash(bytes) };
}

async function probeAirCompiler(buildDirectory, expectedHeaderSha256, compileCanary = false) {
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import {readFile} from 'node:fs/promises';
       import {pathToFileURL} from 'node:url';
       import {resolve} from 'node:path';
       globalThis.self=globalThis;
       globalThis.location={href:'https://invalid.test/air-receipt-worker.mjs'};
       globalThis.fetch=globalThis.importScripts=()=>{throw Error('AIR receipt probe network forbidden')};
       const root=process.argv[1];
       const compiled=await WebAssembly.compile(await readFile(resolve(root,'d2r_air_wasm.wasm')));
       const factory=(await import(pathToFileURL(resolve(root,'d2r_air_wasm.mjs')).href)).default;
       const module=await factory({print(){},printErr(){},locateFile(){throw Error('Unexpected runtime URL')},instantiateWasm(imports,receive){const instance=new WebAssembly.Instance(compiled,imports);receive(instance,compiled);return instance.exports;}});
       for(const name of ['malloc','free','air_compile_v2','air_result_status','air_result_data','air_result_size','air_result_free','air_result_diagnostics','air_result_diagnostics_size','air_compiler_header_sha256','air_compiler_header_bundle_version']) if(typeof module['_'+name]!=='function') throw Error('Missing AIR export '+name);
       const pointer=module._air_compiler_header_sha256();
       if(!Number.isSafeInteger(pointer)||pointer<=0||pointer+65>module.HEAPU8.length||module.HEAPU8[pointer+64]!==0) throw Error('Invalid AIR header identity');
       const headerSha256=new TextDecoder().decode(module.HEAPU8.subarray(pointer,pointer+64));
       const headerBundleVersion=module._air_compiler_header_bundle_version();
       if(headerSha256!==process.argv[2]||headerBundleVersion!==2) throw Error('Built AIR compiler header identity mismatch');
       const result={headerSha256,headerBundleVersion};
       if(process.argv[3]==='1') result.canary=await (await import(process.argv[4])).runAirCompilerCanary(module,{expectedHeaderSha256:headerSha256});
       console.log(JSON.stringify(result));`,
      resolve(buildDirectory),
      expectedHeaderSha256,
      compileCanary ? "1" : "0",
      new URL("../toolchain/metal-air-compiler/ci-compile-canary.mjs", import.meta.url).href,
    ],
    { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 },
  );
  if (probe.error || probe.status !== 0)
    throw new Error(`AIR compiler identity probe failed: ${probe.error?.message ?? probe.stderr}`);
  const runtime = JSON.parse(probe.stdout.trim());
  if (runtime.headerSha256 !== expectedHeaderSha256 || runtime.headerBundleVersion !== 2)
    throw new Error("Built AIR compiler does not match the authored header bundle");
  return runtime;
}

// 每次 CI 都检查已认证的实际输出，包括缓存命中；不改写信任凭据、不重编 LLVM。
// Probe authenticated actual output on every CI run, including cache hits; never rewrite receipts or rebuild LLVM for this check.
export async function verifyAirCompilerCanary() {
  const report = await verifyAirCompilerAssets();
  const runtime = await probeAirCompiler(cache, report.headerSha256, true);
  if (!isDeepStrictEqual(await verifyAirCompilerAssets(), report))
    throw new Error("AIR compiler cache changed during compile canary");
  return {
    ...runtime.canary,
    sourceFingerprintSha256: report.sourceFingerprintSha256,
    headerSha256: report.headerSha256,
    factorySha256: report.files["d2r_air_wasm.mjs"].sha256,
    wasmSha256: report.files["d2r_air_wasm.wasm"].sha256,
    browserExecutionVerified: false,
    fullGameCompilationVerified: false,
    deviceExecutionVerified: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  function option(name) {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${name}`);
    return args[index + 1];
  }
  if (command === "record") {
    const result = await recordAirCompilerBuild({
      buildDirectory: option("--build"),
      sourceDirectory: option("--source"),
      apiDirectory: option("--api-source"),
    });
    console.log(JSON.stringify({ receiptSha256: result.receiptSha256, ...result.report.files }));
  } else if (command === "import") {
    const report = await importAirCompilerAssets({
      directory: option("--input"),
      expectedDigest: option("--sha256"),
    });
    console.log(
      JSON.stringify({ directory: cache, sourceFingerprintSha256: report.sourceFingerprintSha256 }),
    );
  } else if (command === "verify") {
    const report = await prepareAirCompilerAssets();
    const expectedSource = option("--source-fingerprint");
    if (
      expectedSource !== undefined &&
      (!/^[a-f0-9]{64}$/.test(expectedSource) || report.sourceFingerprintSha256 !== expectedSource)
    )
      throw new Error("AIR compiler source differs from the selected CI cache key");
    console.log(
      JSON.stringify({ verified: true, sourceFingerprintSha256: report.sourceFingerprintSha256 }),
    );
  } else {
    throw new Error(
      "Usage: air-compiler-assets.mjs record --build DIR --source DIR --api-source DIR | import --input DIR --sha256 DIGEST | verify [--source-fingerprint DIGEST]",
    );
  }
}
