// 验证 v61-asset-worker 的约定与边界；依据 ../v61-asset-worker.mjs、../asset-generator-adapter.mjs 及本文件的测试断言。
// Verify v61-asset-worker contracts and boundaries against ../v61-asset-worker.mjs、../asset-generator-adapter.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createV61AssetWorker,
  decodedV61ToInternalRgba,
  TextureWorkerClient,
} from "../v61-asset-worker.mjs";
import { createAssetGeneratorAdapter } from "../asset-generator-adapter.mjs";
function fixture() {
  const input = new Uint8Array(56);
  input.set([83, 112, 65, 49, 61, 0, 1, 0]);
  const view = new DataView(input.buffer);
  view.setUint32(8, 2, true);
  view.setUint32(12, 1, true);
  const decoded = {
    width: 2,
    height: 1,
    frameWidth: 1,
    pixelFormat: 70,
    bytesPerPixel: 4,
    pixels: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  };
  return { input, decoded };
}
test("internal RGBA bridge preserves dimensions/frame pixels without claiming v61 encoding", () => {
  const { input, decoded } = fixture();
  const bytes = decodedV61ToInternalRgba(input, decoded);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(4, true), 31);
  assert.equal(view.getUint16(6, true), 1);
  assert.equal(view.getUint32(20, true), 2);
  assert.deepEqual(bytes.subarray(40), decoded.pixels);
  assert.throws(() => decodedV61ToInternalRgba(input, { ...decoded, pixelFormat: 1 }));
  assert.throws(() => decodedV61ToInternalRgba(input, { ...decoded, pixels: new Uint8Array(4) }));
});
test("composed worker emits PNG only for v61 and erases temporary RGBA", async () => {
  const { input, decoded } = fixture();
  let intermediate,
    closed = 0;
  const worker = createV61AssetWorker({
    textureWorker: { decodeV61: async () => decoded, close: () => closed++ },
    assetWorker: {
      run: async (op, bytes, options) => {
        assert.equal(op, "image-default-frame");
        assert.equal(options.frame, 1);
        intermediate = bytes;
        return {
          files: {
            "frame.png": new ArrayBuffer(1),
            "frame.sprite": new ArrayBuffer(48),
            "frame.rgba": new ArrayBuffer(8),
          },
        };
      },
      close: () => closed++,
    },
  });
  const result = await worker.run("image-default-frame", input, { frame: 1 });
  assert.deepEqual(Object.keys(result.files), ["frame.png"]);
  assert.equal(result.sourceVersion, 61);
  assert.ok(intermediate.every((x) => x === 0));
  assert.ok(decoded.pixels.every((x) => x === 0));
  assert.equal(input[4], 61);
  worker.close();
  worker.close();
  assert.equal(closed, 2);
});
test("texture client uses real worker wire contract and does not detach input", async () => {
  const { input, decoded } = fixture();
  let stopped = false;
  const transport = {
    postMessage(message, transfer) {
      assert.equal(message.operation, "decodeV61");
      assert.notEqual(message.source.buffer, input.buffer);
      assert.equal(transfer[0], message.source.buffer);
      queueMicrotask(() =>
        transport.onmessage({ data: { id: message.id, ok: true, result: decoded } }),
      );
    },
    terminate() {
      stopped = true;
    },
  };
  const client = new TextureWorkerClient(transport);
  assert.equal(await client.decodeV61(input), decoded);
  client.close();
  assert.equal(stopped, true);
});
test("v61 packaging requires explicit opt-in and forbids sprite output even when enabled", async () => {
  const { input } = fixture();
  const make = (enableV61Png, output) =>
    createAssetGeneratorAdapter({
      enableV61Png,
      createWorker: () => ({
        capabilities: { v61Png: true },
        run: async () => ({ files: { "frame.png": new ArrayBuffer(1) } }),
        close() {},
      }),
      recipes: [{ operation: "image-default-frame", input: "data/test.sprite", outputs: output }],
    });
  const context = { extracted: { logicalAssets: { read: async () => input } } };
  await assert.rejects(make(false, { "frame.png": "test.png" }).generateAssets(context), {
    code: "ASSET_V61_NOT_CONNECTED",
  });
  await assert.rejects(make(true, { "frame.sprite": "test.sprite" }).generateAssets(context), {
    code: "ASSET_V61_SPRITE_UNSUPPORTED",
  });
  const adapter = make(true, { "frame.png": "test.png" });
  assert.equal((await adapter.generateAssets(context))[0].size, 1);
  await adapter.dispose();
});

test("v61 bridge wipes late decoded pixels after close without starting asset conversion", async () => {
  const { input, decoded } = fixture();
  const before = input.slice();
  let finishDecode,
    runs = 0;
  const worker = createV61AssetWorker({
    textureWorker: {
      decodeV61: () =>
        new Promise((resolve) => {
          finishDecode = resolve;
        }),
      close() {},
    },
    assetWorker: {
      run() {
        runs++;
      },
      close() {},
    },
  });
  const pending = worker.run("image-default-frame", input);
  worker.close();
  finishDecode(decoded);
  await assert.rejects(pending, { message: "V61_ASSET_BRIDGE_FAILED" });
  assert.equal(runs, 0);
  assert.ok(decoded.pixels.every((value) => value === 0));
  assert.deepEqual(input, before);
});

test("v61 bridge wipes decoded pixels when geometry validation rejects before conversion", async () => {
  for (const mismatch of [{ width: 3 }, { pixelFormat: 1 }, { pixels: new Uint8Array([9]) }]) {
    const { input, decoded } = fixture();
    Object.assign(decoded, mismatch);
    const before = input.slice();
    let runs = 0;
    const worker = createV61AssetWorker({
      textureWorker: { decodeV61: async () => decoded, close() {} },
      assetWorker: {
        run() {
          runs++;
        },
        close() {},
      },
    });
    await assert.rejects(worker.run("image-default-frame", input), {
      message: "V61_ASSET_BRIDGE_FAILED",
    });
    assert.equal(runs, 0);
    assert.ok(decoded.pixels.every((value) => value === 0));
    assert.deepEqual(input, before);
    worker.close();
  }
});

test("v61 bridge preserves safe rejection for absent or nonbyte decoded pixels", async () => {
  for (const decoded of [null, {}, { pixels: {} }]) {
    const { input } = fixture();
    const worker = createV61AssetWorker({
      textureWorker: { decodeV61: async () => decoded, close() {} },
      assetWorker: {
        run() {
          assert.fail("invalid decoding must not convert");
        },
        close() {},
      },
    });
    await assert.rejects(worker.run("image-default-frame", input), {
      message: "V61_ASSET_BRIDGE_FAILED",
    });
    worker.close();
  }
});

test("v61 bridge wipes owned rejected worker outputs but preserves caller aliases", async () => {
  for (const invalid of [false, true]) {
    const { input, decoded } = fixture();
    const before = input.slice();
    const png = new Uint8Array([8, 9]);
    const sprite = new Uint8Array([10, 11]);
    let finish, started;
    const running = new Promise((resolve) => {
      started = resolve;
    });
    const worker = createV61AssetWorker({
      textureWorker: { decodeV61: async () => decoded, close() {} },
      assetWorker: {
        run() {
          started();
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
        close() {},
      },
    });
    const pending = worker.run("image-default-frame", input);
    await running;
    if (!invalid) worker.close();
    finish({
      files: {
        "frame.png": invalid ? png : png.buffer,
        "frame.sprite": sprite.buffer,
        "caller-alias": input.buffer,
      },
    });
    await assert.rejects(pending, { message: "V61_ASSET_BRIDGE_FAILED" });
    assert.ok(png.every((value) => value === 0));
    assert.ok(sprite.every((value) => value === 0));
    assert.deepEqual(input, before);
    worker.close();
  }
});

test("accepted v61 PNG output remains intact after bridge cleanup", async () => {
  const { input, decoded } = fixture();
  const png = new Uint8Array([1, 2, 3]);
  const worker = createV61AssetWorker({
    textureWorker: { decodeV61: async () => decoded, close() {} },
    assetWorker: {
      run: async () => ({ files: { "frame.png": png.buffer } }),
      close() {},
    },
  });
  const result = await worker.run("image-default-frame", input);
  assert.equal(result.files["frame.png"], png.buffer);
  assert.deepEqual(png, new Uint8Array([1, 2, 3]));
  worker.close();
  assert.deepEqual(png, new Uint8Array([1, 2, 3]));
});
