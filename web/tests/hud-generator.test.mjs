import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateHud, HUD_LOGICAL_INPUTS } from "../hud-generator.mjs";
import {
  RELEASE_ART_REVISION,
  UPSTREAM_ART_REVISION,
} from "../toolchain/art-recipes-js/revision.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
function fixture() {
  const png = new Uint8Array([1, 2, 3]);
  const assets = Array.from({ length: 9 }, (_, i) => ({
    asset: `dm_native_skill_${i}.png`,
    atlas_px: [1, 1],
    decoded_png_sha256: sha(png),
  }));
  const metadata = { manifest: JSON.stringify({ assets }), i18n: "authored", patch: "{}" };
  const reads = [];
  return {
    reads,
    mode: "switch-upscaled",
    metadata,
    metadataSha256: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, sha(v)])),
    nativeArtFiles: Object.fromEntries(assets.map((a) => [a.asset, png.slice()])),
    logicalAssets: {
      async read(path, options) {
        reads.push({ path, options });
        return new TextEncoder().encode(path.endsWith(".json") ? "{}" : "authored bytes");
      },
    },
    decodeAtlas: async () => ({
      width: 1,
      height: 1,
      pixelFormat: 70,
      bytesPerPixel: 4,
      pixels: new Uint8Array([1, 2, 3, 255]),
    }),
    assetWorker: {
      async run(op, payload, options) {
        assert.equal(op, "hud-v4");
        assert.equal(options.mode, "switch-upscaled");
        assert.equal(options.revision, undefined);
        const bundle = JSON.parse(new TextDecoder().decode(payload));
        assert.deepEqual(Object.keys(bundle.fonts).sort(), [
          "blizzardglobal-v5_81.ttf",
          "exocetblizzardot-medium.otf",
        ]);
        return {
          files: {
            "base.png": new ArrayBuffer(1),
            "hud.json": new ArrayBuffer(1),
            "hud_v4_ui/ui.json": new ArrayBuffer(1),
          },
        };
      },
    },
  };
}
test("complete HUD obtains both fonts from exact logical archive paths", async () => {
  const f = fixture();
  await generateHud(f);
  assert.deepEqual(
    f.reads.map((r) => r.path),
    HUD_LOGICAL_INPUTS,
  );
  assert.ok(f.reads.every((r) => r.options.maxBytes <= 16 * 1024 * 1024));
  assert.deepEqual(f.nativeArtFiles["dm_native_skill_0.png"], new Uint8Array([1, 2, 3]));
});
test("HUD rejects undeclared PC mode, wrong metadata and prior-stage atlas corruption", async () => {
  let f = fixture();
  f.mode = "pc";
  await assert.rejects(generateHud(f), /MODE_REQUIRED/);
  assert.equal(f.reads.length, 0);
  f = fixture();
  f.metadata.patch = "changed";
  await assert.rejects(generateHud(f), /METADATA_HASH/);
  f = fixture();
  f.nativeArtFiles["dm_native_skill_3.png"][0] = 5;
  await assert.rejects(generateHud(f), /ATLAS_HASH/);
});
test("HUD propagates missing archive font instead of substituting an OS font", async () => {
  const f = fixture();
  const read = f.logicalAssets.read;
  f.logicalAssets.read = async (path, options) => {
    if (path.endsWith(".otf")) throw new Error("font absent");
    return read(path, options);
  };
  await assert.rejects(generateHud(f), /font absent/);
});

test("HUD forwards only a recognized explicit internal source revision", async () => {
  for (const revision of [RELEASE_ART_REVISION, UPSTREAM_ART_REVISION]) {
    const f = fixture();
    f.recipeRevision = revision;
    const run = f.assetWorker.run;
    f.assetWorker.run = async (operation, payload, options) => {
      assert.equal(options.revision, revision);
      const { revision: _revision, ...legacyOptions } = options;
      return run(operation, payload, legacyOptions);
    };
    await generateHud(f);
  }
  const invalid = fixture();
  invalid.recipeRevision = "v2";
  await assert.rejects(generateHud(invalid), /RECIPE_REVISION/);
  assert.equal(invalid.reads.length, 0);
});
