// 隔离测试实际密封租约，替换编译和线程，不执行 WASM。
// Isolate the actual sealed lease with synthetic compilation and workers, never executing WASM.
import test from "node:test";
import { spawnSync } from "node:child_process";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";

test("AIR compiler sealed lease handoff races (isolated module mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      "--test-reporter=tap",
      new URL("./fixtures/air-compiler-lease.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assertIsolatedRun(result);
});
