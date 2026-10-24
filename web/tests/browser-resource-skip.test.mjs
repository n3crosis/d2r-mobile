// 合成策略测试；跳过只影响原始资源导出，不证明已有目录有效。
// Synthetic policy tests; skipping affects only original resource export, not validity of existing folders.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runOptionalResourceExport } from "../browser-packager.mjs";

test("default and explicit true export original resources once and preserve errors", async () => {
  let calls = 0;
  const result = { status: "complete", directoryName: "generated" };
  const exporter = async () => {
    calls++;
    return result;
  };
  assert.equal(await runOptionalResourceExport(undefined, exporter), result);
  assert.equal(await runOptionalResourceExport(true, exporter), result);
  assert.equal(calls, 2);
  const primary = new Error("quota");
  await assert.rejects(
    runOptionalResourceExport(true, async () => {
      throw primary;
    }),
    (error) => error === primary,
  );
});
test("explicit false never calls exporter or claims completion or verification", async () => {
  const result = await runOptionalResourceExport(false, () => assert.fail("must not export"));
  assert.deepEqual(result, { status: "skipped", reason: "user-requested" });
  assert.ok(Object.isFrozen(result));
  assert.equal(result.directoryName, undefined);
});
test("ambiguous skip values reject before side effects", async () => {
  for (const value of [null, 0, 1, "false", {}, []])
    await assert.rejects(
      runOptionalResourceExport(value, () => assert.fail("must not export")),
      /RESOURCE_EXPORT_OPTION/,
    );
});
test("wiring keeps authenticated reads and mandatory supplemental export outside skip callback", async () => {
  const source = await readFile(new URL("../browser-packager.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async createOutput(context)");
  const auth = source.indexOf("readAuthenticatedAssets(authenticated, selected", start);
  const optional = source.indexOf("runOptionalResourceExport(exportResources", start);
  const outcome = source.indexOf("resourceOutcome = exportResources", optional);
  const supplemental = source.indexOf("exportLegacyDevicePack({", outcome);
  const output = source.indexOf("output = createBrowserBlobOutputAdapters", supplemental);
  assert.ok(
    start < auth &&
      auth < optional &&
      optional < outcome &&
      outcome < supplemental &&
      supplemental < output,
  );
  assert.match(
    source,
    /if \(!exportResources\) resources = resourceOutcome = RESOURCE_EXPORT_SKIPPED/,
  );
});
