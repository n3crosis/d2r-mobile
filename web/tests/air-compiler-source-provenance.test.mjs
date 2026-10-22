import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { airCompilerSourceIdentity } from "../runtime-build/air-compiler-assets.mjs";

const root = new URL("../toolchain/metal-air-compiler/", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Source-only provenance checks: no compiler artifact is loaded or executed.
test("AIR source manifest authenticates every patch and every patched source path", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const patchPaths = manifest.patches.map(({ path }) => path);
  assert.equal(new Set(patchPaths).size, patchPaths.length);
  assert.deepEqual(
    (await readdir(new URL("patches/", root)))
      .filter((name) => name.endsWith(".patch"))
      .map((name) => `patches/${name}`)
      .sort(),
    [...patchPaths].sort(),
  );
  const sourcePaths = new Set();
  for (const patch of manifest.patches) {
    assert.match(patch.path, /^patches\/[A-Za-z0-9_.+-]+\.patch$/);
    const bytes = await readFile(new URL(patch.path, root));
    assert.equal(hash(bytes), patch.sha256, patch.path);
    const targets = [...bytes.toString("utf8").matchAll(/^\+\+\+ b\/(.+)$/gm)];
    assert(targets.length > 0, `No source targets in ${patch.path}`);
    for (const [, path] of targets) {
      assert.match(path, /^[A-Za-z0-9_.+/-]+$/);
      assert(!path.split("/").includes(".."));
      assert.match(manifest.patchedFiles[path] ?? "", /^[a-f0-9]{64}$/, path);
      sourcePaths.add(path);
    }
  }
  assert.deepEqual([...sourcePaths].sort(), Object.keys(manifest.patchedFiles).sort());
  for (const patch of manifest.rebaseProvenance.previousProjectPatches) {
    assert.match(patch.sha256, /^[a-f0-9]{64}$/);
    assert(patch.rebasedInto.length > 0);
    for (const target of patch.rebasedInto) assert(patchPaths.includes(target), target);
  }
});

test("AIR runtime source identity binds the complete manifest and all ordered patches", async () => {
  const identity = await airCompilerSourceIdentity();
  const manifestBytes = await readFile(new URL("manifest.json", root));
  assert.equal(identity.sourceManifestSha256, hash(manifestBytes));
  assert.equal(identity.sourceCommit, identity.manifest.commit);
  for (const patch of identity.manifest.patches)
    assert.equal(identity.sourceInputs[patch.path], patch.sha256, patch.path);
  assert.deepEqual(
    Object.keys(identity.sourceInputs)
      .filter((path) => path.startsWith("patches/"))
      .sort(),
    identity.manifest.patches.map(({ path }) => path).sort(),
  );
  assert.equal(
    identity.sourceFingerprintSha256,
    hash(
      JSON.stringify({
        sourceManifestSha256: identity.sourceManifestSha256,
        sourceInputs: identity.sourceInputs,
      }),
    ),
  );
});
