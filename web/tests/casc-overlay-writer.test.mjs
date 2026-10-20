import assert from "node:assert/strict";
import test from "node:test";
import { writeCascOverlay, OVERLAY_LIMITS } from "../casc-overlay-writer.mjs";
import { fixture, source, worker, jobs } from "./helpers/casc-overlay-fixture.mjs";
test("real config, TVFS and n/z/multiblock BLTE archive equal independent original-native overlay", async () => {
  const romfs = source();
  const result = await writeCascOverlay({ romfs, replacements: jobs(), worker: worker() });
  assert.deepEqual(result.inventory, fixture.inventory);
  for (const [path, b64] of Object.entries(fixture.expected))
    assert.deepEqual(Buffer.from(result.files[path]), Buffer.from(b64, "base64"));
  const archiveReads = romfs.reads.filter((r) => r.path.endsWith(".data"));
  assert.ok(archiveReads.length > 0);
  // Old asset data comes before both TVFS records and must never be fetched.
  assert.ok(archiveReads.every((r) => r.start > 0n));
  assert.ok(romfs.reads.every((r) => r.count <= 64 * 1024));
});
test("empty overlay returns no changed files without any source reads", async () => {
  const romfs = source();
  assert.deepEqual(await writeCascOverlay({ romfs, replacements: [], worker: worker() }), {
    files: {},
    inventory: [],
  });
  assert.equal(romfs.reads.length, 0);
});
test("first manifest duplicate wins, preserving native overlay lookup", async () => {
  const manifest = Buffer.from(fixture.files["data/build_manifest.psv"], "base64").toString();
  const duplicate = manifest
    .split("\n")[1]
    .replace(/\|[0-9a-f]{32}\|/g, "|" + "f".repeat(32) + "|");
  const romfs = source({
    "data/build_manifest.psv": Buffer.from(manifest + duplicate + "\n").toString("base64"),
  });
  const out = await writeCascOverlay({ romfs, replacements: jobs(), worker: worker() });
  assert.deepEqual(out.inventory, fixture.inventory);
});
test("rejects short reads and corrupt authenticated-record checksums before worker", async () => {
  const romfs = source();
  romfs.files[0].readAt = async () => new Uint8Array(0);
  await assert.rejects(writeCascOverlay({ romfs, replacements: jobs(), worker: worker() }));
  const config = Buffer.from(fixture.files["data/.build.config"], "base64")
    .toString()
    .replace(/vfs-1 = ./, "vfs-1 = f");
  await assert.rejects(
    writeCascOverlay({
      romfs: source({ "data/.build.config": Buffer.from(config).toString("base64") }),
      replacements: jobs(),
      worker: worker(),
    }),
  );
});
test("bounds, duplicate normalized paths and absent source are rejected", async () => {
  for (const replacements of [
    [{ path: "../bad", bytes: new Uint8Array() }],
    [{ path: "data/n.bin", bytes: new Uint8Array(OVERLAY_LIMITS.replacement + 1) }],
    [...jobs(), jobs()[0]],
    [{ path: "data/missing", bytes: new Uint8Array() }],
  ]) {
    await assert.rejects(writeCascOverlay({ romfs: source(), replacements, worker: worker() }));
  }
});
test("abort stops serializer worker and does not release partial output", async () => {
  const controller = new AbortController();
  let closed = 0;
  const pending = {
    close() {
      closed++;
    },
    async run() {
      controller.abort();
      return { files: {} };
    },
  };
  await assert.rejects(
    writeCascOverlay({
      romfs: source(),
      replacements: jobs(),
      worker: pending,
      signal: controller.signal,
    }),
  );
  assert.equal(closed, 1);
});
