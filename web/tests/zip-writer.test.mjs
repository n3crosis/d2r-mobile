// 验证 zip-writer 的约定与边界；依据 ../zip-writer.mjs 及本文件的测试断言。
// Verify zip-writer contracts and boundaries against ../zip-writer.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeZip, ZIP_LIMITS } from "../zip-writer.mjs";

function entry(path, text = "", mode) {
  const bytes = new TextEncoder().encode(text);
  return {
    path,
    size: bytes.length,
    mode,
    chunks: async function* () {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3);
    },
  };
}
function sink() {
  return {
    parts: [],
    closed: 0,
    aborted: 0,
    async write(bytes) {
      this.parts.push(bytes.slice());
    },
    async close() {
      this.closed++;
    },
    async abort() {
      this.aborted++;
    },
  };
}
async function fails(entries, pattern, output = sink(), options) {
  await assert.rejects(writeZip(entries, output, options), pattern);
  assert.equal(output.closed, 0);
  assert.equal(output.aborted, 1);
  return output;
}
test("deterministic STORE ZIP is readable by Python with CRC, Unicode, modes and fixed timestamp", async () => {
  const files = [
    entry("Payload/Demo.app/é.txt", "héllo 🌍"),
    entry("Payload/Demo.app/Run", "123456789", 0o755),
    entry("empty"),
  ];
  const a = sink(),
    b = sink();
  const result = await writeZip(files, a);
  await writeZip([...files].reverse(), b);
  const archive = Buffer.concat(a.parts);
  assert.deepEqual(archive, Buffer.concat(b.parts));
  assert.equal(result.bytesWritten, archive.length);
  assert.equal(result.entries, 3);
  assert.equal(a.closed, 1);
  assert.equal(a.aborted, 0);
  const python = spawnSync(
    "python3",
    [
      "-c",
      `
import io, sys, zipfile
z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
assert z.namelist() == ['Payload/Demo.app/Run', 'Payload/Demo.app/é.txt', 'empty']
assert z.read('Payload/Demo.app/Run') == b'123456789'
assert z.read('Payload/Demo.app/é.txt').decode() == 'héllo 🌍'
assert z.read('empty') == b''
for f in z.infolist():
 assert f.date_time == (1980, 1, 1, 0, 0, 0)
 assert f.compress_type == zipfile.ZIP_STORED
 assert f.flag_bits == 0x808
 assert f.create_system == 3
 assert f.external_attr >> 16 == (0o100755 if f.filename.endswith('/Run') else 0o100644)
assert z.getinfo('Payload/Demo.app/Run').CRC == 0xcbf43926
`,
    ],
    { input: archive },
  );
  assert.equal(python.status, 0, python.stderr?.toString());
});
test("empty archive is valid", async () => {
  const out = sink();
  await writeZip([], out);
  assert.equal(Buffer.concat(out.parts).length, 22);
  assert.equal(out.closed, 1);
});
test("preflight rejects unsafe paths, duplicates, case collisions and ancestor conflicts before writes", async () => {
  for (const paths of [
    ["../a"],
    ["/a"],
    ["a\\b"],
    ["NUL.txt"],
    ["e\u0301"],
    ["a", "a"],
    ["a", "A"],
    ["a", "a/b"],
    ["A/b", "a"],
    ["Resources/a", "resources/b"],
    ["Resources/nested/a", "Resources/Nested/b"],
    ["\ud800"],
  ]) {
    const out = await fails(
      paths.map((p) => entry(p)),
      /path|conflict|encoding/i,
    );
    assert.equal(out.parts.length, 0);
  }
});
test("budgets and modes are validated without reading or writing content", async () => {
  const fake = (path, size) => ({
    path,
    size,
    chunks() {
      assert.fail("must not pull");
    },
  });
  const cases = [
    [fake("a", -1)],
    [fake("a", NaN)],
    [fake("a", Infinity)],
    [fake("a", 1.1)],
    [fake("a", ZIP_LIMITS.maxFileBytes + 1)],
    [fake("a", ZIP_LIMITS.maxFileBytes), fake("b", ZIP_LIMITS.maxFileBytes), fake("c", 1)],
    Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => fake("f" + i, 0)),
    Array.from({ length: 1100 }, (_, i) => fake("x".repeat(4000) + i, 0)),
    [fake("x".repeat(4097), 0)],
    [fake("é".repeat(3000), 0)],
    [fake("x/".repeat(32) + "file", 0)],
    Array.from({ length: 16667 }, (_, i) => fake(`d${i}/nested/file`, 0)),
    [{ ...entry("a"), mode: 0o777 }],
    [{ path: "a", size: 0 }],
  ];
  for (const files of cases) {
    const out = await fails(files, /limit|mode|producer|length/i);
    assert.equal(out.parts.length, 0);
  }
});
test("short, excess, malformed and oversized input abort without closing", async () => {
  await fails([{ ...entry("a", "abc"), size: 4 }], /Short/);
  await fails([{ ...entry("a", "abc"), size: 2 }], /Excess/);
  for (const bytes of ["invalid", new Uint8Array(ZIP_LIMITS.maxChunkBytes + 1)]) {
    await fails(
      [
        {
          path: "a",
          size: 0,
          chunks: async function* () {
            yield bytes;
          },
        },
      ],
      /chunk/,
    );
  }
});
test("sink backpressure prevents parallel writes and pulling ahead", async () => {
  let busy = false,
    pulls = 0;
  const out = sink();
  out.write = async function (bytes) {
    assert.equal(busy, false);
    busy = true;
    const before = pulls;
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(pulls, before);
    this.parts.push(bytes.slice());
    busy = false;
  };
  await writeZip(
    [
      {
        path: "a",
        size: 2,
        chunks: async function* () {
          for (let i = 0; i < 2; i++) {
            assert.equal(busy, false);
            pulls++;
            yield Uint8Array.of(i);
          }
        },
      },
    ],
    out,
  );
  assert.equal(pulls, 2);
  assert.equal(out.closed, 1);
});
test("cancellation before starting and during writes aborts without closing", async () => {
  const before = new AbortController();
  before.abort();
  const out = await fails([entry("a")], /abort/i, sink(), { signal: before.signal });
  assert.equal(out.parts.length, 0);
  const during = new AbortController();
  const output = sink();
  output.write = async () => {
    during.abort();
  };
  await fails([entry("a", "hello")], /abort/i, output, { signal: during.signal });
});
test("write and producer failures clean up iterator and preserve original error", async () => {
  let finalized = false,
    writes = 0;
  const out = sink();
  out.write = async () => {
    if (++writes === 2) throw new Error("write failure");
  };
  out.abort = async function () {
    this.aborted++;
    throw new Error("abort failure");
  };
  await fails(
    [
      {
        path: "a",
        size: 1,
        chunks: async function* () {
          try {
            yield Uint8Array.of(1);
          } finally {
            finalized = true;
          }
        },
      },
    ],
    /write failure/,
    out,
  );
  assert.equal(finalized, true);
  await fails(
    [
      {
        path: "a",
        size: 0,
        chunks: async function* () {
          yield* [];
          throw new Error("producer failure");
        },
      },
    ],
    /producer failure/,
  );
});
test("close failure aborts and does not resolve successfully", async () => {
  const out = sink();
  out.close = async () => {
    throw new Error("close failure");
  };
  await fails([], /close failure/, out);
});

test("failures at every record write abort before close", async () => {
  // 一个空文件：本地头、描述符、中央记录及 EOCD。
  // One empty file: local header, descriptor, central record, EOCD.
  for (let failureAt = 1; failureAt <= 4; failureAt++) {
    const out = sink();
    let writes = 0;
    out.write = async () => {
      if (++writes === failureAt) throw new Error("record failure");
    };
    await fails([entry("a")], /record failure/, out);
    assert.equal(writes, failureAt);
  }
});
test("cancellation during input and after final record prevents commit", async () => {
  const controller = new AbortController();
  let finalized = false;
  await fails(
    [
      {
        path: "a",
        size: 1,
        chunks: async function* () {
          try {
            controller.abort();
            yield Uint8Array.of(1);
          } finally {
            finalized = true;
          }
        },
      },
    ],
    /abort/i,
    sink(),
    { signal: controller.signal },
  );
  assert.equal(finalized, true);
  const atEnd = new AbortController(),
    out = sink();
  out.write = async () => {
    atEnd.abort();
  }; // 空 ZIP 只有最终记录。 | Empty ZIP has just its final record.
  await fails([], /abort/i, out, { signal: atEnd.signal });
});
