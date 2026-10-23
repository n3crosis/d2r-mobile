import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";
import { openExtractedInput } from "../extracted-input.mjs";
test("real release gate rejects authored synthetic bytes and does not accept caller hashes", async () => {
  const input = {
    inputMode: "extracted",
    exefs: [
      { path: "main", file: new Blob(["synthetic main"]) },
      { path: "sdk", file: new Blob(["synthetic sdk"]) },
    ],
    romfs: [{ path: "data/build_manifest.psv", file: new Blob(["header\n"]) }],
    programReleaseId: "switch-3.3.94012-touch-run-v4",
    verified: true,
  };
  await assert.rejects(openExtractedInput(input), { code: "PROGRAM_UNSUPPORTED_VERSION" });
  await assert.rejects(openExtractedInput(input, { contentMode: "warlock" }), {
    code: "EXTRACTED_DLC_UNSUPPORTED",
  });
});
test("extracted route uses isolated synthetic trusted catalog to exercise provenance and lifecycle", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  assertIsolatedRun(
    spawnSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--test",
        "--test-reporter=tap",
        new URL("./fixtures/extracted-input.mock.mjs", import.meta.url).pathname,
      ],
      { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
    ),
  );
});
