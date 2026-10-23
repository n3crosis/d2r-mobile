// 固定 v2 外壳下载和打包输入，并以隔离模拟验证漂移在联网前失败；不下载或执行外壳。
// Pin v2 shell download/packaging inputs and reject drift before network access using isolated mocks, without downloading or executing shells.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { SHELL_BUILD_INPUTS } from "../runtime-build/package.mjs";
import { BUNDLED_SHELL_PROFILE_IDS, resolveShellProfile } from "../shell-profiles.mjs";
import { assertIsolatedRun } from "./helpers/assert-isolated-run.mjs";

const expected = [
  {
    profileId: "v2.0.0-ios26",
    sourceUrl:
      "https://github.com/jhaizhou-ops/d2r-mobile/releases/download/v2.0.0/D2RMobile-shell-build-input.zip",
    bytes: 4856775,
    sha256: "bc1152694d9a00eef680dd07f8ea31419be5ff4d0437d8298d3772e57cc92c94",
    archivePath: "profile/shell.zip",
    evidencePath: "toolchain/shell-release-evidence/v2.0.0.json",
    metadataPath: "profile/shell.json",
    buildPath: "runtime-build/.build/shell.zip",
  },
  {
    profileId: "v2.0.0-ios18",
    sourceUrl:
      "https://github.com/jhaizhou-ops/d2r-mobile/releases/download/v2.0.0/D2RMobile-shell-ios18-build-input.zip",
    bytes: 4852823,
    sha256: "b2d1e3b48c0b15f773b4ea94290fde08039fd123c21be98c55b00da8df55ada5",
    archivePath: "profile/shell-ios18.zip",
    evidencePath: "toolchain/shell-release-evidence/v2.0.0-ios18.json",
    metadataPath: "profile/shell-ios18.json",
    buildPath: "runtime-build/.build/shell-ios18.zip",
  },
];

test("download and packaging share exactly two independently pinned v2 archives", async () => {
  assert.deepEqual(SHELL_BUILD_INPUTS, expected);
  assert.deepEqual(
    SHELL_BUILD_INPUTS.map((input) => input.profileId),
    BUNDLED_SHELL_PROFILE_IDS,
  );
  assert.ok(Object.isFrozen(SHELL_BUILD_INPUTS));
  for (const input of SHELL_BUILD_INPUTS) {
    const evidence = JSON.parse(
      await readFile(new URL(`../${input.evidencePath}`, import.meta.url), "utf8"),
    );
    assert.ok(Object.isFrozen(input));
    assert.equal(input.sourceUrl, evidence.sourceUrl);
    assert.equal(input.bytes, evidence.archiveBytes);
    assert.equal(input.sha256, evidence.sha256);
    assert.equal(input.archivePath, resolveShellProfile(input.profileId).archivePath);
  }
  for (const id of ["v1.0.18-ios26", "v1.0.18-ios18"])
    assert.ok(
      !SHELL_BUILD_INPUTS.some(
        (input) => input.archivePath === resolveShellProfile(id).archivePath,
      ),
    );
});

test("both provenance layouts include the complete v2 metadata without shipping registry sources", async () => {
  const [packaging, programBuild, downloading] = await Promise.all([
    readFile(new URL("../runtime-build/package.mjs", import.meta.url), "utf8"),
    readFile(new URL("../toolchain/program-rewrite-spike/build-wasm.sh", import.meta.url), "utf8"),
    readFile(new URL("../runtime-build/build.mjs", import.meta.url), "utf8"),
  ]);
  const profileSources = packaging.match(/const shellProfileSources = \[([\s\S]*?)\];/)[1];
  const programSources = programBuild.match(/for file in shell-profiles\.mjs ([\s\S]*?); do/)[1];
  for (const name of [
    "v2.0.0.json",
    "v2.0.0-derived-capacities.json",
    "v2.0.0-ios18.json",
    "v2.0.0-ios18-derived-capacities.json",
  ]) {
    assert.ok(profileSources.includes(`"toolchain/shell-release-evidence/${name}"`));
    assert.ok(programSources.includes(`toolchain/shell-release-evidence/${name}`));
  }
  assert.ok(programSources.includes("shell-v2-evidence.mjs"));
  assert.doesNotMatch(profileSources, /shell-(?:profiles|v2-evidence)\.mjs/);
  assert.match(packaging, /await copy\(input\.buildPath, input, input\.archivePath\)/);
  assert.match(packaging, /await copy\(input\.evidencePath, undefined, input\.metadataPath\)/);
  assert.match(downloading, /for \(const input of SHELL_BUILD_INPUTS\)/);
  assert.match(downloading, /offset !== input\.bytes/);
  assert.match(
    downloading,
    /createHash\("sha256"\)\.update\(shellBytes\)\.digest\("hex"\) !== input\.sha256/,
  );
});

test("each independent shell pin rejects registry drift before network access", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--test",
      "--test-reporter=tap",
      new URL("./fixtures/runtime-shell-build-inputs.mock.mjs", import.meta.url).pathname,
    ],
    { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  assertIsolatedRun(result);
});
