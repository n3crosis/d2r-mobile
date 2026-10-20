// 以合成清单验证封闭外壳选择，不下载外壳、不读取游戏或密钥。
// Verify closed shell selection using synthetic manifests, without shell downloads, game data or keys.
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRuntimeProfileSelection,
  prepareSealedRuntime,
} from "../sealed-runtime/clients.mjs";
import { resolveShellProfile, SHELL_PROFILE_IDS } from "../shell-profiles.mjs";
import { OPTIONAL_RUNTIME_ASSET_GROUPS } from "../runtime-asset-groups.mjs";

const common = ["assets", "texture", "translator", "extraction", "program", "spirvCross"].map(
  (name, i) => ({ path: `workers/${name}.mjs`, bytes: 32, sha256: String(i + 1).repeat(64) }),
);
function fixture({ legacy = true, packed = true, optional = false, shared = false } = {}) {
  const profiles = (legacy ? SHELL_PROFILE_IDS : SHELL_PROFILE_IDS.slice(0, 1)).map(
    resolveShellProfile,
  );
  const assets = [
    ...common.map((asset) => ({ ...asset })),
    ...profiles.map((profile) => ({
      path: profile.archivePath,
      bytes: profile.evidence.archiveBytes,
      sha256: profile.evidence.sha256,
    })),
  ];
  if (optional)
    assets.push(
      ...OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].map((path, i) => ({
        path,
        optionalGroup: "legacy-astc",
        bytes: i + 1,
        sha256: (i + 10).toString(16).padStart(64, "0"),
      })),
    );
  if (shared) {
    const alias = { ...assets.at(-1), path: "common/sha-license.txt" };
    delete alias.optionalGroup;
    assets.push(alias);
  }
  const manifest = {
    version: 1,
    assets,
    totalBytes: assets.reduce((n, asset) => n + asset.bytes, 0),
  };
  if (packed) {
    const contents = [
      ...new Map(assets.map((asset) => [`${asset.sha256}-${asset.bytes}`, asset])).values(),
    ];
    manifest.transport = {
      version: 1,
      totalBytes: contents.reduce((n, asset) => n + asset.bytes, 0),
      files: contents.map((asset, i) => ({
        path: `payloads/${i}.bin`,
        bytes: asset.bytes,
        sha256: asset.sha256,
        encoding: "identity",
        decodedBytes: asset.bytes,
      })),
      entries: contents.map((asset, i) => ({
        sha256: asset.sha256,
        bytes: asset.bytes,
        file: `payloads/${i}.bin`,
        offset: 0,
      })),
    };
  }
  return manifest;
}

test("both profiles retain every common asset and download exactly their own shell", () => {
  for (const packed of [true, false]) {
    for (const profileId of [undefined, ...SHELL_PROFILE_IDS]) {
      const manifest = fixture({ packed });
      const before = structuredClone(manifest);
      const selected = resolveShellProfile(profileId);
      const result = validateRuntimeProfileSelection(manifest, profileId);
      assert.deepEqual(
        result.selectedInventory.map((asset) => asset.path),
        [...common.map((asset) => asset.path), selected.archivePath],
      );
      assert.equal(result.inventory.length, manifest.assets.length);
      assert.equal(result.transport.files.length, manifest.assets.length);
      assert.equal(result.downloadFiles.length, common.length + 1);
      assert.equal(result.downloadBytes, 32 * common.length + selected.evidence.archiveBytes);
      assert.deepEqual(manifest, before);
    }
  }
});

test("default-only inventories remain unchanged and absent legacy fails closed", () => {
  for (const packed of [true, false]) {
    const manifest = fixture({ legacy: false, packed });
    const result = validateRuntimeProfileSelection(manifest);
    assert.deepEqual(result.selectedInventory, manifest.assets);
    assert.deepEqual(result.downloadFiles, manifest.transport?.files ?? manifest.assets);
    assert.equal(result.downloadBytes, manifest.totalBytes);
    assert.throws(
      () => validateRuntimeProfileSelection(manifest, SHELL_PROFILE_IDS[1]),
      /unavailable/,
    );
  }
});

test("unknown profile IDs reject before browser capability or network work", async () => {
  for (const profileId of [null, "", "ios18", {}, "__proto__"]) {
    assert.throws(
      () => validateRuntimeProfileSelection(fixture(), profileId),
      /SHELL_PROFILE_UNKNOWN/,
    );
    await assert.rejects(prepareSealedRuntime({ profileId }), /SHELL_PROFILE_UNKNOWN/);
  }
});

test("selected and omitted shell records must match their closed registry", () => {
  for (const profileId of SHELL_PROFILE_IDS) {
    for (const changedId of SHELL_PROFILE_IDS) {
      for (const field of ["sha256", "bytes"]) {
        const manifest = fixture({ packed: false });
        const record = manifest.assets.find(
          (asset) => asset.path === resolveShellProfile(changedId).archivePath,
        );
        if (field === "sha256") record.sha256 = "a".repeat(64);
        else {
          record.bytes++;
          manifest.totalBytes++;
        }
        assert.throws(
          () => validateRuntimeProfileSelection(manifest, profileId),
          /shell profile integrity/,
        );
      }
    }
  }
});

test("full transport and inventory validation includes the omitted shell", () => {
  for (const mutate of [
    (manifest) => {
      manifest.transport.entries.at(-1).offset = 1;
    },
    (manifest) => {
      manifest.transport.entries.pop();
    },
    (manifest) => {
      manifest.transport.files.at(-1).decodedBytes++;
    },
    (manifest) => {
      manifest.transport.totalBytes--;
    },
    (manifest) => {
      manifest.totalBytes--;
    },
  ]) {
    const manifest = fixture();
    mutate(manifest);
    assert.throws(() => validateRuntimeProfileSelection(manifest));
  }
});

test("an omitted shell cannot share a physical payload or logical content with common assets", () => {
  const manifest = fixture();
  const files = manifest.transport.files;
  const entries = manifest.transport.entries;
  const first = files[0],
    last = files.at(-1);
  entries.at(-1).file = first.path;
  entries.at(-1).offset = first.bytes;
  first.bytes += last.bytes;
  first.decodedBytes += last.decodedBytes;
  files.pop();
  assert.throws(() => validateRuntimeProfileSelection(manifest), /payload is shared/);

  const alias = fixture();
  const shell = alias.assets.at(-1);
  alias.assets.push({ ...shell, path: "common/required.bin" });
  alias.totalBytes += shell.bytes;
  assert.throws(() => validateRuntimeProfileSelection(alias), /payload is shared/);
});

test("packed progress reports selected wire bytes, not decoded logical bytes", () => {
  const manifest = fixture();
  const shell = manifest.transport.files.at(-2);
  manifest.transport.totalBytes -= shell.bytes - 100;
  shell.bytes = 100;
  shell.encoding = "gzip";
  const result = validateRuntimeProfileSelection(manifest);
  assert.equal(result.downloadBytes, common.length * 32 + 100);
  assert.ok(result.downloadBytes < manifest.totalBytes);
});

test("both shell selections omit optional codec downloads unless explicitly selected", () => {
  for (const packed of [false, true])
    for (const profileId of SHELL_PROFILE_IDS) {
      const manifest = fixture({ optional: true, packed }),
        baseline = validateRuntimeProfileSelection(fixture({ packed }), profileId),
        before = structuredClone(manifest),
        defaultSelection = validateRuntimeProfileSelection(manifest, profileId),
        enabled = validateRuntimeProfileSelection(manifest, profileId, {
          optionalGroups: ["legacy-astc"],
        });
      assert.deepEqual(defaultSelection.downloadFiles, baseline.downloadFiles);
      assert.equal(defaultSelection.downloadBytes, baseline.downloadBytes);
      assert.deepEqual(defaultSelection.selectedInventory, baseline.selectedInventory);
      assert.equal(
        enabled.selectedInventory.length,
        baseline.selectedInventory.length + OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].length,
      );
      assert.equal(
        enabled.selectedInventory.filter((asset) => asset.path.startsWith("profile/shell")).length,
        1,
      );
      assert.ok(enabled.downloadBytes > defaultSelection.downloadBytes);
      assert.deepEqual(manifest, before);
    }
});

test("optional shared license content stays common without duplicate downloads", () => {
  const manifest = fixture({ optional: true, shared: true }),
    selected = validateRuntimeProfileSelection(manifest),
    enabled = validateRuntimeProfileSelection(manifest, undefined, {
      optionalGroups: ["legacy-astc"],
    });
  assert.ok(selected.selectedInventory.some((asset) => asset.path === "common/sha-license.txt"));
  assert.ok(selected.selectedInventory.every((asset) => !asset.optionalGroup));
  assert.equal(
    enabled.downloadFiles.length - selected.downloadFiles.length,
    OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].length - 1,
  );
});

test("malformed omitted codec closure, mixed packs, and invalid group selection fail closed", () => {
  for (const packed of [false, true]) {
    const incomplete = fixture({ optional: true, packed });
    delete incomplete.assets.at(-1).optionalGroup;
    assert.throws(() => validateRuntimeProfileSelection(incomplete), /optional runtime asset/);
    assert.throws(
      () =>
        validateRuntimeProfileSelection(fixture({ packed }), undefined, {
          optionalGroups: ["legacy-astc"],
        }),
      /unavailable/,
    );
    assert.throws(
      () =>
        validateRuntimeProfileSelection(fixture({ optional: true, packed }), undefined, {
          optionalGroups: ["unknown"],
        }),
      /group selection/,
    );
  }
  const mixed = fixture({ optional: true }),
    files = mixed.transport.files,
    common = files[0],
    optional = files.at(-1);
  mixed.transport.entries.at(-1).file = common.path;
  mixed.transport.entries.at(-1).offset = common.bytes;
  common.bytes += optional.bytes;
  common.decodedBytes += optional.decodedBytes;
  files.pop();
  assert.throws(() => validateRuntimeProfileSelection(mixed), /payload is shared/);
});
