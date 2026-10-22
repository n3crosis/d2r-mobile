import test from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { validateDiagnosticSource } from "./prepare-air-compiler-diagnostic.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const compiler = {
    sourceFingerprintSha256: "a".repeat(64),
    headerSha256: "b".repeat(64),
    sourceLanguage: "floor-metal-3.2",
  };
  const receipt = Buffer.from(JSON.stringify(compiler));
  const source = {
    version: 1,
    sourceRevision: "c".repeat(40),
    sourceFingerprintSha256: compiler.sourceFingerprintSha256,
    headerSha256: compiler.headerSha256,
    sourceLanguage: compiler.sourceLanguage,
    reconstructedPatchedSourceVerified: true,
    llvmCompiledByThisStep: false,
    files: [{ path: "compiler-build-report.json", bytes: receipt.length, sha256: sha(receipt) }],
  };
  const sourceBytes = Buffer.from(JSON.stringify(source));
  return {
    compiler,
    receipt,
    source,
    sourceBytes,
    expected: {
      sourceReportSha256: sha(sourceBytes),
      sourceFingerprintSha256: compiler.sourceFingerprintSha256,
      sourceRevision: source.sourceRevision,
    },
  };
}

test("diagnostic metadata binds complete source and exact receipt without execution", () => {
  const value = fixture();
  assert.deepEqual(
    validateDiagnosticSource(value.compiler, value.receipt, value.sourceBytes, value.expected),
    value.source,
  );
});

for (const field of ["sourceReportSha256", "sourceFingerprintSha256", "sourceRevision"]) {
  test(`rejects independent ${field} drift`, () => {
    const value = fixture();
    value.expected[field] = "0".repeat(field === "sourceRevision" ? 40 : 64);
    assert.throws(() =>
      validateDiagnosticSource(value.compiler, value.receipt, value.sourceBytes, value.expected),
    );
  });
}

for (const field of [
  "version",
  "headerSha256",
  "sourceLanguage",
  "reconstructedPatchedSourceVerified",
  "llvmCompiledByThisStep",
]) {
  test(`rejects source ${field} drift even with a matching report hash`, () => {
    const value = fixture();
    value.source[field] = null;
    value.sourceBytes = Buffer.from(JSON.stringify(value.source));
    value.expected.sourceReportSha256 = sha(value.sourceBytes);
    assert.throws(() =>
      validateDiagnosticSource(value.compiler, value.receipt, value.sourceBytes, value.expected),
    );
  });
}

test("rejects a source archive bound to different compiler receipt bytes", () => {
  const value = fixture();
  value.source.files[0].sha256 = "d".repeat(64);
  value.sourceBytes = Buffer.from(JSON.stringify(value.source));
  value.expected.sourceReportSha256 = sha(value.sourceBytes);
  assert.throws(() =>
    validateDiagnosticSource(value.compiler, value.receipt, value.sourceBytes, value.expected),
  );
});

test("retention stays failure-only and keeps source upload before diagnostic binary", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/verify.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /failure\(\) && steps\.runtime\.outcome == 'failure'/);
  assert.match(workflow, /actions\/cache\/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/);
  assert.doesNotMatch(workflow, /save-always:|continue-on-error:/);
  assert.ok(
    workflow.indexOf("name: air-compiler-diagnostic-source") <
      workflow.indexOf("name: air-compiler-diagnostic-unvalidated"),
  );
  assert.match(workflow, /steps\.air_failure_source_upload\.outcome == 'success'/);
  const build = await readFile(new URL("build-air-compiler.mjs", import.meta.url), "utf8");
  assert.match(build, /compileCanary: await verifyAirCompilerCanary\(\)/);
});
