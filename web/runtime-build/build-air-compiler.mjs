// Import one authenticated release and run the unchanged strict public compile canary.
// Never clone LLVM, apply patches, install a compiler SDK, or rebuild the compiler here.
import process from "node:process";
import { appendFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  readFreshAirReleasePin,
  readFreshAirReleaseMetadata,
  readFreshAirReleaseAsset,
} from "./air-release-loader.mjs";
import {
  prepareAirCompilerAssets,
  verifyAirCompilerCanary,
  importPinnedAirCompiler,
} from "./air-compiler-assets.mjs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--fingerprint"))
  throw new Error(
    "Usage: build-air-compiler.mjs [--fingerprint]; no local compiler build is supported",
  );
const pin = await readFreshAirReleasePin();
if (args[0] === "--fingerprint") {
  const metadata = await readFreshAirReleaseMetadata({ download: true });
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `release_manifest_sha256=${pin.manifestSha256}\nsource_fingerprint=${metadata.release.sourceFingerprintSha256}\n`,
    );
  console.log(
    JSON.stringify({
      repository: pin.repository,
      commit: pin.commit,
      version: pin.version,
      manifestSha256: pin.manifestSha256,
    }),
  );
} else {
  if (
    process.env.D2R_AIR_COMPILER_RELEASE_MANIFEST_SHA256 &&
    process.env.D2R_AIR_COMPILER_RELEASE_MANIFEST_SHA256 !== pin.manifestSha256
  )
    throw new Error("AIR release pin changed after CI cache-key selection");
  const metadata = await readFreshAirReleaseMetadata({ download: true });
  await readFreshAirReleaseAsset(metadata, "correspondingSource", { download: true });
  let cached = false;
  try {
    await lstat(fileURLToPath(new URL("../toolchain/metal-air-compiler/dist/", import.meta.url)));
    cached = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Corrupt/stale caches fail; never silently replace them or rebuild around failed checks.
  const report =
    cached || process.env.D2R_AIR_COMPILER_ASSET_DIR || process.env.D2R_AIR_COMPILER_RECEIPT_SHA256
      ? await prepareAirCompilerAssets()
      : await importPinnedAirCompiler();
  console.log(
    JSON.stringify({
      cached,
      release: pin,
      sourceFingerprintSha256: report.sourceFingerprintSha256,
      receiptSha256: metadata.release.buildReceiptSha256,
    }),
  );
  console.log(JSON.stringify({ compileCanary: await verifyAirCompilerCanary() }));
}
