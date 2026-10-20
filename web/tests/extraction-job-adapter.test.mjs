import test from "node:test";
import assert from "node:assert/strict";
import { createExtractionJobAdapter } from "../extraction-job-adapter.mjs";
import { MockWorker } from "./helpers/extraction-worker.mjs";
// One root directory and a data directory containing only a synthetic CASC manifest.
function romfsFixture() {
  const name = new TextEncoder().encode("build_manifest.psv");
  const manifest = new TextEncoder().encode("Synthetic manifest header\n");
  const dirStart = 84,
    dirSize = 52,
    hashStart = dirStart + dirSize;
  const fileStart = hashStart + 4,
    fileSize = 32 + Math.ceil(name.length / 4) * 4;
  const bytes = new Uint8Array(256 + manifest.length),
    v = new DataView(bytes.buffer);
  const u32 = (p, x) => v.setUint32(p, x, true),
    u64 = (p, x) => v.setBigUint64(p, BigInt(x), true);
  [80, 80, 4, dirStart, dirSize, hashStart, 4, fileStart, fileSize, 256].forEach((x, i) =>
    u64(i * 8, x),
  );
  u32(80, 0);
  u32(hashStart, 0);
  [0, 0xffffffff, 24, 0xffffffff, 0xffffffff, 0].forEach((x, i) => u32(dirStart + i * 4, x));
  [0, 0xffffffff, 0xffffffff, 0, 0xffffffff, 4].forEach((x, i) => u32(dirStart + 24 + i * 4, x));
  bytes.set(new TextEncoder().encode("data"), dirStart + 48);
  u32(fileStart, 24);
  u32(fileStart + 4, 0xffffffff);
  u64(fileStart + 8, 0);
  u64(fileStart + 16, manifest.length);
  u32(fileStart + 24, 0xffffffff);
  u32(fileStart + 28, name.length);
  bytes.set(name, fileStart + 32);
  bytes.set(manifest, 256);
  return bytes;
}
const selection = {
  base: { version: 1 },
  patch: null,
  dlc: [],
  effectiveVersion: 1,
  applicationId: 1n,
};
function fixture({ entries, selected = selection, maxProgramBytes, failRead = false } = {}) {
  const romfs = romfsFixture();
  let generation = "exefs",
    disposed = false;
  const worker = new MockWorker(({ operation, payload }) => {
    if (operation === "initialize") return { records: [{ version: 1 }], inventory: [] };
    if (operation === "select")
      return {
        selection: selected,
        token: generation,
        entries: entries ?? [
          { index: 0, name: "main", size: 70000n, offset: 0n },
          { index: 1, name: "sdk", size: 8n, offset: 70000n },
        ],
      };
    if (operation === "readExefs") {
      assert.equal(payload.token, generation);
      assert.equal(generation, "exefs");
      if (failRead) throw new Error("PRIVATE-CANARY");
      return new Uint8Array(payload.count).fill(payload.index + 1);
    }
    if (operation === "openRomfs") {
      assert.equal(payload.token, generation);
      generation = "romfs";
      return { token: generation, size: BigInt(romfs.length) };
    }
    if (operation === "readRomfs") {
      assert.equal(payload.token, generation);
      return romfs.slice(Number(payload.offset), Number(payload.offset) + payload.count);
    }
    if (operation === "dispose") {
      disposed = true;
      return { disposed: true };
    }
    throw new Error("unknown request");
  });
  const adapter = createExtractionJobAdapter({ createWorker: () => worker, maxProgramBytes });
  return {
    adapter,
    worker,
    get disposed() {
      return disposed;
    },
  };
}
async function open(f, signal) {
  const session = await f.adapter.openSecretSession({
    inputs: { nsps: [], prodKeys: new Blob(["synthetic"]), titleKeys: new Blob(["synthetic"]) },
    signal,
  });
  return session;
}
test("stages main and sdk before token transition and returns only plaintext capabilities", async () => {
  const f = fixture();
  const session = await open(f);
  const first = await f.adapter.inspectContents({ session });
  first.records[0].version = 99;
  assert.equal((await f.adapter.inspectContents({ session })).records[0].version, 1);
  const extracted = await f.adapter.extractSelected({ session, selection });
  assert.deepEqual(Object.keys(extracted).sort(), ["logicalAssets", "programModules", "romfs"]);
  assert.deepEqual(Object.keys(extracted.programModules), ["main", "sdk"]);
  assert.equal(extracted.programModules.main.length, 70000);
  assert.equal(extracted.programModules.sdk.length, 8);
  assert.equal(extracted.programModules.sdk[0], 2);
  const ops = f.worker.requests.map((r) => r.operation);
  assert.deepEqual(ops.slice(0, 6), [
    "initialize",
    "select",
    "readExefs",
    "readExefs",
    "readExefs",
    "openRomfs",
  ]);
  assert.ok(
    f.worker.requests
      .filter((r) => r.operation.startsWith("read"))
      .every((r) => r.payload.count <= 65536),
  );
  const member = extracted.romfs.getFile("data/build_manifest.psv");
  assert.equal((await member.readAt(0n, 1))[0], 83);
  await session.dispose();
  assert.equal(f.disposed, true);
  assert.equal(f.worker.terminated, true);
  await assert.rejects(member.readAt(0n, 0), /EXTRACTION_DISPOSED/);
  await assert.rejects(extracted.logicalAssets.read("anything"), /EXTRACTION_DISPOSED/);
  assert.equal(
    extracted.programModules.main[0],
    1,
    "session disposal does not destroy staged generator inputs",
  );
  await f.adapter.cleanup();
  assert.ok(extracted.programModules.main.every((x) => x === 0));
  assert.ok(extracted.programModules.sdk.every((x) => x === 0));
});
test("rejects mismatched selection, DLC, missing sdk, aggregate budgets before RomFS", async () => {
  for (const config of [
    { selected: { ...selection, effectiveVersion: 2 } },
    { entries: [{ index: 0, name: "main", size: 1n }] },
    { maxProgramBytes: 70007 },
  ]) {
    const f = fixture(config),
      session = await open(f);
    await assert.rejects(
      f.adapter.extractSelected({ session, selection }),
      /^ExtractionClientError: EXTRACTION_FAILED$/,
    );
    assert.equal(f.worker.terminated, true);
    assert.ok(!f.worker.requests.some((r) => r.operation === "openRomfs"));
    assert.ok(!f.worker.requests.some((r) => r.operation === "readExefs"));
  }
  const f = fixture(),
    session = await open(f);
  await assert.rejects(
    f.adapter.extractSelected({ session, selection: { ...selection, dlc: [{}] } }),
    /EXTRACTION_FAILED/,
  );
  assert.ok(!f.worker.requests.some((r) => r.operation === "select"));
});
test("terminal read failure, cancellation, reuse and failed initialization clean up", async () => {
  const f = fixture({ failRead: true }),
    session = await open(f);
  await assert.rejects(
    f.adapter.extractSelected({ session, selection }),
    /^ExtractionClientError: EXTRACTION_FAILED$/,
  );
  assert.equal(f.worker.terminated, true);
  await f.adapter.cleanup();
  await assert.rejects(open(f), /EXTRACTION_SINGLE_USE/);
  const g = fixture(),
    controller = new AbortController(),
    s = await open(g, controller.signal);
  controller.abort("PRIVATE-CANARY");
  assert.equal(g.worker.terminated, true);
  await assert.rejects(g.adapter.inspectContents({ session: s }), /EXTRACTION_DISPOSED/);
  const worker = new MockWorker(() => {
    throw new Error("PRIVATE-CANARY");
  });
  const adapter = createExtractionJobAdapter({ createWorker: () => worker });
  await assert.rejects(
    adapter.openSecretSession({ inputs: {} }),
    /^ExtractionClientError: EXTRACTION_FAILED$/,
  );
  assert.equal(worker.terminated, true);
});

test("per-read cancellation terminates an in-flight bounded RomFS read", async () => {
  const f = fixture(),
    session = await open(f);
  const extracted = await f.adapter.extractSelected({ session, selection });
  const member = extracted.romfs.getFile("data/build_manifest.psv");
  f.worker.handler = undefined; // A native request that does not return.
  const controller = new AbortController();
  const pending = member.readAt(0n, 1, { signal: controller.signal });
  controller.abort("PRIVATE-CANARY");
  await assert.rejects(pending, /^ExtractionClientError: EXTRACTION_DISPOSED$/);
  assert.equal(f.worker.terminated, true);
  await f.adapter.cleanup();
});
