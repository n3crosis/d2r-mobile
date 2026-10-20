// 用临时合成输出验证只读诊断边界；不运行 Git、SDK 或真实编译器。
// Verify read-only diagnostic bounds with temporary synthetic outputs, without Git, SDKs or actual compilers.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { inspectShaderSourceLink } from "../runtime-build/shader-sourcelink-diagnostic.mjs";

const revision = "a".repeat(40);
const schema = "shader-sourcelink-diagnostic-v1";
const direct = "obj/Release/net10.0/ShaderSpike.sourcelink.json";
const nested = "obj/Release/net10.0/browser-wasm/ShaderSpike.sourcelink.json";
const data = (current = true) =>
  JSON.stringify({
    documents: {
      "/private-build-path/*": `https://raw.githubusercontent.com/owner/repository/${current ? revision : "b".repeat(40)}/*`,
    },
  });
async function fixture(t) {
  const projectDirectory = await mkdtemp(join(tmpdir(), "d2r-sourcelink-"));
  t.after(() => rm(projectDirectory, { recursive: true, force: true }));
  return {
    projectDirectory,
    inspect: (sourceRevision = revision) =>
      inspectShaderSourceLink({ projectDirectory, sourceRevision }),
    async write(path, bytes) {
      const target = join(projectDirectory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },
  };
}

test("known candidates emit only bounded hashes and revision-presence metadata", async (t) => {
  for (const path of [direct, nested]) {
    const f = await fixture(t),
      raw = data();
    await f.write(path, raw);
    assert.deepEqual(await f.inspect(), {
      schema,
      status: "present",
      bytes: Buffer.byteLength(raw),
      sha256: createHash("sha256").update(raw).digest("hex"),
      documentMappings: 1,
      containsCurrentAppRevision: true,
    });
    await f.write(path, data(false));
    const result = await f.inspect();
    assert.equal(result.containsCurrentAppRevision, false);
    assert.doesNotMatch(
      JSON.stringify(result),
      /private-build-path|githubusercontent|owner|repository/,
    );
  }
});

test("absent, ambiguous and malformed inputs produce fixed nonfatal statuses", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.inspect(), { schema, status: "absent" });
  await f.write("unrelated/secret.sourcelink.json", data());
  assert.deepEqual(await f.inspect(), { schema, status: "absent" });
  for (const raw of [
    "not-json",
    JSON.stringify({ documents: [] }),
    JSON.stringify({ documents: {}, other: "secret" }),
    JSON.stringify({ documents: { x: "https://secret:password@example.test/*" } }),
    JSON.stringify({
      documents: Object.fromEntries(
        Array.from({ length: 129 }, (_, index) => [String(index), "https://example.test/*"]),
      ),
    }),
    " ".repeat(65537),
    Buffer.from([0xff]),
  ]) {
    await f.write(direct, raw);
    assert.deepEqual(await f.inspect(), { schema, status: "invalid" });
  }
  await f.write(direct, data());
  assert.deepEqual(await f.inspect("invalid revision"), { schema, status: "invalid" });
  await f.write(nested, data());
  assert.deepEqual(await f.inspect(), { schema, status: "ambiguous" });
});

test("candidate files and directory ancestry cannot be symlinks", async (t) => {
  for (const part of [
    "obj",
    "obj/Release",
    "obj/Release/net10.0",
    "obj/Release/net10.0/browser-wasm",
    direct,
  ]) {
    const f = await fixture(t);
    await f.write("outside/ShaderSpike.sourcelink.json", data());
    await mkdir(dirname(join(f.projectDirectory, part)), { recursive: true });
    await symlink(
      join(f.projectDirectory, part === direct ? "outside/ShaderSpike.sourcelink.json" : "outside"),
      join(f.projectDirectory, part),
    );
    assert.deepEqual(await f.inspect(), { schema, status: "invalid" });
  }
});

test("revision matches only URL path segments, never source paths or substrings", async (t) => {
  const f = await fixture(t);
  await f.write(
    direct,
    JSON.stringify({
      documents: {
        [`/${revision}/*`]: `https://example.test/prefix${revision}suffix/*`,
      },
    }),
  );
  assert.equal((await f.inspect()).containsCurrentAppRevision, false);
});

test("diagnostic runs after publish and reuses outer manifest revision without payload inclusion", async () => {
  const build = await readFile(new URL("../runtime-build/build.mjs", import.meta.url), "utf8");
  assert.equal([...build.matchAll(/run\("git", \["rev-parse", "HEAD"\], root, true\)/g)].length, 1);
  assert.match(
    build,
    /run\(command, args, resolve\(root, directory\)\);\s+if \(name === "shader browser publish"\)/,
  );
  assert.match(build, /build: \{[\s\S]*?crossCommit,\s+sourceRevision,/);
  const assembly = await readFile(new URL("../runtime-build/package.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(assembly, /shader-sourcelink-diagnostic|\.sourcelink\.json/);
});
