// 验证 overlay-recipe-provenance 的约定与边界；依据 web/tests 及本文件的测试断言。
// Verify overlay-recipe-provenance contracts and boundaries against web/tests and this file's assertions.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("overlay source and derived-data pins stay synchronized after shared UI text changes", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../toolchain/overlay-recipe-js/scripts/verify-source.mjs", import.meta.url),
      ),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
