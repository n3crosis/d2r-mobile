// 用合成公开记录验证可选编解码器闭包与内容归属；不构建或下载编解码器。
// Verify optional codec closure and content ownership with synthetic public records; no codec builds or downloads.
import test from "node:test";
import assert from "node:assert/strict";
import {
  OPTIONAL_RUNTIME_ASSET_GROUPS,
  runtimeContentKey,
  selectRuntimeAssetGroups,
  validateRuntimeAssetGroups,
  validateRuntimeTransportGroups,
} from "../runtime-asset-groups.mjs";

const common = { path: "common.mjs", bytes: 20, sha256: "a".repeat(64) };
const optional = () =>
  OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].map((path, i) => ({
    path,
    optionalGroup: "legacy-astc",
    bytes: i + 1,
    sha256: String(i).repeat(64),
  }));

test("unmarked existing assets remain common and optional selection defaults off", () => {
  assert.deepEqual(selectRuntimeAssetGroups([common]), [common]);
  const assets = [common, ...optional()],
    before = structuredClone(assets);
  assert.deepEqual(selectRuntimeAssetGroups(assets), [common]);
  assert.deepEqual(selectRuntimeAssetGroups(assets, ["legacy-astc"]), assets);
  assert.deepEqual(assets, before);
  assert.equal(validateRuntimeAssetGroups(assets).get(runtimeContentKey(common)), "");
});

test("only complete exact compiled codec paths can be marked optional", () => {
  for (const mutate of [
    (assets) => assets.pop(),
    (assets) => assets.push({ ...assets[0] }),
    (assets) => delete assets[0].optionalGroup,
    (assets) => (assets[0].optionalGroup = "unknown"),
    (assets) => (assets[0].optionalGroup = null),
    (assets) => (assets[0].optionalGroup = ""),
    (assets) => (assets[0].path = "../escape"),
    (assets) => (assets[0].path = "toolchain/asset-runtime-js/dist/png-codec.wasm"),
    (assets) => assets.push({ ...common, optionalGroup: "legacy-astc" }),
    (assets) => assets.push({ ...common, path: "profile/shell.zip", optionalGroup: "legacy-astc" }),
  ]) {
    const assets = optional();
    mutate(assets);
    assert.throws(() => validateRuntimeAssetGroups(assets), /optional runtime asset/);
  }
});

test("unknown, malformed, duplicate and unavailable requested groups reject", () => {
  for (const selection of [
    null,
    "legacy-astc",
    {},
    [null],
    [""],
    ["__proto__"],
    ["unknown"],
    ["legacy-astc", "legacy-astc"],
  ])
    assert.throws(() => selectRuntimeAssetGroups(optional(), selection), /group selection/);
  assert.throws(() => selectRuntimeAssetGroups([common], ["legacy-astc"]), /unavailable/);
});

test("shared common content wins independently of asset order", () => {
  const assets = optional(),
    alias = { ...assets[2], path: "common/license.txt" };
  delete alias.optionalGroup;
  for (const inventory of [
    [alias, ...assets],
    [...assets, alias],
  ]) {
    const ownership = validateRuntimeAssetGroups(inventory);
    assert.equal(ownership.size, assets.length);
    assert.equal(ownership.get(runtimeContentKey(alias)), "");
    assert.equal(ownership.get(runtimeContentKey(assets[0])), "legacy-astc");
  }
});

test("mixed physical payloads reject, including when optional groups are not selected", () => {
  const assets = [common, ...optional()],
    entries = assets.map((asset, i) => ({ ...asset, file: `payloads/${i}.bin`, offset: 0 }));
  validateRuntimeTransportGroups(assets, entries);
  entries[1].file = entries[0].file;
  assert.throws(() => validateRuntimeTransportGroups(assets, entries), /payload is shared/);
  entries[1] = { ...entries[1], sha256: "f".repeat(64) };
  assert.throws(() => validateRuntimeTransportGroups(assets, entries), /Unknown/);
});
