// 自造消息端口验证来源绑定、精确偏移、有界并发及失败关闭，不使用私有归档。
// Synthetic ports verify source binding, exact offsets, bounded concurrency and fail-closed cleanup without private archives.
import test from "node:test";
import assert from "node:assert/strict";
import { createArchiveReadRpcHost, createArchiveReadRpcClient } from "../archive-read-rpc.mjs";
function pair() {
  const make = () => {
    const listeners = new Map();
    return {
      listeners,
      sent: [],
      closed: false,
      start() {},
      close() {
        this.closed = true;
      },
      addEventListener(k, f) {
        if (!listeners.has(k)) listeners.set(k, new Set());
        listeners.get(k).add(f);
      },
      removeEventListener(k, f) {
        listeners.get(k)?.delete(f);
      },
      deliver(data) {
        for (const f of [...(listeners.get("message") ?? [])]) f({ data });
      },
      postMessage(data, transfers = []) {
        const copy = structuredClone(data, { transfer: transfers });
        this.sent.push(copy);
        queueMicrotask(() => this.peer.deliver(copy));
      },
    };
  };
  const a = make(),
    b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
function setup(source, options = {}) {
  const [a, b] = pair(),
    host = createArchiveReadRpcHost(a, options),
    client = createArchiveReadRpcClient(b, options);
  const descriptor = host.register(source),
    reader = client.open(descriptor);
  return { a, b, host, client, descriptor, reader };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function detached(port) {
  assert.ok([...port.listeners.values()].every((set) => set.size === 0));
}
test("opaque source binding preserves BigInt offsets and transfers owned copies", async () => {
  const size = (1n << 60n) + 100n,
    backing = new Uint8Array(100000),
    calls = [];
  backing.fill(23);
  const s = setup({
    size,
    readAt(at, count) {
      calls.push([at, count]);
      return backing.subarray(7, 7 + count);
    },
  });
  assert.deepEqual(Object.keys(s.descriptor).sort(), ["id", "size"]);
  assert.equal(s.reader.size, size);
  const bytes = await s.reader.readAt(size - 8n, 8);
  assert.equal(bytes.buffer.byteLength, 8);
  assert.deepEqual([...bytes], Array(8).fill(23));
  assert.deepEqual(calls, [[size - 8n, 8]]);
  assert.equal(backing.byteLength, 100000);
  assert.equal(s.b.sent[0].offset, (size - 8n).toString());
  s.client.close();
  await tick();
  detached(s.a);
  detached(s.b);
});
test("Buffer subviews transfer only the requested bytes without detaching or mutating the source", async () => {
  const backing = Buffer.alloc(32, 99);
  backing.set([1, 2, 3, 4], 9);
  const before = new Uint8Array(backing);
  const s = setup({ size: 4n, readAt: () => backing.subarray(9, 13) });
  try {
    const bytes = await s.reader.readAt(0n, 4);
    assert.deepEqual([...bytes], [1, 2, 3, 4]);
    assert.equal(bytes.buffer.byteLength, 4);
    assert.equal(backing.byteLength, 32);
    assert.deepEqual(new Uint8Array(backing), before);
    bytes.fill(0);
    assert.deepEqual(new Uint8Array(backing), before);
    assert.deepEqual([...(await s.reader.readAt(0n, 4))], [1, 2, 3, 4]);
  } finally {
    s.client.close();
    s.host.close();
  }
});
test("bounds reject locally, concurrency has no queue, identifiers are monotonic", async () => {
  const wait = deferred();
  const s = setup({ size: 100n, readAt: () => wait.promise });
  await assert.rejects(s.reader.readAt(0, 1), /BOUNDS/);
  await assert.rejects(s.reader.readAt(0n, 65537), /BOUNDS/);
  const pending = s.reader.readAt(0n, 1);
  await assert.rejects(s.reader.readAt(0n, 1), /BUSY/);
  wait.resolve(new Uint8Array(1));
  await pending;
  await s.reader.readAt(0n, 1);
  assert.deepEqual(
    s.b.sent.filter((x) => x.type === "read").map((x) => x.id),
    [1, 2],
  );
  s.client.close();
});
test("source errors, short reads and shared buffers never disclose source details", async () => {
  for (const readAt of [
    () => {
      throw new Error("private/name");
    },
    () => new Uint8Array(0),
    () => new Uint8Array(new SharedArrayBuffer(1)),
  ]) {
    const s = setup({ size: 1n, readAt });
    await assert.rejects(
      s.reader.readAt(0n, 1),
      (error) => error.message === "ARCHIVE_RPC_READ" && !error.stack.includes("private"),
    );
    s.client.close();
  }
});
test("abort closes both endpoints, aborts source and suppresses late results", async () => {
  const wait = deferred(),
    entered = deferred();
  let sourceSignal;
  const s = setup({
    size: 1n,
    readAt(_at, _count, { signal }) {
      sourceSignal = signal;
      entered.resolve();
      return wait.promise;
    },
  });
  const controller = new AbortController();
  const pending = s.reader.readAt(0n, 1, { signal: controller.signal });
  await entered.promise;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await tick();
  assert.ok(sourceSignal.aborted);
  wait.resolve(new Uint8Array(1));
  await tick();
  assert.equal(s.a.sent.filter((x) => x.type === "result").length, 0);
  detached(s.a);
  detached(s.b);
});
test("revocation and timeout reject pending reads and release listeners", async () => {
  for (const mode of ["revoke", "timeout"]) {
    const s = setup({ size: 1n, readAt: () => new Promise(() => {}) }, { timeoutMs: 10 });
    const pending = s.reader.readAt(0n, 1);
    if (mode === "revoke") s.host.revoke(s.descriptor.id);
    await assert.rejects(pending, mode === "revoke" ? /CLOSED/ : /TIMEOUT/);
    await tick();
    detached(s.a);
    detached(s.b);
  }
});
test("host rejects forged capabilities, noncanonical offsets, duplicated IDs and oversized reads", async () => {
  for (const patch of [
    { cap: "forged" },
    { offset: "00" },
    { offset: "18446744073709551616" },
    { count: 65537 },
    { id: 2 },
    { path: "private" },
  ]) {
    const s = setup({ size: 100000n, readAt: () => new Uint8Array(1) });
    s.a.deliver({ type: "read", id: 1, cap: s.descriptor.id, offset: "0", count: 1, ...patch });
    await tick();
    assert.ok(s.a.closed);
    detached(s.a);
    detached(s.b);
  }
  const s = setup({ size: 1n, readAt: () => new Uint8Array(1) });
  await s.reader.readAt(0n, 1);
  s.a.deliver(s.b.sent[0]);
  await tick();
  assert.ok(s.a.closed);
});
test("client rejects malformed, duplicate and unsolicited replies", async () => {
  for (const kind of ["malformed", "unsolicited", "duplicate"]) {
    const wait = deferred();
    const s = setup({ size: 1n, readAt: () => wait.promise });
    if (kind === "duplicate") {
      wait.resolve(new Uint8Array(1));
      await s.reader.readAt(0n, 1);
      s.b.deliver({ type: "result", id: 1, bytes: new ArrayBuffer(1) });
    } else {
      const pending = s.reader.readAt(0n, 1);
      s.b.deliver({
        type: "result",
        id: kind === "unsolicited" ? 7 : 1,
        bytes: new ArrayBuffer(2),
      });
      await assert.rejects(pending, /PROTOCOL/);
    }
    await tick();
    assert.ok(s.b.closed);
    detached(s.a);
    detached(s.b);
  }
});

// 真实 MessageChannel 验证可转移缓冲与关闭流程；不代表浏览器工作线程验证。
// A real MessageChannel verifies transfer and closure, not browser-worker integration.
test("real MessageChannel round trip uses bounded buffers", async () => {
  const { port1, port2 } = new MessageChannel();
  const host = createArchiveReadRpcHost(port1),
    client = createArchiveReadRpcClient(port2);
  try {
    const reader = client.open(
      host.register({ size: 65536n, readAt: (_at, count) => new Uint8Array(count).fill(42) }),
    );
    const result = await reader.readAt(0n, 65536);
    assert.equal(result.byteLength, 65536);
    assert.equal(result[65535], 42);
  } finally {
    client.close();
    host.close();
  }
});
test("host enforces pending cap independently of client and global abort releases listeners", async () => {
  const s = setup({ size: 1n, readAt: () => new Promise(() => {}) });
  s.a.deliver({ type: "read", id: 1, cap: s.descriptor.id, offset: "0", count: 1 });
  s.a.deliver({ type: "read", id: 2, cap: s.descriptor.id, offset: "0", count: 1 });
  await tick();
  assert.ok(s.a.closed);
  const controller = new AbortController();
  const t = setup({ size: 1n, readAt: () => new Promise(() => {}) }, { signal: controller.signal });
  const pending = t.reader.readAt(0n, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  detached(t.a);
  detached(t.b);
});
