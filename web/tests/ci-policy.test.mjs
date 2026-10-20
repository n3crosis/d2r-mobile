import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const workflows = new URL("../../.github/workflows/", import.meta.url);
const automatic = new Set(["web-packager-checks.yml", "toolchain-style-checks.yml"]);

test("only the two lightweight workflows trigger automatically", async () => {
  const files = (await readdir(workflows)).filter((name) => name.endsWith(".yml"));
  assert.equal(files.length, 16);
  for (const name of files) {
    const text = await readFile(new URL(name, workflows), "utf8");
    const trigger = text.slice(text.indexOf("\non:"), text.indexOf("\npermissions:"));
    assert.match(trigger, /\n {2}workflow_dispatch:/, name);
    if (automatic.has(name)) {
      assert.match(trigger, /\n {2}push:/, name);
      assert.match(trigger, /\n {2}pull_request:/, name);
    } else {
      assert.doesNotMatch(trigger, /\n {2}(push|pull_request|schedule|workflow_run):/, name);
    }
  }
});

test("frontend defaults to one Node version and style uses the local script", async () => {
  const frontend = await readFile(new URL("web-packager-checks.yml", workflows), "utf8");
  assert.match(frontend, /inputs\.compatibility/);
  assert.match(frontend, /\|\| '\["24"\]'/);
  assert.doesNotMatch(frontend, /\n {2}shader-spike:/);
  const style = await readFile(new URL("toolchain-style-checks.yml", workflows), "utf8");
  assert.match(style, /run: bash web\/scripts\/check-authored-style\.sh/);
});
