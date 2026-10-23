import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  sourceReviewOptions,
  readForkSource,
  readOriginalAirProvenance,
  readReviewedSourceLock,
} from "./fixtures/air-fork-source/fork-source.mjs";

const root = new URL("../toolchain/metal-air-compiler/", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test(
  "reviewed fragment liveness API, checker and public source keep their frozen identity",
  sourceReviewOptions,
  async () => {
    const expected = {
      "check-fragment-input-liveness.mjs":
        "803d20dff3cda4ccbf66a45c7526881146bd27b5a805098fbfa9eaa0feddf71b",
      "check-fragment-input-reflection.mjs":
        "14fd952ac51abfbd7482b26e448956c43fde5f8babcaccbb0c83f46ec9774b6e",
      "fixtures/msl-fragment-input-liveness.metal":
        "0820f23da050fa12a4031a45c09dec58a4394f7179032570c1acd85a20d434d5",
    };
    for (const [path, sha256] of Object.entries(expected))
      assert.equal(hash(await readFile(new URL(path, root))), sha256, path);
    assert.equal(
      hash(await readForkSource("wasm/api/air_compiler.cpp")),
      "5d06207b69e57435934bec8e4e67e71c014d6c890fe2ff625e96cc1d4dc7a448",
    );
  },
);

// Source-only provenance checks: no compiler artifact is loaded or executed.
test(
  "fresh fork source lock authenticates all 50 inputs without claiming API byte equivalence",
  sourceReviewOptions,
  async () => {
    const { manifest, receipt } = await readOriginalAirProvenance();
    const lock = await readReviewedSourceLock();
    assert.deepEqual(
      lock.compilerFiles,
      manifest.patchedFiles,
      "all 31 reviewed compiler-core files are unchanged",
    );
    const inputs = {
      ...lock.compilerFiles,
      ...Object.fromEntries(
        Object.entries(lock.sdkFiles).map(([path, sha]) => [`wasm/${path}`, sha]),
      ),
    };
    assert.equal(Object.keys(inputs).length, 50);
    for (const [path, sha256] of Object.entries(inputs)) {
      assert.match(path, /^(?:clang|llvm|wasm)\/[A-Za-z0-9_.+/-]+$/);
      assert(!path.split("/").includes(".."));
      assert.equal(hash(await readForkSource(path)), sha256, path);
    }
    const sdkApiInputs = Object.keys(lock.sdkFiles).filter((path) => path.startsWith("api/"));
    assert.equal(sdkApiInputs.length, 18, "compiler/API sources belong to the generic fork");
    assert.notEqual(
      lock.sdkFiles["api/air_compiler.cpp"],
      receipt.sourceInputs["api/air_compiler.cpp"],
    );
    assert.notEqual(
      lock.sdkFiles["api/CMakeLists.txt"],
      receipt.sourceInputs["api/CMakeLists.txt"],
    );
    for (const name of [
      "control_smoke.cpp",
      "header_smoke.cpp",
      "operations_smoke.h",
      "smoke.cpp",
    ]) {
      assert.equal(Object.hasOwn(lock.sdkFiles, `api/${name}`), false);
      assert.equal(
        hash(await readFile(new URL(`fixtures/native-api/${name}`, root))),
        receipt.sourceInputs[`api/${name}`],
        `relocated authored ${name}`,
      );
    }
  },
);

test("original build provenance still binds the a2flo base and ten ordered patches", async () => {
  const { manifest, receipt } = await readOriginalAirProvenance();
  assert.equal(manifest.repository, "https://github.com/a2flo/floor_llvm");
  assert.equal(manifest.commit, "4b173e3db383ec7164afb11ee7dc86609c88f052");
  assert.equal(receipt.sourceCommit, manifest.commit);
  assert.equal(manifest.patches.length, 10);
  assert.equal(
    receipt.sourceManifestSha256,
    hash(
      await readFile(new URL("fixtures/air-release-history/source-manifest.json", import.meta.url)),
    ),
  );
  const patchPaths = manifest.patches.map(({ path }) => path);
  assert.equal(new Set(patchPaths).size, patchPaths.length);
  for (const patch of manifest.patches) {
    assert.match(patch.path, /^patches\/[A-Za-z0-9_.+-]+\.patch$/);
    assert.equal(receipt.sourceInputs[patch.path], patch.sha256, patch.path);
  }
  assert.deepEqual(
    Object.keys(receipt.sourceInputs).filter((path) => path.startsWith("patches/")),
    patchPaths,
  );
  for (const patch of manifest.rebaseProvenance.previousProjectPatches) {
    assert.match(patch.sha256, /^[a-f0-9]{64}$/);
    assert(patch.rebasedInto.length > 0);
    for (const target of patch.rebasedInto) assert(patchPaths.includes(target), target);
  }
  assert.equal(
    receipt.sourceFingerprintSha256,
    hash(
      JSON.stringify({
        sourceManifestSha256: receipt.sourceManifestSha256,
        sourceInputs: receipt.sourceInputs,
      }),
    ),
  );
});

test("source review override rejects unknown, missing, tampered and symlinked blobs without fallback", async () => {
  const reviewDirectory = await mkdtemp(join(tmpdir(), "air-source-review-"));
  const options = { reviewDirectory };
  const path = "wasm/api/air_compiler.cpp";
  const target = join(reviewDirectory, path);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("source-only review must not fetch or fall back");
  };
  try {
    for (const path of [
      "../manifest.json",
      "/wasm/build.mjs",
      "wasm//build.mjs",
      "wasm/./build.mjs",
    ])
      await assert.rejects(readForkSource(path, options), /unsafe fork path/);
    await assert.rejects(
      readForkSource("wasm/unreviewed.cpp", options),
      /No reviewed source identity/,
    );
    await assert.rejects(readForkSource(path, options), { code: "ENOENT" });
    await assert.rejects(
      readForkSource(path, { reviewDirectory: "" }),
      /empty source review directory/,
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "unreviewed source bytes");
    await assert.rejects(readForkSource(path, options), /Reviewed fork source mismatch/);
    await truncate(target, 0);
    await assert.rejects(readForkSource(path, options), /source review blob size/);
    await truncate(target, 16 * 1024 ** 2 + 1);
    await assert.rejects(readForkSource(path, options), /source review blob size/);
    await rm(target);
    await mkdir(target);
    await assert.rejects(
      readForkSource(path, options),
      /source review blob must be a regular file/,
    );
    await rm(target, { recursive: true });
    await symlink(new URL("check-fragment-input-liveness.mjs", root), target);
    await assert.rejects(
      readForkSource(path, options),
      /source review path must not traverse symlinks/,
    );
    await rm(target);
    await rm(dirname(target), { recursive: true });
    await mkdir(join(reviewDirectory, "redirected"));
    await writeFile(
      join(reviewDirectory, "redirected", "air_compiler.cpp"),
      "unreviewed source bytes",
    );
    await symlink(join(reviewDirectory, "redirected"), dirname(target));
    await assert.rejects(
      readForkSource(path, options),
      /source review path must not traverse symlinks/,
    );
    await writeFile(join(reviewDirectory, "wasm", "source-lock.json"), "{}");
    await assert.rejects(
      readForkSource("wasm/source-lock.json", options),
      /Reviewed fork source mismatch/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(reviewDirectory, { recursive: true, force: true });
  }
});

test("review source-directory override is absent from production release modules", async () => {
  for (const name of ["contract", "transport", "loader"]) {
    const source = await readFile(
      new URL(`../runtime-build/air-release-${name}.mjs`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /D2R_AIR_SOURCE_REVIEW_DIR|fixtures\/air-fork-source|generic-no-added-license-labels/,
    );
  }
});

test("consumer removes compiler duplication but retains authored fixtures and receipt-bound browser smoke", async () => {
  const entries = await readdir(root);
  for (const obsolete of [
    "api",
    "patches",
    "toolchain.mjs",
    "manifest.json",
    "header-identity.mjs",
    "wasm-node-preflight.mjs",
  ])
    assert(!entries.includes(obsolete), `obsolete local compiler implementation: ${obsolete}`);
  for (const retained of [
    "ci-compile-canary.mjs",
    "check-buffer-reflection.mjs",
    "check-fragment-input-liveness.mjs",
    "check-fragment-input-reflection.mjs",
    "fixtures",
  ])
    assert(entries.includes(retained), `D2R regression coverage retained: ${retained}`);
  assert.deepEqual((await readdir(new URL("fixtures/native-api/", root))).sort(), [
    "control_smoke.cpp",
    "header_smoke.cpp",
    "operations_smoke.h",
    "smoke.cpp",
  ]);
  const server = await readFile(new URL("browser-smoke-server.mjs", root), "utf8");
  for (const marker of [
    'args[0] !== "--build"',
    'args[2] !== "--sha256"',
    "await verifyAirCompilerAssets(build, args[3])",
    "const { apiVersion, headerSha256 } = report",
    'airCompilerReceiptOutput(report, "d2r_air_wasm.mjs").sha256',
    'airCompilerReceiptOutput(report, "d2r_air_wasm.wasm").sha256',
    'server.listen(0, "127.0.0.1"',
    '"shader-diagnostics.mjs"',
  ])
    assert(server.includes(marker), marker);
  assert(
    server.indexOf("await verifyAirCompilerAssets(") < server.indexOf("const routes = new Map()"),
  );
  assert.doesNotMatch(server, /readAirHeaderIdentity|--api-source|api-build-wasm/);
});

test("source delivery mirrors exact fresh source and raw receipts without reconstructing a compiler", async () => {
  const source = await readFile(
    new URL("../runtime-build/prepare-air-compiler-source.mjs", import.meta.url),
    "utf8",
  );
  for (const marker of [
    "readFreshAirReleaseMetadata({ download: true })",
    'readFreshAirReleaseAsset(metadata, "correspondingSource", { download: true })',
    "await verifyAirCompilerAssets()",
    "verifyFreshAirReceipt(receipt, metadata.release, metadata.buildInputs)",
    "await put(metadata.release.assets.correspondingSource.name, source.bytes)",
    'await put("compiler-build-report.json", receipt)',
    'await put("release-manifest.json", metadata.manifestBytes)',
    'await put("build-inputs.json", metadata.buildInputsBytes)',
    'kind: "pinned-release-source-mirror"',
    "completeReleaseSourceVerified: true",
    "installedSdkRuntimeSourcesIncluded: true",
    "llvmCompiledByThisStep: false",
    "binaryBuiltFromNewFork: true",
  ])
    assert(source.includes(marker), marker);
  assert(source.indexOf("verifyFreshAirReceipt(receipt") < source.indexOf("await mkdir(output)"));
  assert(
    source.indexOf('readFreshAirReleaseAsset(metadata, "correspondingSource"') <
      source.indexOf("await mkdir(output)"),
  );
  assert.doesNotMatch(
    source,
    /runToolchain|build-host-tools|build-wasm|reconstructedPatchedSourceVerified|originalCompleteSourceZipVerified/,
  );
});

test(
  "stage-decorated resource storage retains its exact reviewed missing-stage-in guard",
  sourceReviewOptions,
  async () => {
    const source = await readForkSource("clang/lib/CodeGen/CodeGenModule.cpp");
    assert.equal(hash(source), "24a2c4602921cb219f27ed3edc2db2db924c000109177e0dc3588155879da678");
    for (const guard of [
      "!Stage && (T->isPointerType() || T->isReferenceType())",
      "HasOnlyBufferBinding &= isa<MetalBufferBindingAttr>(A)",
      "IsStoragePointer && HasOnlyBufferBinding",
      "AS == LangAS::opencl_global || AS == LangAS::opencl_constant",
      "IsStoragePointer && is_kernel",
      "P->hasAttr<MetalThreadgroupBindingAttr>() && AS == LangAS::opencl_local",
      "!IsBoundBuffer && !IsBoundThreadgroup && has_msl_io",
    ])
      assert(source.includes(guard), guard);
  },
);

test(
  "ordinary buffer reflection uses reviewed AST layout without changing special paths",
  sourceReviewOptions,
  async () => {
    const source = await readForkSource("clang/lib/CodeGen/CodeGenModule.cpp");
    assert.equal(hash(source), "24a2c4602921cb219f27ed3edc2db2db924c000109177e0dc3588155879da678");
    for (const guard of [
      "!is_indirect && !indirect_buffer && !align_vectors",
      "!parent_decl.hasAttr<GraphicsStageInputAttr>() && !struct_rdecl.isUnion()",
      "!struct_rdecl.getNumBases() && !struct_rdecl.isPolymorphic()",
      "use_ast_layout &= !field->isBitField()",
      "use_ast_layout ? &Context.getASTRecordLayout(&struct_rdecl) : nullptr",
      "record_layout->getFieldOffset(field->getFieldIndex()) / Context.getCharWidth()",
      "Context.getTypeSizeInChars(field_type).getQuantity()",
      "!clang_pointee_type->isIncompleteType() && !clang_pointee_type->isFunctionType()",
      "Context.getTypeAlignInChars(clang_pointee_type).getQuantity()",
      "indirect_buffer ? uint64_t(8u) : uint64_t(16u)",
    ])
      assert(source.includes(guard), guard);
  },
);

test(
  "AIR64 initial/final storage layouts match and fork preparation enforces equality",
  sourceReviewOptions,
  async () => {
    const target = await readForkSource("clang/lib/Basic/Targets/SPIR.h");
    assert.equal(hash(target), "e90c20a141c7918f6d4c922f73965bfa2e4d540b17c62305665d0460f43ed48a");
    const finalization = await readForkSource("llvm/lib/Transforms/LibFloor/MetalFinal.cpp");
    const initialLayout = target.match(
      /class LLVM_LIBRARY_VISIBILITY AIR64TargetInfo\b[\s\S]*?resetDataLayout\("([^"]+)"\);/,
    );
    const finalLayouts = [...finalization.matchAll(/\bMod\.setDataLayout\("([^"]+)"\);/g)];
    assert(initialLayout);
    assert.equal(finalLayouts.length, 1);
    assert.equal(initialLayout[1], finalLayouts[0][1]);
    assert(initialLayout[1].includes("v96:128:128"));
    assert.deepEqual(
      initialLayout[1].split("-").filter((part) => !part.startsWith("v")),
      "e-p:64:64:64-i1:8:8-i8:8:8-i16:16:16-i32:32:32-i64:64:64-f32:32:32-f64:64:64-n8:16:32".split(
        "-",
      ),
      "pointer, scalar and native-width layout clauses remain unchanged",
    );
    const build = await readForkSource("wasm/build.mjs");
    assert(build.includes('join(source, "clang/lib/Basic/Targets/SPIR.h")'));
    assert(build.includes('join(source, "llvm/lib/Transforms/LibFloor/MetalFinal.cpp")'));
    assert(build.includes("AIR64TargetInfo"));
    assert(build.includes("finalLayouts.length !== 1 || initialLayout[1] !== finalLayouts[0][1]"));
    assert(build.includes('throw Error("AIR64 initial and final storage DataLayouts must match")'));
  },
);

test(
  "writer consumes unused fragment and position flags without changing prior corrections",
  sourceReviewOptions,
  async () => {
    const source = await readForkSource("llvm/lib/Bitcode/MetalLib/MetalLibReflection.cpp");
    assert.equal(hash(source), "f57d14824b7beb9fc61f1cd527c06aea830302b8f46f840e657601d1b0e4e85b");
    const flag =
      /\} else if \(type_str == "air\.arg_unused"\) \{\s*\/\/ A zero-operand flag; preserve it in the serialized reflection\.\s*if \(node\.unused\.has_value\(\)\) return false;\s*node\.unused = true;\s*return true;/g;
    assert.equal(
      [...source.matchAll(flag)].length,
      2,
      "fragment and position flags reject duplicate markers",
    );
  },
);

test("four public reflection probes retain byte identity and existing runner/canary coverage", async () => {
  const inventory = await readFile(new URL("fixtures/buffer-reflection.json", root), "utf8");
  assert.equal(hash(inventory), "d03a386cf2ccf443c285ce9f41e850a00b7a187c06b4bab8e56f29aa756cd298");
  const fixtures = JSON.parse(inventory);
  const publicHashes = {
    "fixtures/msl-buffer-reflection-mixed.metal":
      "aa008f242806c8e5625db92b364fe87216df3695ebfb1528d393b053ebb4267a",
    "fixtures/msl-buffer-reflection-array.metal":
      "1f43fb6b0d15115e1cbe8ea624c64a6a4eb6f785a9c852a4e5428f7c1491c20f",
    "fixtures/msl-buffer-reflection-float3.metal":
      "f883a9c3d6f0e73681f1c95f6539597ddf31f2f8c4703d9590c9b81e4dfa7733",
    "fixtures/msl-buffer-reflection-nested.metal":
      "357404a163024f6102503ee483cba9e2e6bc51963ae1f13e930e424ffe1ea82b",
  };
  assert.deepEqual(fixtures.map(({ file }) => file).sort(), Object.keys(publicHashes).sort());
  const canary = await readFile(new URL("ci-compile-canary.mjs", root), "utf8");
  for (const fixture of fixtures) {
    const source = await readFile(new URL(fixture.file, root), "utf8");
    assert.equal(hash(source), publicHashes[fixture.file]);
    assert.equal(fixture.sha256, publicHashes[fixture.file]);
    assert(source.includes("SPDX-License-Identifier: MIT"));
    assert(source.includes("#include <metal_stdlib>"));
    assert(source.includes(`kernel void ${fixture.entry}(`));
    assert.equal(fixture.stage, "kernel");
    assert.equal(fixture.expected, "compiled");
    assert.equal(fixture.buffer.align, 16);
    assert(canary.includes(`filename: "${fixture.file.replace("fixtures/", "")}"`));
    assert(canary.includes(`entry: "${fixture.entry}"`));
  }
  const runner = await readFile(new URL("run-msl-fixtures.mjs", root), "utf8");
  assert(runner.includes('"fixtures/buffer-reflection.json"'));
  assert(runner.includes('import { checkReflection } from "./check-buffer-reflection.mjs"'));
  assert(runner.includes("checkReflection(result.stdout, fixture)"));
});

test(
  "stage/storage regression inventory preserves all authored source bytes and native wiring",
  sourceReviewOptions,
  async () => {
    const fixtures = JSON.parse(
      await readFile(new URL("fixtures/stage-storage.json", root), "utf8"),
    );
    assert.equal(fixtures.length, 17);
    assert.equal(fixtures.filter(({ expected }) => expected === "compiled").length, 2);
    assert.equal(fixtures.filter(({ expected }) => expected === "rejected").length, 15);
    assert.equal(new Set(fixtures.map(({ file }) => file)).size, fixtures.length);
    assert.deepEqual(
      (await readdir(new URL("fixtures/stage-storage-negative/", root))).sort(),
      fixtures
        .filter(({ expected }) => expected === "rejected")
        .map(({ file }) => file.replace("fixtures/stage-storage-negative/", ""))
        .sort(),
    );
    const canary = await readFile(new URL("ci-compile-canary.mjs", root), "utf8");
    const publicHashes = {
      "fixtures/msl-stage-record-threadgroup.metal":
        "f4475a8a668fbf24f1c4b754dbd5fb30d74b934bd6802f7fa10b0734d341b5c5",
      "fixtures/msl-stage-record-buffers.metal":
        "c99dbf7384190f672de1661efc56b38c6a43741c7b411da6c63fdea76f290de8",
    };
    for (const fixture of fixtures) {
      assert.match(fixture.file, /^fixtures\/(?:stage-storage-negative\/)?[a-z0-9-]+\.metal$/);
      const source = await readFile(new URL(fixture.file, root), "utf8");
      assert.equal(hash(source), fixture.sha256, fixture.file);
      assert(source.includes("SPDX-License-Identifier: MIT"));
      assert(source.includes("#include <metal_stdlib>"));
      assert.doesNotMatch(source, /#line|#pragma OPENCL EXTENSION/);
      if (fixture.expected === "rejected") {
        assert.equal(typeof fixture.diagnostic, "string");
        assert(fixture.diagnostic.length > 0);
      } else {
        assert.equal(fixture.stage, "kernel");
        assert.equal(fixture.sha256, publicHashes[fixture.file]);
        assert(canary.includes(`filename: "${fixture.file.replace("fixtures/", "")}"`));
        assert(canary.includes(`entry: "${fixture.entry}"`));
        assert(source.includes(`kernel void ${fixture.entry}(`));
        assert(source.includes("[[stage_in]]"));
      }
    }
    const runner = await readFile(new URL("run-msl-fixtures.mjs", root), "utf8");
    for (const marker of [
      '"fixtures/stage-storage.json"',
      "assert.equal(sha(source), fixture.sha256",
      "assert.ifError(result.error)",
      "assert.equal(result.signal, null",
      "assert.notEqual(result.status, 0",
      "result.stderr.includes(fixture.diagnostic)",
      "assert.equal(result.status, 0",
      '"one stage input field"',
      '"air.buffer"',
      '"air.location_index"',
      '"air.address_space"',
    ])
      assert(runner.includes(marker), marker);
    const build = await readForkSource("wasm/build.mjs");
    assert.doesNotMatch(
      build,
      /run-msl-fixtures|d2r_air|D2R_AIR/,
      "generic producer does not own or silently substitute D2R-authored fixture execution",
    );
  },
);
