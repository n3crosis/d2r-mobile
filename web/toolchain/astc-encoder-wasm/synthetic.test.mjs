// 仅验证合成输入契约；不是编码保真或游戏对等测试。
// Synthetic contracts only; these are not codec fidelity or game parity tests.
// 基于公开基元契约和 Node 内置测试断言。
// Based on the public primitive contract and Node built-in test assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { validateImage, encodeWithModule } from "./contract.mjs";
import { encodeAstc4x4 } from "./client.mjs";
const image = (width = 4, height = 4) => ({
  width,
  height,
  rgba: new ArrayBuffer(width * height * 4),
});
test("size, profile, edge dimensions, and bounded allocation", () => {
  assert.equal(validateImage(image()), 16);
  assert.equal(validateImage(image(5, 1)), 32);
  assert.equal(validateImage(image(1024, 1024)), 1048576);
  for (const width of [0, -1, NaN, Infinity, 1.5, 4097])
    assert.throws(() => validateImage({ ...image(), width }));
  assert.throws(() => validateImage({ ...image(), width: 2048, height: 2048 }));
  assert.throws(() => validateImage({ ...image(), profile: "hdr" }));
  assert.throws(() => validateImage({ ...image(), rgba: new Uint8Array(64) }));
  assert.throws(() => validateImage({ ...image(), rgba: new ArrayBuffer(63) }));
  if (typeof SharedArrayBuffer !== "undefined")
    assert.throws(() => validateImage({ ...image(), rgba: new SharedArrayBuffer(64) }));
});
test("module allocations are freed after success, rejection, and partial allocation failure", () => {
  for (const outcome of ["ok", "codec", "allocation"]) {
    let allocations = 0;
    const freed = [];
    const module = {
      HEAPU8: new Uint8Array(1024),
      _malloc: () => (++allocations === 1 ? 64 : outcome === "allocation" ? 0 : 128),
      _free: (ptr) => freed.push(ptr),
      _astc_encode_rgba: (...args) => {
        assert.deepEqual(args, [64, 64, 4, 4, 1, 128, 16]);
        module.HEAPU8.fill(73, 128, 144);
        return outcome === "codec" ? 101 : 0;
      },
    };
    const encode = () => encodeWithModule(module, { ...image(), profile: "srgb" });
    if (outcome === "ok") assert.deepEqual(new Uint8Array(encode()), new Uint8Array(16).fill(73));
    else assert.throws(encode);
    assert.deepEqual(freed, outcome === "allocation" ? [64] : [128, 64]);
  }
});
test("worker ownership, success, abort, busy guard, malformed response, timeout and startup failure", async () => {
  const original = globalThis.Worker;
  let latest;
  class FakeWorker {
    constructor() {
      latest = this;
    }
    postMessage(data, transfer) {
      this.data = structuredClone(data, { transfer });
    }
    terminate() {
      this.terminated = true;
    }
  }
  globalThis.Worker = FakeWorker;
  try {
    for (const signal of [{}, { aborted: false }, "invalid", 1]) {
      const untouched = image();
      assert.throws(() => encodeAstc4x4(untouched, { signal }), /AbortSignal/);
      assert.equal(untouched.rgba.byteLength, 64);
    }
    const input = image();
    let result = encodeAstc4x4(input);
    assert.equal(input.rgba.byteLength, 0);
    await assert.rejects(encodeAstc4x4(image()), /Only one/);
    latest.onmessage({ data: { ok: true, blocks: new ArrayBuffer(16) } });
    assert.equal((await result).byteLength, 16);
    assert.equal(latest.terminated, true);
    const controller = new AbortController();
    result = encodeAstc4x4(image(), { signal: controller.signal });
    controller.abort();
    await assert.rejects(result, { name: "AbortError" });
    assert.equal(latest.terminated, true);
    const untouched = image();
    await assert.rejects(encodeAstc4x4(untouched, { signal: controller.signal }), {
      name: "AbortError",
    });
    assert.equal(untouched.rgba.byteLength, 64);
    result = encodeAstc4x4(image());
    latest.onmessage({ data: { ok: true, blocks: new ArrayBuffer(15) } });
    await assert.rejects(result, /length/);
    await assert.rejects(encodeAstc4x4(image(), { timeoutMs: 1 }), /deadline/);
    assert.equal(latest.terminated, true);
    globalThis.Worker = class {
      constructor() {
        throw new Error("startup");
      }
    };
    await assert.rejects(encodeAstc4x4(image()), /startup/);
    globalThis.Worker = FakeWorker;
    result = encodeAstc4x4(image());
    latest.onerror();
    await assert.rejects(result, /initialization/);
  } finally {
    globalThis.Worker = original;
  }
});
