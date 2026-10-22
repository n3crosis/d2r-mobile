import test from "node:test";
import assert from "node:assert/strict";
import { createExtractionWorkerClient } from "../extraction-worker-client.mjs";

import { MockWorker } from "./helpers/extraction-worker.mjs";
const make = (options = {}) => {
  const worker = new MockWorker();
  return {
    worker,
    client: createExtractionWorkerClient({ createWorker: () => worker, ...options }),
  };
};
const read = (client, options) =>
  client.readRomfs({ token: "generation", offset: 0n, count: 2 }, options);
test("serializes bounded requests and receives isolated transferred arrays", async () => {
  const { worker, client } = make({ maxQueue: 1 });
  const first = read(client),
    second = read(client);
  await assert.rejects(read(client), /EXTRACTION_QUEUE_LIMIT/);
  assert.equal(worker.requests.length, 1);
  const bytes = new Uint8Array([1, 2]);
  worker.emit({ id: 1, ok: true, result: structuredClone(bytes, { transfer: [bytes.buffer] }) });
  assert.equal(bytes.byteLength, 0);
  assert.deepEqual(await first, new Uint8Array([1, 2]));
  assert.equal(worker.requests.length, 2);
  worker.emit({ id: 2, ok: true, result: new Uint8Array([3, 4]) });
  assert.deepEqual(await second, new Uint8Array([3, 4]));
  client.close();
  assert.equal(worker.terminated, true);
  assert.equal(worker.listeners.size, 0);
});
test("abort terminates active and queued requests without propagating abort reason", async () => {
  const { worker, client } = make();
  const controller = new AbortController();
  const pending = [read(client), read(client, { signal: controller.signal })];
  controller.abort("SECRET-CANARY");
  for (const promise of pending)
    await assert.rejects(promise, /^ExtractionClientError: EXTRACTION_CANCELLED$/);
  assert.equal(worker.terminated, true);
  await assert.rejects(read(client), /EXTRACTION_DISPOSED/);
});
test("timeout is terminal for the entire queue", async () => {
  const { worker, client } = make({ timeoutMs: 10 });
  const results = await Promise.allSettled([read(client), read(client)]);
  assert.ok(
    results.every((r) => r.status === "rejected" && r.reason.code === "EXTRACTION_TIMEOUT"),
  );
  assert.equal(worker.terminated, true);
});
test("stale ids, malformed shapes, foreign errors, short reads and generation reuse fail closed", async () => {
  for (const response of [
    { id: 9, ok: true, result: new Uint8Array(2) },
    { id: 1, ok: true, result: new Uint8Array(2), extra: "canary" },
    { id: 1, ok: false, error: "SECRET-CANARY" },
    { id: 1, ok: true, result: new Uint8Array(1) },
    { id: 1, ok: true, result: new Uint8Array(4).subarray(1, 3) },
  ]) {
    const { worker, client } = make();
    const promise = read(client);
    worker.emit(response);
    await assert.rejects(promise, /^ExtractionClientError: EXTRACTION_PROTOCOL_FAILED$/);
    assert.equal(worker.terminated, true);
  }
  const { worker, client } = make();
  const promise = client.openRomfs("same");
  worker.emit({ id: 1, ok: true, result: { token: "same", size: 80n } });
  await assert.rejects(promise, /EXTRACTION_PROTOCOL_FAILED/);
});
test("fixed worker failure and crash expose no native detail", async () => {
  for (const crash of [false, true]) {
    const { worker, client } = make();
    const promise = read(client);
    if (crash) worker.listeners.get("error")({ message: "SECRET-CANARY" });
    else worker.emit({ id: 1, ok: false, error: "EXTRACTION_FAILED" });
    await assert.rejects(promise, crash ? /EXTRACTION_WORKER_FAILED/ : /EXTRACTION_FAILED/);
    assert.equal(worker.terminated, true);
  }
});
test("fixed API strips unknown properties and rejects out of bounds reads before send", async () => {
  const { worker, client } = make();
  assert.equal(client.execute, undefined);
  for (const payload of [
    { token: "t", offset: 0n, count: 65537 },
    { token: "t", offset: -1n, count: 1 },
  ])
    await assert.rejects(client.readRomfs(payload), /EXTRACTION_READ_BOUNDS/);
  assert.equal(worker.requests.length, 0);
  const pending = client.dispose();
  worker.emit({ id: 1, ok: true, result: { disposed: true } });
  await pending;
  await client.dispose();
  assert.equal(worker.requests.length, 1);
});

test("large verification operations survive the old deadline but expire at their bounded total deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const operation of ["initialize", "openRomfs"]) {
    const { worker, client } = make();
    const pending =
      operation === "initialize"
        ? client.initialize({ nsps: [], prodKeys: new Blob(), titleKeys: new Blob() })
        : client.openRomfs("exefs");
    const checked = assert.rejects(pending, /^ExtractionClientError: EXTRACTION_TIMEOUT$/);
    t.mock.timers.tick(120000);
    assert.equal(worker.terminated, false);
    t.mock.timers.tick(2 * 60 * 60 * 1000 - 120001);
    assert.equal(worker.terminated, false);
    t.mock.timers.tick(1);
    await checked;
    assert.equal(worker.terminated, true);
    assert.equal(worker.listeners.size, 0);
  }
});

test("short reads and disposal retain short deadlines while select retains two minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const operation of ["readRomfs", "readExefs", "dispose", "select"]) {
    const { worker, client } = make();
    const pending =
      operation === "readRomfs"
        ? read(client)
        : operation === "readExefs"
          ? client.readExefs({ token: "t", index: 0, offset: 0n, count: 1 })
          : operation === "dispose"
            ? client.dispose()
            : client.select({});
    const checked = assert.rejects(pending, /EXTRACTION_TIMEOUT/);
    const deadline = operation === "select" ? 120000 : 30000;
    t.mock.timers.tick(deadline - 1);
    assert.equal(worker.terminated, false);
    t.mock.timers.tick(1);
    await checked;
    assert.equal(worker.terminated, true);
  }
});

test("trusted per-operation overrides are snapshotted and include queued time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const operationTimeoutMs = { openRomfs: 1000000, readRomfs: 100 };
  const { worker, client } = make({ operationTimeoutMs });
  operationTimeoutMs.readRomfs = 1000000; // Cannot prolong already configured leases.
  const opening = client.openRomfs("exefs"),
    queued = read(client);
  const checked = Promise.all([
    assert.rejects(opening, /EXTRACTION_TIMEOUT/),
    assert.rejects(queued, /EXTRACTION_TIMEOUT/),
  ]);
  t.mock.timers.tick(99);
  assert.equal(worker.terminated, false);
  assert.equal(worker.requests.length, 1);
  t.mock.timers.tick(1);
  await checked;
  assert.equal(worker.terminated, true);
  assert.equal(
    worker.requests.length,
    1,
    "queued read never reaches worker after its total deadline",
  );
});

test("long-operation cancellation remains immediate and cannot be renewed by late worker replies", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { worker, client } = make({ operationTimeoutMs: { openRomfs: 6 * 60 * 60 * 1000 } });
  const controller = new AbortController();
  const pending = client.openRomfs("exefs", { signal: controller.signal });
  const checked = assert.rejects(pending, /^ExtractionClientError: EXTRACTION_CANCELLED$/);
  t.mock.timers.tick(120001);
  assert.equal(worker.terminated, false);
  controller.abort("PRIVATE-CANARY");
  assert.equal(worker.terminated, true);
  await checked;
  worker.emit({ id: 1, ok: true, result: { token: "romfs", size: 100n } });
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  await assert.rejects(read(client), /EXTRACTION_DISPOSED/);
});

test("operation deadlines cannot be disabled, unbounded or applied to arbitrary RPC", () => {
  let created = 0;
  const createWorker = () => {
    created++;
    return new MockWorker();
  };
  for (const operationTimeoutMs of [
    null,
    [],
    { execute: 1 },
    { initialize: 0 },
    { initialize: Infinity },
    { openRomfs: 6 * 60 * 60 * 1000 + 1 },
    { readRomfs: 120001 },
    { dispose: -1 },
    { select: undefined },
    { readExefs: 1.5 },
  ])
    assert.throws(
      () => createExtractionWorkerClient({ createWorker, operationTimeoutMs }),
      /EXTRACTION_CLIENT_OPTIONS/,
    );
  assert.equal(created, 0, "invalid budgets reject before opening isolated runtime");
});

test("successful slow verification clears its timer before later bounded reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { worker, client } = make();
  const pending = client.openRomfs("exefs");
  t.mock.timers.tick(600001);
  worker.emit({ id: 1, ok: true, result: { token: "romfs", size: 100n } });
  assert.deepEqual(await pending, { token: "romfs", size: 100n });
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  assert.equal(worker.terminated, false, "successful request has no residual long timer");
  const bytes = read(client);
  t.mock.timers.tick(29999);
  worker.emit({ id: 2, ok: true, result: new Uint8Array([1, 2]) });
  assert.deepEqual(await bytes, new Uint8Array([1, 2]));
  client.close();
});

test("allowlisted initialization progress and diagnoses expose no arbitrary worker text", async () => {
  const { worker, client } = make();
  const events = [];
  const pending = client.initialize(
    { nsps: [], prodKeys: new Blob(), titleKeys: new Blob() },
    {
      onProgress: (event) => events.push(event),
    },
  );
  const progress = { stage: "content-hash", completed: 0, total: 3, bytes: 1234 };
  worker.emit({ id: 1, progress });
  assert.deepEqual(events, [progress]);
  assert.equal(worker.terminated, false);
  worker.emit({ id: 1, ok: false, error: "PROD_KEYS_MALFORMED" });
  await assert.rejects(pending, /^ExtractionClientError: PROD_KEYS_MALFORMED$/);
  assert.equal(worker.terminated, true);
});

test("RomFS verification progress reaches the caller without completing the request", async () => {
  const { worker, client } = make();
  const events = [];
  const pending = client.openRomfs("exefs", { onProgress: (event) => events.push(event) });
  const progress = { stage: "romfs-base", completed: 50, total: 100, bytes: 4294967296 };
  worker.emit({ id: 1, progress });
  assert.deepEqual(events, [progress]);
  assert.equal(worker.terminated, false);
  worker.emit({ id: 1, ok: true, result: { token: "romfs", size: 100n } });
  assert.deepEqual(await pending, { token: "romfs", size: 100n });
  client.close();
});

test("ExeFS open progress reaches selection without closing its worker", async () => {
  const { worker, client } = make();
  const events = [];
  const pending = client.select({}, { onProgress: (event) => events.push(event) });
  const progress = { stage: "exefs-open", completed: 0, total: 0, bytes: 0 };
  worker.emit({ id: 1, progress });
  assert.deepEqual(events, [progress]);
  assert.equal(worker.terminated, false);
  worker.emit({ id: 1, ok: true, result: { selection: {}, token: "exefs", entries: [] } });
  assert.deepEqual(await pending, { selection: {}, token: "exefs", entries: [] });
  client.close();
});

// 进度观察者的异步结果不改变成功、原始失败或现有截止时间。
// Async progress observers cannot change success, original failure, or existing deadlines.
test("rejected async extraction progress is observed without replacing worker outcomes", async () => {
  for (const failed of [false, true]) {
    const { worker, client } = make();
    const pending = client.openRomfs("exefs", {
      onProgress: async () => {
        throw new Error("synthetic observer failure");
      },
    });
    const checked = failed
      ? assert.rejects(pending, /^ExtractionClientError: PROD_KEYS_MALFORMED$/)
      : pending;
    worker.emit({ id: 1, progress: { stage: "romfs-base", completed: 50, total: 100, bytes: 64 } });
    if (failed) worker.emit({ id: 1, ok: false, error: "PROD_KEYS_MALFORMED" });
    else worker.emit({ id: 1, ok: true, result: { token: "romfs", size: 80n } });
    const result = await checked;
    if (!failed) assert.equal(result.token, "romfs");
    await new Promise((resolve) => setImmediate(resolve));
    client.close();
    assert.equal(worker.terminated, true);
    assert.equal(worker.listeners.size, 0);
  }
});
test("unsettled extraction observer does not renew the existing deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { worker, client } = make({ operationTimeoutMs: { openRomfs: 20 } });
  const pending = client.openRomfs("exefs", { onProgress: () => new Promise(() => {}) });
  const checked = assert.rejects(pending, /^ExtractionClientError: EXTRACTION_TIMEOUT$/);
  t.mock.timers.tick(19);
  worker.emit({ id: 1, progress: { stage: "romfs-base", completed: 50, total: 100, bytes: 64 } });
  t.mock.timers.tick(1);
  await checked;
  assert.equal(worker.terminated, true);
});

test("aborting from an async progress observer still cancels active and queued extraction", async () => {
  const { worker, client } = make();
  const controller = new AbortController();
  const pending = client.openRomfs("exefs", {
    signal: controller.signal,
    async onProgress() {
      controller.abort("Synthetic private abort reason");
      throw new Error("Synthetic observer failure");
    },
  });
  const checked = Promise.all([
    assert.rejects(pending, /^ExtractionClientError: EXTRACTION_CANCELLED$/),
    assert.rejects(read(client), /^ExtractionClientError: EXTRACTION_CANCELLED$/),
  ]);
  worker.emit({ id: 1, progress: { stage: "romfs-base", completed: 50, total: 100, bytes: 64 } });
  await checked;
  assert.equal(worker.terminated, true);
  assert.equal(worker.listeners.size, 0);
  assert.equal(worker.requests.length, 1);
  await new Promise((resolve) => setImmediate(resolve));
});
