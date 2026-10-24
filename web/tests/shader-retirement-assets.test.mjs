// 隔离公开 WASM 退休所有权测试；所有线程及编译均为无执行替身。
// Isolate public WASM retirement ownership tests; all workers and compilation are inert stand-ins.
import test from "node:test";
import { spawnSync } from "node:child_process";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";

test("shader retirement public-asset ownership (isolated module mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      "--test-reporter=tap",
      new URL("./fixtures/shader-retirement-assets.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assertIsolatedRun(result);
});
