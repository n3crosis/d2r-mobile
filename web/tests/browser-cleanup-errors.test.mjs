// 合成清理错误检查：不读取游戏文件，不输出原始错误文本。
// Synthetic cleanup failure checks: no game files and no raw error text in UI summaries.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanupPackagingAdapters } from "../browser-packager.mjs";
import { PackagingJobError } from "../packaging-job.mjs";
import { packagingFailureSummary } from "../packaging-diagnostics.mjs";

test("successful cleanup retains order and awaits both operations", async () => {
  const calls = [];
  assert.equal(
    await cleanupPackagingAdapters(
      async () => {
        await Promise.resolve();
        calls.push("extraction");
      },
      async () => calls.push("adapters"),
    ),
    undefined,
  );
  assert.deepEqual(calls, ["extraction", "adapters"]);
});
test("single extraction failure retains exact identity and still closes adapters", async () => {
  const primary = new Error("first");
  let closed = false;
  await assert.rejects(
    cleanupPackagingAdapters(
      () => {
        throw primary;
      },
      async () => {
        closed = true;
      },
    ),
    (error) => error === primary,
  );
  assert.equal(closed, true);
});
test("single adapter-close failure retains exact identity", async () => {
  const cleanup = new Error("second");
  await assert.rejects(
    cleanupPackagingAdapters(
      async () => {},
      async () => {
        throw cleanup;
      },
    ),
    (error) => error === cleanup,
  );
});
test("dual failure preserves original cause and both errors without exposing raw details", async () => {
  const first = new Error("private source path"),
    second = new Error("private cleanup detail");
  await assert.rejects(
    cleanupPackagingAdapters(
      async () => {
        throw first;
      },
      () => {
        throw second;
      },
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, first);
      assert.deepEqual(error.errors, [first, second]);
      const wrapped = new PackagingJobError(error, {
        stage: "cleanup",
        code: "STAGE_FAILED",
        cleanupCodes: ["RESOURCE_CLEANUP_FAILED"],
      });
      assert.equal(wrapped.cause.cause, first);
      const summary = packagingFailureSummary(wrapped.report);
      assert.ok(!summary.includes("private"));
      return true;
    },
  );
});
