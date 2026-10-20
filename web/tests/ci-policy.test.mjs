import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { profiles, validateProfile, run } from "../verification/verify.mjs";
const workflows = new URL("../../.github/workflows/", import.meta.url);

test("one GitHub workflow runs only one Linux browser-build job", async () => {
  assert.deepEqual(
    (await readdir(workflows)).filter((name) => name.endsWith(".yml")),
    ["verify.yml"],
  );
  const text = await readFile(new URL("verify.yml", workflows), "utf8");
  assert.deepEqual(
    [...text.slice(text.indexOf("\njobs:")).matchAll(/^ {2}([a-z-]+):/gm)].map((match) => match[1]),
    ["quick"],
  );
  assert.match(text, /runs-on: ubuntu-24\.04/);
  assert.match(text, /run: node web\/verification\/verify\.mjs quick/);
  assert.doesNotMatch(
    text,
    /matrix:|strategy:|inputs:|desktop-build:|windows-|macos-|download-artifact/,
  );
  assert.match(text, /node web\/runtime-build\/build\.mjs/);
  assert.match(text, /node web\/runtime-build\/stage-preview\.mjs/);
  assert.equal([...text.matchAll(/uses: actions\/upload-artifact@/g)].length, 1);
  assert.doesNotMatch(text, /pull_request_target:|self-hosted|secrets\./);
  for (const sha of text.matchAll(/uses: [^@]+@(\S+)/g)) assert.match(sha[1], /^[0-9a-f]{40}$/);
  assert.match(text, /name: web-preview\n\s+path: web\/dist\//);
  assert.match(text, /retention-days: 7/);
});

test("profile selection rejects arbitrary shell, paths, and prototype names", () => {
  for (const bad of [
    "../quick",
    "quick;echo unsafe",
    "constructor",
    "__proto__",
    "",
    "assets\nshader",
  ]) {
    assert.throws(() => validateProfile(bad), /Unknown verification profile/);
  }
  for (const name of ["quick", "full", ...Object.keys(profiles)])
    assert.equal(validateProfile(name), name);
  assert.throws(() => run("assets", {}), /--provision/);
  assert.throws(() => run("assets", { GITHUB_ACTIONS: "true" }), /local verification only/);
});

test("allowlisted metadata is emitted without executing a proof", async () => {
  const temp = await mkdtemp(join(tmpdir(), "verification-metadata-"));
  try {
    const output = join(temp, "output");
    const result = spawnSync(
      process.execPath,
      [
        new URL("../verification/verify.mjs", import.meta.url).pathname,
        "shader-pipeline",
        "--metadata",
      ],
      {
        env: { ...process.env, GITHUB_OUTPUT: output, RUNNER_TEMP: temp },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const text = await readFile(output, "utf8");
    assert.match(text, /dotnet=true/);
    assert.match(text, /linked-shader\/native/);
    assert.doesNotMatch(text, /\$\{\{/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("shared recipe runner preserves failure, skipped steps, and diagnostics", async () => {
  const temp = await mkdtemp(join(tmpdir(), "verification-steps-"));
  try {
    const script = `source "$VERIFY_ROOT/web/verification/steps.sh"
step first fail . 0 <<'STEP'
exit 7
STEP
step second skipped . 0 <<'STEP'
exit 0
STEP
always_step report diagnostics . 0 <<'STEP'
printf '%s %s' "$VERIFY_OUTCOME_first" "$VERIFY_OUTCOME_second" > "$RUNNER_TEMP/result"
STEP
finish
`;
    const result = spawnSync("bash", ["-c", script], {
      env: {
        ...process.env,
        VERIFY_ROOT: new URL("../../", import.meta.url).pathname,
        RUNNER_TEMP: temp,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(await readFile(join(temp, "result"), "utf8"), "failure skipped");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
