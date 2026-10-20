// 依据现有解码器与 Node 校验内核，用自造归档验证流式兼容、损坏拒绝和取消清理。
// Synthetic archive compatibility, corruption and cancellation checks against the existing decoder and Node checksum kernels.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { stageArchiveRecord } from "../archive-stream-reader.mjs";
import { decodeArchiveRecord } from "../archive-reader.mjs";
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");
const digest = (bytes) => Buffer.from(md5(bytes), "hex");
const BASE = 0x123456789an;
function fixture(
  encoding,
  content = Buffer.from(Array.from({ length: 150003 }, (_, i) => i % 251)),
) {
  let raw, hashBytes;
  if (encoding.startsWith("b:")) {
    const parts = [content.subarray(0, 70000), content.subarray(70000)];
    const payload = [
      Buffer.concat([Buffer.from("N"), parts[0]]),
      Buffer.concat([Buffer.from("Z"), deflateSync(parts[1])]),
    ];
    const header = Buffer.alloc(60);
    header.write("BLTE");
    header.writeUInt32BE(60, 4);
    header[8] = 15;
    header[11] = 2;
    payload.forEach((p, i) => {
      header.writeUInt32BE(p.length, 12 + i * 24);
      header.writeUInt32BE(parts[i].length, 16 + i * 24);
      digest(p).copy(header, 20 + i * 24);
    });
    raw = Buffer.concat([header, ...payload]);
    hashBytes = header;
  } else {
    raw = encoding === "n" ? content : deflateSync(content);
    hashBytes = raw;
  }
  const record = {
    offset: BASE,
    encodedSize: raw.length,
    decodedSize: content.length,
    encoding,
    ckey: md5(content),
    ekey: md5(hashBytes).slice(0, 18) + "0203" + BASE.toString(16).padStart(10, "0"),
  };
  return { raw, record, content };
}
function source(raw, base = BASE) {
  const reads = [];
  return {
    size: base + BigInt(raw.length),
    reads,
    readAt(at, length) {
      assert.equal(typeof at, "bigint");
      assert.ok(at >= base);
      assert.ok(length <= 65536);
      reads.push([at, length]);
      const offset = Number(at - base);
      return new Uint8Array(raw.subarray(offset, offset + length));
    },
  };
}
function stageFactory({ retain = true } = {}) {
  const state = { appended: 0, finalized: 0, disposed: 0, chunks: [] };
  const createStage = async () => ({
    append(bytes) {
      assert.ok(bytes.buffer.byteLength <= 65536);
      state.appended += bytes.length;
      if (retain) state.chunks.push(bytes.slice());
    },
    finalize() {
      state.finalized++;
      const bytes = retain ? Buffer.concat(state.chunks) : null;
      return {
        size: state.appended,
        readAt: (at, count) =>
          bytes ? new Uint8Array(bytes.subarray(at, at + count)) : new Uint8Array(count),
      };
    },
    dispose() {
      state.disposed++;
      state.chunks = [];
    },
  });
  return { state, createStage };
}
const options = (createStage) => ({
  maxEncodedBytes: 32 * 1024 * 1024,
  maxDecodedBytes: 32 * 1024 * 1024,
  createStage,
});
for (const encoding of ["n", "z", "b:synthetic"])
  test(`stream matches existing decoder: ${encoding}`, async () => {
    const { raw, record, content } = fixture(encoding),
      staging = stageFactory();
    const input = source(raw);
    const output = await stageArchiveRecord(input, record, options(staging.createStage));
    assert.equal(output.size, content.length);
    assert.equal(staging.state.finalized, 1);
    assert.deepEqual(Buffer.from(await output.readAt(0, output.size)), content);
    const old = await decodeArchiveRecord(
      { size: raw.length, read: (at, count) => raw.subarray(at, at + count) },
      { ...record, offset: 0 },
      { verifyMd5: async (bytes, expected) => md5(bytes) === expected },
    );
    assert.deepEqual(Buffer.from(old), content);
    await output.dispose();
    await assert.rejects(output.readAt(0, 1), /DISPOSED/);
  });
test("BLTE detection overrides declared n, and empty n/z records pass checksums", async () => {
  const f = fixture("b:synthetic");
  f.record.encoding = "n";
  for (const value of [f, fixture("n", Buffer.alloc(0)), fixture("z", Buffer.alloc(0))]) {
    const staging = stageFactory();
    const result = await stageArchiveRecord(
      source(value.raw),
      value.record,
      options(staging.createStage),
    );
    assert.equal(result.size, value.content.length);
    await result.dispose();
  }
});
test("reject checksum, header, mode, extent, budget and short-read corruption without publishing a stage", async () => {
  const cases = [
    (f) => {
      f.record.ckey = "0".repeat(32);
    },
    (f) => {
      f.record.ekey = "0".repeat(18) + f.record.ekey.slice(18);
    },
    (f) => {
      f.record.ekey = f.record.ekey.slice(0, 22) + "0000000000";
    },
    (f) => {
      f.raw[8] = 0;
    },
    (f) => {
      f.raw[20] ^= 1;
      f.record.ekey = md5(f.raw.subarray(0, 60)).slice(0, 18) + f.record.ekey.slice(18);
    },
    (f) => {
      f.raw[60] = 110;
    },
    (f) => {
      f.raw[f.raw.length - 1] ^= 1;
    },
    (f) => {
      f.record.decodedSize--;
    },
    (f) => {
      f.record.encodedSize++;
    },
  ];
  for (const change of cases) {
    const f = fixture("b:synthetic");
    change(f);
    const staging = stageFactory();
    await assert.rejects(
      stageArchiveRecord(source(f.raw), f.record, options(staging.createStage)),
      /ARCHIVE_STREAM_/,
    );
    assert.equal(staging.state.finalized, 0);
    if (staging.state.appended) assert.equal(staging.state.disposed, 1);
  }
  const f = fixture("n");
  await assert.rejects(
    stageArchiveRecord(source(f.raw), f.record, {
      ...options(stageFactory().createStage),
      maxDecodedBytes: 3,
    }),
    /RECORD/,
  );
  await assert.rejects(
    stageArchiveRecord(
      { size: BASE + BigInt(f.raw.length), readAt: () => new Uint8Array(0) },
      f.record,
      options(stageFactory().createStage),
    ),
    /SHORT_READ/,
  );
});
test("explicit new budget supports >16MiB BLTE without decoded retention; old whole-buffer limit remains", async () => {
  const part = Buffer.alloc(1024 * 1024, 7),
    block = Buffer.concat([Buffer.from("Z"), deflateSync(part)]),
    count = 17;
  const header = Buffer.alloc(12 + 24 * count);
  header.write("BLTE");
  header.writeUInt32BE(header.length, 4);
  header[8] = 15;
  header[11] = count;
  const contentHash = createHash("md5");
  for (let i = 0; i < count; i++) {
    header.writeUInt32BE(block.length, 12 + i * 24);
    header.writeUInt32BE(part.length, 16 + i * 24);
    digest(block).copy(header, 20 + i * 24);
    contentHash.update(part);
  }
  const raw = Buffer.concat([header, ...Array(count).fill(block)]);
  const record = {
    offset: BASE,
    encodedSize: raw.length,
    decodedSize: part.length * count,
    encoding: "b:256K*=z",
    ckey: contentHash.digest("hex"),
    ekey: md5(header).slice(0, 18) + "0203" + BASE.toString(16),
  };
  const staging = stageFactory({ retain: false });
  const result = await stageArchiveRecord(source(raw), record, options(staging.createStage));
  assert.equal(staging.state.appended, 17 * 1024 * 1024);
  assert.equal(staging.state.chunks.length, 0);
  await result.dispose();
  await assert.rejects(
    decodeArchiveRecord(
      { size: raw.length, read: (at, n) => raw.subarray(at, at + n) },
      { ...record, offset: 0 },
      { verifyMd5: () => true },
    ),
    /decoded size/,
  );
});
test("abort pending archive reads and stage acquisition; late owned stage is disposed", async () => {
  const f = fixture("n");
  const controller = new AbortController();
  let mark;
  const ready = new Promise((resolve) => {
    mark = resolve;
  });
  const result = stageArchiveRecord(
    {
      size: BASE + BigInt(f.raw.length),
      readAt() {
        mark();
        return new Promise(() => {});
      },
    },
    f.record,
    { ...options(stageFactory().createStage), signal: controller.signal },
  );
  await ready;
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  const other = new AbortController();
  let acquired, release;
  const acquiring = new Promise((resolve) => {
    acquired = resolve;
  });
  const stage = stageFactory();
  const job = stageArchiveRecord(source(f.raw), f.record, {
    ...options(() => {
      acquired();
      return new Promise((resolve) => {
        release = resolve;
      });
    }),
    signal: other.signal,
  });
  await acquiring;
  other.abort();
  release(await stage.createStage());
  await assert.rejects(job, { name: "AbortError" });
  assert.equal(stage.state.disposed, 1);
});
test("abort during compressed output and sanitize external source failures", async () => {
  const f = fixture("z");
  const controller = new AbortController(),
    staging = stageFactory();
  await assert.rejects(
    stageArchiveRecord(source(f.raw), f.record, {
      ...options(async () => {
        const stage = await staging.createStage();
        return {
          ...stage,
          append(bytes) {
            stage.append(bytes);
            controller.abort();
          },
        };
      }),
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(staging.state.finalized, 0);
  assert.equal(staging.state.disposed, 1);
  await assert.rejects(
    stageArchiveRecord(
      {
        size: BASE + BigInt(f.raw.length),
        readAt() {
          throw new Error("/private/example");
        },
      },
      f.record,
      options(staging.createStage),
    ),
    (error) =>
      error.message === "ARCHIVE_STREAM_FAILED" && !error.stack.includes("/private/example"),
  );
});
// 清理超时保留可观察的所有权 Promise，既不假报已清理，也不遗失迟到资源。
// A cleanup timeout retains an observable ownership promise; never claim cleanup or lose late resources.
test("pending cleanup remains observable and late disposal completes", async () => {
  const f = fixture("n");
  let release;
  const cleanup = new Promise((resolve) => {
    release = resolve;
  });
  let failure;
  try {
    await stageArchiveRecord(
      source(f.raw),
      f.record,
      options(async () => ({
        append() {
          throw new Error("write failed");
        },
        finalize() {
          assert.fail("Must not finalize");
        },
        dispose() {
          return cleanup;
        },
      })),
    );
  } catch (error) {
    failure = error;
  }
  assert.equal(failure.message, "ARCHIVE_STREAM_CLEANUP_PENDING");
  assert.ok(failure.cleanup instanceof Promise);
  release();
  await failure.cleanup;
});
// 在校验和正确时也拒绝非法模式，并在输出超过声明大小时停止解压。
// Reject unsupported modes even with valid checksums, and stop inflation at the declared output size.
test("verified unsupported BLTE mode and valid compressed stream overflow fail closed", async () => {
  const f = fixture("b:synthetic");
  f.raw[60] = 110;
  const blockSize = f.raw.readUInt32BE(12);
  digest(f.raw.subarray(60, 60 + blockSize)).copy(f.raw, 20);
  f.record.ekey = md5(f.raw.subarray(0, 60)).slice(0, 18) + f.record.ekey.slice(18);
  await assert.rejects(
    stageArchiveRecord(source(f.raw), f.record, options(stageFactory().createStage)),
    /BLOCK_MODE/,
  );
  const z = fixture("z");
  z.record.decodedSize = 1;
  const staging = stageFactory();
  await assert.rejects(
    stageArchiveRecord(source(z.raw), z.record, options(staging.createStage)),
    /DECODED_SIZE/,
  );
  assert.equal(staging.state.finalized, 0);
  assert.equal(staging.state.disposed, 1);
});
// 普通小块只从认证来源读取一遍负载；大块用两遍有界读取而不扩大缓存。
// Ordinary small blocks read payload once from the authenticated source; large blocks use two bounded passes without growing the cache.
test("small encoded payloads are cached once, large raw records use bounded two-pass reads", async () => {
  const f = fixture("b:synthetic"),
    input = source(f.raw),
    staging = stageFactory();
  const result = await stageArchiveRecord(input, f.record, options(staging.createStage));
  const payloadReads = input.reads.filter(([at]) => at >= BASE + 60n);
  assert.equal(
    payloadReads.reduce((total, [, count]) => total + count, 0),
    f.raw.length - 60,
  );
  await result.dispose();
  const large = fixture("n", Buffer.alloc(1024 * 1024 + 16, 11)),
    largeSource = source(large.raw);
  const largeStage = stageFactory({ retain: false });
  const value = await stageArchiveRecord(
    largeSource,
    large.record,
    options(largeStage.createStage),
  );
  assert.equal(
    largeSource.reads.reduce((total, [, count]) => total + count, 0),
    12 + large.raw.length * 2,
  );
  await value.dispose();
});

// 取消后迟到的获取错误不能被吞掉；普通主错误和正常取消不重复包装。
// Retain late acquisition failures after cancellation without duplicating primary failures or normal aborts.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function cancelledAcquisition() {
  const f = fixture("n"),
    controller = new AbortController();
  const entered = deferred(),
    acquiring = deferred();
  const job = stageArchiveRecord(source(f.raw), f.record, {
    ...options(() => {
      entered.resolve();
      return acquiring.promise;
    }),
    signal: controller.signal,
  });
  const outcome = job.catch((error) => error);
  await entered.promise;
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  return { acquiring, outcome };
}
test("distinct late acquisition rejection remains observable and sanitized", async () => {
  const { acquiring, outcome } = await cancelledAcquisition();
  const failure = new AggregateError(
    [new Error("private cleanup detail")],
    "private acquisition detail",
  );
  acquiring.reject(failure);
  const error = await outcome;
  assert.equal(error.message, "ARCHIVE_STREAM_CLEANUP_FAILED");
  assert.equal(error.cause.name, "AbortError");
  assert.ok(!error.stack.includes("private"));
  await assert.rejects(error.cleanup, (value) => value === failure);
});
test("ordinary acquisition failure and late normal abort are not duplicate cleanup failures", async () => {
  const f = fixture("n");
  await assert.rejects(
    stageArchiveRecord(
      source(f.raw),
      f.record,
      options(() => {
        throw new Error("private primary");
      }),
    ),
    (error) => error.message === "ARCHIVE_STREAM_FAILED" && error.cleanup === undefined,
  );
  const { acquiring, outcome } = await cancelledAcquisition();
  acquiring.reject(new DOMException("Cancelled", "AbortError"));
  assert.equal((await outcome).name, "AbortError");
});
test("acquisition deadline preserves later rejection on cleanup", async () => {
  const { acquiring, outcome } = await cancelledAcquisition();
  const error = await outcome;
  assert.equal(error.message, "ARCHIVE_STREAM_CLEANUP_PENDING");
  assert.equal(error.cause.name, "AbortError");
  const failure = new AggregateError([new Error("late cleanup")], "late acquisition");
  acquiring.reject(failure);
  await assert.rejects(error.cleanup, (value) => value === failure);
});
test("acquisition deadline preserves late stage disposal failure", async () => {
  const { acquiring, outcome } = await cancelledAcquisition();
  const error = await outcome;
  assert.equal(error.message, "ARCHIVE_STREAM_CLEANUP_PENDING");
  let disposals = 0;
  const failure = new Error("late disposal");
  acquiring.resolve({
    dispose() {
      disposals++;
      throw failure;
    },
  });
  await assert.rejects(error.cleanup, (value) => value === failure);
  assert.equal(disposals, 1);
});
// 第二遍输入变化必须拒绝发布；压缩头变化即使解码内容相同也必须被发现。
// Reject changed second-pass input before publication, including compressed header changes preserving decoded content.
for (const encoding of ["n", "z"])
  test(`large ${encoding} second-pass mutation is detected before finalization`, async () => {
    const f = fixture("n", Buffer.alloc(1024 * 1024 + 16, 11));
    if (encoding === "z") {
      f.raw = deflateSync(f.content, { level: 0 });
      f.record.encoding = "z";
      f.record.encodedSize = f.raw.length;
      f.record.ekey = md5(f.raw).slice(0, 18) + f.record.ekey.slice(18);
    }
    const input = source(f.raw),
      original = input.readAt;
    let starts = 0;
    input.readAt = (at, count) => {
      if (at === BASE && ++starts === 3) {
        if (encoding === "z") {
          f.raw[0] = 0x78;
          f.raw[1] = 0x9c;
        } else f.raw[0] ^= 1;
      }
      return original(at, count);
    };
    const staging = stageFactory({ retain: false });
    await assert.rejects(
      stageArchiveRecord(input, f.record, options(staging.createStage)),
      /SOURCE_CHANGED/,
    );
    assert.equal(staging.state.finalized, 0);
    assert.equal(staging.state.disposed, 1);
  });
