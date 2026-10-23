import test from "node:test";
import { MockWorker } from "./helpers/extraction-worker.mjs";
import assert from "node:assert/strict";
import {
  createExtractionJobAdapter,
  readAuthenticatedProgramModules,
  readAuthenticatedAssets,
  readInputContentPolicy,
} from "../extraction-job-adapter.mjs";
import {
  D2R_WARLOCK_ID as warlock,
  resolveD2rExpansionSelection,
} from "../d2r-expansion-policy.mjs";
import {
  fixture,
  open,
  selection,
  inspectedFixture,
} from "./helpers/extraction-adapter-fixture.mjs";
test("stages main and sdk before token transition and returns only plaintext capabilities", async () => {
  const f = fixture();
  const session = await open(f);
  const first = await f.adapter.inspectContents({ session });
  first.records[0].version = 99;
  assert.equal((await f.adapter.inspectContents({ session })).records[0].version, 0n);
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
  assert.deepEqual(extracted.logicalAssets.findUniquePathSuffixes([]), []);
  assert.throws(
    () => extracted.logicalAssets.findUniquePathSuffixes(["/missing.sprite"]),
    /EXTRACTION_ASSET_MISSING/,
  );
  const member = extracted.romfs.getFile("data/build_manifest.psv");
  assert.equal((await member.readAt(0n, 1))[0], 83);
  await session.dispose();
  assert.equal(f.disposed, true);
  assert.equal(f.worker.terminated, true);
  await assert.rejects(member.readAt(0n, 0), /EXTRACTION_DISPOSED/);
  assert.throws(() => extracted.logicalAssets.findUniquePathSuffixes([]), /EXTRACTION_DISPOSED/);
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
test("explicit quick mode stays bound across initialization, selection, and RomFS opening", async () => {
  const inspected = inspectedFixture();
  inspected.inventory = inspected.inventory.map((entry) => ({
    ...entry,
    sha256: null,
    hashVerified: false,
  }));
  const selected = resolveD2rExpansionSelection(inspected.records, inspected.inventory, {
    skipContentHashes: true,
  });
  const f = fixture({ inspected, selected, skipContentHashes: true, verifyRomfs: false });
  const session = await open(f);
  const extracted = await f.adapter.extractSelected({ session, selection: selected });
  assert.equal(extracted.romfs.files.length, 1);
  assert.equal(f.worker.requests[0].payload.skipContentHashes, true);
  assert.equal(f.worker.requests[1].payload.options.skipContentHashes, true);
  assert.equal(
    f.worker.requests.find((r) => r.operation === "openRomfs").payload.verifyRomfs,
    false,
  );
  await session.dispose();
  await f.adapter.cleanup();
});
test("rejects mismatched selection, forged DLC, missing sdk, aggregate budgets before RomFS", async () => {
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

test("program provenance binds exact extracted identity, selection and live session", async () => {
  const f = fixture(),
    session = await open(f);
  const extracted = await f.adapter.extractSelected({ session, selection });
  const assets = readAuthenticatedAssets(extracted, selection);
  assert.deepEqual(readInputContentPolicy(extracted, selection), {
    contentMode: "warlock",
    inputProvenance: "authenticated-package",
    dlcMetadata: "authenticated",
  });
  assert.throws(
    () =>
      readInputContentPolicy(extracted, {
        ...selection,
        inputKind: "extracted",
        dlcMetadata: "not-authenticated",
      }),
    /PROVENANCE/,
  );
  assert.equal(assets.romfs, extracted.romfs);
  assert.equal(assets.logicalAssets, extracted.logicalAssets);
  assert.ok(Object.isFrozen(assets.romfs.files));
  assert.ok(assets.romfs.files.every(Object.isFrozen));
  assert.deepEqual(Object.keys(assets.romfs.files[0]).sort(), ["path", "size"]);
  assert.throws(() => readAuthenticatedAssets({ ...extracted }, selection), /PROVENANCE_REJECTED/);
  assert.throws(
    () => readAuthenticatedAssets(extracted, { ...selection, effectiveVersion: 999 }),
    /PROVENANCE_REJECTED/,
  );
  assert.equal(readAuthenticatedProgramModules(extracted, selection), extracted.programModules);
  assert.equal(
    readAuthenticatedProgramModules(extracted, structuredClone(selection)),
    extracted.programModules,
  );
  for (const candidate of [{ ...extracted }, { programModules: extracted.programModules }, null])
    assert.throws(
      () => readAuthenticatedProgramModules(candidate, selection),
      /EXTRACTION_PROVENANCE_REJECTED/,
    );
  assert.throws(
    () => readAuthenticatedProgramModules(extracted, { ...selection, effectiveVersion: 999 }),
    /EXTRACTION_PROVENANCE_REJECTED/,
  );
  const controller = new AbortController();
  controller.abort("PRIVATE-CANARY");
  assert.throws(
    () => readAuthenticatedProgramModules(extracted, selection, { signal: controller.signal }),
    /^ExtractionClientError: EXTRACTION_CANCELLED$/,
  );
  await session.dispose();
  assert.throws(() => readAuthenticatedAssets(extracted, selection), /PROVENANCE_REJECTED/);
  assert.throws(
    () => readAuthenticatedProgramModules(extracted, selection),
    /EXTRACTION_PROVENANCE_REJECTED/,
  );
  await f.adapter.cleanup();
});

test("requires retained known expansion evidence, not caller supplied DLC claims", async () => {
  for (const mutate of [
    (x) => x.records.pop(),
    (x) => x.records.splice(1, 1),
    (x) => {
      x.records[2].titleId++;
    },
    (x) => {
      x.inventory[2].hashVerified = false;
    },
    (x) => {
      x.inventory[2].size++;
    },
    (x) => {
      x.records[2].contents[0].type = 1;
    },
    (x) => {
      x.records[2].contents[0].idOffset = 1;
    },
  ]) {
    const inspected = inspectedFixture();
    mutate(inspected);
    const f = fixture({ inspected }),
      session = await open(f);
    await assert.rejects(
      f.adapter.extractSelected({ session, selection }),
      /^ExtractionClientError: EXTRACTION_FAILED$/,
    );
    assert.ok(!f.worker.requests.some((r) => r.operation === "select"));
    assert.equal(f.worker.terminated, true);
  }
  const f = fixture(),
    session = await open(f);
  await assert.rejects(
    f.adapter.extractSelected({ session, selection: { ...selection, dlc: [] } }),
    /EXTRACTION_FAILED/,
  );
  assert.ok(!f.worker.requests.some((r) => r.operation === "select"));
});

test("forwards explicit DLC version and retains exact evidence in provenance", async () => {
  const inspected = inspectedFixture();
  inspected.records.push({ ...inspected.records[2], version: 1n });
  const dlcVersions = { [warlock.toString(16).padStart(16, "0")]: 1n };
  const chosen = resolveD2rExpansionSelection(inspected.records, inspected.inventory, {
    dlcVersions,
  });
  const f = fixture({ inspected, selected: chosen }),
    session = await open(f);
  const extracted = await f.adapter.extractSelected({ session, selection: chosen });
  assert.deepEqual(f.worker.requests.find((r) => r.operation === "select").payload.options, {
    contentMode: "warlock",
    baseVersion: 0n,
    patchVersion: 65536n,
    dlcVersions,
  });
  assert.equal(readAuthenticatedProgramModules(extracted, chosen), extracted.programModules);
  assert.throws(
    () => readAuthenticatedProgramModules(extracted, { ...chosen, dlc: [] }),
    /EXTRACTION_PROVENANCE_REJECTED/,
  );
  assert.equal(chosen.requiredContents.length, 3);
  assert.equal("owned" in chosen, false);
  await f.adapter.cleanup();
});

test("safe initialization diagnosis survives adapter cleanup", async () => {
  let worker;
  worker = new MockWorker((request) => {
    worker.emit({ id: request.id, ok: false, error: "PROD_KEYS_UNREADABLE" });
  });
  const adapter = createExtractionJobAdapter({ createWorker: () => worker });
  await assert.rejects(
    adapter.openSecretSession({ inputs: {} }),
    /^ExtractionClientError: PROD_KEYS_UNREADABLE$/,
  );
  assert.equal(worker.terminated, true);
});

test("authenticated base and update without DLC work in both permitted content modes", async () => {
  for (const contentMode of ["base-update-only", "optional-warlock"]) {
    const inspected = inspectedFixture();
    inspected.records = inspected.records.slice(0, 2);
    inspected.inventory = inspected.inventory.slice(0, 2);
    const chosen = resolveD2rExpansionSelection(inspected.records, inspected.inventory, {
      contentMode,
    });
    const f = fixture({ inspected, selected: chosen, contentMode });
    const session = await open(f);
    const extracted = await f.adapter.extractSelected({ session, selection: chosen });
    assert.equal(chosen.dlc.length, 0);
    assert.equal(readAuthenticatedProgramModules(extracted, chosen), extracted.programModules);
    assert.equal(
      f.worker.requests.find((r) => r.operation === "select").payload.options.contentMode,
      contentMode,
    );
    await f.adapter.cleanup();
  }
});

for (const revocation of ["cancel", "dispose"])
  test(`fulfilled private RomFS reads are wiped after ${revocation} before delivery`, async () => {
    const f = fixture();
    const session = await open(f);
    const extracted = await f.adapter.extractSelected({ session, selection });
    const file = extracted.romfs.getFile("data/build_manifest.psv");
    const controller = new AbortController();
    const emit = f.worker.emit.bind(f.worker);
    let delivered, disposing;
    f.worker.emit = (message) => {
      if (message.result instanceof Uint8Array) {
        delivered = message.result;
        emit(message);
        if (revocation === "cancel") controller.abort();
        else disposing = session.dispose();
      } else emit(message);
    };
    try {
      await assert.rejects(
        file.readAt(0n, 1, { signal: controller.signal }),
        /EXTRACTION_DISPOSED|Abort/,
      );
      assert.ok(delivered instanceof Uint8Array);
      assert.deepEqual([...delivered], [0]);
      await disposing;
    } finally {
      await f.adapter.cleanup();
    }
  });

test("cleanup after initialization fulfillment cannot publish a disposed session", async () => {
  const f = fixture();
  const emit = f.worker.emit.bind(f.worker);
  let cleaning;
  f.worker.emit = (message) => {
    emit(message);
    if (message.ok && message.result?.records) cleaning = f.adapter.cleanup();
  };
  try {
    await assert.rejects(open(f), /EXTRACTION_FAILED/);
    await cleaning;
    assert.equal(f.worker.terminated, true);
  } finally {
    await f.adapter.cleanup();
  }
});

for (const kind of ["throw", "reject"])
  test(`local extraction phase diagnostics isolate observers that ${kind}`, async () => {
    const f = fixture();
    const session = await open(f);
    let phases = 0;
    try {
      const extracted = await f.adapter.extractSelected({
        session,
        selection,
        onDiagnostic() {
          phases++;
          if (kind === "throw") throw new Error("PRIVATE-OBSERVER");
          return Promise.reject(new Error("PRIVATE-OBSERVER"));
        },
      });
      assert.ok(phases >= 4);
      assert.equal(extracted.programModules.main[0], 1);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      await f.adapter.cleanup();
    }
  });

test("isolating phase diagnostics does not swallow cancellation through the actual signal", async () => {
  const f = fixture();
  const session = await open(f);
  const controller = new AbortController();
  try {
    await assert.rejects(
      f.adapter.extractSelected({
        session,
        selection,
        signal: controller.signal,
        onDiagnostic() {
          controller.abort();
          throw new Error("PRIVATE-OBSERVER");
        },
      }),
      /EXTRACTION_CANCELLED/,
    );
    assert.equal(f.worker.terminated, true);
    assert.equal(
      f.worker.requests.some((request) => request.operation === "readExefs"),
      false,
    );
  } finally {
    await f.adapter.cleanup();
  }
});
