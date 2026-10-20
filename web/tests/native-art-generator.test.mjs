import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateNativeArt } from "../native-art-generator.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
function fixture() {
  const bytes = new Uint8Array([1, 2, 3]);
  const manifest = {
    official_tables: ["skills.txt", "skilldesc.txt"].map((file) => ({ file, sha256: sha(bytes) })),
    assets: Array.from({ length: 9 }, (_, i) => ({
      asset: `dm_native_skill_${i}.png`,
      official_path: `data:data/hd/authored/${i}.sprite`,
      official_sprite_sha256: sha(bytes),
      atlas_px: [1, 1],
    })),
  };
  const metadata = {
    manifest: JSON.stringify(manifest),
    geometry: "{}",
    binding: "{}",
    implementation: "/* authored */",
  };
  const metadataSha256 = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, sha(v)]));
  const reads = [];
  const files = Object.fromEntries(
    [...manifest.assets.map((a) => a.asset), "dm_touch_native_art.c"].map((n) => [
      n,
      new ArrayBuffer(1),
    ]),
  );
  return {
    metadata,
    metadataSha256,
    reads,
    files,
    logicalAssets: {
      async read(path, options) {
        reads.push({ path, ...options });
        return bytes.slice();
      },
    },
    decodeAtlas: async () => ({
      width: 1,
      height: 1,
      pixels: new Uint8Array([1, 2, 3, 4]),
      pixelFormat: 70,
      bytesPerPixel: 4,
    }),
    assetWorker: {
      async run(op, payload, options) {
        assert.equal(op, "native-art");
        const bundle = JSON.parse(new TextDecoder().decode(payload));
        assert.equal(Object.keys(bundle.raw).length, 11);
        assert.equal(Object.keys(bundle.rgba).length, 9);
        assert.deepEqual(options, { metadataSha256 });
        return { files };
      },
    },
  };
}
test("native art reads the entire named inventory and emits no partial set", async () => {
  const f = fixture();
  assert.equal((await generateNativeArt(f)).files, f.files);
  assert.equal(f.reads.length, 11);
  assert.ok(f.reads.every((r) => r.maxBytes <= 8 * 1024 * 1024));
});
test("native art rejects untrusted metadata before logical reads", async () => {
  const f = fixture();
  f.metadata.binding = "changed";
  await assert.rejects(generateNativeArt(f), /METADATA_HASH/);
  assert.equal(f.reads.length, 0);
});
test("native art rejects source hash, output omissions, bad decoded dimensions and cancellation", async () => {
  let f = fixture();
  f.logicalAssets.read = async () => new Uint8Array([0]);
  await assert.rejects(generateNativeArt(f), /SOURCE_HASH/);
  f = fixture();
  delete f.files["dm_native_skill_8.png"];
  await assert.rejects(generateNativeArt(f), /OUTPUT_SET/);
  f = fixture();
  f.decodeAtlas = async () => ({ width: 2, height: 1, pixels: new Uint8Array(8) });
  await assert.rejects(generateNativeArt(f), /DECODE_GEOMETRY/);
  f = fixture();
  const controller = new AbortController();
  controller.abort();
  f.signal = controller.signal;
  await assert.rejects(generateNativeArt(f), /CANCELLED/);
  assert.equal(f.reads.length, 0);
});
