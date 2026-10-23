// 验证 native-art-png-digests 的约定与边界；依据 ../native-art-png-digests.mjs 及本文件的测试断言。
// Verify native-art-png-digests contracts and boundaries against ../native-art-png-digests.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { acceptsNativeArtPngDigest } from "../native-art-png-digests.mjs";

test("browser PNG digest is accepted only with its matching frozen atlas pin", () => {
  const asset = {
    asset: "dm_native_skill_0.png",
    decoded_png_sha256: "15f751a2499a798509ab4746780414527b3405c8afc78b654e34cdadaf868617",
  };
  const browser = "a9e5a63e6eee6cf44cd96e77ad59f6067dc09dcf6d2bcd2bf77200327e6928e9";
  assert.equal(acceptsNativeArtPngDigest(asset, asset.decoded_png_sha256), true);
  assert.equal(acceptsNativeArtPngDigest(asset, browser), true);
  assert.equal(
    acceptsNativeArtPngDigest({ ...asset, decoded_png_sha256: "0".repeat(64) }, browser),
    false,
  );
  assert.equal(acceptsNativeArtPngDigest({ ...asset, asset: "other.png" }, browser), false);
  assert.equal(acceptsNativeArtPngDigest(asset, "0".repeat(64)), false);
});
