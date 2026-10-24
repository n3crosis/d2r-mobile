// 包装器允许增减有效用例，但不能把空跑、跳过、失败或中断当作通过。
// Wrappers permit changing valid case counts, but never accept empty, skipped, failed or interrupted runs.
import test from "node:test";
import assert from "node:assert/strict";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";
function result(overrides = {}, process = {}) {
  const totals = { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...overrides };
  return {
    status: 0,
    stdout:
      Object.entries(totals)
        .map(([key, value]) => `# ${key} ${value}`)
        .join("\n") + "\n",
    stderr: "",
    ...process,
  };
}
test("isolated wrapper accepts any nonzero all-passing count", () => {
  for (const count of [1, 8, 13, 35, 80, 100])
    assert.doesNotThrow(() => assertIsolatedRun(result({ tests: count, pass: count })));
  assert.doesNotThrow(() =>
    assertIsolatedRun(result({}, { stdout: result().stdout.replaceAll("\n", "\r\n") })),
  );
});
test("isolated wrapper rejects incomplete, skipped, failed and empty execution", () => {
  for (const totals of [
    { tests: 0, pass: 0 },
    { pass: 2 },
    { fail: 1 },
    { cancelled: 1 },
    { skipped: 1 },
    { todo: 1 },
  ])
    assert.throws(() => assertIsolatedRun(result(totals)));
  for (const process of [
    { status: 1 },
    { status: null },
    { error: new Error("timeout") },
    { stdout: "" },
    { stdout: result().stdout + "# tests 3\n" },
    { stdout: result().stdout.replace("# pass 3\n", "") },
  ])
    assert.throws(() => assertIsolatedRun(result({}, process)));
});
