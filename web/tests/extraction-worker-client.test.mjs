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
