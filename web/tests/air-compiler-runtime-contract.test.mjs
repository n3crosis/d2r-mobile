import assert from "node:assert/strict";
import test from "node:test";
import { airCompilerIdentity, AIR_COMPILER_SOURCE_LANGUAGE } from "../air-compiler-contract.mjs";
import {
  AIR_COMPILER_RUNTIME,
  airCompilerReceiptOutput,
  airCompilerReceiptSourceRecord,
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

test("fresh fork receipt preserves identity and only aliases the two existing output paths", async () => {
  const { createFreshAirReleaseFixture } =
    await import("./fixtures/air-release-generic/fixture.mjs");
  const { receipt } = createFreshAirReleaseFixture(),
    before = JSON.stringify(receipt);
  assert.equal(validateAirCompilerBuildReceipt(receipt), receipt);
  const component = airCompilerRuntimeComponent(receipt);
  assert.equal(component.id, AIR_COMPILER_RUNTIME.id);
  assert.equal(component.factorySha256, receipt.files["air_wasm.mjs"].sha256);
  assert.equal(component.wasmSha256, receipt.files["air_wasm.wasm"].sha256);
  assert.equal(
    airCompilerReceiptOutput(receipt, "d2r_air_wasm.wasm"),
    receipt.files["air_wasm.wasm"],
  );
  assert.throws(() => airCompilerReceiptOutput(receipt, "another.wasm"));
  assert.deepEqual(airCompilerReceiptSourceRecord(receipt), {
    path: "toolchain/metal-air-compiler/dist/source-lock.json",
    sha256: receipt.sourceLockSha256,
  });
  assert.equal(JSON.stringify(receipt), before);
  for (const change of [
    (r) => (r.apiVersion = 1),
    (r) => (r.buildTool.jobs = 0),
    (r) => (r.buildTool.versions.node = "v22.0.0"),
    (r) => (r.verification.smoke.cases = []),
    (r) => (r.verification.smoke.cases[1].status = 0),
    (r) => (r.files["air_wasm.wasm"].bytes = 128 * 1024 ** 2 + 1),
    (r) => (r.headerBundleVersion = 1),
    (r) => (r.sourceTreeClean = false),
    (r) => (r.sourceLockSha256 = "bad"),
    (r) => (r.sourceInputs = {}),
    (r) => (r.sourceInputs["../escape"] = "a".repeat(64)),
    (r) => (r.sourceManifestSha256 = "a".repeat(64)),
    (r) => (r.files["d2r_air_wasm.wasm"] = r.files["air_wasm.wasm"]),
    (r) => (r.buildTool.emscriptenVersion = "4.0.21"),
    (r) => (r.verification.headerSha256 = "0".repeat(64)),
    (r) => (r.verification.deviceExecutionVerified = true),
  ]) {
    const invalid = structuredClone(receipt);
    change(invalid);
    assert.throws(() => validateAirCompilerBuildReceipt(invalid));
  }
});
