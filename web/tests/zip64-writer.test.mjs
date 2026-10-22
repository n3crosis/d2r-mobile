import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { planZip64, writeZip64, zip64EndRecords, ZIP64_LIMITS } from "../zip64-writer.mjs";
const options = { maxTotalBytes: 1024n * 1024n };
function entry(path, text = "", mode) {
  const data = new TextEncoder().encode(text);
  return {
    path,
    size: BigInt(data.length),
    mode,
    chunks: async function* () {
      for (let i = 0; i < data.length; i += 3) yield data.subarray(i, i + 3);
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
    async abort(error) {
      this.aborted++;
      this.error = error;
    },
  };
}
async function fails(files, pattern, opts = options, out = sink()) {
  await assert.rejects(writeZip64(files, out, opts), pattern);
  assert.equal(out.closed, 0);
  assert.equal(out.aborted, 1);
  return out;
}
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
test("real small ZIP64: deterministic bytes and independent Python CRC/content/modes", async () => {
  const files = [entry("é.txt", "héllo 🌍"), entry("Run", "123456789", 0o755), entry("empty")];
  const a = sink(),
    b = sink();
  const result = await writeZip64(files, a, options);
  await writeZip64([...files].reverse(), b, options);
  const archive = Buffer.concat(a.parts);
  assert.deepEqual(archive, Buffer.concat(b.parts));
  assert.equal(result.bytesWritten, BigInt(archive.length));
  assert.equal(planZip64(files, options).bytesWritten, result.bytesWritten);
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
assert z.namelist() == ['Run', 'empty', 'é.txt']
assert z.read('Run') == b'123456789'
assert z.read('é.txt').decode() == 'héllo 🌍'
assert z.read('empty') == b''
for f in z.infolist():
 assert f.date_time == (1980, 1, 1, 0, 0, 0)
 assert f.compress_type == zipfile.ZIP_STORED
 assert f.flag_bits == 0x808
 assert f.extract_version == 45
 assert f.create_system == 3
 assert f.external_attr >> 16 == (0o100755 if f.filename == 'Run' else 0o100644)
assert z.getinfo('Run').CRC == 0xcbf43926
`,
    ],
    { input: archive },
  );
  assert.equal(python.status, 0, python.stderr?.toString());
  const local = view(a.parts[0]);
  assert.equal(local.getUint32(18, true), 0xffffffff);
  assert.equal(local.getUint16(28, true), 20);
  assert.equal(local.getUint16(33, true), 1);
  const descriptor = a.parts.find(
    (p) => p.length === 24 && view(p).getUint32(0, true) === 0x08074b50,
  );
  assert.equal(view(descriptor).getBigUint64(8, true), 9n);
  assert.equal(view(descriptor).getBigUint64(16, true), 9n);
});
test("empty ZIP64 end records", async () => {
  const out = sink();
  await writeZip64([], out, { maxTotalBytes: 98n });
  assert.equal(out.parts.length, 1);
  assert.equal(out.parts[0].length, 98);
  const v = view(out.parts[0]);
  assert.equal(v.getBigUint64(4, true), 44n);
  assert.equal(v.getBigUint64(64, true), 0n);
  assert.equal(v.getUint32(72, true), 1);
  assert.equal(v.getUint32(76, true), 0x06054b50);
});
test("declared budgets and paths fail before writes or pulls", async () => {
  let pulls = 0;
  const file = {
    ...entry("a"),
    chunks() {
      pulls++;
      throw new Error("unexpected pull");
    },
  };
  const cases = [
    [[file], {}],
    [[file], { maxTotalBytes: Infinity }],
    [[file], { maxTotalBytes: Number.MAX_SAFE_INTEGER + 1 }],
    [[file], { maxTotalBytes: -1n }],
    [[file], { maxTotalBytes: 98n }],
    [[{ ...file, size: 1n << 64n }], options],
    [[{ ...file, size: -1n }], options],
    [[{ ...file, size: Number.MAX_SAFE_INTEGER + 1 }], options],
    [[{ ...file, mode: 0o777 }], options],
    [[{ ...file, chunks: null }], options],
    [[{ ...file, path: "\ud800" }], options],
    [[{ ...file, path: "x".repeat(4097) }], options],
    [[{ ...file, path: "é".repeat(2049) }], options],
    [[{ ...file, path: "x/".repeat(32) + "file" }], options],
    [
      Array.from({ length: 16667 }, (_, i) => ({ ...file, path: `d${i}/nested/file` })),
      { maxTotalBytes: 8 * 1024 * 1024 },
    ],
    [Array(ZIP64_LIMITS.maxEntries + 1).fill(file), options],
    [
      Array.from({ length: 1200 }, (_, i) => ({ ...file, path: `${i}${"x".repeat(4000)}` })),
      { maxTotalBytes: 1n << 40n },
    ],
  ];
  for (const paths of [
    ["../a"],
    ["/a"],
    ["a\\b"],
    ["a", "A"],
    ["a", "a/b"],
    ["a/b", "a"],
    ["a", "a"],
    ["Resources/a", "resources/b"],
    ["Resources/nested/a", "Resources/Nested/b"],
    ["e\u0301"],
  ])
    cases.push([paths.map((path) => ({ ...file, path })), options]);
  for (const [files, opts] of cases)
    assert.equal((await fails(files, /ZIP64|path|conflict/i, opts)).parts.length, 0);
  assert.equal(pulls, 0);
});
test("actual byte counts, chunk bounds and producer errors abort", async () => {
  await fails([{ ...entry("a", "abc"), size: 2n }], /Excess/);
  await fails([{ ...entry("a", "abc"), size: 4n }], /Short/);
  for (const bad of ["abc", new Uint8Array(ZIP64_LIMITS.maxChunkBytes + 1)])
    await fails(
      [
        {
          ...entry("a"),
          chunks: async function* () {
            yield bad;
          },
        },
      ],
      /chunk/,
    );
  await fails(
    [
      {
        ...entry("a"),
        chunks() {
          throw new Error("producer");
        },
      },
    ],
    /producer/,
  );
});
test("backpressure, cancellation and iterator cleanup", async () => {
  const controller = new AbortController();
  let pulled = 0,
    returned = 0,
    pending = false;
  const file = {
    path: "a",
    size: 3n,
    chunks: async function* () {
      try {
        for (let i = 0; i < 3; i++) {
          assert.equal(pending, false);
          pulled++;
          yield Uint8Array.of(i);
        }
      } finally {
        returned++;
      }
    },
  };
  const out = sink();
  out.write = async (bytes) => {
    assert.equal(pending, false);
    pending = true;
    await new Promise((resolve) => setImmediate(resolve));
    pending = false;
    if (bytes.length === 1) controller.abort(new Error("cancelled"));
  };
  await fails([file], /cancelled/, { ...options, signal: controller.signal }, out);
  assert.equal(pulled, 1);
  assert.equal(returned, 1);
});
test("pre-abort, write/close/cleanup failure and close commit boundary", async () => {
  const controller = new AbortController();
  controller.abort(new Error("pre-cancel"));
  assert.equal(
    (await fails([], /pre-cancel/, { ...options, signal: controller.signal })).parts.length,
    0,
  );
  for (const method of ["write", "close"]) {
    const output = sink();
    output[method] = async () => {
      throw new Error(method);
    };
    output.abort = async () => {
      output.aborted++;
      throw new Error("cleanup");
    };
    await fails([], new RegExp(method), options, output);
  }
  const late = new AbortController(),
    committed = sink();
  committed.close = async () => {
    committed.closed++;
    late.abort();
  };
  await writeZip64([], committed, { ...options, signal: late.signal });
  assert.equal(committed.closed, 1);
  assert.equal(committed.aborted, 0);
});
test("metadata-only virtual >4GiB and >2^53 counters: NOT a payload/CRC archive test", () => {
  let sourcePulls = 0;
  for (const size of [0xffffffffn, 0x100000000n, (1n << 53n) + 123n]) {
    const files = ["a", "b"].map((path) => ({
      path,
      size,
      chunks() {
        sourcePulls++;
        throw new Error("metadata only");
      },
    }));
    const plan = planZip64(files, { maxTotalBytes: 1n << 63n });
    assert.equal(plan.entries[1].offset, size + 75n);
    let virtualSinkCounter = 0n;
    for (const file of plan.entries) virtualSinkCounter += 51n + file.size + 24n;
    assert.equal(virtualSinkCounter, plan.centralOffset);
    const end = zip64EndRecords({ ...plan, entries: 2n });
    const v = view(end);
    assert.equal(v.getBigUint64(48, true), virtualSinkCounter);
    assert.equal(v.getBigUint64(64, true), plan.centralOffset + plan.centralSize);
    assert.equal(v.getBigUint64(24, true), 2n);
    assert.equal(v.getBigUint64(40, true), 150n);
    assert.equal(v.getUint16(84, true), 0xffff);
    assert.equal(v.getUint32(92, true), 0xffffffff);
    assert.equal(virtualSinkCounter + plan.centralSize + BigInt(end.length), plan.bytesWritten);
  }
  assert.equal(sourcePulls, 0);
  assert.throws(
    () => zip64EndRecords({ entries: 0, centralOffset: (1n << 64n) - 1n, centralSize: 0 }),
    /archive size/,
  );
});
test(
  "opt-in real >4GiB stream with bounded repeated source and discard/count sink",
  { skip: process.env.ZIP64_LARGE_STREAM_TEST !== "1" },
  async () => {
    // All bytes pass through the production CRC loop. No fake chunk lengths/CRC.
    const chunk = new Uint8Array(ZIP64_LIMITS.maxChunkBytes),
      repeats = 1025;
    const size = BigInt(chunk.length) * BigInt(repeats);
    let pulls = 0,
      written = 0n,
      descriptor,
      central,
      secondCentral;
    const file = {
      path: "large",
      size,
      chunks: async function* () {
        for (let i = 0; i < repeats; i++) {
          pulls++;
          yield chunk;
        }
      },
    };
    const out = sink();
    out.write = async (bytes) => {
      written += BigInt(bytes.length);
      if (bytes.length === 24 && !descriptor) descriptor = bytes.slice();
      if (bytes.length === 79) central = bytes.slice();
      if (bytes.length === 75) secondCentral = bytes.slice();
    };
    const result = await writeZip64([file, entry("z")], out, { maxTotalBytes: size + 1024n });
    assert.equal(pulls, repeats);
    assert.equal(written, result.bytesWritten);
    assert.equal(view(descriptor).getBigUint64(8, true), size);
    assert.equal(view(central).getBigUint64(55, true), size);
    assert.equal(view(secondCentral).getBigUint64(67, true), size + 79n);
    const python = spawnSync("python3", [
      "-c",
      `import zlib\nc=0\nb=bytes(${chunk.length})\nfor _ in range(${repeats}): c=zlib.crc32(b,c)\nprint(c)`,
    ]);
    assert.equal(python.status, 0, python.stderr?.toString());
    assert.equal(view(descriptor).getUint32(4, true), Number(python.stdout.toString().trim()));
    assert.equal(out.closed, 1);
  },
);
