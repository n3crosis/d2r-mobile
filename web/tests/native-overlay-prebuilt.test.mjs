// 普通测试入口始终执行隔离模块模拟覆盖，不要求调用方记住实验标志。
// The ordinary test entry always executes isolated module-mock coverage without caller flags.
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";
import test from "node:test";
import { spawnSync } from "node:child_process";
import process from "node:process";
test("native overlay optional prebuilt assembly (isolated module mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      "--test-reporter=tap",
      new URL("./fixtures/native-overlay-prebuilt.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assertIsolatedRun(result);
});
