// 隔离生产循环的模块替身；不运行私有输入或真实编译器。
// Isolate production-loop module substitutes; do not execute private input or real compilers.
import test from "node:test";
import { spawnSync } from "node:child_process";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";
test("bounded production shader concurrency preserves ownership, cache and deterministic proof-first output", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      "--test-reporter=tap",
      new URL("./fixtures/production-shader-concurrency.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assertIsolatedRun(result);
});
