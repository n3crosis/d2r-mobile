// 只使用模块模拟及合成字节，不执行编译器或私有输入。
// Only module mocks and synthetic bytes. No compiler or private inputs execute.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("production shader reuse preserves identity, validation, source proof and cancellation", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "tests/fixtures/shader-output-cache.mock.mjs"],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      timeout: 60000,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
