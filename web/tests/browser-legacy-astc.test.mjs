// 合成生命周期测试不构成浏览器、真实游戏或原生兼容性证明。
// Synthetic lifecycle tests are not browser, real-game or native compatibility proof.
import test from "node:test";
import assert from "node:assert/strict";
import {
  withLegacyAstcProducerLease,
  prepareBrowserPackager,
  LEGACY_ASTC_PRODUCTION_LIMITS,
} from "../browser-packager.mjs";
import { PackagingJobError } from "../packaging-job.mjs";

test("default operation needs no producer and preserves result", async () => {
  const result = { committed: true };
  assert.equal(await withLegacyAstcProducerLease(undefined, async () => result), result);
});
test("lease closes only after export and job cleanup settle", async () => {
  const events = [];
  await withLegacyAstcProducerLease({ close: async () => events.push("lease") }, async () => {
    events.push("export");
    await Promise.resolve();
    events.push("job-cleanup");
  });
  assert.deepEqual(events, ["export", "job-cleanup", "lease"]);
});
test("primary error identity survives successful cleanup", async () => {
  const primary = new Error("cancelled");
  let closed = false;
  await assert.rejects(
    withLegacyAstcProducerLease(
      {
        close: async () => {
          closed = true;
        },
      },
      async () => {
        throw primary;
      },
    ),
    (error) => error === primary,
  );
  assert.equal(closed, true);
});
test("cleanup failure preserves primary cause and observable cleanup", async () => {
  const primary = new Error("quota");
  const cleanup = new Error("lease");
  const failure = new PackagingJobError(primary, { cleanupCodes: [], committed: false });
  await assert.rejects(
    withLegacyAstcProducerLease(
      {
        close: async () => {
          throw cleanup;
        },
      },
      async () => {
        throw failure;
      },
    ),
    (error) => {
      assert.equal(error.cause, primary);
      assert.deepEqual(error.cleanupErrors, [cleanup]);
      assert.deepEqual(error.report.cleanupCodes, ["LEGACY_ASTC_CLEANUP_FAILED"]);
      return true;
    },
  );
});
test("cleanup after IPA commit reports committed outcome instead of silent success", async () => {
  await assert.rejects(
    withLegacyAstcProducerLease(
      {
        close: async () => {
          throw new Error("lease");
        },
      },
      async () => ({ committed: true }),
    ),
    (error) => {
      assert.equal(error.report.committed, true);
      assert.equal(error.report.stage, "cleanup");
      return true;
    },
  );
});
test("option fails closed and policy limits are explicit", async () => {
  await assert.rejects(prepareBrowserPackager({ legacyAstc: "yes" }), /LEGACY_ASTC_OPTION/);
  assert.equal(LEGACY_ASTC_PRODUCTION_LIMITS.maxPackBytes, 8 * 1024 ** 3);
  assert.ok(Object.isFrozen(LEGACY_ASTC_PRODUCTION_LIMITS));
});

test("conversion diagnostics expose only safe multi-pass counts and ignore observer failures", async () => {
  const { createLegacyAstcDiagnosticObserver } = await import("../browser-packager.mjs");
  const events = [];
  const emit = createLegacyAstcDiagnosticObserver((event) => events.push(event));
  emit({
    phase: "converting",
    processedBytes: 12,
    completedBlocks: 3,
    completedRecords: 1,
    path: "private",
    key: "secret",
    totalBytes: 100,
  });
  assert.deepEqual(events, [
    {
      stage: "assets",
      state: "running",
      diagnostic: {
        kind: "legacy-astc",
        phase: "converting",
        processedBytes: 12,
        completedBlocks: 3,
        completedRecords: 1,
      },
    },
  ]);
  assert.ok(Object.isFrozen(events[0].diagnostic));
  for (const invalid of [
    { phase: "unknown", processedBytes: 0, completedBlocks: 0 },
    { phase: "converting", processedBytes: -1, completedBlocks: 0 },
    { phase: "converting", processedBytes: 0, completedBlocks: Infinity },
  ])
    emit(invalid);
  assert.equal(events.length, 1);
  const valid = { phase: "complete", processedBytes: 12, completedBlocks: 3 };
  createLegacyAstcDiagnosticObserver(() => {
    throw new Error("observer");
  })(valid);
  createLegacyAstcDiagnosticObserver(async () => {
    throw new Error("observer");
  })(valid);
  const controller = new AbortController();
  controller.abort();
  createLegacyAstcDiagnosticObserver(
    () => assert.fail("aborted observer"),
    controller.signal,
  )(valid);
  await new Promise((resolve) => setImmediate(resolve));
});

test("only exact producer detail codes survive failure summary without raw text", async () => {
  const { legacyAstcFailureDetailCode } = await import("../browser-packager.mjs");
  const { packagingFailureSummary } = await import("../packaging-diagnostics.mjs");
  for (const detailCode of ["STORAGE_QUOTA", "SIZE_LIMIT", "INTEGRITY_FAILED", "CODEC_FAILED"]) {
    const cause = Object.assign(new Error("private filename key"), { detailCode });
    const error = new PackagingJobError(cause, { stage: "assets", code: "STAGE_FAILED" });
    assert.equal(legacyAstcFailureDetailCode(error), detailCode);
    const summary = packagingFailureSummary({
      ...error.report,
      detailCode: legacyAstcFailureDetailCode(error),
    });
    assert.ok(summary.includes(`[${detailCode}]`));
    assert.ok(!summary.includes("private filename key"));
  }
  const cause = Object.assign(new Error("private"), { detailCode: "PRIVATE_PATH" });
  assert.equal(legacyAstcFailureDetailCode(new PackagingJobError(cause, {})), undefined);
  assert.ok(!packagingFailureSummary({ detailCode: "PRIVATE_PATH" }).includes("PRIVATE_PATH"));
});
