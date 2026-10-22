// 同一 CI 作业交付完整对应源码；只准备公开源码，不执行 LLVM 编译或读取游戏输入。
// Deliver complete corresponding source in the same CI job; prepare public source only, never compile LLVM or read game inputs.
import process from "node:process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { airCompilerSourceIdentity, verifyAirCompilerAssets } from "./air-compiler-assets.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const prefix = "web/toolchain/metal-air-compiler/";
const downloads = join(root, "web/runtime-build/.build/air-compiler-source-download");
const archive = join(downloads, "upstream.tar.gz");
const args = process.argv.slice(2);
const index = args.indexOf("--output");
if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--"))
  throw new Error("Provide --output for the separate corresponding-source artifact");
const output = resolve(args[index + 1]);
try {
  await lstat(output);
  throw new Error("Source artifact output must not already exist");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const identity = await airCompilerSourceIdentity();
const compiler = await verifyAirCompilerAssets();
if (compiler.sourceFingerprintSha256 !== identity.sourceFingerprintSha256)
  throw new Error("Source artifact does not match the verified compiler");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function digestFile(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum)
    throw new Error("Invalid bounded source artifact file");
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > maximum) throw new Error("Source artifact input grew beyond its cap");
    digest.update(chunk);
  }
  if (bytes !== info.size) throw new Error("Source artifact input changed while reading");
  return { bytes, sha256: digest.digest("hex") };
}
function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    timeout: 15 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Source preparation failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
await mkdir(downloads, { recursive: true });
const directoryInfo = await lstat(downloads);
if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
  throw new Error("Source download cache must be a regular directory");
let exists = true;
try {
  await lstat(archive);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  exists = false;
}
if (!exists) {
  const temporary = await mkdtemp(join(downloads, ".download-"));
  const pending = join(temporary, "upstream.tar.gz");
  try {
    const response = await fetch(identity.manifest.archiveUrl, {
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!response.ok || !response.body) throw new Error("Pinned source download failed");
    const file = await open(pending, "wx");
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 256 * 1024 * 1024) throw new Error("Pinned source archive exceeded cap");
        await file.writeFile(chunk);
      }
    } finally {
      await file.close();
    }
    if ((await digestFile(pending, 256 * 1024 * 1024)).sha256 !== identity.manifest.archiveSha256)
      throw new Error("Pinned source archive digest mismatch");
    await rename(pending, archive);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
// 缓存中的归档仍须匹配仓库固定摘要；绝不信任归档自报的哈希或静默替换损坏缓存。
// Cached archives must match the repository pin, never a self-reported hash or silent replacement of corrupt cache data.
const archiveRecord = await digestFile(archive, 256 * 1024 * 1024);
if (archiveRecord.sha256 !== identity.manifest.archiveSha256)
  throw new Error("Cached upstream source archive digest mismatch");
const temporary = await mkdtemp(join(tmpdir(), "d2r-air-source-"));
const staging = join(temporary, "artifact");
try {
  // 只从固定公开归档重建并检查补丁树；绝不打包现有工作目录的未知文件或编译对象。
  // Reconstruct and check the patch tree from pinned public bytes; never package unknown files or objects from an existing work directory.
  run(process.execPath, [
    join(root, prefix, "toolchain.mjs"),
    "prepare",
    "--archive",
    archive,
    "--work",
    join(temporary, "source-check"),
  ]);
  await mkdir(staging);
  const records = [];
  async function copy(path, source = join(root, path), maximum = 16 * 1024 * 1024) {
    if (
      !/^[A-Za-z0-9_.+/-]+$/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Invalid source artifact path");
    const expected = await digestFile(source, maximum);
    const target = join(staging, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    const actual = await digestFile(target, maximum);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new Error("Source file changed while copying");
    records.push({ path, ...actual });
  }
  await copy("upstream.tar.gz", archive, 256 * 1024 * 1024);
  const paths = new Set([
    ...run("git", ["ls-files", "-z", "--", prefix]).split("\0").filter(Boolean),
    "LICENSE",
    ".github/workflows/verify.yml",
    "web/air-compiler-runtime-contract.mjs",
    "web/air-compiler-contract.mjs",
    "web/shader-diagnostics.mjs",
    "web/air-compiler-adapter.mjs",
    "web/compiled-shader-boundary.mjs",
    "web/runtime-build/air-compiler-assets.mjs",
    "web/runtime-build/build-air-compiler.mjs",
    "web/runtime-build/prepare-air-compiler-source.mjs",
    "web/runtime-build/README.md",
  ]);
  for (const path of [...paths].sort()) await copy(path);
  const copied = new Map(records.map((entry) => [entry.path, entry]));
  for (const [path, digest] of Object.entries(identity.sourceInputs))
    if (copied.get(prefix + path)?.sha256 !== digest)
      throw new Error("Corresponding source input differs from compiler receipt");
  if (copied.get(prefix + "manifest.json")?.sha256 !== identity.sourceManifestSha256)
    throw new Error("Corresponding source manifest changed");
  await copy("compiler-build-report.json", join(root, prefix, "dist/build-report.json"));
  if (
    JSON.stringify(JSON.parse(await readFile(join(staging, "compiler-build-report.json")))) !==
    JSON.stringify(compiler)
  )
    throw new Error("Compiler receipt changed during source packaging");
  const instructions = `Complete AIR compiler corresponding source / AIR 编译器完整对应源码

upstream.tar.gz contains the complete pinned public upstream source archive.
web/toolchain/metal-air-compiler contains every ordered patch, authored API/header,
build recipe and license. All source bytes are delivered here, not promised for
a future download. CI reconstructed the full patched tree and checked every
manifest-listed modified file without compiling LLVM in this preparation step.

upstream.tar.gz 包含完整的固定公开上游源码。工具包包含全部有序补丁、
API/头文件、构建脚本及许可证。源码已全部交付，不以未来下载承诺代替。
本步骤已重建并验证补丁树，不执行 LLVM 编译，不包含游戏输入或编译对象。

From this extracted directory / 从解压后的本目录执行:
node web/toolchain/metal-air-compiler/toolchain.mjs prepare --archive ./upstream.tar.gz --work ./source-work

Developer rebuild only, after activating official Emscripten 4.0.20:
仅开发者重建需要，先激活官方 Emscripten 4.0.20:
node web/toolchain/metal-air-compiler/toolchain.mjs build-host-tools --work ./source-work --jobs 2
node web/toolchain/metal-air-compiler/toolchain.mjs build-wasm --work ./source-work --jobs 2

Linux, Node.js 24, a C++20 compiler, CMake, Ninja, Git and tar are developer tools,
not browser-user compilation requirements. The exact SDK pin is in the included
.github/workflows/verify.yml. Preserve all upstream notices, particularly the
GPL-2-only compiler transforms; see THIRD_PARTY_NOTICES.md and licenses/ in the
compiler package. No Apple SDK, Xcode or remote compiler is used.

source-report.json binds every delivered file and the verified compiler source
identity. Its independent digest is printed in the producing CI step's log.
compiler-build-report.json matches the binary in the same run's web-preview.
Source availability does not establish browser, full-game or device validation.
源码交付不代表浏览器、完整游戏或设备验证已完成。
`;
  await writeFile(join(staging, "BUILD_FROM_SOURCE.txt"), instructions);
  records.push({
    path: "BUILD_FROM_SOURCE.txt",
    ...(await digestFile(join(staging, "BUILD_FROM_SOURCE.txt"), 16384)),
  });
  const current = await airCompilerSourceIdentity();
  if (current.sourceFingerprintSha256 !== identity.sourceFingerprintSha256)
    throw new Error("Compiler source changed while preparing corresponding source");
  const report = {
    version: 1,
    sourceRevision: run("git", ["rev-parse", "HEAD"]).trim(),
    sourceFingerprintSha256: identity.sourceFingerprintSha256,
    sourceLanguage: compiler.sourceLanguage,
    headerSha256: identity.headerSha256,
    upstream: { url: identity.manifest.archiveUrl, ...archiveRecord },
    reconstructedPatchedSourceVerified: true,
    llvmCompiledByThisStep: false,
    files: records.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const bytes = JSON.stringify(report, null, 2) + "\n";
  const reportSha256 = sha(bytes);
  await writeFile(join(staging, "source-report.json"), bytes);
  await mkdir(dirname(output), { recursive: true });
  // RUNNER_TEMP and the checkout can be different filesystems; only copied allowlisted files reach output.
  await mkdir(output);
  for (const path of [...records.map((entry) => entry.path), "source-report.json"]) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await copyFile(join(staging, path), join(output, path));
  }
  for (const entry of records) {
    const actual = await digestFile(join(output, entry.path), 256 * 1024 * 1024);
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256)
      throw new Error("Final corresponding-source artifact changed during copy");
  }
  if (sha(await readFile(join(output, "source-report.json"))) !== reportSha256)
    throw new Error("Final source report digest mismatch");
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `source_report_sha256=${reportSha256}\n`);
  console.log(
    JSON.stringify({
      directory: output,
      sourceReportSha256: reportSha256,
      files: records.length,
      sourceFingerprintSha256: identity.sourceFingerprintSha256,
      llvmCompiled: false,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
