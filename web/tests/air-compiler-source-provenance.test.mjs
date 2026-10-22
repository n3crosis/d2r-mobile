import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { airCompilerSourceIdentity } from "../runtime-build/air-compiler-assets.mjs";

const root = new URL("../toolchain/metal-air-compiler/", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("reviewed fragment liveness API, checker and public source keep their frozen identity", async () => {
  const expected = {
    "api/air_compiler.cpp": "fce9a24557cca900398b2e7b9afbb853297a5d8bd034616d9c80b89a9d20981b",
    "check-fragment-input-liveness.mjs":
      "daa57c1cba44200bc31b30af6aece5ae734a17c2cf974b0825118b7f5c913b23",
    "fixtures/msl-fragment-input-liveness.metal":
      "5aa0bc64fe9d8df5b7afb8b2d7454782403962bdf28883f6e6e925a3c36db6a0",
  };
  for (const [path, sha256] of Object.entries(expected))
    assert.equal(hash(await readFile(new URL(path, root))), sha256, path);
  const identity = await airCompilerSourceIdentity();
  assert.equal(identity.sourceInputs["api/air_compiler.cpp"], expected["api/air_compiler.cpp"]);
});

// Source-only provenance checks: no compiler artifact is loaded or executed.
test("AIR source manifest authenticates every patch and every patched source path", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const patchPaths = manifest.patches.map(({ path }) => path);
  assert.equal(new Set(patchPaths).size, patchPaths.length);
  assert.deepEqual(
    (await readdir(new URL("patches/", root)))
      .filter((name) => name.endsWith(".patch"))
      .map((name) => `patches/${name}`)
      .sort(),
    [...patchPaths].sort(),
  );
  const sourcePaths = new Set();
  for (const patch of manifest.patches) {
    assert.match(patch.path, /^patches\/[A-Za-z0-9_.+-]+\.patch$/);
    const bytes = await readFile(new URL(patch.path, root));
    assert.equal(hash(bytes), patch.sha256, patch.path);
    const targets = [...bytes.toString("utf8").matchAll(/^\+\+\+ b\/(.+)$/gm)];
    assert(targets.length > 0, `No source targets in ${patch.path}`);
    for (const [, path] of targets) {
      assert.match(path, /^[A-Za-z0-9_.+/-]+$/);
      assert(!path.split("/").includes(".."));
      assert.match(manifest.patchedFiles[path] ?? "", /^[a-f0-9]{64}$/, path);
      sourcePaths.add(path);
    }
  }
  assert.deepEqual([...sourcePaths].sort(), Object.keys(manifest.patchedFiles).sort());
  for (const patch of manifest.rebaseProvenance.previousProjectPatches) {
    assert.match(patch.sha256, /^[a-f0-9]{64}$/);
    assert(patch.rebasedInto.length > 0);
    for (const target of patch.rebasedInto) assert(patchPaths.includes(target), target);
  }
});

test("AIR runtime source identity binds the complete manifest and all ordered patches", async () => {
  const identity = await airCompilerSourceIdentity();
  const manifestBytes = await readFile(new URL("manifest.json", root));
  assert.equal(identity.sourceManifestSha256, hash(manifestBytes));
  assert.equal(identity.sourceCommit, identity.manifest.commit);
  for (const patch of identity.manifest.patches)
    assert.equal(identity.sourceInputs[patch.path], patch.sha256, patch.path);
  assert.deepEqual(
    Object.keys(identity.sourceInputs)
      .filter((path) => path.startsWith("patches/"))
      .sort(),
    identity.manifest.patches.map(({ path }) => path).sort(),
  );
  assert.equal(
    identity.sourceFingerprintSha256,
    hash(
      JSON.stringify({
        sourceManifestSha256: identity.sourceManifestSha256,
        sourceInputs: identity.sourceInputs,
      }),
    ),
  );
});

test("stage-decorated resource storage changes only the missing-stage-in guard", async () => {
  const patch = await readFile(
    new URL("patches/0106-a2flo-corpus-compiler-fixes.patch", root),
    "utf8",
  );
  const target = "--- a/clang/lib/CodeGen/CodeGenModule.cpp\n";
  assert.equal(patch.split(target).length, 2, "exactly one CodeGenModule delta");
  const codegen = patch.slice(patch.indexOf(target)).split(/(?=^--- a\/)/m)[0];
  const nextHunk = codegen.indexOf("\n@@", codegen.indexOf("\n@@") + 1);
  const delta = codegen.slice(0, nextHunk + 1);
  assert.equal(hash(delta), "0163a4fcda09f30e754babc6e66874a67413017bd2c68411a29e88b01d8822dd");
  const removed = delta
    .split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---"));
  assert.deepEqual(removed, ["-\t\t\tif (has_msl_io(Base->getAsCXXRecordDecl())) {"]);
  for (const guard of [
    "!Stage && (T->isPointerType() || T->isReferenceType())",
    "HasOnlyBufferBinding &= isa<MetalBufferBindingAttr>(A)",
    "IsStoragePointer && HasOnlyBufferBinding",
    "AS == LangAS::opencl_global || AS == LangAS::opencl_constant",
    "IsStoragePointer && is_kernel",
    "P->hasAttr<MetalThreadgroupBindingAttr>() && AS == LangAS::opencl_local",
    "!IsBoundBuffer && !IsBoundThreadgroup && has_msl_io",
  ])
    assert(delta.includes(guard), guard);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(
    manifest.patchedFiles["clang/lib/CodeGen/CodeGenModule.cpp"],
    "24a2c4602921cb219f27ed3edc2db2db924c000109177e0dc3588155879da678",
  );
});

test("ordinary buffer reflection uses reviewed AST layout without changing special paths", async () => {
  const patch = await readFile(
    new URL("patches/0106-a2flo-corpus-compiler-fixes.patch", root),
    "utf8",
  );
  const target = "--- a/clang/lib/CodeGen/CodeGenModule.cpp\n";
  const codegen = patch.slice(patch.indexOf(target)).split(/(?=^--- a\/)/m)[0];
  const nextHunk = codegen.indexOf("\n@@", codegen.indexOf("\n@@") + 1);
  const reflection =
    target + "+++ b/clang/lib/CodeGen/CodeGenModule.cpp\n" + codegen.slice(nextHunk + 1);
  // Composition shifts line numbers, not the three reviewed reflection edits.
  assert.equal(
    hash(reflection.replace(/^@@.*@@.*$/gm, "@@")),
    "c71665339e34fd610dddd829de28609ecb6c5bebad587094fb9ce69677290442",
  );
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
    assert(reflection.includes(guard), guard);
});

test("AIR64 starts with final vector storage alignment and preparation enforces layout equality", async () => {
  const patch = await readFile(
    new URL("patches/0106-a2flo-corpus-compiler-fixes.patch", root),
    "utf8",
  );
  const target = "--- a/clang/lib/Basic/Targets/SPIR.h\n";
  assert.equal(patch.split(target).length, 2);
  const delta = patch.slice(patch.indexOf(target)).split(/(?=^--- a\/)/m)[0];
  assert.equal(hash(delta), "20b2741f94eb2108bf4cefabf4c6a8c5743575ef77d8dee011bf00de83334353");
  const before = delta.match(/^-\s*resetDataLayout\("([^"]+)"\);/m)?.[1];
  const after = delta.match(/^\+\s*resetDataLayout\("([^"]+)"\);/m)?.[1];
  assert(before && after);
  assert(after.includes("v96:128:128"));
  assert.deepEqual(
    after.split("-").filter((part) => !part.startsWith("v")),
    before.split("-").filter((part) => !part.startsWith("v")),
    "pointer, scalar and native-width layout clauses remain unchanged",
  );
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(
    manifest.patchedFiles["clang/lib/Basic/Targets/SPIR.h"],
    "e90c20a141c7918f6d4c922f73965bfa2e4d540b17c62305665d0460f43ed48a",
  );
  const toolchain = await readFile(new URL("toolchain.mjs", root), "utf8");
  assert(toolchain.includes('join(source, "clang/lib/Basic/Targets/SPIR.h")'));
  assert(toolchain.includes('join(source, "llvm/lib/Transforms/LibFloor/MetalFinal.cpp")'));
  assert(toolchain.includes("AIR64TargetInfo"));
  assert(
    toolchain.includes("finalLayouts.length !== 1 || initialLayout[1] !== finalLayouts[0][1]"),
  );
  assert(
    toolchain.includes('throw Error("AIR64 initial and final storage DataLayouts must match")'),
  );
});

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

test("stage/storage regression inventory preserves all authored source bytes and native wiring", async () => {
  const fixtures = JSON.parse(await readFile(new URL("fixtures/stage-storage.json", root), "utf8"));
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
  const toolchain = await readFile(new URL("toolchain.mjs", root), "utf8");
  assert(toolchain.includes('"run-msl-fixtures.mjs"'));
});
