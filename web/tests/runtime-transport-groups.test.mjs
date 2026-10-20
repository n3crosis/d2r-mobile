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
