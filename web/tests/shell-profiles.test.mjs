// 公开外壳配置及数据派生的合成拒绝检查，不使用游戏或外壳二进制。
// Synthetic rejection checks for public profiles and data derivation, without game or shell binaries.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHELL_PROFILE_ID,
  SHELL_PROFILE_IDS,
  BUNDLED_SHELL_PROFILE_IDS,
  resolveShellProfile,
} from "../shell-profiles.mjs";
import {
  D2R_RUNTIME_CONTENT_PIN,
  deriveD2rRuntimeContentMode,
} from "../d2r-runtime-content-mode.mjs";

test("closed shell registry preserves default binding and separates legacy metadata", () => {
  const current = resolveShellProfile("v1.0.18-ios26"),
    legacy = resolveShellProfile("v1.0.18-ios18");
  assert.equal(current.id, "v1.0.18-ios26");
  assert.equal(current.releaseId, "v1.0.18");
  assert.equal(current.archivePath, "profile/legacy-shell.zip");
  assert.notEqual(current.contentPin, D2R_RUNTIME_CONTENT_PIN);
  assert.deepEqual(current.guestTarget, {
    platform: "ios",
    minimumVersion: "26.0.0",
    sdkVersion: "26.0.0",
  });
  assert.deepEqual(legacy.guestTarget, {
    platform: "ios",
    minimumVersion: "18.0.0",
    sdkVersion: "26.0.0",
  });
  assert.equal(legacy.archivePath, "profile/legacy-shell-ios18.zip");
  assert.deepEqual(current.contentPin, {
    release: "v1.0.18",
    executablePath: "DmIOS",
    size: 2327536,
    originalSha256: "2d4b0299ff5d4856e12e14948da369ca35c27d2d0afd78dfed44cf4f6442b9ba",
    noDlcSha256: "0d6bae055ea5ee0571ff592ece73b90e9f3e7399fa8c59216f70a8f3707988fa",
    symbol: "_aoc_owned.v",
    address: 0x10018ef78n,
    fileOffset: 0x18ef78,
  });
  for (const id of SHELL_PROFILE_IDS) {
    const p = resolveShellProfile(id),
      e = p.evidence.entries.find((entry) => entry.path === p.capacities.evidence.executablePath);
    assert.equal(p.capacities.shellSha256, p.evidence.sha256);
    assert.equal(p.contentPin.originalSha256, e.sha256);
    assert.equal(p.contentPin.size, e.size);
    assert.equal(p.capacities.evidence.executableSha256, e.sha256);
    assert.deepEqual(p.capacities.counts, {
      EXP: 100,
      VTPART: 11,
      VTROW: 562,
      VTSET: 35,
      TAROW: 429,
    });
  }
  assert.notEqual(current.contentPin.originalSha256, legacy.contentPin.originalSha256);
  assert.notEqual(current.contentPin.fileOffset, legacy.contentPin.fileOffset);
});

test("unknown IDs, caller-owned profiles and mutation cannot cross-bind profiles", async () => {
  for (const id of [
    null,
    "ios18",
    "v1.0.18",
    "__proto__",
    "constructor",
    {},
    { id: "v1.0.18-ios18" },
  ]) {
    assert.throws(() => resolveShellProfile(id), /SHELL_PROFILE_UNKNOWN/);
    await assert.rejects(
      deriveD2rRuntimeContentMode(new Uint8Array(), { contentMode: "warlock", profileId: id }),
      /SHELL_PROFILE_UNKNOWN/,
    );
  }
  const legacy = resolveShellProfile("v1.0.18-ios18");
  assert.throws(() => {
    legacy.contentPin.fileOffset = D2R_RUNTIME_CONTENT_PIN.fileOffset;
  }, TypeError);
  assert.throws(() => {
    legacy.capacities.counts.EXP = 99;
  }, TypeError);
  assert.throws(() => {
    legacy.evidence.entries[0].sha256 = "0".repeat(64);
  }, TypeError);
  assert.throws(() => {
    SHELL_PROFILE_IDS.push("custom");
  }, TypeError);
});

test("synthetic wrong and mixed-profile executable identities reject", async () => {
  for (const id of SHELL_PROFILE_IDS) {
    const p = resolveShellProfile(id),
      other = resolveShellProfile(SHELL_PROFILE_IDS.find((candidate) => candidate !== id));
    for (const contentMode of ["warlock", "base-update-only"]) {
      await assert.rejects(
        deriveD2rRuntimeContentMode(new Uint8Array(p.contentPin.size), {
          profileId: id,
          contentMode,
        }),
        /D2R_RUNTIME_CONTENT_BINDING/,
      );
      await assert.rejects(
        deriveD2rRuntimeContentMode(new Uint8Array(other.contentPin.size), {
          profileId: id,
          contentMode,
        }),
        /D2R_RUNTIME_CONTENT_BINDING/,
      );
    }
  }
});

test("only the matched v2 pair is bundled by default, while explicit old profiles remain closed", () => {
  assert.equal(resolveShellProfile().id, DEFAULT_SHELL_PROFILE_ID);
  assert.equal(DEFAULT_SHELL_PROFILE_ID, "v2.0.0-ios26");
  assert.equal(resolveShellProfile().contentPin, D2R_RUNTIME_CONTENT_PIN);
  assert.deepEqual(BUNDLED_SHELL_PROFILE_IDS, ["v2.0.0-ios26", "v2.0.0-ios18"]);
  assert.equal(new Set(SHELL_PROFILE_IDS.map((id) => resolveShellProfile(id).archivePath)).size, 4);
  for (const id of ["v1.0.18-ios26", "v1.0.18-ios18"]) {
    const profile = resolveShellProfile(id);
    assert.deepEqual(profile.assetRecipe, { artRevision: "v1.0.18", overlayRevision: "v1.0.18" });
    assert.ok(!BUNDLED_SHELL_PROFILE_IDS.includes(id));
  }
});
