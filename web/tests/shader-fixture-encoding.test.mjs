// 验证 shader-fixture-encoding 的约定与边界；依据 ../toolchain/shader-spike/synthetic-fixture.mjs 及本文件的测试断言。
// Verify shader-fixture-encoding contracts and boundaries against ../toolchain/shader-spike/synthetic-fixture.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { code, job } from "../toolchain/shader-spike/synthetic-fixture.mjs";
test("authored shader fixture keeps exact encoding and options", () => {
  assert.equal(code.byteLength, 16);
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  assert.equal(view.getBigUint64(0, true), 0n);
  assert.equal(view.getBigUint64(8, true), 0xe30000000007000fn);
  assert.equal(job.stage, "cs");
  assert.deepEqual(job.local, [1, 1, 1]);
  assert.equal(job.shared, 0);
  assert.equal(job.debug, true);
  assert.equal(job.reduced, false);
});
