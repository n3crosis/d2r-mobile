// 默认测试入口运行隔离的公开引导模拟，不把模拟结果称作浏览器或真实 WASM 证明。
// Run isolated public-bootstrap mocks from the default test entry, not browser or actual WASM proof.
import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { spawnSync } from "node:child_process";
test("optional producer public-bootstrap lifecycle (isolated module mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      new URL("./fixtures/runtime-optional-bootstrap.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tests 6/);
});
