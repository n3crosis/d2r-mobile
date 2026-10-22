import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, truncate, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inventoryShaderCorpus } from "../scripts/inventory-shader-corpus.mjs";
const keyA = "0000000000000001",
  keyB = "0000000000000002";
async function directory(t) {
  const folder = await mkdtemp(join(tmpdir(), "private-shader-corpus-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
async function base(
  folder,
  key = keyA,
  source = "fragment float4 privateName() { return float4(1); }\n",
) {
  await writeFile(join(folder, `${key}_b.metallib`), source);
  await writeFile(join(folder, `${key}_b.json`), JSON.stringify({ key: `${key}_b`, stage: "ps" }));
}

test("matches exact filename/raw-hash source digest and counts deduplicated base/fetch sources", async (t) => {
  const folder = await directory(t);
  const normalized = "fragment float4 privateName() { return float4(1); }\n";
  await base(folder, keyB, normalized.replaceAll("\n", "\r\n"));
  await base(folder, keyA, normalized);
  await writeFile(join(folder, `${keyA}_bf.metallib`), normalized);
  const digest = createHash("sha256");
  for (const key of [keyA, keyB]) {
    digest.update(`${key}_b.metal`);
    digest.update(createHash("sha256").update(normalized).digest());
  }
  const expectedDigest = digest.digest("hex").slice(0, 16);
  const result = await inventoryShaderCorpus(folder, { expectedDigest, expectedCount: 2 });
  assert.equal(result.sourceDigest, expectedDigest);
  assert.equal(result.baseCount, 2);
  assert.equal(result.fetchCount, 1);
  assert.equal(result.uniqueNormalizedSourceHashCount, 1);
  assert.equal(result.expectation, "matches");
  assert.equal(result.authenticated, false);
  assert.equal(result.inventory.stages.ps, 3);
  assert.doesNotMatch(JSON.stringify(result), /privateName|\.metallib|private-shader-corpus/);
  assert.equal((await inventoryShaderCorpus(folder)).expectation, "not-checked");
  assert.equal(
    (await inventoryShaderCorpus(folder, { expectedDigest, expectedCount: 3 })).expectation,
    "mismatch",
  );
});

test("rejects compiled MTLB bytes and malformed source encoding", async (t) => {
  const folder = await directory(t);
  await base(folder, keyA, Buffer.from([77, 84, 76, 66, 0, 0, 0, 0]));
  await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_COMPILED_BINARY" });
  await base(folder, keyA, Buffer.from([255, 255]));
  await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_INVALID_UTF8" });
  await base(folder, keyA, "private\0source");
  await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_INVALID_SOURCE" });
});

test("rejects missing or malformed metadata and mismatched shader identity", async (t) => {
  const folder = await directory(t);
  await writeFile(join(folder, `${keyA}_b.metallib`), "fragment void f() {}");
  await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_MISSING_COMPANION" });
  for (const content of ["private broken json", JSON.stringify({ stage: "secretStage" })]) {
    await writeFile(join(folder, `${keyA}_b.json`), content);
    await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_INVALID_METADATA" });
  }
  await writeFile(
    join(folder, `${keyA}_b.json`),
    JSON.stringify({ key: `${keyB}_b`, stage: "ps" }),
  );
  await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_METADATA_KEY_MISMATCH" });
});

test("does not skip unexpected shader files or traverse mixed chain folders", async (t) => {
  const folder = await directory(t);
  await base(folder);
  await writeFile(join(folder, "private_unknown_b.metallib"), "private");
  await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_UNEXPECTED_ENTRY" });
  await rm(join(folder, "private_unknown_b.metallib"));
  await mkdir(join(folder, "b-other-chain"));
  await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_NONREGULAR_ENTRY" });
});

test("rejects symlink inputs, selected symlink directories and oversized regular sources", async (t) => {
  const folder = await directory(t);
  const outside = await directory(t);
  await base(outside);
  await symlink(join(outside, `${keyA}_b.metallib`), join(folder, `${keyA}_b.metallib`));
  await assert.rejects(inventoryShaderCorpus(folder), { code: "CORPUS_NONREGULAR_ENTRY" });
  const link = join(folder, "selected-link");
  await symlink(outside, link, "dir");
  await assert.rejects(inventoryShaderCorpus(link), { code: "CORPUS_INVALID_DIRECTORY" });
  await truncate(join(outside, `${keyA}_b.metallib`), 8 * 1024 * 1024 + 1);
  await assert.rejects(inventoryShaderCorpus(outside), { code: "CORPUS_FILE_SIZE" });
});

test("CLI emits only safe codes for private paths and metadata and supports explicit expectations", async (t) => {
  const folder = await directory(t);
  const script = fileURLToPath(new URL("../scripts/inventory-shader-corpus.mjs", import.meta.url));
  await base(folder);
  const good = spawnSync(process.execPath, [script, folder], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).baseCount, 1);
  const mismatch = spawnSync(
    process.execPath,
    [script, folder, "--expected-digest", "0000000000000000", "--expected-count", "1"],
    { encoding: "utf8" },
  );
  assert.equal(mismatch.status, 2);
  assert.equal(JSON.parse(mismatch.stdout).expectation, "mismatch");
  await writeFile(join(folder, `${keyA}_b.json`), "private secret broken JSON");
  const bad = spawnSync(process.execPath, [script, folder], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr, "CORPUS_INVALID_METADATA\n");
  assert.equal(bad.stdout, "");
});
