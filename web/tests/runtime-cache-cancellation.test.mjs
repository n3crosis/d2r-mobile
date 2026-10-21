// 默认测试入口隔离运行公开缓存取消模拟，不将其视为浏览器存储证明。
// Run isolated public-cache cancellation mocks, not a browser-storage proof.
import test from "node:test";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";
import { spawnSync } from "node:child_process";
test("public runtime cache cancellation boundaries (isolated module mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      "--test-reporter=tap",
      new URL("./fixtures/runtime-cache-cancellation.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assertIsolatedRun(result);
});
