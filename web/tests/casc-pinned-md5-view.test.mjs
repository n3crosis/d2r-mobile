// 合成 TVFS 输入验证固定 MD5 适配器只散列视图范围；不加载游戏数据或 WASM。
// Synthetic TVFS input verifies the pinned MD5 adapter hashes only the view; no game data or WASM.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import SparkMD5 from "../vendor/spark-md5-3.0.2/spark-md5.mjs";
import {
  createCascOverlayTransform,
  createPinnedCascOverlayTransform,
} from "../toolchain/casc-overlay-js/overlay.mjs";

const compress = (bytes) => new Uint8Array(deflateSync(bytes, { level: 9 }));

test("pinned CASC MD5 hashes exact Buffer subviews rather than unrelated backing bytes", async () => {
  const fixture = spawnSync(
    "python3",
    [fileURLToPath(new URL("../toolchain/casc-overlay-js/test/fixture.py", import.meta.url))],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(fixture.status, 0, fixture.stderr);
  const request = JSON.parse(fixture.stdout);
  const payload = Buffer.from(request.payload, "base64");
  const oracle = createCascOverlayTransform({
    md5: (bytes) => new Uint8Array(createHash("md5").update(bytes).digest()),
    compress,
  });
  const expected = await oracle(new Uint8Array(payload), request.options);
  const generate = createPinnedCascOverlayTransform({
    codec: { genericZlibVersion: "1.2.13", compressZlib: compress },
    SparkMD5,
  });
  for (const padding of [0, 19]) {
    const backing = Buffer.alloc(payload.length + padding * 2, 0xa7);
    backing.set(payload, padding);
    const actual = await generate(
      backing.subarray(padding, padding + payload.length),
      request.options,
    );
    assert.deepEqual(actual.inventory, expected.inventory);
    assert.deepEqual(Object.keys(actual.files).sort(), Object.keys(expected.files).sort());
    for (const name of Object.keys(expected.files))
      assert.deepEqual(
        new Uint8Array(actual.files[name]),
        new Uint8Array(expected.files[name]),
        name,
      );
    assert.ok(backing.subarray(0, padding).every((byte) => byte === 0xa7));
    assert.ok(backing.subarray(padding + payload.length).every((byte) => byte === 0xa7));
  }
});
