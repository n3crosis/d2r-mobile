// 独立进程验证输出清零及引用释放，不依赖真实资源或主测试进程的 GC 状态。
// An isolated process verifies output wiping and reference release without real assets or parent GC state.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const adapterUrl = new URL("../asset-generator-adapter.mjs", import.meta.url).href;
test("disposed asset entries and suspended iterators release owned output buffers", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { createAssetGeneratorAdapter } from ${JSON.stringify(adapterUrl)};
      const borrowed = new Uint8Array(65537).fill(7);
      const input = new Uint8Array([83, 112, 65, 49, 31, 0]);
      let owned;
      const slice = ArrayBuffer.prototype.slice;
      ArrayBuffer.prototype.slice = function (...args) {
        const copy = slice.apply(this, args);
        if (this === borrowed.buffer) owned = new WeakRef(copy);
        return copy;
      };
      const adapter = createAssetGeneratorAdapter({
        recipes: [{ operation: "image-default-frame", input: "data/test.sprite",
          outputs: { "frame.png": "NativeHUD/test.png" } }],
        createWorker: () => ({
          run: async () => ({ files: { "frame.png": borrowed.buffer } }),
          close() {},
        }),
      });
      let entries;
      try {
        entries = await adapter.generateAssets({ extracted: {
          logicalAssets: { read: async () => input },
        } });
      } finally {
        ArrayBuffer.prototype.slice = slice;
      }
      assert.ok(owned?.deref());
      const iterator = entries[0].chunks();
      const first = await iterator.next();
      assert.equal(first.value.length, 65536);
      assert.ok(first.value.every(byte => byte === 7));
      await adapter.dispose();
      assert.ok(new Uint8Array(owned.deref()).every(byte => byte === 0));
      assert.ok(borrowed.every(byte => byte === 7));
      assert.deepEqual([...input], [83, 112, 65, 49, 31, 0]);
      assert.ok(first.value.every(byte => byte === 7));
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(resolve => setImmediate(resolve));
        globalThis.gc();
      }
      assert.equal(owned.deref(), undefined, "retained entry/iterator keeps disposed output alive");
      await assert.rejects(iterator.next(), error => error.code === "ASSET_DISPOSED");
      await assert.rejects(entries[0].chunks().next(), error => error.code === "ASSET_DISPOSED");
      assert.equal(entries[0].size, borrowed.length);
      await adapter.dispose();
      `,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
