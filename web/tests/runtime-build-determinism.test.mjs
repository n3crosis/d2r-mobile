// 用模拟工具验证可复现元数据输入，不执行真正的 Git 操作或编译器构建。
// Verify reproducible metadata inputs with mock tools, without real Git operations or compiler builds.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const commit = "f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7";

async function mockBuild(t, epoch) {
  const directory = await mkdtemp(join(tmpdir(), "d2r-build-metadata-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin"),
    upstream = join(directory, "source");
  await mkdir(bin);
  await mkdir(upstream);
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
case "$3 $4" in
  'rev-parse HEAD') printf '%s\\n' '${commit}' ;;
  'show -s') printf '%s\\n' "$D2R_MOCK_EPOCH" ;;
  *) exit 99 ;;
esac
`,
    { mode: 0o755 },
  );
  const capture = join(directory, "calls.jsonl");
  await writeFile(
    join(bin, "cmake"),
    `#!${process.execPath}
require('node:fs').appendFileSync(process.env.D2R_CAPTURE, JSON.stringify({args:process.argv.slice(2),epoch:process.env.SOURCE_DATE_EPOCH,tz:process.env.TZ})+'\\n');
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [
      fileURLToPath(new URL("../toolchain/spirv-cross-spike/build.sh", import.meta.url)),
      "native",
      upstream,
      join(directory, "build"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SOURCE_DATE_EPOCH: "1",
        TZ: "Asia/Shanghai",
        D2R_MOCK_EPOCH: epoch,
        D2R_CAPTURE: capture,
      },
    },
  );
  const calls = await readFile(capture, "utf8").then(
    (text) =>
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return { result, calls };
}

test("verified upstream epoch and UTC override ambient build metadata", async (t) => {
  const { result, calls } = await mockBuild(t, "1700000000");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[0], "-S");
  assert.equal(calls[1].args[0], "--build");
  for (const call of calls) {
    assert.equal(call.epoch, "1700000000");
    assert.equal(call.tz, "UTC");
  }
});

test("invalid upstream epoch fails before configure or build", async (t) => {
  const { result, calls } = await mockBuild(t, "not-an-epoch");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid upstream commit epoch/);
  assert.deepEqual(calls, []);
});

test("project-only revision opt-outs retain portable debug symbols and external provenance", async () => {
  const [project, build] = await Promise.all([
    source("../toolchain/shader-spike/ShaderSpike.csproj"),
    source("../runtime-build/build.mjs"),
  ]);
  assert.match(
    project,
    /<IncludeSourceRevisionInInformationalVersion>false<\/IncludeSourceRevisionInInformationalVersion>/,
  );
  assert.match(project, /<EnableSourceLink>false<\/EnableSourceLink>/);
  assert.match(project, /<DebugType>portable<\/DebugType>/);
  assert.match(project, /<DebugSymbols>true<\/DebugSymbols>/);
  assert.doesNotMatch(project, /<(?:EnableSourceControlManagerQueries|SourceRevisionId)>/);
  for (const field of ["sourceRevision", "sourceDirty", "crossCommit", "emscripten", "dotnet"])
    assert.match(build, new RegExp(`\\b${field}(?:\\s*:|,)`));
});
