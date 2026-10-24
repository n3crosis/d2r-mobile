// 仅供测试的源码读取器。显式离线审查认证的是所审阅的源码字节，不是公开发布、编译器构建或设备结果。生产代码没有源码目录覆盖选项，也不导入此文件。
// Test-only source reader. Explicit offline review authenticates reviewed
// source bytes, not a published release, compiler build, or device result.
// Production code has no source-directory override and never imports this file.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceLockSha256 = "39ac9a625495f67de57e10a3976a67f56edc543bd8c3e23bd5aab3df698eab1d";
const manifestSha256 = "0a05419fa2e7bbf0b9d401e502c96064170db8cc3b18fb67bdfb6b21a508acc7";
const fingerprint = "62fe9f99030712ebcf9f9fdb9cb78c2b92a192a6afda2625250a179cb026a3aa";

export const sourceReviewOptions = {
  skip:
    process.env.D2R_AIR_SOURCE_REVIEW_DIR === undefined
      ? "Set D2R_AIR_SOURCE_REVIEW_DIR to opt into offline compiler source review"
      : false,
};

export async function readReviewedSourceLock() {
  const bytes = await readFile(new URL("reviewed-source-lock.json", import.meta.url));
  assert.equal(hash(bytes), sourceLockSha256, "independently reviewed source lock identity");
  const lock = JSON.parse(bytes);
  assert.equal(lock.schemaVersion, 1);
  assert.equal(Object.keys(lock.compilerFiles).length, 31);
  assert.equal(Object.keys(lock.sdkFiles).length, 19);
  return lock;
}

export async function readOriginalAirProvenance() {
  const manifestBytes = await readFile(
    new URL("../air-release-history/source-manifest.json", import.meta.url),
  );
  assert.equal(hash(manifestBytes), manifestSha256, "original source manifest identity");
  const manifest = JSON.parse(manifestBytes);
  const receiptBytes = await readFile(
    new URL("../air-release-history/original-build-report.json", import.meta.url),
  );
  assert.equal(
    hash(receiptBytes),
    "fc25c5f62aa374c6d9c6afab857ffd809231e21dea5495cdfa8c8e49c3b9972a",
    "original build receipt identity",
  );
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.sourceCommit, "4b173e3db383ec7164afb11ee7dc86609c88f052");
  assert.equal(receipt.sourceManifestSha256, manifestSha256);
  assert.equal(receipt.sourceFingerprintSha256, fingerprint);
  assert.equal(
    hash(
      JSON.stringify({ sourceManifestSha256: manifestSha256, sourceInputs: receipt.sourceInputs }),
    ),
    fingerprint,
    "historical receipt source inputs are immutable, not fresh-build provenance",
  );
  return { manifest, receipt };
}

export async function readForkSource(
  path,
  { reviewDirectory = process.env.D2R_AIR_SOURCE_REVIEW_DIR } = {},
) {
  assert.equal(typeof path, "string");
  assert.match(path, /^[A-Za-z0-9_.+/-]+$/);
  assert(
    !path.split("/").some((part) => !part || part === "." || part === ".."),
    "unsafe fork path",
  );
  const lock = await readReviewedSourceLock();
  const expected =
    path === "wasm/source-lock.json"
      ? sourceLockSha256
      : (lock.compilerFiles[path] ??
        (path.startsWith("wasm/") ? lock.sdkFiles[path.slice(5)] : undefined));
  assert.match(expected ?? "", /^[a-f0-9]{64}$/, `No reviewed source identity for ${path}`);
  assert.equal(
    typeof reviewDirectory,
    "string",
    "source review requires D2R_AIR_SOURCE_REVIEW_DIR",
  );
  assert(reviewDirectory.length > 0, "empty source review directory");
  const root = await realpath(reviewDirectory);
  const target = join(root, path);
  assert.equal(await realpath(target), target, "source review path must not traverse symlinks");
  const info = await lstat(target);
  assert(info.isFile() && !info.isSymbolicLink(), "source review blob must be a regular file");
  assert(info.size > 0 && info.size <= 16 * 1024 ** 2, "source review blob size");
  const bytes = await readFile(target);
  assert.equal(bytes.length, info.size, "source review blob changed while reading");
  assert.equal(hash(bytes), expected, `Reviewed fork source mismatch: ${path}`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
