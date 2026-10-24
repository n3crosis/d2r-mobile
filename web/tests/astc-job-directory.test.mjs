// 合成 OPFS 句柄测试所有权和异步故障；不声称真实浏览器锁或磁盘行为。
// Synthetic OPFS handles test ownership and asynchronous failures, not real browser locking or disk behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { createAstcJobDirectory } from "../astc-job-directory.mjs";
const id = "12345678-1234-4123-8123-123456789abc";
const missing = () => new DOMException("missing", "NotFoundError");
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const entries = new Map(),
    log = [];
  let createHook, removeHook;
  const child = () => {
    const identity = {};
    return {
      kind: "directory",
      identity,
      async isSameEntry(other) {
        return other.identity === identity;
      },
    };
  };
  const root = {
    kind: "directory",
    async getDirectoryHandle(name, options) {
      log.push(options?.create ? "create" : "get");
      if (options?.create) {
        if (createHook) await createHook();
        const value = child();
        entries.set(name, value);
        return value;
      }
      if (!entries.has(name)) throw missing();
      return entries.get(name);
    },
    async removeEntry(name, options) {
      log.push("remove");
      assert.equal(options.recursive, true);
      if (removeHook) await removeHook();
      if (!entries.delete(name)) throw missing();
    },
  };
  return {
    root,
    entries,
    log,
    child,
    set createHook(value) {
      createHook = value;
    },
    set removeHook(value) {
      removeHook = value;
    },
  };
}
const options = (f, extra = {}) => ({
  root: f.root,
  randomUUID: () => id,
  cleanupTimeoutMs: 30,
  ...extra,
});
test("fresh lease retained until explicit disposal, stop before identity checked removal", async () => {
  const f = fixture(),
    lease = await createAstcJobDirectory(
      options(f, {
        stopAndDrain: () => {
          f.log.push("stop");
        },
      }),
    );
  assert.equal(lease.root, [...f.entries.values()][0]);
  assert.equal(lease.status.phase, "ready");
  assert.equal(f.entries.size, 1);
  await lease.dispose();
  assert.equal(lease.status.phase, "disposed");
  assert.equal(lease.status.removed, true);
  assert.ok(f.log.indexOf("stop") < f.log.indexOf("remove"));
  assert.throws(() => lease.root, /NOT_READY/);
  await lease.dispose();
  assert.equal(f.log.filter((v) => v === "remove").length, 1);
});
test("preexisting or replaced entries are never removed", async () => {
  const f = fixture(),
    name = `d2rm-astc-job-${id}`,
    original = f.child();
  f.entries.set(name, original);
  let failure;
  try {
    await createAstcJobDirectory(options(f));
  } catch (error) {
    failure = error;
  }
  assert.match(failure.cause.message, /COLLISION/);
  await failure.lease.dispose();
  assert.equal(f.entries.get(name), original);
  assert.ok(!f.log.includes("remove"));
  f.entries.delete(name);
  const lease = await createAstcJobDirectory(options(f)),
    replacement = f.child();
  f.entries.set(name, replacement);
  await assert.rejects(lease.dispose(), (error) => /IDENTITY_CHANGED/.test(error.cause.message));
  assert.equal(f.entries.get(name), replacement);
  assert.equal(lease.status.phase, "cleanup-failed");
  assert.ok(!f.log.includes("remove"));
});
test("failed removal is observable and retryable without losing ownership", async () => {
  const f = fixture(),
    lease = await createAstcJobDirectory(options(f));
  f.removeHook = () => {
    throw new DOMException("locked", "InvalidStateError");
  };
  await assert.rejects(lease.dispose(), /CLEANUP_FAILED/);
  assert.equal(lease.status.removed, false);
  assert.equal(f.entries.size, 1);
  f.removeHook = undefined;
  await lease.dispose();
  assert.equal(f.entries.size, 0);
  assert.equal(lease.status.removed, true);
});
test("uncertain removal timeout remains single-flight and can be awaited again", async () => {
  const f = fixture(),
    gate = deferred(),
    lease = await createAstcJobDirectory(options(f));
  f.removeHook = () => gate.promise;
  await assert.rejects(lease.dispose(), (error) => /TIMEOUT/.test(error.cause.message));
  assert.equal(lease.status.cleanupPending, true);
  assert.equal(lease.status.removed, false);
  const retry = lease.dispose();
  assert.equal(f.log.filter((v) => v === "remove").length, 1);
  gate.resolve();
  await retry;
  assert.equal(lease.status.removed, true);
});
test("late creation after timeout exposes lease and cleans only acquired directory", async () => {
  const f = fixture(),
    gate = deferred();
  f.createHook = () => gate.promise;
  let failure;
  try {
    await createAstcJobDirectory(options(f));
  } catch (error) {
    failure = error;
  }
  assert.match(failure.cause.message, /TIMEOUT/);
  assert.ok(failure.lease);
  assert.equal(failure.lease.status.cleanupPending, true);
  gate.resolve();
  await failure.lease.dispose();
  assert.equal(f.entries.size, 0);
  assert.equal(failure.lease.status.removed, true);
  assert.equal(f.log.filter((v) => v === "create").length, 1);
});
test("abort during creation and stop failure keep cleanup observable", async () => {
  const f = fixture(),
    gate = deferred(),
    controller = new AbortController();
  f.createHook = () => gate.promise;
  const pending = createAstcJobDirectory(options(f, { signal: controller.signal }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  let failure;
  try {
    await pending;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure.lease);
  gate.resolve();
  await failure.lease.dispose();
  assert.equal(f.entries.size, 0);
  const g = fixture();
  let calls = 0;
  const lease = await createAstcJobDirectory(
    options(g, {
      stopAndDrain: () => {
        if (++calls === 1) throw new Error("stop failed");
      },
    }),
  );
  await assert.rejects(lease.dispose(), /CLEANUP_FAILED/);
  assert.ok(!g.log.includes("remove"));
  await lease.dispose();
  assert.equal(calls, 2);
  assert.equal(lease.status.removed, true);
});

test("pending shutdown prevents removal and retry does not issue shutdown twice", async () => {
  const f = fixture(),
    gate = deferred();
  let calls = 0;
  const lease = await createAstcJobDirectory(
    options(f, {
      stopAndDrain: () => {
        calls++;
        return gate.promise;
      },
    }),
  );
  await assert.rejects(lease.dispose(), /CLEANUP_FAILED/);
  assert.equal(calls, 1);
  assert.ok(!f.log.includes("remove"));
  const retry = lease.dispose();
  gate.resolve();
  await retry;
  assert.equal(calls, 1);
  assert.equal(lease.status.removed, true);
});
test("pre-aborted creation performs no filesystem access and missing owned directory is released", async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(createAstcJobDirectory(options(f, { signal: controller.signal })), /abort/i);
  assert.equal(f.log.length, 0);
  const lease = await createAstcJobDirectory(options(f));
  f.entries.clear();
  await lease.dispose();
  assert.equal(lease.status.removed, true);
  assert.ok(!f.log.includes("remove"));
});
