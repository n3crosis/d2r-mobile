// 合成产物证明提交后清理失败可恢复下载，不构成真实浏览器证明。
// Synthetic artifacts prove post-commit cleanup recovery, not real-browser behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { withLegacyAstcProducerLease, takeCommittedDownload } from "../browser-packager.mjs";
import { PackagingJobError } from "../packaging-job.mjs";
import { createDownloadPreparation } from "../download-preparation.mjs";
import { committedCleanupWarning } from "../packaging-diagnostics.mjs";

test("committed Blob survives cleanup error privately and URL retry never regenerates", async () => {
  const blob = new Blob(["synthetic IPA"]);
  const cleanup = new Error("private cleanup details");
  let conversions = 0,
    attempts = 0;
  let failure;
  try {
    await withLegacyAstcProducerLease(
      {
        close() {
          throw cleanup;
        },
      },
      async () => {
        conversions++;
        return { committed: true };
      },
      () => ({ blob, fileName: "unsigned.ipa" }),
    );
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof PackagingJobError);
  assert.equal(failure.cause, cleanup);
  assert.deepEqual(failure.cleanupErrors, [cleanup]);
  assert.equal(failure.report.committed, true);
  assert.doesNotMatch(JSON.stringify(failure), /blob|unsigned\.ipa|synthetic IPA/);
  const recovery = takeCommittedDownload(failure);
  assert.equal(recovery.blob, blob);
  assert.equal(takeCommittedDownload(failure), undefined);
  const preparation = createDownloadPreparation({
    createObjectURL(value) {
      assert.equal(value, blob);
      if (++attempts === 1) throw new Error("URL failed");
      return "blob:ready";
    },
    revokeObjectURL() {},
  });
  preparation.retain(recovery);
  assert.equal(preparation.prepare().status, "retryable");
  assert.equal(preparation.prepare().status, "ready");
  assert.equal(conversions, 1);
  assert.match(committedCleanupWarning(), /cleanup failed.*Save the IPA, then reload/);
  assert.doesNotMatch(committedCleanupWarning(), /No completed IPA/);
});

test("forged reports and precommit failures never authorize retrieval", async () => {
  const forged = new PackagingJobError(new Error("validation"), { committed: true });
  let reads = 0;
  assert.equal(takeCommittedDownload(forged), undefined);
  for (const operation of [
    async () => {
      throw forged;
    },
    async () => ({ committed: false }),
  ]) {
    await assert.rejects(
      withLegacyAstcProducerLease(
        {
          close() {
            throw new Error("cleanup");
          },
        },
        operation,
        () => {
          reads++;
          return { blob: new Blob(), fileName: "x" };
        },
      ),
      (error) => {
        assert.equal(takeCommittedDownload(error), undefined);
        return true;
      },
    );
  }
  assert.equal(reads, 0);
});

test("unavailable committed output preserves original cleanup cause without recovery", async () => {
  const cleanup = new Error("cleanup");
  await assert.rejects(
    withLegacyAstcProducerLease(
      {
        close() {
          throw cleanup;
        },
      },
      async () => ({ committed: true }),
      () => {
        throw new Error("not available");
      },
    ),
    (error) => {
      assert.equal(error.cause, cleanup);
      assert.equal(takeCommittedDownload(error), undefined);
      return true;
    },
  );
});

test("UI uses opaque recovery before generic failure wording and preserves export outcomes", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const recovery = source.slice(
    source.indexOf("const recovered = takeCommittedDownload(error)"),
    source.indexOf("appendActivity(packagingFailureSummary(report)"),
  );
  assert.match(recovery, /retain\(recovered\)/);
  assert.match(recovery, /committedCleanupWarning\(\)/);
  assert.match(recovery, /dmWebResourcesSaved/);
  assert.match(recovery, /prepareDownload\(!originalIdentity && !jobOptions.signing\)/);
  assert.doesNotMatch(recovery, /\.generate\(/);
});

test("packager binds its own sink and transfers recovery when preserving export reports", async () => {
  const source = await readFile(new URL("../browser-packager.mjs", import.meta.url), "utf8");
  assert.match(source, /\(\) => output\.getDownload\(\)/);
  assert.match(
    source,
    /const recovery = takeCommittedDownload\(error\);\s*if \(recovery\) committedDownloads\.set\(reported, recovery\);\s*throw reported;/,
  );
  const { catalog } = await import("../i18n-catalog.mjs");
  assert.match(catalog.dmWebCommittedCleanupWarning[1], /清理失败.*先保存 IPA.*重新载入/);
});
