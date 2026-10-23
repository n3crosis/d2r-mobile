import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  readForkSource,
  readOriginalAirProvenance,
} from "./fixtures/air-fork-source/fork-source.mjs";

const root = new URL("../toolchain/metal-air-compiler/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const hash = (data) => createHash("sha256").update(data).digest("hex");

// Source-only assertions: no compiler, LLVM parser/verifier or generated shader runs.
test("scalar i1 conversion hardening retains its exact authenticated fork source boundary", async () => {
  const { manifest, receipt } = await readOriginalAirProvenance();
  const path = "patches/0110-a2flo-scalar-i1-conversions.patch";
  const sha256 = "1e41886634d829084a3752d56723e38b55ff20dd75649510be6c4be446ca0c82";
  const source = await readForkSource("llvm/lib/Transforms/LibFloor/MetalFinal.cpp");
  assert.equal(manifest.patches.length, 10);
  assert.deepEqual(manifest.patches[9], { path, sha256 });
  assert.equal(receipt.sourceInputs[path], sha256);
  assert.equal(hash(source), "b7f8c3d17df3fddea4e87cd8a6fc2ac6ed0d53531714f9403b73ab72f3c39973");
  assert.equal(
    manifest.patchedFiles["llvm/lib/Transforms/LibFloor/MetalFinal.cpp"],
    "b7f8c3d17df3fddea4e87cd8a6fc2ac6ed0d53531714f9403b73ab72f3c39973",
  );
  assert.equal(
    hash(await readForkSource("wasm/api/air_compiler.cpp")),
    "5d06207b69e57435934bec8e4e67e71c014d6c890fe2ff625e96cc1d4dc7a448",
  );
  assert.equal(
    hash(await read("ci-compile-canary.mjs")),
    "19415766142c77a9443478e74d5413a300397c28a1a0395b2f99d22d3547eeca",
  );
});

test("release CI retains strict canary, failure evidence and complete source-artifact safeguards", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/verify.yml", import.meta.url),
    "utf8",
  );
  const steps = workflow.split(/^ {6}- /m).slice(1);
  const step = (id) => {
    const matches = steps.filter((text) => text.includes(`\n        id: ${id}\n`));
    assert.equal(matches.length, 1, `exactly one ${id} step`);
    return matches[0];
  };
  const build = await readFile(
    new URL("../runtime-build/build-air-compiler.mjs", import.meta.url),
    "utf8",
  );
  assert(build.includes("compileCanary: await verifyAirCompilerCanary()"));
  assert(build.includes("await prepareAirCompilerAssets()"));
  assert(build.includes("await importPinnedAirCompiler()"));
  assert(
    build.indexOf("await prepareAirCompilerAssets()") <
      build.indexOf("compileCanary: await verifyAirCompilerCanary()"),
  );
  assert(
    build.indexOf("await importPinnedAirCompiler()") <
      build.indexOf("compileCanary: await verifyAirCompilerCanary()"),
  );
  const runtime = step("runtime");
  assert(runtime.includes("node web/runtime-build/build-air-compiler.mjs"));
  assert(
    runtime.indexOf("node web/runtime-build/build-air-compiler.mjs") <
      runtime.indexOf("air_compiler_verified=true"),
  );
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  const failureVerify = step("air_failure_verify");
  assert(failureVerify.includes("failure() && steps.runtime.outcome == 'failure'"));
  assert(failureVerify.includes("air-compiler-assets.mjs verify --source-fingerprint"));
  const failureSource = step("air_failure_source");
  assert(failureSource.includes("!cancelled() && steps.air_failure_verify.outcome == 'success'"));
  assert(failureSource.includes("prepare-air-compiler-source.mjs --output"));
  const failureUpload = step("air_failure_source_upload");
  assert(failureUpload.includes("!cancelled() && steps.air_failure_source.outcome == 'success'"));
  assert(failureUpload.includes("include-hidden-files: true"));
  assert(failureUpload.includes("if-no-files-found: error"));
  const bundle = step("air_failure_bundle");
  assert(bundle.includes("!cancelled() && steps.air_failure_source_upload.outcome == 'success'"));
  assert(bundle.includes("steps.air_failure_source_upload.outputs.artifact-id"));
  assert(bundle.includes("steps.air_failure_source.outputs.source_report_sha256"));
  assert(bundle.includes("prepare-air-compiler-diagnostic.mjs"));
  const diagnostic = steps.find((text) =>
    text.includes("name: air-compiler-diagnostic-unvalidated"),
  );
  assert(diagnostic?.includes("!cancelled() && steps.air_failure_bundle.outcome == 'success'"));
  assert(diagnostic.includes("if-no-files-found: error"));
  const completeSource = steps.find((text) => text.includes("name: air-compiler-source\n"));
  assert(completeSource?.includes("include-hidden-files: true"));
  assert(completeSource.includes("if-no-files-found: error"));
  assert.doesNotMatch(completeSource, /failure\(\)|always\(\)|!cancelled\(\)/);
  assert(
    workflow.includes(
      'prepare-air-compiler-source.mjs --output "$RUNNER_TEMP/air-compiler-source-artifact"',
    ),
  );
  const preview = steps.find((text) => text.includes("name: web-preview\n"));
  assert(preview?.includes("if-no-files-found: error"));
  assert.doesNotMatch(preview, /failure\(\)|always\(\)|!cancelled\(\)/);
  assert(workflow.indexOf("name: air-compiler-source\n") < workflow.indexOf("name: web-preview\n"));
  assert(
    workflow.indexOf("node web/runtime-build/stage-preview.mjs") <
      workflow.indexOf("name: web-preview\n"),
  );
});

test("25 scalar i1 cases are frozen authored symbolic shapes, not compiler output", async () => {
  const files = {
    "fixtures/scalar-i1-conversions.ll":
      "38a92cd67dd7522aeab39b8af191a4e02253d193c097b27c8d4cfdb80f06e4e5",
    "fixtures/scalar-i1-conversions.expected.ll":
      "1c562583db1b9180d54706f8f67db369fba1eb1000ea6459e15f1671a1eac21a",
    "fixtures/scalar-i1-conversions.json":
      "06a74555c99c67bf8093f8f440909653343abc36bfb15f11bdbd18767f1f6613",
  };
  const sources = {};
  for (const [path, expected] of Object.entries(files)) {
    sources[path] = await read(path);
    assert.equal(hash(sources[path]), expected, path);
  }
  const input = sources["fixtures/scalar-i1-conversions.ll"];
  const expected = sources["fixtures/scalar-i1-conversions.expected.ll"];
  const cases = JSON.parse(sources["fixtures/scalar-i1-conversions.json"]);
  assert.equal(cases.kind, "hand-authored-symbolic-shapes");
  assert.equal(cases.compilerExecuted, false);
  assert.equal(cases.llvmVerified, false);
  const names = [
    "signed_half",
    "signed_float",
    "signed_double",
    "signed_true",
    "signed_false",
    "signed_poison",
    "signed_undef",
    "unsigned_half",
    "unsigned_float",
    "unsigned_double",
    "unsigned_true",
    "unsigned_false",
    "unsigned_poison",
    "unsigned_undef",
    "frozen_input",
    "adjacent_debug_multiuse",
    "vector_signed",
    "vector_unsigned",
    "vector_one_signed",
    "signed_i8",
    "unsigned_i64",
    "unsupported_bfloat",
    "unsupported_fp128",
    "reverse_signed",
    "reverse_unsigned",
  ];
  assert.deepEqual(
    cases.cases.map((entry) => entry.name),
    names,
  );
  for (const source of [input, expected]) {
    assert.deepEqual(
      [...source.matchAll(/^define .+ @([^ (]+)\(/gm)].map((match) => match[1]),
      names,
    );
    assert.doesNotMatch(source, /^; RUN:/m);
    assert(source.includes("Hand-authored symbolic fixtures, not captured compiler output"));
  }
  for (const type of ["half", "float", "double"])
    for (const sign of ["-", ""])
      assert(expected.includes(`select i1 %b, ${type} ${sign}1.000000e+00, ${type} 0.000000e+00`));
  assert(expected.includes("ret float poison"));
  assert(expected.includes("freeze i1"));
  assert(!(await read("ci-compile-canary.mjs")).includes("scalar-i1-conversions"));
});
