// 只验证固定元数据与拒绝边界，不执行外壳、编译器或游戏。
// Fixed metadata and rejection boundaries only; no shell, compiler or game execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  V2_SHELL_PROFILE_IDS,
  V2_SHELL_CAPABILITIES,
  V2_SHELL_RELEASE_SOURCE,
  resolveV2ShellEvidence,
} from "../shell-v2-evidence.mjs";
import {
  DEFAULT_SHELL_PROFILE_ID,
  SHELL_PROFILE_IDS,
  resolveShellProfile,
} from "../shell-profiles.mjs";
import { deriveD2rRuntimeContentMode } from "../d2r-runtime-content-mode.mjs";

test("default v2 profiles bind reviewed recipes without claiming device validation", async () => {
  assert.equal(DEFAULT_SHELL_PROFILE_ID, "v2.0.0-ios26");
  assert.deepEqual(V2_SHELL_PROFILE_IDS, ["v2.0.0-ios26", "v2.0.0-ios18"]);
  assert.deepEqual(SHELL_PROFILE_IDS, [...V2_SHELL_PROFILE_IDS, "v1.0.18-ios26", "v1.0.18-ios18"]);
  for (const id of V2_SHELL_PROFILE_IDS) {
    const selected = resolveShellProfile(id);
    const evidence = resolveV2ShellEvidence(id);
    assert.equal(selected.evidence, evidence.evidence);
    assert.equal(selected.contentPin, evidence.contentPin);
    assert.equal(selected.assetRecipe.artRevision, V2_SHELL_RELEASE_SOURCE);
    assert.equal(selected.assetRecipe.overlayRevision, V2_SHELL_RELEASE_SOURCE);
    assert.equal(
      selected.assetRecipe.overlaySourceFingerprint,
      V2_SHELL_CAPABILITIES.overlayNativeSourceFingerprint,
    );
    await assert.rejects(
      deriveD2rRuntimeContentMode(new Uint8Array(), { profileId: id, contentMode: "warlock" }),
      /D2R_RUNTIME_CONTENT_BINDING/,
    );
  }
  assert.equal(V2_SHELL_CAPABILITIES.status, "source-reviewed-not-device-validated");
  assert.equal(V2_SHELL_CAPABILITIES.matchingReleaseAssetRecipeRequired, true);
  assert.equal(V2_SHELL_CAPABILITIES.completeShaderSourceDigestRequired, true);
  assert.equal(V2_SHELL_CAPABILITIES.reflectionAndCompiledLibraryValidationRequired, true);
  assert.equal(V2_SHELL_CAPABILITIES.laterPlayStationGlyphsSupported, false);
  assert.equal(V2_SHELL_CAPABILITIES.laterIosVp8Supported, false);
  assert.equal(V2_SHELL_CAPABILITIES.deviceExecutionVerified, false);
});

test("both candidates bind exact release, executable, minimum OS and distinct patch sites", () => {
  assert.equal(V2_SHELL_RELEASE_SOURCE, "b811b90172f4eb40ec1bc89d903308e0c5ab88d0");
  const current = resolveV2ShellEvidence("v2.0.0-ios26");
  const legacy = resolveV2ShellEvidence("v2.0.0-ios18");
  assert.equal(current.contentPin.fileOffset, 0x1a71e8);
  assert.equal(legacy.contentPin.fileOffset, 0x1a3058);
  assert.notEqual(current.contentPin.originalSha256, legacy.contentPin.originalSha256);
  assert.notEqual(current.contentPin.noDlcSha256, legacy.contentPin.noDlcSha256);
  assert.notEqual(current.evidence.sha256, legacy.evidence.sha256);
  for (const p of [current, legacy]) {
    const { evidence, capacities, contentPin } = p;
    assert.equal(evidence.releaseTarget, V2_SHELL_RELEASE_SOURCE);
    assert.equal(capacities.evidence.sourceCommit, V2_SHELL_RELEASE_SOURCE);
    assert.equal(capacities.evidence.reviewStatus, "independently-reviewed-static-control-flow");
    assert.equal(evidence.publisherDigestMatched, true);
    assert.equal(evidence.publisherChecksumAssetMatched, true);
    assert.equal(evidence.publisherBinaryBuildAttestationVerified, false);
    assert.equal(evidence.productionCompatibilityEstablished, false);
    assert.equal(evidence.entries.length, 15);
    const executable = evidence.entries.find((e) => e.path === capacities.evidence.executablePath);
    assert.equal(executable.sha256, contentPin.originalSha256);
    assert.equal(executable.size, contentPin.size);
    assert.equal(capacities.shellSha256, evidence.sha256);
    assert.equal(capacities.evidence.executableSha256, contentPin.originalSha256);
    assert.equal(evidence.machOBuildVersions[0].minimumVersion, p.guestTarget.minimumVersion);
    assert.equal(evidence.machOBuildVersions[0].sdkVersion, "27.1.0");
    assert.equal(p.guestTarget.sdkVersion, "26.0.0");
    assert.equal(evidence.shellInfo.CHAIN, "420aeb7c8bc6");
    assert.equal(evidence.shellInfo.SHADER_SRC, "be59c864f087b377");
    assert.equal(evidence.shellInfo.SPIRV_CROSS, "1.4.363.0");
    assert.equal(evidence.inspection.executed, false);
    assert.equal(evidence.inspection.contentMode.mutationOnlyInMemory, true);
    assert.equal(evidence.inspection.contentMode.derivedSha256, contentPin.noDlcSha256);
    assert.deepEqual(capacities.counts, {
      EXP: 100,
      VTPART: 11,
      VTROW: 562,
      VTSET: 35,
      TAROW: 429,
    });
    assert.deepEqual(capacities.evidence.bindings.map((b) => b.name).sort(), [
      "_k_exp_load",
      "_ta_load",
      "_vt_load",
      "_vt_part_cb",
      "_vt_row_cb",
      "_vt_set_cb",
    ]);
    for (const binding of capacities.evidence.bindings) {
      assert.match(binding.functionSha256, /^[a-f0-9]{64}$/);
      assert.ok(binding.functionBytes > 0);
      for (const group of binding.instructions) {
        assert.ok(group.window.length >= 2);
        assert.match(group.window[0].decodedSubset, /^cmp [wx][0-9]+, #[0-9]+$/);
        for (const instruction of group.window) {
          assert.ok(instruction.fileOffset >= binding.fileOffset);
          assert.ok(instruction.fileOffset < binding.fileOffset + binding.functionBytes);
          assert.match(instruction.bytes, /^[a-f0-9]{8}$/);
        }
      }
    }
  }
  assert.equal(legacy.evidence.inspection.metal4SymbolNames.length, 0);
});

test("independent static review binds the same ZIPs, functions, callback tags and patch sites", async () => {
  const reviews = JSON.parse(
    await readFile(
      new URL(
        "../toolchain/shell-release-evidence/v2.0.0-independent-native-review.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(reviews.length, V2_SHELL_PROFILE_IDS.length);
  for (const id of V2_SHELL_PROFILE_IDS) {
    const p = resolveV2ShellEvidence(id);
    const review = reviews.find((r) => r.asset.sha256 === p.evidence.sha256);
    assert.ok(review);
    assert.equal(review.executableSha256, p.contentPin.originalSha256);
    assert.equal(review.minimumVersion, p.guestTarget.minimumVersion);
    assert.equal(review.aocDataSymbol.fileOffset, p.contentPin.fileOffset);
    assert.equal(BigInt(review.aocDataSymbol.address), p.contentPin.address);
    assert.equal(review.aocDerivedSha256, p.contentPin.noDlcSha256);
    assert.equal(review.rawInstructionWindowBytesVerified, true);
    assert.deepEqual(review.vaultTagCallbackContextBindings, [
      { tag: "VTPART", callback: "_vt_part_cb", contextFrameOffset: -20 },
      { tag: "VTROW", callback: "_vt_row_cb", contextFrameOffset: -24 },
      { tag: "VTSET", callback: "_vt_set_cb", contextFrameOffset: -28 },
    ]);
    assert.equal(review.functionBindings.length, p.capacities.evidence.bindings.length);
    for (const binding of p.capacities.evidence.bindings) {
      assert.deepEqual(
        review.functionBindings.find((b) => b.name === binding.name),
        {
          name: binding.name,
          fileOffset: binding.fileOffset,
          functionSha256: binding.functionSha256,
        },
      );
    }
  }
});

test("candidate metadata is immutable and never accepts caller-supplied identities", () => {
  for (const id of [undefined, null, {}, "__proto__", "constructor", "v2.0.0", "v1.0.18-ios26"])
    assert.throws(() => resolveV2ShellEvidence(id), /SHELL_V2_EVIDENCE_UNKNOWN/);
  const p = resolveV2ShellEvidence("v2.0.0-ios26");
  assert.throws(() => {
    p.contentPin.fileOffset = 0x18ef78;
  }, TypeError);
  assert.throws(() => {
    p.capacities.counts.EXP = 99;
  }, TypeError);
  assert.throws(() => {
    p.evidence.shellInfo.CHAIN = "f2bc055e8f1e";
  }, TypeError);
  assert.throws(() => {
    V2_SHELL_CAPABILITIES.status = "enabled";
  }, TypeError);
});

test("CHAIN diagnostics distinguish publisher reproducibility from source-equivalent consumption", async () => {
  const records = JSON.parse(
    await readFile(
      new URL(
        "../toolchain/shell-release-evidence/v2.0.0-source-chain-comparison.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const [old, release, latest] = records;
  assert.deepEqual(old.chainInputSha256, release.chainInputSha256);
  assert.deepEqual(release.chainInputSha256, latest.chainInputSha256);
  assert.equal(release.computedChain, "c675d3fa7c90");
  assert.equal(release.headerChain, "15cf7ca29eaf");
  assert.equal(release.headerMatchesCommittedInputs, false);
  assert.notEqual(
    release.computedChain,
    resolveV2ShellEvidence("v2.0.0-ios26").evidence.shellInfo.CHAIN,
  );
  const loaders = JSON.parse(
    await readFile(
      new URL(
        "../toolchain/shell-release-evidence/v2.0.0-native-loader-comparison.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const record of loaders.records.filter((r) => r.path !== "dm/gfx/nvn/nvn_mtl.m"))
    assert.equal(record.byteIdentical, true);
  const metal = loaders.records.find((r) => r.path === "dm/gfx/nvn/nvn_mtl.m");
  assert.equal(metal.shaderLoadBodyByteIdentical, true);
  assert.equal(metal.libraryLoaderBodyByteIdentical, true);
});

test("v2 uses the existing full source proof before all three CHAIN labels", async () => {
  const source = await readFile(new URL("../production-shaders.mjs", import.meta.url), "utf8");
  const proof = source.indexOf("await pipeline.verifyCompleteSourceSet()");
  const chain = source.indexOf("const chain = trustedShell.trustedRecipe.chain");
  assert.ok(proof >= 0 && chain > proof);
  assert.match(source.slice(proof, chain), /pending.length !== 6927/);
  assert.match(
    source.slice(proof, chain),
    /proof.sourceDigest !== trustedShell.trustedRecipe.shaderDigest/,
  );
  for (const marker of ["row.replay.chain = chain", "msl/b-${chain}/", "# chain b-${chain}"]) {
    assert.ok(source.indexOf(marker) > chain);
  }
  for (const id of V2_SHELL_PROFILE_IDS) {
    const selected = resolveShellProfile(id);
    assert.equal(selected.evidence.shellInfo.CHAIN, "420aeb7c8bc6");
    assert.equal(selected.evidence.shellInfo.SHADER_SRC, "be59c864f087b377");
    assert.ok(selected.evidence.requiredPaths.includes("msl/b-420aeb7c8bc6/"));
  }
});
