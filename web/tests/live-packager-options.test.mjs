// 隔离模块模拟入口；不执行浏览器、WASM 或真实输入。
// Isolated module mocks only; no browser, WASM or real inputs.
import test from "node:test";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";
import process from "node:process";
import { spawnSync } from "node:child_process";
test("live packager options use preloaded capabilities (isolated mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  assertIsolatedRun(
    spawnSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--test",
        "--test-reporter=tap",
        new URL("./fixtures/live-packager-options.mock.mjs", import.meta.url).pathname,
      ],
      { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
    ),
  );
});
