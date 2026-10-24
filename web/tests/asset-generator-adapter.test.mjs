// 验证 asset-generator-adapter 的约定与边界；依据 ../asset-generator-adapter.mjs 及本文件的测试断言。
// Verify asset-generator-adapter contracts and boundaries against ../asset-generator-adapter.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createAssetGeneratorAdapter,
  ASSET_ADAPTER_CAPABILITIES,
  ASSET_ADAPTER_LIMITS,
} from "../asset-generator-adapter.mjs";

const recipe = (outputs = { "frame.png": "NativeHUD/test.png" }) => ({
  operation: "image-default-frame",
  input: "data/Synthetic/test.sprite",
  frame: 1,
  outputs,
});
function fixture(options = {}) {
  const calls = [];
  let closed = 0;
  const output = new Uint8Array([1, 2, 3, 4]);
  const worker = {
    run: async (...args) => {
      calls.push(["worker", ...args]);
      return { files: { "frame.png": output.buffer, "frame.sprite": new Uint8Array([5]).buffer } };
    },
    close: () => closed++,
    ...options.worker,
  };
  const reader = {
    read: async (...args) => {
      calls.push(["reader", ...args]);
      return new Uint8Array([83, 112, 65, 49, 31, 0]);
    },
    ...options.reader,
  };
  const adapter = createAssetGeneratorAdapter({
    recipes: options.recipes ?? [recipe()],
    createWorker: () => worker,
  });
  return {
    adapter,
    calls,
    output,
    reader,
    get closed() {
      return closed;
    },
  };
}
async function collect(entry) {
  const result = [];
  for await (const bytes of entry.chunks()) result.push(...bytes);
  return result;
}
test("bounded logical read and existing worker become app-relative streamed entries", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const entries = await f.adapter.generateAssets({
    extracted: { logicalAssets: f.reader },
    signal,
  });
  assert.equal(entries[0].path, "NativeHUD/test.png");
  assert.equal(entries[0].mode, 0o100644);
  assert.equal(entries[0].size, 4);
  assert.equal(f.calls[0][1], "data/synthetic/test.sprite");
  assert.deepEqual(f.calls[0][2], { maxBytes: ASSET_ADAPTER_LIMITS.inputBytes, signal });
  assert.equal(f.calls[1][1], "image-default-frame");
  assert.deepEqual(f.calls[1][3], { frame: 1 });
  f.output.fill(99);
  assert.deepEqual(await collect(entries[0]), [1, 2, 3, 4]);
  const first = await entries[0].chunks().next();
  first.value.fill(77);
  assert.deepEqual(await collect(entries[0]), [1, 2, 3, 4]);
  assert.equal(f.closed, 1);
  await f.adapter.dispose();
  assert.equal(f.closed, 1);
  await assert.rejects(collect(entries[0]), { code: "ASSET_DISPOSED" });
});
test("incomplete capability is explicit; table and overlay plans cannot pretend to be app assets", () => {
  assert.equal(ASSET_ADAPTER_CAPABILITIES.completeAssetPipeline, false);
  assert.equal(ASSET_ADAPTER_CAPABILITIES.imageDefaultFrameV61, false);
  for (const operation of ["experience-table", "overlay-paths", "casc-pack"]) {
    assert.throws(() => fixture({ recipes: [{ ...recipe(), operation }] }), {
      code: "ASSET_UNSUPPORTED_RECIPE",
    });
  }
});
test("unsafe and duplicate destinations fail before any worker or read", () => {
  for (const path of ["../x.png", "Payload/a.app/x.png", "x\\y.png", "a//b.png", "a/./b.png"]) {
    assert.throws(() => fixture({ recipes: [recipe({ "frame.png": path })] }));
  }
  assert.throws(() => fixture({ recipes: [recipe(), recipe()] }), {
    code: "ASSET_DUPLICATE_OUTPUT",
  });
  assert.throws(() => fixture({ recipes: [recipe({ "frame.rgba": "raw.png" })] }), {
    code: "ASSET_UNSUPPORTED_OUTPUT",
  });
});
test("v61 is not enabled before the separate texture adapter is verified and integrated", async () => {
  const f = fixture({ reader: { read: async () => new Uint8Array([83, 112, 65, 49, 61, 0]) } });
  await assert.rejects(f.adapter.generateAssets({ extracted: { logicalAssets: f.reader } }), {
    code: "ASSET_V61_NOT_CONNECTED",
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.closed, 1);
});
test("pre-abort and in-flight abort reject promptly without leaking abort reasons", async () => {
  const before = new AbortController();
  before.abort(new Error("private key-like diagnostic"));
  const f = fixture();
  await assert.rejects(f.adapter.generateAssets({ signal: before.signal }), {
    code: "ASSET_CANCELLED",
  });
  assert.equal(f.closed, 0);
  const during = new AbortController();
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const g = fixture({
    worker: {
      run: () => {
        entered();
        return new Promise(() => {});
      },
    },
  });
  const pending = g.adapter.generateAssets({
    extracted: { logicalAssets: g.reader },
    signal: during.signal,
  });
  await ready;
  during.abort(new Error("private path"));
  await assert.rejects(pending, { code: "ASSET_CANCELLED" });
  assert.equal(g.closed, 1);
});
test("invalid read/output and worker errors fail closed with redacted errors", async () => {
  for (const [options, code] of [
    [{ reader: { read: async () => new ArrayBuffer(8) } }, "ASSET_INPUT_LIMIT"],
    [
      { worker: { run: async () => ({ files: { "frame.png": new Uint8Array([1]) } }) } },
      "ASSET_INVALID_RESULT",
    ],
    [{ worker: { run: async () => ({ files: {} }) } }, "ASSET_MISSING_OUTPUT"],
    [
      {
        worker: {
          run: async () => {
            throw new Error("secret data");
          },
        },
      },
      "ASSET_GENERATION_FAILED",
    ],
  ]) {
    const f = fixture(options);
    await assert.rejects(f.adapter.generateAssets({ extracted: { logicalAssets: f.reader } }), {
      message: code,
      code,
    });
    assert.equal(f.closed, 1);
  }
});
test("single-use adapter and fixed-size chunks bound lifecycle and output reads", async () => {
  const bytes = new Uint8Array(ASSET_ADAPTER_LIMITS.chunkBytes + 3);
  const f = fixture({ worker: { run: async () => ({ files: { "frame.png": bytes.buffer } }) } });
  const entries = await f.adapter.generateAssets({ extracted: { logicalAssets: f.reader } });
  const lengths = [];
  for await (const chunk of entries[0].chunks()) lengths.push(chunk.length);
  assert.deepEqual(lengths, [ASSET_ADAPTER_LIMITS.chunkBytes, 3]);
  await assert.rejects(f.adapter.generateAssets({ extracted: { logicalAssets: f.reader } }), {
    code: "ASSET_ADAPTER_SINGLE_USE",
  });
  await f.adapter.dispose();
});

test("hard input and aggregate output budgets reject rather than truncating", async () => {
  const oversized = fixture({
    reader: { read: async () => new Uint8Array(ASSET_ADAPTER_LIMITS.inputBytes + 1) },
  });
  await assert.rejects(
    oversized.adapter.generateAssets({ extracted: { logicalAssets: oversized.reader } }),
    { code: "ASSET_INPUT_LIMIT" },
  );
  const outputBytes = new ArrayBuffer(ASSET_ADAPTER_LIMITS.retainedOutputBytes / 2 + 1);
  const aggregate = fixture({
    recipes: [recipe(), recipe({ "frame.png": "NativeHUD/second.png" })],
    worker: { run: async () => ({ files: { "frame.png": outputBytes } }) },
  });
  await assert.rejects(
    aggregate.adapter.generateAssets({ extracted: { logicalAssets: aggregate.reader } }),
    { code: "ASSET_OUTPUT_LIMIT" },
  );
  assert.equal(aggregate.closed, 1);
  assert.throws(
    () =>
      fixture({
        recipes: Array.from({ length: ASSET_ADAPTER_LIMITS.recipes + 1 }, () => recipe()),
      }),
    { code: "ASSET_INVALID_RECIPES" },
  );
});

test("cleanup failure preserves a primary generation failure without unsafe finally throws", async () => {
  const f = fixture({
    worker: {
      run: async () => {
        throw new Error("private failure");
      },
      close: () => {
        throw new Error("private cleanup");
      },
    },
  });
  await assert.rejects(f.adapter.generateAssets({ extracted: { logicalAssets: f.reader } }), {
    code: "ASSET_GENERATION_FAILED",
    cleanupCode: "ASSET_WORKER_CLEANUP_FAILED",
  });
});
