// Isolate module mocks from all actual implementation tests.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("packager signing lifetime and unsigned fallback (isolated mocks)", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      new URL("./fixtures/browser-signing-lifetime.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tests 8/);
});
