// 默认测试入口运行隔离的公开引导模拟，不把模拟结果称作浏览器或真实 WASM 证明。
// Run isolated public-bootstrap mocks from the default test entry, not browser or actual WASM proof.
import test from "node:test";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";
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
      "--test-reporter=tap",
      new URL("./fixtures/runtime-optional-bootstrap.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assertIsolatedRun(result);
});
