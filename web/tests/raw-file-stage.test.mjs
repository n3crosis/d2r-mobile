// 只用内存文件系统替身测试原始文件暂存的边界、所有权和错误；不构成真实浏览器证明。
// Test raw-stage bounds, ownership and failures with an in-memory filesystem double, not real-browser proof.
import test from "node:test";
import assert from "node:assert/strict";
import { createRawFileStage, RAW_FILE_STAGE_CHUNK_BYTES } from "../raw-file-stage.mjs";
const uuid = "12345678-1234-4123-8123-123456789abc";
const name = `d2rm-raw-${uuid}`;
const notFound = () => new DOMException("missing", "NotFoundError");
function filesystem(faults = {}) {
  const entries = new Map([["unrelated", { keep: true }]]),
    events = [];
  let bytes = new Uint8Array(),
    closed = false;
  const handle = {
    async createWritable(options) {
      events.push(["open", options]);
      if (faults.open) throw faults.open;
      return {
        async write({ type, position, data }) {
          events.push(["write", position, data.length]);
          assert.equal(type, "write");
          assert.ok(data.length <= RAW_FILE_STAGE_CHUNK_BYTES);
          assert.ok(position <= bytes.length);
          await faults.onWrite?.();
          if (faults.write) throw faults.write;
          const next = new Uint8Array(Math.max(bytes.length, position + data.length));
          next.set(bytes);
          next.set(data, position);
          bytes = next;
        },
        async close() {
          events.push(["close"]);
          await faults.onClose?.();
          if (faults.close) throw faults.close;
          closed = true;
        },
        async abort() {
          events.push(["abort"]);
          if (faults.abort) throw faults.abort;
        },
      };
    },
    async getFile() {
      events.push(["getFile"]);
      assert.equal(closed, true);
      if (faults.file) throw faults.file;
      const blob = new Blob([faults.changedSize ? new Uint8Array(bytes.length + 1) : bytes]);
      if (!faults.read && !faults.shortRead && !faults.onRead && !faults.onReadBuffer) return blob;
      return {
        size: blob.size,
        slice(start, end) {
          assert.ok(end - start <= RAW_FILE_STAGE_CHUNK_BYTES);
          return {
            async arrayBuffer() {
              await faults.onRead?.();
              if (faults.read) throw faults.read;
              const buffer = await blob
                .slice(start, faults.shortRead ? Math.max(start, end - 1) : end)
                .arrayBuffer();
              faults.onReadBuffer?.(buffer);
              return buffer;
            },
          };
        },
      };
    },
  };
  const root = {
    kind: "directory",
    async getDirectoryHandle(key, options) {
      events.push(["directory", key, options?.create ?? false]);
      if (!options?.create) {
        if (!entries.has(key)) throw notFound();
        return entries.get(key);
      }
      const child = {
        async getFileHandle(fileName, opts) {
          assert.equal(fileName, "data.bin");
          assert.deepEqual(opts, { create: true });
          if (faults.childFile) throw faults.childFile;
          return handle;
        },
      };
      entries.set(key, child);
      faults.onCreate?.();
      return child;
    },
    async removeEntry(key, options) {
      events.push(["remove", key, options]);
      assert.equal(key, name);
      assert.deepEqual(options, { recursive: true });
      if (faults.remove) throw faults.remove;
      if (!entries.delete(key)) throw notFound();
    },
  };
  return {
    root,
    entries,
    events,
    make: (options = {}) =>
      createRawFileStage({
        root,
        maxBytes: 2 * RAW_FILE_STAGE_CHUNK_BYTES,
        randomUUID: () => uuid,
        ...options,
      }),
  };
}

test("sequential appends and bounded backpatch produce replayable closed snapshot", async () => {
  const fs = filesystem();
  const stage = await fs.make();
  await stage.append(Uint8Array.of(1, 2, 3));
  await stage.backpatch(1, Uint8Array.of(8));
  await stage.append(Uint8Array.of(4, 5));
  const source = await stage.finalize();
  assert.equal(source.size, 5);
  assert.equal(source.file.size, 5);
  for (let i = 0; i < 2; i++)
    assert.deepEqual(await source.readAt(0, 5), Uint8Array.of(1, 8, 3, 4, 5));
  assert.deepEqual(await source.readAt(5, 0), new Uint8Array());
  assert.ok(
    fs.events.findIndex((event) => event[0] === "close") <
      fs.events.findIndex((event) => event[0] === "getFile"),
  );
  await stage.dispose();
  await stage.dispose();
  assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
  await assert.rejects(source.readAt(0, 1), /DISPOSED/);
  await assert.rejects(stage.append(Uint8Array.of(9)), /DISPOSED/);
});

test("limits, root and UUID reject before ownership or file writes", async () => {
  for (const maxBytes of [undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const fs = filesystem();
    await assert.rejects(fs.make({ maxBytes }), /INVALID_LIMIT/);
    assert.equal(fs.events.length, 0);
  }
  await assert.rejects(createRawFileStage({ maxBytes: 1 }), /ROOT_REQUIRED/);
  const fs = filesystem();
  await assert.rejects(fs.make({ randomUUID: () => "../bad" }), /INVALID_ID/);
  assert.equal(fs.events.length, 0);
});

test("zero budget and exact chunk/budget limits work without sparse gaps", async () => {
  const empty = await filesystem().make({ maxBytes: 0 });
  assert.equal((await empty.finalize()).size, 0);
  await empty.dispose();
  const stage = await filesystem().make({ maxBytes: RAW_FILE_STAGE_CHUNK_BYTES });
  await stage.append(new Uint8Array(RAW_FILE_STAGE_CHUNK_BYTES));
  await stage.backpatch(RAW_FILE_STAGE_CHUNK_BYTES, new Uint8Array());
  const source = await stage.finalize();
  assert.equal(
    (await source.readAt(0, RAW_FILE_STAGE_CHUNK_BYTES)).length,
    RAW_FILE_STAGE_CHUNK_BYTES,
  );
  await stage.dispose();
  for (const operation of [
    (s) => s.append(new Uint8Array(RAW_FILE_STAGE_CHUNK_BYTES + 1)),
    (s) => s.append(new Uint8Array(5)),
    (s) => s.backpatch(1, Uint8Array.of(1)),
    (s) => s.backpatch(-1, new Uint8Array()),
    (s) => s.backpatch(0.5, new Uint8Array()),
    (s) => s.append([1]),
  ]) {
    const fs = filesystem(),
      s = await fs.make({ maxBytes: 4 });
    await assert.rejects(operation(s), /RAW_STAGE_/);
    assert.equal(
      fs.events.some((event) => event[0] === "write"),
      false,
    );
    await s.dispose();
    assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
  }
});

test("read ranges reject over-limit, fractional and out-of-bounds reads", async () => {
  for (const [offset, length] of [
    [0, RAW_FILE_STAGE_CHUNK_BYTES + 1],
    [-1, 1],
    [0.5, 1],
    [0, -1],
    [2, 0],
    [0, 2],
  ]) {
    const stage = await filesystem().make();
    await stage.append(Uint8Array.of(1));
    const source = await stage.finalize();
    await assert.rejects(source.readAt(offset, length), /READ_RANGE/);
    await stage.dispose();
  }
});

test("existing child is never reused or removed", async () => {
  const fs = filesystem();
  fs.entries.set(name, { existing: true });
  await assert.rejects(fs.make(), /COLLISION/);
  assert.deepEqual(fs.entries.get(name), { existing: true });
  assert.equal(
    fs.events.some((event) => event[0] === "remove"),
    false,
  );
});

test("creation, quota, write, close and snapshot failures clean only owned child", async () => {
  for (const field of ["childFile", "open", "write", "close", "file", "changedSize"]) {
    const cause = new DOMException(
      field,
      field === "write" ? "QuotaExceededError" : "OperationError",
    );
    const fs = filesystem({ [field]: field === "changedSize" ? true : cause });
    let stage;
    await assert.rejects(
      async () => {
        stage = await fs.make();
        await stage.append(Uint8Array.of(1));
        await stage.finalize();
      },
      field === "changedSize" ? /SIZE_CHANGED/ : (error) => error === cause,
    );
    await stage?.dispose();
    assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
  }
});

test("cleanup failure is observable and dispose retries owned resources", async () => {
  const faults = { remove: new Error("remove failed") };
  const fs = filesystem(faults),
    stage = await fs.make();
  await assert.rejects(stage.dispose(), /CLEANUP_FAILED/);
  assert.ok(fs.entries.has(name));
  delete faults.remove;
  await stage.dispose();
  assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
});

test("failed writer abort retains the stage until a successful dispose retry", async () => {
  const faults = { abort: new Error("abort failed") };
  const fs = filesystem(faults),
    stage = await fs.make();
  await stage.append(Uint8Array.of(1, 2, 3));
  await assert.rejects(stage.dispose(), (error) => {
    assert.match(error.message, /CLEANUP_FAILED/);
    assert.deepEqual(error.errors, [faults.abort]);
    return true;
  });
  assert.ok(fs.entries.has(name));
  assert.equal(fs.events.filter((event) => event[0] === "remove").length, 0);
  delete faults.abort;
  await stage.dispose();
  assert.equal(fs.events.filter((event) => event[0] === "abort").length, 2);
  assert.equal(fs.events.filter((event) => event[0] === "remove").length, 1);
  assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
  await stage.dispose();
  assert.equal(fs.events.filter((event) => event[0] === "remove").length, 1);
});

test("abort before and during creation or writes cleans safely", async () => {
  const controller = new AbortController();
  controller.abort();
  const pre = filesystem();
  await assert.rejects(pre.make({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(pre.events.length, 0);
  for (const phase of ["onCreate", "onWrite", "onClose"]) {
    const ctl = new AbortController();
    const fs = filesystem({ [phase]: () => ctl.abort() });
    let stage;
    await assert.rejects(
      async () => {
        stage = await fs.make({ signal: ctl.signal });
        await stage.append(Uint8Array.of(1));
        await stage.finalize();
      },
      { name: "AbortError" },
    );
    await stage?.dispose();
    assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
  }
});

test("concurrent writes reject and disposal drains the pending browser call", async () => {
  let unblock, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const wait = new Promise((resolve) => {
    unblock = resolve;
  });
  const fs = filesystem({
    onWrite: () => {
      started();
      return wait;
    },
  });
  const stage = await fs.make();
  const writing = stage.append(Uint8Array.of(1));
  await entered;
  await assert.rejects(stage.append(Uint8Array.of(2)), /CONCURRENT_OPERATION/);
  const disposed = stage.dispose();
  assert.equal(
    fs.events.some((event) => event[0] === "remove"),
    false,
  );
  unblock();
  await assert.rejects(writing, /DISPOSED/);
  await disposed;
  assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
});

test("finalize is one-shot and writes after finalization reject", async () => {
  for (const operation of [
    (s) => s.finalize(),
    (s) => s.append(Uint8Array.of(1)),
    (s) => s.backpatch(0, new Uint8Array()),
  ]) {
    const stage = await filesystem().make();
    await stage.finalize();
    await assert.rejects(operation(stage), /NOT_WRITABLE/);
    await stage.dispose();
  }
});

test("read errors, short reads and cancellation reject and remove only the owned child", async () => {
  for (const mode of ["read", "shortRead", "abort"]) {
    const controller = new AbortController();
    const reason = new Error("read failed");
    const faults =
      mode === "abort"
        ? { onRead: () => controller.abort() }
        : { [mode]: mode === "read" ? reason : true };
    const fs = filesystem(faults);
    const stage = await fs.make({ signal: controller.signal });
    await stage.append(Uint8Array.of(1, 2));
    const source = await stage.finalize();
    await assert.rejects(
      source.readAt(0, 2),
      mode === "abort"
        ? { name: "AbortError" }
        : mode === "read"
          ? (error) => error === reason
          : /SHORT_READ/,
    );
    await stage.dispose();
    assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
  }
});

test("operation and cleanup errors retain both causes and support later cleanup retry", async () => {
  const write = new Error("disk failed"),
    abort = new Error("abort failed"),
    remove = new Error("remove failed");
  const faults = { write, abort, remove };
  const fs = filesystem(faults),
    stage = await fs.make();
  await assert.rejects(stage.append(Uint8Array.of(1)), (error) => {
    assert.equal(error.cause, write);
    assert.equal(error.errors[0], write);
    assert.deepEqual(error.errors[1].errors, [abort]);
    return true;
  });
  assert.equal(
    fs.events.some((event) => event[0] === "remove"),
    false,
  );
  assert.ok(fs.entries.has(name));
  delete faults.abort;
  await assert.rejects(stage.dispose(), (error) => {
    assert.deepEqual(error.errors, [remove]);
    return true;
  });
  assert.ok(fs.entries.has(name));
  delete faults.remove;
  await stage.dispose();
  assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
});

test("idle abort triggers cleanup and source reads reject afterward", async () => {
  const controller = new AbortController(),
    fs = filesystem();
  const stage = await fs.make({ signal: controller.signal });
  const source = await stage.finalize();
  controller.abort();
  await stage.dispose();
  await assert.rejects(source.readAt(0, 0), { name: "AbortError" });
  assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
});

test("non-AbortSignal inputs reject before filesystem access", async () => {
  for (const signal of [
    null,
    false,
    "signal",
    {},
    new AbortController(),
    {
      throwIfAborted() {},
      addEventListener() {},
      removeEventListener() {},
    },
  ]) {
    const fs = filesystem();
    await assert.rejects(fs.make({ signal }), /INVALID_SIGNAL/);
    assert.equal(fs.events.length, 0);
  }
});

test("small views cannot retain oversized, shared or resizable backing buffers", async () => {
  const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
  assert.equal(resizable.resizable, true);
  for (const bytes of [
    new Uint8Array(new ArrayBuffer(RAW_FILE_STAGE_CHUNK_BYTES + 1), 0, 1),
    new Uint8Array(new SharedArrayBuffer(8), 0, 1),
    new Uint8Array(resizable, 0, 1),
  ]) {
    for (const method of ["append", "backpatch"]) {
      const fs = filesystem(),
        stage = await fs.make();
      await stage.append(Uint8Array.of(1));
      const before = fs.events.filter((event) => event[0] === "write").length;
      await assert.rejects(
        method === "append" ? stage.append(bytes) : stage.backpatch(0, bytes),
        /INVALID_CHUNK/,
      );
      assert.equal(fs.events.filter((event) => event[0] === "write").length, before);
      await stage.dispose();
      assert.deepEqual([...fs.entries.keys()], ["unrelated"]);
    }
  }
});

// 失败的读取副本尚未转交调用方；成功读取和空读取保持原有所有权。
// Failed read copies have not been handed to callers; successful and empty reads retain their ownership contract.
test("raw stage wipes unreturned read buffers on cancellation and short reads", async () => {
  for (const mode of ["abort", "shortRead"]) {
    const controller = new AbortController();
    let captured;
    const fs = filesystem({
      shortRead: mode === "shortRead",
      onReadBuffer(buffer) {
        captured = new Uint8Array(buffer);
        if (mode === "abort") controller.abort();
      },
    });
    const stage = await fs.make({ signal: controller.signal });
    await stage.append(Uint8Array.of(7, 8, 9));
    const source = await stage.finalize();
    await assert.rejects(
      source.readAt(0, 3),
      mode === "abort" ? { name: "AbortError" } : /RAW_STAGE_SHORT_READ/,
    );
    assert.ok(captured.length > 0);
    assert.ok(captured.every((value) => value === 0));
    await stage.dispose();
    assert.equal(fs.entries.has(name), false);
    assert.equal(fs.entries.has("unrelated"), true);
  }
});

test("successful raw stage reads remain caller-owned after disposal, including empty reads", async () => {
  const fs = filesystem();
  const stage = await fs.make();
  await stage.append(Uint8Array.of(7, 8));
  const source = await stage.finalize();
  const bytes = await source.readAt(0, 2);
  const empty = await source.readAt(2, 0);
  await stage.dispose();
  assert.deepEqual([...bytes], [7, 8]);
  assert.equal(empty.length, 0);
});
