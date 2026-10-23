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
  assert.equal(uploads.length, 4);
  assert.deepEqual([...artifacts.keys()].sort(), [
    "air-compiler-diagnostic-source",
    "air-compiler-diagnostic-unvalidated",
    "air-compiler-source",
    "web-preview",
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
  assert.doesNotMatch(text, /continue-on-error:|save-always:/);
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

test("AIR object cache is bounded and separate from exact authenticated finished outputs", async () => {
  const text = await readFile(new URL("verify.yml", workflows), "utf8");
  const steps = text.split(/\n {6}- /).slice(1);
  const step = (id) => {
    const matches = steps.filter((value) => value.includes(`\n        id: ${id}\n`));
    assert.equal(matches.length, 1, id);
    return matches[0];
  };
  const setup = step("air_objects_setup");
  const restore = step("air_objects");
  const verified = step("air_objects_verified");
  const finished = step("air_cache");
  const save = steps.find((value) =>
    value.startsWith("name: Save source-specific public AIR object snapshot\n"),
  );
  assert(setup.includes("if: ${{ steps.air_cache.outputs.cache-hit != 'true' }}"));
  for (const token of [
    "runner.os",
    "runner.arch",
    "ubuntu-24.04",
    "emsdk4.0.20-e4fe26ef59168ff44f4c23c466e497bf60b3411e",
    "steps.air_source.outputs.upstream_archive_sha256",
    "web/toolchain/metal-air-compiler/toolchain.mjs",
    "web/toolchain/metal-air-compiler/api/CMakeLists.txt",
    "web/runtime-build/build-air-compiler.mjs",
    "max_size = 2GiB",
    "compiler_check = content",
    "direct_mode = false",
    "depend_mode = false",
  ])
    assert(setup.includes(token), token);
  assert.match(setup, /sloppiness =\s*\n\s*remote_storage =\s*\n/);
  assert(setup.includes("ccache_sha256=\"$(sha256sum /usr/bin/ccache | cut -d ' ' -f1)\""));
  assert(setup.includes('[[ "$ccache_sha256" =~ ^[a-f0-9]{64}$ ]]'));
  assert(
    setup.includes('printf \'prefix=%s-ccache%s-\\n\' "$AIR_OBJECT_CACHE_PREFIX" "$ccache_sha256"'),
  );
  assert(restore.includes("if: ${{ steps.air_objects_setup.outcome == 'success' }}"));
  assert(restore.includes("path: ${{ runner.temp }}/air-compiler-ccache\n"));
  assert(
    restore.includes(
      "key: ${{ steps.air_objects_setup.outputs.prefix }}${{ steps.air_source.outputs.source_fingerprint }}",
    ),
  );
  assert(restore.includes("restore-keys: ${{ steps.air_objects_setup.outputs.prefix }}"));
  assert.doesNotMatch(restore, /ccache\.conf|metal-air-compiler\/dist|receipt/);
  assert.doesNotMatch(finished, /restore-keys:/);
  assert(finished.includes("public-air-compiler-v1-"));
  assert(finished.includes("steps.air_source.outputs.source_fingerprint"));
  assert.equal(steps.filter((value) => value.includes("restore-keys:")).length, 1);
  assert(
    verified.includes(
      "if: ${{ !cancelled() && steps.air_objects.outcome == 'success' && steps.runtime.outputs.air_compiler_verified == 'true' && (steps.runtime.outcome == 'success' || steps.air_failure_verify.outcome == 'success') }}",
    ),
  );
  assert(verified.includes("/usr/bin/ccache --cleanup\n"));
  assert.match(verified, /\/usr\/bin\/ccache --show-stats(?:\n|$)/);
  assert(
    save.includes(
      "if: ${{ !cancelled() && steps.air_objects_verified.outcome == 'success' && steps.air_objects.outputs.cache-hit != 'true' }}",
    ),
  );
  assert(save.includes("key: ${{ steps.air_objects.outputs.cache-primary-key }}"));
  assert(save.includes("path: ${{ runner.temp }}/air-compiler-ccache"));
  for (const value of [restore, save])
    assert.match(
      value,
      /uses: actions\/cache\/(restore|save)@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/,
    );
});

test("AIR cache wrapper stays scoped and never authenticates a failed build or canary", async () => {
  const text = await readFile(new URL("verify.yml", workflows), "utf8");
  const runtime = text.split(/\n {6}- /).find((value) => value.includes("\n        id: runtime\n"));
  const segment = runtime.slice(
    runtime.indexOf("          (\n"),
    runtime.indexOf("          rustup toolchain install"),
  );
  assert(segment.includes("node web/runtime-build/build-air-compiler.mjs"));
  assert(
    runtime.indexOf('source "$RUNNER_TEMP/browser-emsdk/emsdk_env.sh"') <
      runtime.indexOf("EM_COMPILER_WRAPPER="),
  );
  assert.equal((text.match(/export EM_COMPILER_WRAPPER=/g) ?? []).length, 1);
  const temp = await mkdtemp(join(tmpdir(), "air-cache-wrapper-"));
  try {
    for (const [outcome, airStatus, cacheStatus, expectedStatus] of [
      ["success", 0, 0, 0],
      ["skipped", 0, 0, 0],
      ["success", 7, 0, 7],
      ["success", 2, 0, 2],
      ["success", 0, 4, 4],
    ]) {
      const output = join(temp, `output-${outcome}-${airStatus}-${cacheStatus}`);
      // These are inert shell functions. No node compiler, ccache, package manager or workflow runs.
      const script =
        `stub_ccache() { return ${cacheStatus}; }\nnode() { test "\${EM_COMPILER_WRAPPER:-unset}" = "${outcome === "success" ? "stub_ccache" : "unset"}" || return 97; return ${airStatus}; }\n` +
        segment
          .replaceAll("${{ steps.air_objects_setup.outcome }}", outcome)
          .replaceAll("/usr/bin/ccache", "stub_ccache") +
        'test -z "${EM_COMPILER_WRAPPER:-}"\ntest -z "${CCACHE_CONFIGPATH:-}"\n';
      const env = { ...process.env, GITHUB_OUTPUT: output, RUNNER_TEMP: temp };
      delete env.EM_COMPILER_WRAPPER;
      delete env.CCACHE_CONFIGPATH;
      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail"], {
        input: script,
        env,
        encoding: "utf8",
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, expectedStatus, result.stderr);
      if (expectedStatus === 0)
        assert.equal(await readFile(output, "utf8"), "air_compiler_verified=true\n");
      else await assert.rejects(readFile(output), { code: "ENOENT" });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
