import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { archiveLocator, ARCHIVE_LIMITS, decodeArchiveRecord } from "../archive-reader.mjs";

// Python stdlib constructs fixtures, then actual native dmx.py independently decodes
// them using an in-memory archive. No copied JS decoder serves as the oracle.
const fixtures = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      String.raw`
import hashlib, importlib.util, io, json, pathlib, struct, sys, zlib
spec = importlib.util.spec_from_file_location('dmx', pathlib.Path(sys.argv[1]) / 'dm/tools/dmx.py')
dmx = importlib.util.module_from_spec(spec); spec.loader.exec_module(dmx)
content = bytes(range(256)) * 32 + b'bounded archive fixture'
parts = [content[:97], content[97:]]
blocks = [b'N' + parts[0], b'Z' + zlib.compress(parts[1])]
header = b'BLTE' + struct.pack('>I', 12 + 24 * len(blocks)) + b'\x0f\x00\x00\x02'
for block, part in zip(blocks, parts):
    header += struct.pack('>II', len(block), len(part)) + hashlib.md5(block).digest()
result = []
for encoding, raw in [('n', content), ('z', zlib.compress(content)), ('b:synthetic', header + b''.join(blocks))]:
    ckey = hashlib.md5(content).hexdigest()
    row = ['0','0','0','0',ckey,str(len(content)),'00'*16,str(len(raw)),encoding,'fixture','0']
    dmx._FH[(0,0)] = io.BytesIO(raw)
    decoded = dmx.read_row(row)
    result.append(dict(raw=raw.hex(), decoded=decoded.hex(), record=dict(offset=0, encodedSize=len(raw), decodedSize=len(content), encoding=encoding, ckey=ckey)))
print(json.dumps(result))
`,
      fileURLToPath(new URL("../../", import.meta.url)),
    ],
    { encoding: "utf8" },
  ),
);
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");
const verifyMd5 = async (bytes, expected) => md5(bytes) === expected;
function source(bytes, base = 0) {
  const reads = [];
  return {
    size: base + bytes.length,
    reads,
    async read(offset, length) {
      reads.push([offset, length]);
      assert.ok(offset >= base);
      assert.ok(length <= ARCHIVE_LIMITS.encodedBlock);
      return bytes.slice(offset - base, offset - base + length);
    },
  };
}
const blte = fixtures[2];
const decode = (bytes, record = blte.record, options = {}) =>
  decodeArchiveRecord(source(bytes), record, { verifyMd5, ...options });
for (const fixture of fixtures) {
  test(`Python/native parity: ${fixture.record.encoding}`, async () => {
    const bytes = Buffer.from(fixture.raw, "hex");
    const input = source(bytes);
    assert.equal(
      Buffer.from(await decodeArchiveRecord(input, fixture.record, { verifyMd5 })).toString("hex"),
      fixture.decoded,
    );
    assert.ok(input.reads.length >= 2);
  });
}
test("40-bit locator and sparse >4 GiB reads preserve exact offsets", async () => {
  const base = 0x123456789a;
  assert.deepEqual(archiveLocator("0000000000000000000203123456789a"), {
    chunk: 2,
    archive: 3,
    offset: base,
    filename: "02-00000003.data",
  });
  const input = source(Buffer.from(blte.raw, "hex"), base);
  const result = await decodeArchiveRecord(input, { ...blte.record, offset: base }, { verifyMd5 });
  assert.equal(Buffer.from(result).toString("hex"), blte.decoded);
  assert.ok(input.reads.every(([offset]) => offset >= base));
  assert.throws(() => archiveLocator("bad"), /EKey/);
});
test("large raw records are read in bounded chunks", async () => {
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 257, 0x5a);
  const input = source(bytes);
  const decoded = await decodeArchiveRecord(
    input,
    {
      offset: 0,
      encodedSize: bytes.length,
      decodedSize: bytes.length,
      encoding: "n",
      ckey: md5(bytes),
    },
    { verifyMd5 },
  );
  assert.equal(Buffer.compare(Buffer.from(decoded), bytes), 0);
  assert.ok(input.reads.length >= 3);
  assert.ok(input.reads.every(([, length]) => length <= 4 * 1024 * 1024));
});
test("MD5 is mandatory, includes BLTE mode byte, and checks final CKey", async () => {
  const bytes = Buffer.from(blte.raw, "hex");
  await assert.rejects(decodeArchiveRecord(source(bytes), blte.record), /verifier is required/);
  const observed = [];
  await decode(bytes, blte.record, {
    verifyMd5: async (data, expected, context) => {
      observed.push([context.kind, data[0]]);
      return verifyMd5(data, expected);
    },
  });
  assert.deepEqual(observed, [
    ["encoded block", 78],
    ["encoded block", 90],
    ["decoded content", 0],
  ]);
  await assert.rejects(
    decode(bytes, { ...blte.record, ckey: "0".repeat(32) }),
    /MD5 mismatch: decoded/,
  );
  bytes[20] ^= 1;
  await assert.rejects(decode(bytes), /MD5 mismatch: encoded/);
  await assert.rejects(
    decode(Buffer.from(blte.raw, "hex"), blte.record, { verifyMd5: () => undefined }),
    /MD5 mismatch/,
  );
});
test("reject malformed metadata before payload reads or oversized allocations", async () => {
  const original = Buffer.from(blte.raw, "hex");
  for (const [field, value] of [
    ["decodedSize", ARCHIVE_LIMITS.decodedRecord + 1],
    ["encodedSize", ARCHIVE_LIMITS.encodedRecord + 1],
    ["offset", Number.MAX_SAFE_INTEGER],
    ["offset", -1],
    ["decodedSize", NaN],
  ]) {
    const input = source(original);
    await assert.rejects(
      decodeArchiveRecord(input, { ...blte.record, [field]: value }, { verifyMd5 }),
    );
    assert.equal(input.reads.length, 0);
  }
  for (const mutate of [
    (b) => b.writeUInt32BE(0, 4),
    (b) => {
      b[8] = 0;
    },
    (b) => {
      b[9] = 255;
    },
    (b) => b.writeUInt32BE(ARCHIVE_LIMITS.encodedBlock + 1, 12),
    (b) => b.writeUInt32BE(ARCHIVE_LIMITS.decodedBlock + 1, 16),
    (b) => b.writeUInt32BE(0, 12),
    (b) => b.writeUInt32BE(1, 16),
  ]) {
    const bytes = Buffer.from(original);
    mutate(bytes);
    const input = source(bytes);
    await assert.rejects(decodeArchiveRecord(input, blte.record, { verifyMd5 }));
    assert.ok(input.reads.every(([offset]) => offset === 0));
  }
});
test("truncation, short adapter reads and trailing container bytes fail closed", async () => {
  const bytes = Buffer.from(blte.raw, "hex");
  await assert.rejects(
    decode(bytes.subarray(0, 10), { ...blte.record, encodedSize: 10 }),
    /Truncated/,
  );
  await assert.rejects(decode(bytes.subarray(0, bytes.length - 1)), /outside source/);
  await assert.rejects(
    decode(Buffer.concat([bytes, Buffer.from([0])]), {
      ...blte.record,
      encodedSize: bytes.length + 1,
    }),
    /totals mismatch/,
  );
  await assert.rejects(
    decodeArchiveRecord({ size: bytes.length, read: async () => new Uint8Array() }, blte.record, {
      verifyMd5,
    }),
    /Short/,
  );
});
test("unsupported mode is rejected even with valid encoded MD5", async () => {
  const bytes = Buffer.from(blte.raw, "hex");
  bytes[60] = 69;
  Buffer.from(md5(bytes.subarray(60, 158)), "hex").copy(bytes, 20);
  await assert.rejects(decode(bytes), /Unsupported BLTE block mode/);
});
test("zlib output is bounded by declared size and malformed streams fail", async () => {
  const fixture = fixtures[1],
    bytes = Buffer.from(fixture.raw, "hex");
  await assert.rejects(decode(bytes, { ...fixture.record, decodedSize: 1 }), /exceeds declared/);
  await assert.rejects(
    decode(bytes, { ...fixture.record, decodedSize: fixture.record.decodedSize + 1 }),
    /length mismatch/,
  );
  const corrupt = Buffer.from(bytes);
  corrupt[corrupt.length - 1] ^= 255;
  await assert.rejects(decode(corrupt, fixture.record));
  await assert.rejects(
    decode(bytes.subarray(0, bytes.length - 2), {
      ...fixture.record,
      encodedSize: bytes.length - 2,
    }),
  );
});
test("cancellation before reads and during awaited checksum returns no output", async () => {
  const bytes = Buffer.from(blte.raw, "hex");
  const controller = new AbortController();
  controller.abort();
  const input = source(bytes);
  await assert.rejects(
    decodeArchiveRecord(input, blte.record, { verifyMd5, signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(input.reads.length, 0);
  const next = new AbortController();
  await assert.rejects(
    decode(bytes, blte.record, {
      signal: next.signal,
      verifyMd5: async () => {
        next.abort();
        return true;
      },
    }),
    { name: "AbortError" },
  );
});
test("empty native raw record is valid; unsupported encodings and raw sizes are not", async () => {
  const record = {
    offset: 0,
    encodedSize: 0,
    decodedSize: 0,
    encoding: "n",
    ckey: md5(new Uint8Array()),
  };
  assert.equal((await decode(new Uint8Array(), record)).length, 0);
  await assert.rejects(decode(new Uint8Array(), { ...record, encoding: "e" }), /Unsupported/);
  await assert.rejects(decode(new Uint8Array(), { ...record, decodedSize: 1 }), /Raw length/);
});
test("abort during decompression cancels stream and never returns partial bytes", async () => {
  const original = globalThis.DecompressionStream;
  const controller = new AbortController();
  let transformed = false;
  // Deterministic stream scheduling seam; actual zlib correctness is covered above.
  globalThis.DecompressionStream = class {
    constructor(format) {
      assert.equal(format, "deflate");
      return new TransformStream({
        transform(_chunk, stream) {
          transformed = true;
          stream.enqueue(new Uint8Array([1]));
          controller.abort();
        },
      });
    }
  };
  try {
    const fixture = fixtures[1];
    await assert.rejects(
      decode(Buffer.from(fixture.raw, "hex"), fixture.record, { signal: controller.signal }),
      { name: "AbortError" },
    );
    assert.ok(transformed);
  } finally {
    globalThis.DecompressionStream = original;
  }
});
test("compressed input uses small sequential writes, not a whole-block enqueue", async () => {
  const original = globalThis.DecompressionStream;
  const sizes = [];
  let active = 0,
    peak = 0;
  globalThis.DecompressionStream = class {
    constructor() {
      return new TransformStream({
        async transform(chunk, controller) {
          active++;
          peak = Math.max(peak, active);
          sizes.push(chunk.length);
          await Promise.resolve();
          controller.enqueue(chunk);
          active--;
        },
      });
    }
  };
  try {
    const bytes = new Uint8Array(ARCHIVE_LIMITS.compressedSlice * 4 + 17).fill(7);
    const result = await decode(bytes, {
      offset: 0,
      encodedSize: bytes.length,
      decodedSize: bytes.length,
      encoding: "z",
      ckey: md5(bytes),
    });
    assert.deepEqual(result, bytes);
    assert.deepEqual(sizes, [1024, 1024, 1024, 1024, 17]);
    assert.equal(peak, 1);
  } finally {
    globalThis.DecompressionStream = original;
  }
});
test("output overflow stops compressed producer rather than submitting remaining slices", async () => {
  const original = globalThis.DecompressionStream;
  let writes = 0;
  globalThis.DecompressionStream = class {
    constructor() {
      return new TransformStream({
        transform(chunk, controller) {
          writes++;
          assert.ok(chunk.length <= ARCHIVE_LIMITS.compressedSlice);
          controller.enqueue(new Uint8Array(2));
        },
      });
    }
  };
  try {
    const bytes = new Uint8Array(ARCHIVE_LIMITS.compressedSlice * 20);
    await assert.rejects(
      decode(bytes, {
        offset: 0,
        encodedSize: bytes.length,
        decodedSize: 1,
        encoding: "z",
        ckey: "0".repeat(32),
      }),
      /exceeds declared/,
    );
    assert.equal(writes, 1);
  } finally {
    globalThis.DecompressionStream = original;
  }
});
test("abort while a write is pending cancels reader, aborts writer and settles producer", async () => {
  const original = globalThis.DecompressionStream;
  const aborter = new AbortController();
  let cancelled = false,
    aborted = false,
    writeSettled = false,
    writes = 0;
  let release;
  globalThis.DecompressionStream = class {
    constructor() {
      this.readable = new ReadableStream({
        cancel() {
          cancelled = true;
          release();
        },
      });
      this.writable = new WritableStream({
        async write() {
          writes++;
          await new Promise((resolve) => {
            release = resolve;
            queueMicrotask(() => aborter.abort());
          });
          writeSettled = true;
        },
        abort() {
          aborted = true;
        },
      });
    }
  };
  try {
    const bytes = new Uint8Array(ARCHIVE_LIMITS.compressedSlice * 3);
    await assert.rejects(
      decode(
        bytes,
        {
          offset: 0,
          encodedSize: bytes.length,
          decodedSize: 1,
          encoding: "z",
          ckey: "0".repeat(32),
        },
        { signal: aborter.signal },
      ),
      { name: "AbortError" },
    );
    assert.ok(cancelled && aborted && writeSettled);
    assert.equal(writes, 1);
  } finally {
    globalThis.DecompressionStream = original;
  }
});
test("high-expansion zlib record is rejected after bounded input submission", async () => {
  // Generate 128 MiB logical output without allocating it: Python keeps one 64 KiB
  // synthetic chunk and the ~128 KiB compressed fixture. Decoder declares only 1 byte.
  const bytes = execFileSync("python3", [
    "-c",
    "import sys,zlib; c=zlib.compressobj(); chunk=bytes(65536); [sys.stdout.buffer.write(c.compress(chunk)) for _ in range(2048)]; sys.stdout.buffer.write(c.flush())",
  ]);
  assert.ok(bytes.length < ARCHIVE_LIMITS.encodedBlock);
  await assert.rejects(
    decode(bytes, {
      offset: 0,
      encodedSize: bytes.length,
      decodedSize: 1,
      encoding: "z",
      ckey: "0".repeat(32),
    }),
    /exceeds declared/,
  );
});
