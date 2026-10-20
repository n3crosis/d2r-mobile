// 使用合成 Blob 和 URL/DOM 替身验证下载失败不损坏已完成产物。
// Synthetic Blobs and URL/DOM doubles verify download failure cannot invalidate completed artifacts.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createDownloadPreparation, attemptAutomaticDownload } from "../download-preparation.mjs";
test("failed URL preparation retains identical completed Blob for retry, then reuses URL", () => {
  const blob = new Blob(["synthetic IPA"]),
    calls = [],
    revoked = [];
  let fail = true;
  const session = createDownloadPreparation({
    createObjectURL(value) {
      calls.push(value);
      if (fail) throw new Error("private error");
      return "blob:ready";
    },
    revokeObjectURL(value) {
      revoked.push(value);
    },
  });
  session.retain({ blob, fileName: "ready.ipa" });
  assert.deepEqual(session.prepare(), { status: "retryable" });
  assert.equal(revoked.length, 0);
  fail = false;
  assert.deepEqual(session.prepare(), {
    status: "ready",
    url: "blob:ready",
    fileName: "ready.ipa",
  });
  assert.deepEqual(calls, [blob, blob]);
  session.prepare();
  assert.equal(calls.length, 2);
  session.dispose();
  assert.deepEqual(revoked, ["blob:ready"]);
  assert.deepEqual(session.prepare(), { status: "unavailable" });
});
test("replacement does not revoke prior URL until new URL creation succeeds", () => {
  let fail = false,
    count = 0;
  const revoked = [];
  const session = createDownloadPreparation({
    createObjectURL() {
      if (fail) throw new Error("no URL");
      return `blob:${++count}`;
    },
    revokeObjectURL(value) {
      revoked.push(value);
    },
  });
  session.retain({ blob: new Blob(["one"]), fileName: "one.ipa" });
  session.prepare();
  session.retain({ blob: new Blob(["two"]), fileName: "two.ipa" });
  fail = true;
  session.prepare();
  assert.deepEqual(revoked, []);
  fail = false;
  assert.equal(session.prepare().url, "blob:2");
  assert.deepEqual(revoked, ["blob:1"]);
  session.dispose();
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
});
test("all automatic download DOM failures are contained and never revoke URL", () => {
  for (const phase of ["create", "append", "click", "remove"]) {
    const node = {
      click() {
        if (phase === "click") throw new Error("blocked");
      },
      remove() {
        if (phase === "remove") throw new Error("blocked");
      },
    };
    const document = {
      createElement() {
        if (phase === "create") throw new Error("blocked");
        return node;
      },
      body: {
        append() {
          if (phase === "append") throw new Error("blocked");
        },
      },
    };
    assert.doesNotThrow(() =>
      attemptAutomaticDownload({ url: "blob:retained", fileName: "ready.ipa" }, document),
    );
  }
});
test("UI retry never reruns conversion and completed outcomes bypass conversion-failure catch", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const retry = app.slice(
    app.indexOf("  function prepareDownload()"),
    app.indexOf("  async function generate()"),
  );
  assert.match(retry, /downloadPreparation.current.prepare\(\)/);
  assert.doesNotMatch(retry, /\.generate\(|setLegacyStatus|setResourceOutcome/);
  assert.match(
    app,
    /generationCompleted = true;[\s\S]*?downloadPreparation.current.retain\(result.download\)/,
  );
  assert.match(
    app,
    /if \(generationCompleted\) \{[\s\S]*?dmWebDownloadPreparationFailed[\s\S]*?return;\s+\}\s+const report/,
  );
  assert.match(app, /preparedDownload.dispose\(\)/);
  assert.match(app, /<Button onClick=\{prepareDownload\}>/);
});
