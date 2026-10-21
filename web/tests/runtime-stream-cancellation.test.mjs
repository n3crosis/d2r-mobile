// 隔离运行公开运行时流取消测试，不将 Node 流测试视为浏览器性能证明。
// Isolate public-runtime stream cancellation tests, without treating Node stream tests as browser performance proof.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("public runtime stream cancellation and cleanup (isolated module mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      new URL("./fixtures/runtime-stream-cancellation.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tests 8/);
});
