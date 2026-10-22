// 同一 CI 作业内的真实编译器缓存回退；只编译公开固定源，不运行游戏或参考验证集。
// Real-compiler cache fallback inside the existing CI job; compile pinned public sources without game inputs or reference suites.
import process from "node:process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, mkdir, lstat, rm, appendFile } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  airCompilerSourceIdentity,
  prepareAirCompilerAssets,
  recordAirCompilerBuild,
  importAirCompilerAssets,
  verifyAirCompilerCanary,
} from "./air-compiler-assets.mjs";

const compiler = fileURLToPath(new URL("../toolchain/metal-air-compiler/", import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${name}`);
  return args[index + 1];
}
const identity = await airCompilerSourceIdentity();
if (args.includes("--fingerprint")) {
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `source_fingerprint=${identity.sourceFingerprintSha256}\nupstream_archive_sha256=${identity.manifest.archiveSha256}\n`,
    );
  console.log(
    JSON.stringify({
      sourceFingerprintSha256: identity.sourceFingerprintSha256,
      emscripten: "4.0.20",
    }),
  );
} else {
  if (
    process.env.D2R_AIR_COMPILER_SOURCE_FINGERPRINT &&
    process.env.D2R_AIR_COMPILER_SOURCE_FINGERPRINT !== identity.sourceFingerprintSha256
  )
    throw new Error("AIR compiler sources changed after CI cache-key selection");
  let cached = false;
  try {
    await lstat(join(compiler, "dist"));
    cached = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (
    cached ||
    process.env.D2R_AIR_COMPILER_ASSET_DIR ||
    process.env.D2R_AIR_COMPILER_RECEIPT_SHA256
  ) {
    // 有缓存时必须验证成功；绝不以重建静默掩盖被篡改或过期的已恢复缓存。
    // Existing caches must verify; never silently rebuild over a tampered or stale restored cache.
    const report = await prepareAirCompilerAssets();
    console.log(
      JSON.stringify({ cached: true, sourceFingerprintSha256: report.sourceFingerprintSha256 }),
    );
  } else {
    const requestedJobs = Number(option("--jobs", "4"));
    if (!Number.isSafeInteger(requestedJobs) || requestedJobs < 1 || requestedJobs > 4)
      throw new Error("AIR CI compiler jobs must be 1..4");
    const jobs = Math.max(
      1,
      Math.min(requestedJobs, availableParallelism(), Math.floor(totalmem() / (2 * 1024 ** 3))),
    );
    const work = resolve(option("--work", join(compiler, "work")));
    const deadline = Date.now() + 150 * 60_000;
    async function runToolchain(command, extra = []) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("AIR compiler cold-build deadline exceeded");
      console.log(`AIR compiler build: ${command}, at most ${jobs} compile jobs and one link job`);
      await new Promise((resolveRun, reject) => {
        const grouped = process.platform !== "win32";
        const child = spawn(
          process.execPath,
          [
            join(compiler, "toolchain.mjs"),
            command,
            "--work",
            work,
            "--jobs",
            String(jobs),
            ...extra,
          ],
          {
            stdio: "inherit",
            detached: grouped,
          },
        );
        let expired = false,
          killTimer;
        const terminate = (signal) => {
          try {
            if (grouped && child.pid) process.kill(-child.pid, signal);
            else child.kill(signal);
          } catch (error) {
            if (error.code !== "ESRCH") reject(error);
          }
        };
        const timer = setTimeout(() => {
          expired = true;
          terminate("SIGTERM");
          killTimer = setTimeout(() => terminate("SIGKILL"), 10000);
        }, remaining);
        child.once("error", (error) => {
          clearTimeout(timer);
          clearTimeout(killTimer);
          reject(error);
        });
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          if (!expired) clearTimeout(killTimer);
          if (expired) reject(new Error("AIR compiler cold-build deadline exceeded"));
          else if (code !== 0)
            reject(new Error(`AIR compiler ${command} failed: ${code ?? signal}`));
          else resolveRun();
        });
      });
    }
    let prepared = false;
    try {
      await lstat(join(work, "prepared.json"));
      prepared = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!prepared) {
      await mkdir(dirname(work), { recursive: true });
      const archive = join(dirname(work), `air-source-${identity.manifest.archiveSha256}.tar.gz`);
      const response = await fetch(identity.manifest.archiveUrl, {
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!response.ok || !response.body)
        throw new Error("Pinned AIR source archive download failed");
      const output = await open(archive, "w");
      const digest = createHash("sha256");
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > 256 * 1024 * 1024)
            throw new Error("Pinned AIR source archive exceeded byte cap");
          digest.update(chunk);
          await output.writeFile(chunk);
        }
        if (!bytes || digest.digest("hex") !== identity.manifest.archiveSha256)
          throw new Error("Pinned AIR source archive digest mismatch");
      } catch (error) {
        await output.close();
        await rm(archive, { force: true });
        throw error;
      }
      await output.close();
      await runToolchain("prepare", ["--archive", archive]);
      await rm(archive, { force: true });
    }
    await runToolchain("build-host-tools");
    await runToolchain("build-wasm");
    const buildDirectory = join(work, "api-build-wasm");
    const { receiptSha256 } = await recordAirCompilerBuild({
      buildDirectory,
      sourceDirectory: join(work, "source"),
      apiDirectory: join(compiler, "api"),
    });
    const report = await importAirCompilerAssets({
      directory: buildDirectory,
      expectedDigest: receiptSha256,
    });
    // 只缓存小型最终公开输出；本机工具、LLVM 源码、对象目录不进入 CI 缓存或预览。
    // Cache only final public outputs, never native tools, LLVM sources, object trees, or private data.
    console.log(
      JSON.stringify({
        cached: false,
        receiptSha256,
        sourceFingerprintSha256: report.sourceFingerprintSha256,
        files: report.files,
      }),
    );
  }
  // 同一真实字节探针覆盖新构建和已验证缓存；源码身份或凭据不因探针升级被改写。
  // The same real-byte probe covers fresh builds and verified caches without relabeling their source identity or receipt.
  console.log(JSON.stringify({ compileCanary: await verifyAirCompilerCanary() }));
}
