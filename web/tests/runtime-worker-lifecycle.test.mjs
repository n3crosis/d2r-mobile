// 默认测试入口隔离运行密封 RPC 生命周期模拟，不将其视为真实浏览器工作线程证明。
// Run isolated sealed RPC lifecycle mocks from the default suite, not actual browser-worker proof.
import test from "node:test";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";
import { spawnSync } from "node:child_process";
test("sealed runtime worker RPC lifecycle (isolated module mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      "--test-reporter=tap",
      new URL("./fixtures/runtime-worker-lifecycle.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assertIsolatedRun(result);
});
