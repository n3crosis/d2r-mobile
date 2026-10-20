import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { writeCascOverlay, OVERLAY_LIMITS } from "../casc-overlay-writer.mjs";
const base = new URL("../toolchain/asset-generation-spike/", import.meta.url);
const script = new URL("test/casc-overlay-oracle.py", base);
execFileSync("python3", [new URL("scripts/package-casc-overlay.py", base).pathname]);
const fixture = JSON.parse(
  execFileSync("python3", [script.pathname], { maxBuffer: 4 * 1024 * 1024 }),
);
function source(changes = {}) {
  const reads = [];
  const files = Object.entries({ ...fixture.files, ...changes }).map(([path, encoded]) => {
    const bytes = Buffer.from(encoded, "base64");
    return {
      path,
      size: BigInt(bytes.length),
      async readAt(start, count) {
        reads.push({ path, start, count });
        return new Uint8Array(bytes.subarray(Number(start), Number(start) + count));
      },
    };
  });
  return { files, reads, getFile: (path) => files.find((f) => f.path === path) };
}
function worker() {
  return {
    close() {},
    async run(operation, payload, options) {
      assert.equal(operation, "casc-overlay");
      const result = JSON.parse(
        execFileSync("python3", [script.pathname, "serialize"], {
          input: JSON.stringify({ payload: Buffer.from(payload).toString("base64"), options }),
          maxBuffer: 4 * 1024 * 1024,
        }),
      );
      result.files = Object.fromEntries(
        Object.entries(result.files).map(([path, b64]) => [
          path,
          Uint8Array.from(Buffer.from(b64, "base64")).buffer,
        ]),
      );
      return result;
    },
  };
}
const jobs = () =>
  fixture.replacements.map((j) => ({
    ...j,
    bytes: Uint8Array.from(Buffer.from(j.bytes, "base64")),
  }));
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
