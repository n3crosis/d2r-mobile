// Synthetic receipt checks are not browser signing or device installation proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateSigningBuildReceipt } from "../runtime-build/package.mjs";
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
