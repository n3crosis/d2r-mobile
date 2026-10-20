// 以合成清单验证封闭外壳选择，不下载外壳、不读取游戏或密钥。
// Verify closed shell selection using synthetic manifests, without shell downloads, game data or keys.
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRuntimeProfileSelection,
  prepareSealedRuntime,
} from "../sealed-runtime/clients.mjs";
import { resolveShellProfile, SHELL_PROFILE_IDS } from "../shell-profiles.mjs";

const common = ["assets", "texture", "translator", "extraction", "program", "spirvCross"].map(
  (name, i) => ({ path: `workers/${name}.mjs`, bytes: 32, sha256: String(i + 1).repeat(64) }),
);
function fixture({ legacy = true, packed = true } = {}) {
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
  const manifest = {
    version: 1,
    assets,
    totalBytes: assets.reduce((n, asset) => n + asset.bytes, 0),
  };
  if (packed) {
    manifest.transport = {
      version: 1,
      totalBytes: manifest.totalBytes,
      files: assets.map((asset, i) => ({
        path: `payloads/${i}.bin`,
        bytes: asset.bytes,
        sha256: asset.sha256,
        encoding: "identity",
        decodedBytes: asset.bytes,
      })),
      entries: assets.map((asset, i) => ({
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
