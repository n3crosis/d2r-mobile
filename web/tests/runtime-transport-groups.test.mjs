// 验证可选组按内容归属隔离传输包，保持旧打包格式及字节不变。
// Verify content-owned optional pack isolation while preserving the legacy packing format and bytes.
import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  OPTIONAL_RUNTIME_ASSET_GROUPS,
  runtimeContentKey,
  validateRuntimeAssetGroups,
  selectRuntimeAssetGroups,
} from "../runtime-asset-groups.mjs";
import {
  createRuntimeTransport,
  validateRuntimeTransport,
  verifyTransportPayload,
} from "../runtime-build/transport.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture({ optional = true, shared = false, large = false } = {}) {
  const assets = [],
    contents = new Map();
  function add(path, data, optionalGroup) {
    const bytes = Buffer.from(data),
      record = { path, sha256: sha(bytes), bytes: bytes.length };
    if (optionalGroup !== undefined) record.optionalGroup = optionalGroup;
    assets.push(record);
    contents.set(runtimeContentKey(record), { ...record, data: bytes });
  }
  add("common/worker.mjs", "common worker");
  add("toolchain/asset-runtime-js/dist/png-codec.wasm", "common codec");
  if (optional)
    OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"].forEach((path, i) =>
      add(
        path,
        large && i === 1 ? Buffer.alloc(300 * 1024, 1) : `optional codec ${i}`,
        "legacy-astc",
      ),
    );
  if (shared) add("common/license.txt", "optional codec 2");
  return { assets, contents };
}
function manifest(assets, transport) {
  return {
    version: 1,
    assets,
    totalBytes: assets.reduce((n, asset) => n + asset.bytes, 0),
    transport,
  };
}

test("no-group transport remains byte-for-byte identical with no additional schema fields", () => {
  const { assets, contents } = fixture({ optional: false }),
    previous = createRuntimeTransport(contents),
    grouped = createRuntimeTransport(contents, { assets });
  assert.deepEqual(grouped, previous);
  const sorted = [...contents.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    decoded = Buffer.concat(sorted.map((record) => record.data)),
    gzip = gzipSync(decoded, { level: 9 }),
    encoding = gzip.length < decoded.length ? "gzip" : "identity",
    data = encoding === "gzip" ? gzip : decoded,
    path = `payloads/${sha(data)}.${encoding === "gzip" ? "gz" : "bin"}`;
  assert.deepEqual(previous.payloads, new Map([[path, data]]));
  assert.deepEqual(previous.transport.files, [
    { path, bytes: data.length, sha256: sha(data), encoding, decodedBytes: decoded.length },
  ]);
  assert.deepEqual(Object.keys(previous.transport).sort(), [
    "entries",
    "files",
    "totalBytes",
    "version",
  ]);
});

test("small and large optional codec payloads never change common transport bytes", () => {
  for (const shared of [false, true])
    for (const large of [false, true]) {
      const { assets, contents } = fixture({ shared, large }),
        common = fixture({ optional: false, shared }),
        baseline = createRuntimeTransport(common.contents),
        result = createRuntimeTransport(contents, { assets }),
        files = validateRuntimeTransport(manifest(assets, result.transport)),
        ownership = validateRuntimeAssetGroups(assets);
      for (const file of files.values())
        verifyTransportPayload(file, result.payloads.get(file.path));
      const commonFiles = new Set(
        result.transport.entries
          .filter((entry) => ownership.get(runtimeContentKey(entry)) === "")
          .map((entry) => entry.file),
      );
      assert.deepEqual(
        new Map([...result.payloads].filter(([path]) => commonFiles.has(path))),
        baseline.payloads,
      );
      for (const file of files.values())
        assert.equal(
          new Set(file.entries.map((entry) => ownership.get(runtimeContentKey(entry)))).size,
          1,
        );
      assert.equal(result.transport.entries.length, contents.size);
    }
});

test("group metadata and logical transport source contents must agree exactly", () => {
  const { assets, contents } = fixture();
  assert.throws(
    () => createRuntimeTransport(contents, { assets: assets.slice(1) }),
    /inventory mismatch/,
  );
  const extra = [...assets, { path: "extra.bin", bytes: 3, sha256: "f".repeat(64) }];
  assert.throws(() => createRuntimeTransport(contents, { assets: extra }), /inventory mismatch/);
  assert.throws(
    () => createRuntimeTransport(contents, { assets: assets.slice(0, -1) }),
    /Incomplete/,
  );
});

test("full validator rejects a syntactically valid mixed payload and incomplete optional metadata", () => {
  const { assets, contents } = fixture(),
    mixed = createRuntimeTransport(contents);
  assert.throws(
    () => validateRuntimeTransport(manifest(assets, mixed.transport)),
    /payload is shared/,
  );
  const valid = createRuntimeTransport(contents, { assets }),
    changed = structuredClone(assets);
  delete changed.at(-1).optionalGroup;
  assert.throws(
    () => validateRuntimeTransport(manifest(changed, valid.transport)),
    /optional runtime asset/,
  );
});

test("shared signing and ASTC bytes cannot drag an unselected optional payload into downloads", () => {
  const { assets, contents } = fixture();
  // 将一个仅可选内容记录与签名许可证共用，不与公共字节共用。
  // Share one optional-only content record with a signing license, not with common bytes.
  const shared = contents.get(runtimeContentKey(assets[4]));
  OPTIONAL_RUNTIME_ASSET_GROUPS["ipa-signing"].forEach((path, i) => {
    const data = i === 2 ? shared.data : Buffer.from(`signing asset ${i}`);
    const record = { path, optionalGroup: "ipa-signing", bytes: data.length, sha256: sha(data) };
    assets.push(record);
    contents.set(runtimeContentKey(record), { ...record, data });
  });
  const first = createRuntimeTransport(contents, { assets });
  assert.deepEqual(createRuntimeTransport(contents, { assets: [...assets].reverse() }), first);
  validateRuntimeTransport(manifest(assets, first.transport));
  for (const optionalGroups of [
    [],
    ["ipa-signing"],
    ["legacy-astc"],
    ["ipa-signing", "legacy-astc"],
  ]) {
    const selectedKeys = new Set(
      selectRuntimeAssetGroups(assets, optionalGroups).map(runtimeContentKey),
    );
    const selectedFiles = new Set(
      first.transport.entries
        .filter((entry) => selectedKeys.has(runtimeContentKey(entry)))
        .map((entry) => entry.file),
    );
    for (const entry of first.transport.entries)
      if (selectedFiles.has(entry.file))
        assert.ok(
          selectedKeys.has(runtimeContentKey(entry)),
          "selected physical payload contains only selected content",
        );
  }
  const ownership = validateRuntimeAssetGroups(assets);
  assert.equal(ownership.get(runtimeContentKey(shared)), "ipa-signing|legacy-astc");
  const common = { ...shared, path: "common/shared-license.txt" };
  delete common.optionalGroup;
  for (const records of [
    [common, ...assets],
    [...assets, common],
  ])
    assert.equal(validateRuntimeAssetGroups(records).get(runtimeContentKey(shared)), "");
});

test("two v2-sized synthetic archives each own one transport payload, without legacy archives", () => {
  const assets = [],
    contents = new Map();
  for (const [path, size, fill] of [
    ["common/metadata.json", 32, 1],
    ["profile/shell.zip", 4856775, 2],
    ["profile/shell-ios18.zip", 4852823, 3],
  ]) {
    const data = Buffer.alloc(size, fill),
      record = { path, bytes: data.length, sha256: sha(data) };
    assets.push(record);
    contents.set(runtimeContentKey(record), { ...record, data });
  }
  const { transport, payloads } = createRuntimeTransport(contents, { assets });
  const files = validateRuntimeTransport(manifest(assets, transport));
  for (const file of files.values()) verifyTransportPayload(file, payloads.get(file.path));
  assert.equal(files.size, 3);
  const archiveFiles = new Set();
  for (const asset of assets.filter((asset) => asset.path.startsWith("profile/"))) {
    const entry = transport.entries.find(
      (entry) => runtimeContentKey(entry) === runtimeContentKey(asset),
    );
    assert.equal(entry.offset, 0);
    assert.equal(files.get(entry.file).entries.length, 1);
    assert.equal(files.get(entry.file).decodedBytes, asset.bytes);
    archiveFiles.add(entry.file);
  }
  assert.equal(archiveFiles.size, 2);
  assert.ok(!assets.some((asset) => asset.path.includes("legacy-shell")));
});
