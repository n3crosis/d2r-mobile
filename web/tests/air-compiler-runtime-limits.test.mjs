// 纯元数据边界测试：不分配大型载荷、不构建或执行编译器。
// Metadata-only boundary checks: no large payload allocation, compiler build or execution.
import test from "node:test";
import assert from "node:assert/strict";
import {
  AIR_COMPILER_RUNTIME,
  airCompilerOutputMaximumBytes,
  runtimeAssetMaximumBytes,
  runtimeTransportMaximumBytes,
  validateAirCompilerBuildReceipt,
} from "../air-compiler-runtime-contract.mjs";
import { validateRuntimeTransport } from "../runtime-build/transport.mjs";
import {
  validateRuntimeInventory,
  validateRuntimeProfileSelection,
} from "../sealed-runtime/clients.mjs";
import { resolveShellProfile } from "../shell-profiles.mjs";

const MiB = 1024 * 1024;
const digest = "a".repeat(64);
function fixture(wasmBytes = 80 * MiB) {
  const component = {
    ...AIR_COMPILER_RUNTIME,
    sealedEntry: AIR_COMPILER_RUNTIME.entry,
    sealedJobAdapter: true,
    headerSha256: digest,
    sourceFingerprintSha256: digest,
    factorySha256: "2".repeat(64),
    wasmSha256: "3".repeat(64),
  };
  const profile = resolveShellProfile();
  const assets = ["entry", "factory", "wasm", "receipt"].map((name, index) => ({
    path: component[name],
    bytes: name === "wasm" ? wasmBytes : 1,
    sha256: String(index + 1).repeat(64),
  }));
  assets.push({
    path: profile.archivePath,
    bytes: profile.evidence.archiveBytes,
    sha256: profile.evidence.sha256,
  });
  const files = assets.map((asset) => ({
    path: `payloads/${asset.sha256}.bin`,
    bytes: asset.bytes,
    sha256: asset.sha256,
    encoding: "identity",
    decodedBytes: asset.bytes,
  }));
  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  return {
    version: 1,
    assets,
    totalBytes,
    components: { airCompiler: component },
    transport: {
      version: 1,
      totalBytes,
      files,
      entries: assets.map((asset, index) => ({
        bytes: asset.bytes,
        sha256: asset.sha256,
        file: files[index].path,
        offset: 0,
      })),
    },
  };
}

test("only the exact compiler WASM path gets the 128 MiB asset allowance", () => {
  assert.equal(runtimeAssetMaximumBytes(AIR_COMPILER_RUNTIME.wasm), 128 * MiB);
  for (const path of [
    "other.wasm",
    AIR_COMPILER_RUNTIME.factory,
    AIR_COMPILER_RUNTIME.wasm + ".bak",
  ])
    assert.equal(runtimeAssetMaximumBytes(path), 64 * MiB);
  assert.equal(airCompilerOutputMaximumBytes("d2r_air_wasm.mjs"), MiB);
  assert.equal(airCompilerOutputMaximumBytes("d2r_air_wasm.wasm"), 128 * MiB);
  assert.throws(() => airCompilerOutputMaximumBytes("other.wasm"));
});

test("Node and browser transport accept a sole large compiler payload, not oversized ordinary assets", () => {
  const manifest = fixture();
  validateRuntimeTransport(manifest);
  validateRuntimeInventory(manifest);
  validateRuntimeProfileSelection(manifest);
  const ordinary = structuredClone(manifest);
  ordinary.assets[2].path = "other.wasm";
  assert.throws(() => validateRuntimeTransport(ordinary));
  assert.throws(() => validateRuntimeInventory(ordinary));
  assert.throws(() => validateRuntimeProfileSelection(ordinary));
});

test("large compiler payload allowance never applies to mixed, offset or mismatched slices", () => {
  for (const mutate of [
    (manifest) => {
      manifest.transport.entries[2].offset = 1;
    },
    (manifest) => {
      manifest.transport.entries[2].sha256 = digest;
    },
    (manifest) => {
      manifest.transport.files[2].decodedBytes++;
    },
    (manifest) => {
      manifest.transport.entries.push({ ...manifest.transport.entries[2] });
    },
    (manifest) => {
      manifest.transport.entries[1].file = manifest.transport.files[2].path;
    },
  ]) {
    const manifest = fixture();
    mutate(manifest);
    assert.equal(runtimeTransportMaximumBytes(manifest.transport.files[2], manifest), 64 * MiB);
    assert.throws(() => validateRuntimeTransport(manifest));
    assert.throws(() => validateRuntimeProfileSelection(manifest));
  }
});

test("the compiler-specific asset and decoded limits still stop at 128 MiB", () => {
  const manifest = fixture(128 * MiB + 1);
  assert.throws(() => validateRuntimeInventory(manifest));
  assert.throws(() => validateRuntimeTransport(manifest));
  assert.throws(() => validateRuntimeProfileSelection(manifest));
});

test("receipts separately bound the small factory and compiler module", () => {
  const report = {
    version: 2,
    id: AIR_COMPILER_RUNTIME.id,
    apiVersion: 2,
    headerBundleVersion: 2,
    sourceLanguage: AIR_COMPILER_RUNTIME.sourceLanguage,
    emscripten: "4.0.20",
    headerSha256: digest,
    sourceFingerprintSha256: digest,
    sourceManifestSha256: digest,
    sourceCommit: "a".repeat(40),
    sourceInputs: { "toolchain.mjs": digest },
    files: {
      "d2r_air_wasm.mjs": { bytes: MiB, sha256: digest },
      "d2r_air_wasm.wasm": { bytes: 128 * MiB, sha256: digest },
    },
  };
  validateAirCompilerBuildReceipt(report);
  for (const name of Object.keys(report.files)) {
    const changed = structuredClone(report);
    changed.files[name].bytes++;
    assert.throws(() => validateAirCompilerBuildReceipt(changed));
  }
});
