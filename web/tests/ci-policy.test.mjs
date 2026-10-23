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
  const steps = text.split(/\n {6}- /).slice(1);
  const uploads = steps.filter((step) => /uses: actions\/upload-artifact@/.test(step));
  const artifacts = new Map(uploads.map((step) => [step.match(/^ {10}name: (\S+)$/m)?.[1], step]));
  assert.equal(uploads.length, 5);
  assert.deepEqual([...artifacts.keys()].sort(), [
    "air-compiler-diagnostic-source",
    "air-compiler-diagnostic-unvalidated",
    "air-compiler-source",
    "web-preview",
    "web-preview-screenshot",
  ]);
  assert.match(text, /failure\(\) && steps\.runtime\.outcome == 'failure'/);
  assert.match(
    artifacts.get("air-compiler-diagnostic-source"),
    /if: \$\{\{ !cancelled\(\) && steps\.air_failure_source\.outcome == 'success' \}\}/,
  );
  assert.match(
    artifacts.get("air-compiler-diagnostic-unvalidated"),
    /if: \$\{\{ !cancelled\(\) && steps\.air_failure_bundle\.outcome == 'success' \}\}/,
  );
  // No explicit condition means GitHub's default success() guard, never failure retention.
  for (const name of ["air-compiler-source", "web-preview"])
    assert.doesNotMatch(artifacts.get(name), /\n {8}if:/);
  assert.doesNotMatch(text, /save-always:/);
  for (const step of steps.filter((step) => /continue-on-error:/.test(step))) {
    assert.match(step, /id: preview_screenshot(?:_upload)?\n/);
    assert.match(step, /continue-on-error: true/);
  }
  assert.match(
    artifacts.get("web-preview-screenshot"),
    /steps\.preview_screenshot\.outcome == 'success'/,
  );
  assert.match(
    artifacts.get("web-preview-screenshot"),
    /path: \$\{\{ runner\.temp \}\}\/web-preview-screenshot\/web-preview\.png/,
  );
  assert.doesNotMatch(text, /pull_request_target:|self-hosted|secrets\./);
  for (const sha of text.matchAll(/uses: [^@]+@(\S+)/g)) assert.match(sha[1], /^[0-9a-f]{40}$/);
  assert.match(text, /name: web-preview\n\s+path: web\/dist\//);
  assert.match(text, /retention-days: 7/);
});

// 原生编译输入与固定配方来源变更也必须触发同一个构建作业。
// Native compilation inputs and pinned recipe sources must trigger the same build job.
test("both workflow triggers cover native and pinned runtime inputs", async () => {
  const text = await readFile(new URL("verify.yml", workflows), "utf8");
  const filters = [...text.matchAll(/paths:\s*\[([\s\S]*?)\]/g)].map((match) =>
    [...match[1].matchAll(/"([^"\n]+)"/g)].map((value) => value[1]),
  );
  assert.equal(filters.length, 2);
  const inputs = new Set([
    "LICENSE",
    "dm/third_party/bcdec/bcdec.h",
    "dm/third_party/bcdec/LICENSE",
  ]);
  for (const name of [
    "asset-transforms-js/source-provenance.json",
    "casc-overlay-js/source-provenance.json",
    "art-recipes-js/source-provenance.json",
    "remaining-art-js/source-provenance.json",
    "hud-recipes-js/provenance.json",
    "overlay-recipe-js/source-provenance.json",
  ]) {
    const manifest = JSON.parse(
      await readFile(new URL(`../toolchain/${name}`, import.meta.url), "utf8"),
    );
    for (const path of Object.keys(manifest.sources ?? manifest))
      if (path.startsWith("dm/")) inputs.add(path);
  }
  for (const patterns of filters)
    for (const input of inputs) {
      const included = patterns.some((pattern) =>
        pattern.endsWith("/**") ? input.startsWith(pattern.slice(0, -2)) : input === pattern,
      );
      assert.ok(included, `Runtime input does not trigger CI: ${input}`);
    }
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

test("AIR release cache is exact and the consumer cannot fall back to a compiler build", async () => {
  const text = await readFile(new URL("verify.yml", workflows), "utf8");
  const finished = text
    .split(/\n {6}- /)
    .find((value) => value.includes("\n        id: air_cache\n"));
  assert(
    finished.includes(
      "public-air-release-v1-${{ steps.air_source.outputs.release_manifest_sha256 }}",
    ),
  );
  for (const path of [
    "web/toolchain/metal-air-compiler/dist",
    "web/runtime-build/.build/air-compiler-receipt.sha256",
  ])
    assert(finished.includes(path));
  const assetCache = text
    .split(/\n {6}- /)
    .find((value) => value.includes("path: web/runtime-build/.build/air-compiler-release"));
  assert(
    assetCache.includes(
      "public-air-release-assets-v1-${{ steps.air_source.outputs.release_manifest_sha256 }}",
    ),
  );
  assert.doesNotMatch(
    text,
    /restore-keys:|ccache|EM_COMPILER_WRAPPER|air_objects|build-air-compiler\.mjs --(?:work|jobs)/,
  );
  const build = await readFile(
    new URL("../runtime-build/build-air-compiler.mjs", import.meta.url),
    "utf8",
  );
  assert.match(build, /importPinnedAirCompiler/);
  assert.match(build, /compileCanary: await verifyAirCompilerCanary\(\)/);
  assert.doesNotMatch(build, /spawn|runToolchain|build-host-tools|build-wasm|emsdk.*install/);
  // Existing non-AIR builds still need the pinned SDK.
  assert(text.includes('source "$RUNNER_TEMP/browser-emsdk/emsdk_env.sh"'));
  assert(text.includes('"$RUNNER_TEMP/browser-emsdk/emsdk" install 4.0.20'));
  assert(text.includes("node web/runtime-build/build.mjs"));
});
test("AIR import and canary failures never authenticate the runtime", async () => {
  const text = await readFile(new URL("verify.yml", workflows), "utf8");
  const runtime = text.split(/\n {6}- /).find((value) => value.includes("\n        id: runtime\n"));
  const segment = runtime.slice(
    runtime.indexOf("          node web/runtime-build/build-air-compiler.mjs"),
    runtime.indexOf("          rustup toolchain install"),
  );
  assert(segment.includes("air_compiler_verified=true"));
  const temp = await mkdtemp(join(tmpdir(), "air-release-gate-"));
  try {
    for (const status of [0, 2, 7]) {
      const output = join(temp, `output-${status}`);
      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail"], {
        input: `node() { return ${status}; }\n` + segment,
        env: { ...process.env, GITHUB_OUTPUT: output },
        encoding: "utf8",
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, status, result.stderr);
      if (status === 0)
        assert.equal(await readFile(output, "utf8"), "air_compiler_verified=true\n");
      else await assert.rejects(readFile(output), { code: "ENOENT" });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
