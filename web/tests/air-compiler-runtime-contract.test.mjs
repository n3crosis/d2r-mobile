import assert from "node:assert/strict";
import test from "node:test";
import { airCompilerIdentity, AIR_COMPILER_SOURCE_LANGUAGE } from "../air-compiler-contract.mjs";
import {
  AIR_COMPILER_RUNTIME,
  airCompilerRuntimeComponent,
  assertAirCompilerReceiptMatchesComponent,
  validateAirCompilerBuildReceipt,
  validateAirCompilerRuntimeComponent,
} from "../air-compiler-runtime-contract.mjs";

// Authored metadata fixtures only: no compiler execution or shader output evidence.
const digest = "a".repeat(64);
function receipt() {
  return {
    version: 2,
    id: AIR_COMPILER_RUNTIME.id,
    apiVersion: 2,
    headerBundleVersion: 2,
    sourceLanguage: "floor-metal-3.2",
    emscripten: "4.0.20",
    headerSha256: digest,
    sourceFingerprintSha256: digest,
    sourceManifestSha256: digest,
    sourceCommit: "a".repeat(40),
    sourceInputs: { "toolchain.mjs": digest },
    files: {
      "d2r_air_wasm.mjs": { bytes: 1, sha256: digest },
      "d2r_air_wasm.wasm": { bytes: 1, sha256: digest },
    },
  };
}
test("worker identity and authenticated receipt require the same migrated language", () => {
  assert.equal(AIR_COMPILER_SOURCE_LANGUAGE, "floor-metal-3.2");
  assert.equal(
    airCompilerIdentity({ factorySha256: digest, wasmSha256: digest, headerSha256: digest })
      .sourceLanguage,
    "floor-metal-3.2",
  );
  validateAirCompilerBuildReceipt(receipt());
  assert.throws(() => validateAirCompilerBuildReceipt({ ...receipt(), version: 1 }));
  for (const sourceLanguage of [undefined, "floor-metal-3.0", "apple-msl-3.2"])
    assert.throws(() => validateAirCompilerBuildReceipt({ ...receipt(), sourceLanguage }));
});
test("old API-v2 AIR metadata cannot be relabeled by a new loader", () => {
  const report = receipt();
  const component = airCompilerRuntimeComponent(report);
  const manifest = {
    components: { airCompiler: component },
    assets: ["entry", "factory", "wasm", "receipt"].map((name) => ({
      path: component[name],
      bytes: 1,
      sha256: digest,
    })),
  };
  assert.equal(validateAirCompilerRuntimeComponent(manifest), component);
  assertAirCompilerReceiptMatchesComponent(report, component);
  for (const sourceLanguage of [undefined, "floor-metal-3.0"])
    assert.throws(() =>
      validateAirCompilerRuntimeComponent({
        ...manifest,
        components: { airCompiler: { ...component, sourceLanguage } },
      }),
    );
});
test("pre-AIR inventory parsing remains compatible without inventing compilation", () => {
  assert.equal(validateAirCompilerRuntimeComponent({ assets: [] }), undefined);
  assert.throws(() => validateAirCompilerRuntimeComponent({ assets: [] }, { required: true }));
});
