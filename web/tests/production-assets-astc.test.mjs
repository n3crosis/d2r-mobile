// 普通测试命令通过独立子进程执行模块替身，不需要更改 CI 标志。
// The normal test command runs module doubles in an isolated subprocess without changing CI flags.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import process from "node:process";
test("optional ASTC adapter metadata and lifetime contracts", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      new URL("./fixtures/asset-pipeline-astc.mock.mjs", import.meta.url).pathname,
      new URL("./fixtures/production-assets-astc.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tests 6/);
});
