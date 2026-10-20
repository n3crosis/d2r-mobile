// 仅用合成字节、Python 原生编码和内存暂存替身测试补充包；不构成浏览器或游戏证明。
// Test packs with synthetic bytes, native Python encoding and an in-memory stage double; not browser or game proof.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeCascPack } from "../casc-pack-writer.mjs";
const native = new URL("../../dm/tools/casc_overlay.py", import.meta.url).pathname;
function python(code, input, args = []) {
  const result = spawnSync("python3", ["-c", code, ...args], { input, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return new Uint8Array(result.stdout);
}
// 版本字段仅是注入替身的契约值，不声称宿主 Python 是固定版本。
// The version field is only the injected double's contract value, not a claim that host Python is pinned.
const pinnedLibrary = process.env.CASC_PACK_NATIVE_CODEC;
const nativeCompression = `
import sys,ctypes
lib=ctypes.CDLL(sys.argv[1])
lib.png_input.restype=ctypes.POINTER(ctypes.c_ubyte)
lib.png_output.restype=ctypes.POINTER(ctypes.c_ubyte)
lib.generic_zlib_version.restype=ctypes.c_char_p
assert lib.generic_zlib_version()==b"1.2.13"
raw=sys.stdin.buffer.read()
assert lib.zlib_begin(9)==0
for at in range(0,max(1,len(raw)),65536):
 part=raw[at:at+65536]
 ctypes.memmove(lib.png_input(),part,len(part))
 size=lib.zlib_push(len(part),int(at+65536>=len(raw)))
 assert size>=0
 sys.stdout.buffer.write(ctypes.string_at(lib.png_output(),size))
`;
const codec = {
  genericZlibVersion: "1.2.13",
  // 测试桥仅拼接小型合成样本；生产必须注入真正有界的固定版本流式编解码器。
  // The test bridge concatenates small synthetic fixtures only; production must inject the genuinely bounded pinned streaming codec.
  async *compressZlibStream(input, options) {
    const pieces = [];
    for await (const bytes of input) pieces.push(bytes);
    const raw = Buffer.concat(pieces);
    assert.ok(raw.length <= options.maxInputBytes);
    const encoded = python(
      pinnedLibrary
        ? nativeCompression
        : "import sys,zlib; sys.stdout.buffer.write(zlib.compress(sys.stdin.buffer.read(),9))",
      raw,
      pinnedLibrary ? [pinnedLibrary] : [],
    );
    for (let at = 0; at < encoded.length; at += 113) yield encoded.slice(at, at + 113);
  },
};
async function* source(bytes, step = 137) {
  for (let at = 0; at < bytes.length; at += step) yield bytes.slice(at, at + step);
}
async function* jobs(items) {
  yield* items;
}
function memoryStage(faults = {}) {
  let data = new Uint8Array(),
    busy = false;
  const log = [],
    state = { disposed: false, created: false, log };
  const run = async (name, action) => {
    assert.equal(busy, false);
    busy = true;
    try {
      log.push(name);
      await Promise.resolve();
      await faults[name]?.();
      return action();
    } finally {
      busy = false;
    }
  };
  state.createStage = async () => {
    state.created = true;
    return {
      append(bytes) {
        return run("append", () => {
          const next = new Uint8Array(data.length + bytes.length);
          next.set(data);
          next.set(bytes, data.length);
          data = next;
        });
      },
      backpatch(offset, bytes) {
        return run("backpatch", () => data.set(bytes, offset));
      },
      finalize() {
        return run("finalize", () => ({
          size: data.length,
          file: new Blob([data]),
          readAt: async (offset, length) => data.slice(offset, offset + length),
        }));
      },
      async dispose() {
        state.disposed = true;
        await faults.dispose?.();
        data = new Uint8Array();
      },
    };
  };
  return state;
}
async function hashFile(file, { chunkBytes, signal }) {
  const hash = createHash("sha256");
  let bytesHashed = 0;
  for (let at = 0; at < file.size; at += chunkBytes) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await file.slice(at, at + chunkBytes).arrayBuffer());
    bytesHashed += bytes.length;
    hash.update(bytes);
  }
  return { sha256: hash.digest("hex"), bytesHashed };
}
function options(items, stage, extra = {}) {
  return {
    jobs: jobs(items),
    location: [0, 8],
    locationAvailable: async () => true,
    maxPackBytes: 3 * 1024 * 1024,
    expectedEntries: items.length,
    codec,
    hashFile,
    createStage: stage.createStage,
    ...extra,
  };
}
const job = (spec, bytes, path = "data/test.bin") => ({
  path,
  spec,
  decodedSize: bytes.length,
  source: source(bytes),
});
test("serial n/z/BLTE/empty pack bytes, EKeys, index and metadata match native Python", async () => {
  const raw = Uint8Array.from({ length: 600123 }, (_, i) => ((i * 19) ^ (i >>> 7)) & 255);
  const inputs = [
    ["n", raw],
    ["z", raw],
    ["b:256K*=z", raw],
    ["n", new Uint8Array()],
    ["z", new Uint8Array()],
    ["b:256K*=z", new Uint8Array()],
    ["n", new Uint8Array([66, 76, 84, 69, 0, 0, 0, 10, 9, 8, 7, 6])],
    ["n", new Uint8Array([66, 76, 84, 69, 0, 0, 0, 0])],
  ];
  const items = inputs.map(([spec, bytes], i) => job(spec, bytes, `data/${i}.bin`));
  const stage = memoryStage();
  const result = await writeCascPack(options(items, stage));
  let offset = 0,
    expectedIndex = "# pack\t00-00000008.data\n";
  for (let i = 0; i < inputs.length; i++) {
    const [spec, bytes] = inputs[i];
    const output = python(
      "import sys,importlib.util; s=importlib.util.spec_from_file_location('casc',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); e=m.encode_by_espec(sys.stdin.buffer.read(),sys.argv[2]); sys.stdout.buffer.write(m.ekey_for(e,0,8,int(sys.argv[3]))+e)",
      bytes,
      [native, spec, String(offset)],
    );
    const expectedKey = Buffer.from(output.subarray(0, 16)).toString("hex"),
      encoded = output.subarray(16);
    assert.deepEqual(await result.source.readAt(offset, encoded.length), encoded);
    assert.deepEqual(result.records[i], {
      path: `data/${i}.bin`,
      newEkey: expectedKey,
      encodedSize: encoded.length,
      decodedSize: bytes.length,
    });
    expectedIndex += `data/${i}.bin\t${expectedKey}\t${encoded.length}\t${bytes.length}\n`;
    offset += encoded.length;
  }
  assert.equal(result.source.size, offset);
  assert.equal(result.index, expectedIndex);
  assert.deepEqual(result.pack, {
    name: "00-00000008.data",
    size: offset,
    sha256: (await hashFile(result.source.file, { chunkBytes: 1024 })).sha256,
  });
  assert.equal(stage.disposed, false);
  assert.equal(stage.log.filter((n) => n === "backpatch").length, 2);
  await result.dispose();
  assert.equal(stage.disposed, true);
});
test("empty pack finalizes and hashing is exact", async () => {
  const stage = memoryStage();
  const result = await writeCascPack(options([], stage));
  assert.equal(result.pack.size, 0);
  assert.equal(result.pack.sha256, createHash("sha256").digest("hex"));
  await result.dispose();
});
test("collision rejects before stage creation and source consumption", async () => {
  const stage = memoryStage();
  await assert.rejects(
    writeCascPack(options([], stage, { locationAvailable: async () => false })),
    /LOCATION_COLLISION/,
  );
  assert.equal(stage.created, false);
});
test("source exact counts, backing-buffer bounds, unknown specs and index paths fail closed", async () => {
  const cases = [
    { ...job("n", new Uint8Array(3)), decodedSize: 2 },
    { ...job("z", new Uint8Array(3)), decodedSize: 4 },
    { ...job("b:256K*=z", new Uint8Array(3)), decodedSize: 4 },
    { ...job("n", new Uint8Array()), decodedSize: 2 ** 31 },
    { ...job("n", new Uint8Array()), decodedSize: 2 ** 32 },
    job("b:64K*=z", new Uint8Array()),
    job("n", new Uint8Array(), "+data/a"),
    job("n", new Uint8Array(), "data/a\tb"),
    job("n", new Uint8Array(), "data/../a"),
    {
      ...job("n", new Uint8Array(1)),
      source: (async function* () {
        yield new Uint8Array(1024 * 1024 + 1).subarray(0, 1);
      })(),
    },
    job("n", new Uint8Array([66, 76, 84, 69])),
  ];
  for (const item of cases) {
    const stage = memoryStage();
    await assert.rejects(writeCascPack(options([item], stage)), /CASC_PACK_/);
    assert.equal(stage.disposed, true);
  }
});
test("duplicates, entry counts, pack byte budget and hash mismatch dispose partial outputs", async () => {
  const item = () => job("n", new Uint8Array([1, 2, 3]));
  const cases = [
    [[item(), item()], {}],
    [[item()], { expectedEntries: 0 }],
    [[item()], { expectedEntries: 2 }],
    [[item()], { maxPackBytes: 2 }],
    [[item()], { hashFile: async () => ({ sha256: "a".repeat(64), bytesHashed: 2 }) }],
    [[item()], { hashFile: async () => ({ sha256: "invalid", bytesHashed: 3 }) }],
  ];
  for (const [items, extra] of cases) {
    const stage = memoryStage();
    await assert.rejects(writeCascPack(options(items, stage, extra)), /CASC_PACK_/);
    assert.equal(stage.disposed, true);
  }
});
test("abort during append closes async source and cleans stage", async () => {
  const controller = new AbortController(),
    reason = new Error("cancelled");
  let closed = false;
  const input = (async function* () {
    try {
      yield new Uint8Array([1]);
      yield new Uint8Array([2]);
    } finally {
      closed = true;
    }
  })();
  const stage = memoryStage({ append: () => controller.abort(reason) });
  await assert.rejects(
    writeCascPack(
      options([{ path: "data/a", spec: "n", decodedSize: 2, source: input }], stage, {
        signal: controller.signal,
      }),
    ),
    reason,
  );
  assert.equal(closed, true);
  assert.equal(stage.disposed, true);
});
test("write/backpatch/finalize/hash failures clean up and cleanup failures remain visible", async () => {
  for (const action of ["append", "backpatch", "finalize", "hash"]) {
    const error = new Error(action),
      stage = memoryStage({
        [action]: () => {
          throw error;
        },
      });
    const extra =
      action === "hash"
        ? {
            hashFile: async () => {
              throw error;
            },
          }
        : {};
    await assert.rejects(
      writeCascPack(options([job("b:256K*=z", new Uint8Array([1]))], stage, extra)),
      error,
    );
    assert.equal(stage.disposed, true);
  }
  const stage = memoryStage({
    append: () => {
      throw new Error("write");
    },
    dispose: () => {
      throw new Error("cleanup");
    },
  });
  await assert.rejects(
    writeCascPack(options([job("n", new Uint8Array([1]))], stage)),
    (error) => error instanceof AggregateError && error.errors.length === 2,
  );
});
test("location bytes and pack address-space budgets reject truncation", async () => {
  for (const extra of [
    { location: [0, 256] },
    { location: [-1, 8] },
    { maxPackBytes: 2 ** 40 + 1 },
    { expectedEntries: 32769 },
  ]) {
    const stage = memoryStage();
    await assert.rejects(writeCascPack(options([], stage, extra)), /INVALID_OPTIONS/);
    assert.equal(stage.created, false);
  }
});

// 即使注入的编解码器提前停止，也不暴露未完成的档。
// Even an injected codec stopping early must not expose an incomplete archive.
test("incomplete codec consumption fails for raw zlib and each BLTE block", async () => {
  const broken = {
    genericZlibVersion: "1.2.13",
    async *compressZlibStream() {
      yield new Uint8Array([1]);
    },
  };
  for (const spec of ["z", "b:256K*=z"]) {
    const stage = memoryStage();
    await assert.rejects(
      writeCascPack(options([job(spec, new Uint8Array([1, 2]))], stage, { codec: broken })),
      /SOURCE_NOT_CONSUMED|CODEC_INCOMPLETE/,
    );
    assert.equal(stage.disposed, true);
  }
});

// 挂起的宿主回调不会无限阻止取消；清理是否完成单独报告。
// Hung host callbacks cannot block cancellation forever; cleanup completion is reported separately.
test("abort races location, jobs.next and final hashing", async () => {
  for (const action of ["location", "next", "hash"]) {
    const controller = new AbortController(),
      reason = new Error("cancel host wait"),
      stage = memoryStage();
    let reached;
    const entered = new Promise((resolve) => {
      reached = resolve;
    });
    const hang = (signal) => {
      assert.equal(signal, controller.signal);
      reached();
      return new Promise(() => {});
    };
    const extra = { signal: controller.signal };
    if (action === "location") extra.locationAvailable = (_, { signal }) => hang(signal);
    if (action === "next")
      extra.jobs = {
        [Symbol.asyncIterator]() {
          return { next: () => hang(controller.signal), return: async () => ({ done: true }) };
        },
      };
    if (action === "hash") extra.hashFile = (_, { signal }) => hang(signal);
    const work = writeCascPack(options([], stage, extra));
    await entered;
    controller.abort(reason);
    await assert.rejects(work, reason);
    assert.equal(stage.disposed, action !== "location");
  }
});
test("abort preserves primary cause with never-settling iterator cleanup and stage disposal", async () => {
  const controller = new AbortController(),
    reason = new Error("cancel"),
    stage = memoryStage({ dispose: () => new Promise(() => {}) });
  let reached;
  const entered = new Promise((resolve) => {
    reached = resolve;
  });
  const input = {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          reached();
          return new Promise(() => {});
        },
        return: () => new Promise(() => {}),
      };
    },
  };
  const work = writeCascPack(options([], stage, { jobs: input, signal: controller.signal }));
  await entered;
  controller.abort(reason);
  await assert.rejects(
    work,
    (error) =>
      error instanceof AggregateError &&
      error.cause === reason &&
      error.cleanup instanceof Promise &&
      error.errors[1].message === "CASC_PACK_CLEANUP_PENDING",
  );
  assert.equal(stage.disposed, true);
});
test("late stage acquisition after cancellation is disposed without losing ownership", async () => {
  const controller = new AbortController(),
    reason = new Error("late cancel"),
    stage = memoryStage();
  let acquire, entered;
  const reached = new Promise((resolve) => {
    entered = resolve;
  });
  const createStage = () => {
    entered();
    return new Promise((resolve) => {
      acquire = resolve;
    });
  };
  const work = writeCascPack(options([], stage, { createStage, signal: controller.signal }));
  await reached;
  controller.abort(reason);
  let failure;
  try {
    await work;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.cause, reason);
  assert.equal(stage.disposed, false);
  acquire(await stage.createStage());
  await failure.cleanup;
  assert.equal(stage.disposed, true);
});
test("iterator cleanup rejection does not replace a source failure", async () => {
  const primary = new Error("source failed"),
    cleanup = new Error("iterator close failed"),
    stage = memoryStage();
  const input = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw primary;
        },
        return: async () => {
          throw cleanup;
        },
      };
    },
  };
  await assert.rejects(
    writeCascPack(options([], stage, { jobs: input })),
    (error) =>
      error instanceof AggregateError && error.cause === primary && error.errors.includes(cleanup),
  );
  assert.equal(stage.disposed, true);
});

// 迟到的获取失败可能包含资源清理失败，不能被取消原因掩盖。
// Late acquisition failures may contain cleanup failures and must not be hidden by cancellation.
test("late acquisition cleanup failure remains observable after cleanup deadline", async () => {
  const controller = new AbortController(),
    reason = new Error("cancel"),
    cleanupFailure = new Error("RAW_STAGE_CLEANUP_FAILED");
  const lateFailure = new AggregateError(
    [cleanupFailure],
    "RAW_STAGE_OPERATION_AND_CLEANUP_FAILED",
  );
  let rejectAcquire, reached;
  const entered = new Promise((resolve) => {
    reached = resolve;
  });
  const stage = memoryStage();
  const work = writeCascPack(
    options([], stage, {
      signal: controller.signal,
      createStage: () => {
        reached();
        return new Promise((_, reject) => {
          rejectAcquire = reject;
        });
      },
    }),
  );
  await entered;
  controller.abort(reason);
  let failure;
  try {
    await work;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.cause, reason);
  rejectAcquire(lateFailure);
  const results = await failure.cleanup;
  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason, lateFailure);
  assert.ok(results[0].reason.errors.includes(cleanupFailure));
});
test("ordinary acquisition failure preserves its original error without duplication", async () => {
  const reason = new Error("create failed"),
    stage = memoryStage();
  await assert.rejects(
    writeCascPack(
      options([], stage, {
        createStage: async () => {
          throw reason;
        },
      }),
    ),
    reason,
  );
});
test("oversized paths reject before allocating transformations and hash-prefixed TSV rows reject", async () => {
  const original = String.prototype.toLowerCase;
  String.prototype.toLowerCase = function () {
    if (this.length > 4096) throw new Error("unexpected large transformation");
    return original.call(this);
  };
  try {
    for (const path of ["a".repeat(4097), "#data/test.bin"]) {
      const stage = memoryStage();
      await assert.rejects(
        writeCascPack(options([job("n", new Uint8Array(), path)], stage)),
        /CASC_PACK_INVALID_PATH/,
      );
      assert.equal(stage.disposed, true);
    }
  } finally {
    String.prototype.toLowerCase = original;
  }
});

// 上限模式允许单次过滤枚举，但不承诺候选集合完整；精确计数模式保持原行为。
// Maximum-only mode allows one-pass filtered enumeration but does not promise candidate completeness; exact-count mode retains its behavior.
test("max-only mode accepts fewer jobs and returns actual count without a pre-pass", async () => {
  const stage = memoryStage();
  let enumerations = 0,
    reads = 0;
  const stream = {
    async *[Symbol.asyncIterator]() {
      enumerations++;
      yield {
        path: "data/filtered.bin",
        spec: "n",
        decodedSize: 1,
        source: {
          async *[Symbol.asyncIterator]() {
            reads++;
            yield new Uint8Array([7]);
          },
        },
      };
    },
  };
  const result = await writeCascPack(
    options([], stage, { jobs: stream, expectedEntries: undefined, maxEntries: 3 }),
  );
  assert.equal(result.count, 1);
  assert.equal(result.records.length, 1);
  assert.equal(enumerations, 1);
  assert.equal(reads, 1);
  await result.dispose();
  const emptyStage = memoryStage();
  const empty = await writeCascPack(
    options([], emptyStage, { expectedEntries: undefined, maxEntries: 0 }),
  );
  assert.equal(empty.count, 0);
  await empty.dispose();
});
test("at least one valid explicit entry count or bound is required", async () => {
  for (const extra of [
    { expectedEntries: undefined },
    { expectedEntries: undefined, maxEntries: null },
    { expectedEntries: undefined, maxEntries: -1 },
    { expectedEntries: undefined, maxEntries: 1.5 },
    { expectedEntries: undefined, maxEntries: 32769 },
    { expectedEntries: 2, maxEntries: 1 },
    { expectedEntries: null, maxEntries: 1 },
  ]) {
    const stage = memoryStage();
    await assert.rejects(writeCascPack(options([], stage, extra)), /INVALID_OPTIONS/);
    assert.equal(stage.created, false);
  }
});
test("max-only overrun closes enumeration and cleans partial output", async () => {
  const stage = memoryStage();
  let closed = false;
  const stream = {
    async *[Symbol.asyncIterator]() {
      try {
        yield job("n", new Uint8Array([1]), "data/a");
        yield job("n", new Uint8Array([2]), "data/b");
      } finally {
        closed = true;
      }
    },
  };
  await assert.rejects(
    writeCascPack(options([], stage, { jobs: stream, expectedEntries: undefined, maxEntries: 1 })),
    /INVALID_JOB/,
  );
  assert.equal(closed, true);
  assert.equal(stage.disposed, true);
  assert.ok(!stage.log.includes("finalize"));
});
test("exact counts remain mandatory when supplied alongside a looser maximum", async () => {
  const stage = memoryStage();
  const result = await writeCascPack(
    options([job("n", new Uint8Array([1]))], stage, { expectedEntries: 1, maxEntries: 2 }),
  );
  assert.equal(result.count, 1);
  await result.dispose();
  for (const items of [
    [],
    [job("n", new Uint8Array([1]), "data/a"), job("n", new Uint8Array([2]), "data/b")],
  ]) {
    const failed = memoryStage();
    await assert.rejects(
      writeCascPack(options(items, failed, { expectedEntries: 1, maxEntries: 2 })),
      /ENTRY_COUNT|INVALID_JOB/,
    );
    assert.equal(failed.disposed, true);
  }
});
test("max-only enumeration errors are not interpreted as successful early completion", async () => {
  const stage = memoryStage(),
    reason = new Error("candidate enumeration failed");
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield job("n", new Uint8Array([1]));
      throw reason;
    },
  };
  await assert.rejects(
    writeCascPack(options([], stage, { jobs: stream, expectedEntries: undefined, maxEntries: 2 })),
    reason,
  );
  assert.equal(stage.disposed, true);
  assert.ok(!stage.log.includes("finalize"));
});
