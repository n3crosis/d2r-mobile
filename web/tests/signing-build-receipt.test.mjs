// Synthetic receipt checks are not browser signing or device installation proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateSigningBuildReceipt,
  validateSigningPatchHashes,
} from "../runtime-build/package.mjs";
const pins = JSON.parse(
  await readFile(new URL("../toolchain/zsign-wasm/pins.json", import.meta.url), "utf8"),
);
function fixture() {
  return {
    pins: structuredClone(pins),
    compiler: "emcc (Emscripten gcc/clang-like replacement) 4.0.20\n",
    report: {
      sourcePins: structuredClone(pins),
      browserExecutionVerified: false,
      deviceInstallVerified: false,
      files: Object.fromEntries(
        [
          "zsign.mjs",
          "zsign.wasm",
          "ZSIGN-LICENSE.txt",
          "PORT-LICENSE.txt",
          "OPENSSL-LICENSE.txt",
          "OPENSSL-NOTICE.txt",
          "pins.json",
          "patch-report.json",
          "compiler-version.txt",
        ].map((name) => [name, { bytes: 16, sha256: "a".repeat(64) }]),
      ),
    },
  };
}
test("signer receipt requires the exact native output closure and source pins", () => {
  const value = fixture();
  assert.equal(validateSigningBuildReceipt(value), value.report.files);
});
test("missing, changed, oversized or unproven signing outputs cannot be packaged", () => {
  for (const mutate of [
    (v) => delete v.report.files["zsign.wasm"],
    (v) => (v.report.files["unexpected.wasm"] = { bytes: 16, sha256: "a".repeat(64) }),
    (v) => (v.report.files["zsign.wasm"].bytes = 0),
    (v) => (v.report.files["zsign.wasm"].bytes = 64 * 1024 * 1024 + 1),
    (v) => (v.report.files["zsign.wasm"].sha256 = "fake"),
    (v) => (v.report.sourcePins.zsign.commit = "0".repeat(40)),
    (v) => (v.pins.port.commit = "0".repeat(40)),
    (v) => (v.compiler = v.compiler.replace("4.0.20", "4.0.21")),
    (v) => (v.report.browserExecutionVerified = true),
    (v) => (v.report.deviceInstallVerified = true),
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => validateSigningBuildReceipt(value), /Invalid signing build receipt/);
  }
});

test("signing local receipts bind all four production patches including profile compatibility", () => {
  const localHashes = Object.fromEntries(
    ["prepare-source.py", "stream-sha.inc", "bounded-map.inc", "profile-compatibility.inc"].map(
      (name, index) => [name, String(index).repeat(64)],
    ),
  );
  const report = { patches: { ...localHashes } };
  assert.doesNotThrow(() => validateSigningPatchHashes(report, localHashes));
  for (const name of Object.keys(localHashes)) {
    const missing = structuredClone(report);
    delete missing.patches[name];
    assert.throws(
      () => validateSigningPatchHashes(missing, localHashes),
      /local source receipt mismatch/,
    );
    const stale = structuredClone(report);
    stale.patches[name] = "f".repeat(64);
    assert.throws(
      () => validateSigningPatchHashes(stale, localHashes),
      /local source receipt mismatch/,
    );
  }
  const missingLocalHelper = { ...localHashes };
  delete missingLocalHelper["profile-compatibility.inc"];
  assert.throws(
    () => validateSigningPatchHashes(report, missingLocalHelper),
    /local source receipt mismatch/,
  );
  assert.throws(() => validateSigningPatchHashes({}, {}), /local source receipt mismatch/);
});
