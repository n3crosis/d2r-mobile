// 只使用存储估算替身；不访问真实存储或改变权限。
// Storage-estimate doubles only; no real storage access or permission changes.
import assert from "node:assert/strict";
import test from "node:test";
import { readOpfsStorageAdvisory } from "../opfs-storage-advisory.mjs";
const storage = (value) => ({ estimate: async () => value });
test("reports origin estimate and compares only explicit known staging requirements", async () => {
  const options = { storage: storage({ quota: 1000, usage: 300 }) };
  const unknown = await readOpfsStorageAdvisory(options);
  assert.deepEqual(unknown, {
    status: "estimated",
    quotaBytes: 1000,
    usageBytes: 300,
    availableBytes: 700,
    requiredBytes: null,
    sufficiency: "unknown",
    advisoryOnly: true,
  });
  assert.ok(Object.isFrozen(unknown));
  assert.equal(
    (await readOpfsStorageAdvisory({ ...options, requiredBytes: 700 })).sufficiency,
    "estimated-sufficient",
  );
  assert.equal(
    (await readOpfsStorageAdvisory({ ...options, requiredBytes: 701 })).sufficiency,
    "estimated-insufficient",
  );
  assert.equal(
    (await readOpfsStorageAdvisory({ ...options, requiredBytes: 0 })).sufficiency,
    "estimated-sufficient",
  );
  const over = await readOpfsStorageAdvisory({
    storage: storage({ quota: 10, usage: 12 }),
    requiredBytes: 1,
  });
  assert.equal(over.availableBytes, 0);
  assert.equal(over.sufficiency, "estimated-insufficient");
});
test("missing, throwing or rejected APIs are advisory unavailable, never a normal-mode gate", async () => {
  for (const candidate of [
    null,
    {},
    { estimate: 1 },
    {
      get estimate() {
        throw new Error("unavailable");
      },
    },
    {
      estimate() {
        throw new Error("unavailable");
      },
    },
    {
      estimate() {
        return Promise.reject(new Error("unavailable"));
      },
    },
  ]) {
    const result = await readOpfsStorageAdvisory({ storage: candidate, requiredBytes: 100 });
    assert.equal(result.status, "unavailable");
    assert.equal(result.availableBytes, null);
    assert.equal(result.sufficiency, "unknown");
  }
});
test("missing and unsafe numeric estimates stay unknown without coercion", async () => {
  for (const value of [
    null,
    {},
    { quota: 100 },
    { quota: 100, usage: undefined },
    ...[-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "100", 100n].flatMap((n) => [
      { quota: n, usage: 0 },
      { quota: 100, usage: n },
    ]),
    {
      get quota() {
        throw new Error("bad getter");
      },
      usage: 0,
    },
  ]) {
    const result = await readOpfsStorageAdvisory({ storage: storage(value) });
    assert.equal(result.status, "invalid");
    assert.equal(result.availableBytes, null);
    assert.equal(result.sufficiency, "unknown");
  }
});
test("timeout returns promptly and late rejected estimates remain observed", async () => {
  let reject;
  const result = await readOpfsStorageAdvisory({
    storage: {
      estimate: () =>
        new Promise((_, r) => {
          reject = r;
        }),
    },
    timeoutMs: 5,
  });
  assert.equal(result.status, "timeout");
  assert.equal(result.availableBytes, null);
  reject(new Error("late failure"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});
test("pre-cancel avoids estimation; pending cancellation returns unknown without hanging", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  assert.equal(
    (
      await readOpfsStorageAdvisory({
        storage: {
          estimate() {
            calls++;
          },
        },
        signal: controller.signal,
      })
    ).status,
    "cancelled",
  );
  assert.equal(calls, 0);
  const active = new AbortController(),
    pending = readOpfsStorageAdvisory({
      storage: { estimate: () => new Promise(() => {}) },
      signal: active.signal,
    });
  await Promise.resolve();
  active.abort();
  assert.equal((await pending).status, "cancelled");
});
test("only estimate is invoked and option limits reject configuration mistakes", async () => {
  const candidate = {
    estimate() {
      assert.equal(this, candidate);
      return { quota: 100, usage: 0 };
    },
    persist() {
      assert.fail("must not request persistence");
    },
    getDirectory() {
      assert.fail("must not inspect files");
    },
  };
  await readOpfsStorageAdvisory({ storage: candidate });
  for (const options of [
    { requiredBytes: -1 },
    { requiredBytes: Infinity },
    { requiredBytes: 1.1 },
    { timeoutMs: 0 },
    { timeoutMs: 30001 },
    { signal: {} },
  ])
    await assert.rejects(readOpfsStorageAdvisory({ storage: candidate, ...options }), /options/);
});
