import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectXci, XCI_INPUT_LIMITS, XciInputError } from "../xci-input.mjs";

// Authored synthetic HEAD/HFS0 images only. No game content, keys, or copied fixtures.
const digest = (bytes) => createHash("sha256").update(bytes).digest();
const payload = (name, length = 32) => ({ name, contents: Buffer.alloc(length, 0x5a) });

function range(segments, start, length) {
  const bytes = Buffer.alloc(length);
  const end = start + BigInt(length);
  for (const segment of segments) {
    const segmentEnd = segment.offset + BigInt(segment.bytes.length);
    const from = start > segment.offset ? start : segment.offset;
    const to = end < segmentEnd ? end : segmentEnd;
    if (from < to) {
      segment.bytes.copy(
        bytes,
        Number(from - start),
        Number(from - segment.offset),
        Number(to - segment.offset),
      );
    }
  }
  return bytes;
}

function hfs(definitions, { padding = 512 } = {}) {
  const strings = Buffer.from(definitions.map((entry) => `${entry.name}\0`).join(""));
  const minimum = 16 + definitions.length * 64 + strings.length;
  const headerSize = Math.ceil(minimum / padding) * padding;
  const bytes = Buffer.alloc(headerSize);
  bytes.write("HFS0");
  bytes.writeUInt32LE(definitions.length, 4);
  bytes.writeUInt32LE(headerSize - 16 - definitions.length * 64, 8);
  strings.copy(bytes, 16 + definitions.length * 64);
  const segments = [{ offset: 0n, bytes }];
  const entries = [];
  let cursor = 0n;
  let stringOffset = 0;
  for (let i = 0; i < definitions.length; i++) {
    const definition = definitions[i];
    const contents = Buffer.isBuffer(definition.contents)
      ? {
          size: BigInt(definition.contents.length),
          segments: [{ offset: 0n, bytes: definition.contents }],
        }
      : definition.contents;
    const offset = definition.offset ?? cursor;
    const size = definition.size ?? contents.size;
    const hashSize = definition.hashSize ?? Number(size < 512n ? size : 512n);
    const position = 16 + i * 64;
    bytes.writeBigUInt64LE(offset, position);
    bytes.writeBigUInt64LE(size, position + 8);
    bytes.writeUInt32LE(stringOffset, position + 16);
    bytes.writeUInt32LE(hashSize, position + 20);
    digest(range(contents.segments, 0n, hashSize)).copy(bytes, position + 32);
    const start = BigInt(headerSize) + offset;
    for (const segment of contents.segments) {
      segments.push({ offset: start + segment.offset, bytes: segment.bytes });
    }
    entries.push({ name: definition.name, offset: start, size, position, contents });
    stringOffset += Buffer.byteLength(definition.name) + 1;
    if (offset + size > cursor) cursor = offset + size;
  }
  return { bytes, segments, entries, headerSize, size: BigInt(headerSize) + cursor };
}

function fixture({ partitions, secureMembers, rootOffset = 0xf000n } = {}) {
  const definitions = partitions ?? [
    { name: "secure", contents: hfs(secureMembers ?? [payload("program.nca")]) },
  ];
  const root = hfs(definitions);
  const head = Buffer.alloc(0x200);
  head.write("HEAD", 0x100);
  head.writeBigUInt64LE(rootOffset, 0x130);
  head.writeBigUInt64LE(BigInt(root.headerSize), 0x138);
  digest(root.bytes).copy(head, 0x140);
  const segments = [
    { offset: 0n, bytes: head },
    ...root.segments.map((segment) => ({ ...segment, offset: rootOffset + segment.offset })),
  ];
  const reads = [];
  const file = {
    name: "synthetic.xci",
    size: Number(rootOffset + root.size),
    slice(start, end) {
      assert(Number.isSafeInteger(start) && Number.isSafeInteger(end));
      assert(start >= 0 && start <= end && end <= this.size);
      assert(end - start <= XCI_INPUT_LIMITS.readBytes, "Every read must be bounded");
      reads.push({ start, end });
      return {
        async arrayBuffer() {
          const bytes = range(segments, BigInt(start), end - start);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
  };
  const resealRoot = () => digest(root.bytes).copy(head, 0x140);
  const resealPartitions = () => {
    for (const entry of root.entries) {
      const hashSize = root.bytes.readUInt32LE(entry.position + 20);
      digest(range(segments, rootOffset + entry.offset, hashSize)).copy(
        root.bytes,
        entry.position + 32,
      );
    }
    resealRoot();
  };
  return { file, reads, head, root, rootOffset, segments, resealRoot, resealPartitions };
}

const rejects = (image, code) =>
  assert.rejects(inspectXci(image.file), (error) => {
    assert(error instanceof XciInputError);
    assert.equal(error.code, code);
    return true;
  });

test("global HEAD/HFS0 selects only secure NCA and ticket entries, with absolute BigInt ranges", async () => {
  const secure = hfs([
    payload("program.nca"),
    payload("rights.tik", 24),
    payload("metadata.cnmt.nca", 64),
    payload("ignore.cert"),
  ]);
  const image = fixture({
    partitions: [
      { name: "update", contents: hfs([payload("system.nca")]) },
      { name: "normal", contents: hfs([payload("normal.nca"), payload("normal.tik")]) },
      { name: "secure", contents: secure },
      { name: "logo", contents: hfs([payload("logo.nca")]) },
    ],
  });
  const result = await inspectXci(image.file);
  const secureBase = image.rootOffset + image.root.entries[2].offset;
  assert.deepEqual(result, {
    format: "XCI",
    size: BigInt(image.file.size),
    entries: secure.entries.slice(0, 3).map((entry) => ({
      name: entry.name,
      offset: secureBase + entry.offset,
      size: entry.size,
    })),
  });
  assert(Object.isFrozen(result) && Object.isFrozen(result.entries));
  assert(result.entries.every(Object.isFrozen));
});

test("supports empty non-secure partitions and case-insensitive NCA/ticket extensions", async () => {
  const image = fixture({
    partitions: [
      { name: "normal", contents: hfs([], { padding: 1 }) },
      { name: "secure", contents: hfs([payload("PROGRAM.NCA"), payload("RIGHTS.TIK")]) },
    ],
  });
  assert.deepEqual(
    (await inspectXci(image.file)).entries.map((entry) => entry.name),
    ["PROGRAM.NCA", "RIGHTS.TIK"],
  );
});

test("accepts an immutable Blob containing only the authored synthetic image", async () => {
  const image = fixture();
  const blob = new Blob([range(image.segments, 0n, image.file.size)]);
  assert.deepEqual(await inspectXci(blob), await inspectXci(image.file));
});

test("sparse files above 4 GiB retain exact absolute offsets and do not read whole members", async () => {
  const gap = (1n << 32n) + 1337n;
  const largeMember = (1n << 32n) + 71n;
  const image = fixture({
    rootOffset: (1n << 32n) + 0x200n,
    secureMembers: [
      { ...payload("huge.nca"), offset: gap, size: largeMember, hashSize: 32 },
      { ...payload("tail.tik", 8), offset: gap + largeMember },
    ],
  });
  const result = await inspectXci(image.file);
  const offset = image.rootOffset + BigInt(image.root.headerSize + 512) + gap;
  assert.equal(result.entries[0].offset, offset);
  assert.equal(result.entries[0].size, largeMember);
  assert.equal(result.entries[1].offset, offset + largeMember);
  assert(result.size > 12n * 1024n * 1024n * 1024n);
  assert(image.reads.reduce((sum, read) => sum + read.end - read.start, 0) < 4096);
});

test("large metadata indexes and declared hash prefixes are read in 64 KiB chunks", async () => {
  const definitions = Array.from({ length: 1100 }, (_, i) => payload(`data-${i}.nca`, 0));
  definitions[0] = { ...payload("program.nca", 160000), hashSize: 150001 };
  // Empty irrelevant members are allowed, with the SHA-256 of the empty prefix.
  for (let i = 1; i < definitions.length; i++) definitions[i].name = `data-${i}.cert`;
  const secure = hfs(definitions);
  assert(secure.headerSize > XCI_INPUT_LIMITS.readBytes);
  const image = fixture({ partitions: [{ name: "secure", contents: secure }] });
  const result = await inspectXci(image.file);
  assert.equal(result.entries.length, 1);
  assert(image.reads.some((read) => read.end - read.start === XCI_INPUT_LIMITS.readBytes));
  assert(image.reads.every((read) => read.end - read.start <= 65536));
});

test("checks declared prefixes, not trailing bytes, while leaving full NCA integrity to the gate", async () => {
  const content = Buffer.alloc(1000, 0x5a);
  const image = fixture({
    secureMembers: [{ name: "program.nca", contents: content, hashSize: 32 }],
  });
  content[999] ^= 1;
  assert.equal((await inspectXci(image.file)).entries.length, 1);
  content[0] ^= 1;
  await rejects(image, "HFS0_MEMBER_HASH");
});

test("rejects truncated or misplaced HEAD magic and invalid file objects", async () => {
  await assert.rejects(inspectXci(new Blob([new Uint8Array(511)])), { code: "XCI_HEADER" });
  for (const file of [null, {}, { size: -1, slice() {} }, { size: 2 ** 53, slice() {} }]) {
    await assert.rejects(inspectXci(file), { code: "FILE_SIZE" });
  }
  const image = fixture();
  image.head.write("HEAD", 0);
  image.head.fill(0, 0x100, 0x104);
  await rejects(image, "XCI_MAGIC");
});

for (const [label, offset, headerSize] of [
  ["inside HEAD", 0n, 512n],
  ["unaligned", 0xf001n, 512n],
  ["past file", 1n << 63n, 512n],
  ["empty header", 0xf000n, 0n],
  ["short header", 0xf000n, 15n],
  ["oversized header", 0xf000n, 1n << 63n],
]) {
  test(`rejects invalid declared root ${label}`, async () => {
    const image = fixture();
    image.head.writeBigUInt64LE(offset, 0x130);
    image.head.writeBigUInt64LE(headerSize, 0x138);
    await rejects(image, "XCI_ROOT_RANGE");
    assert.equal(image.reads.length, 1);
  });
}

test("rejects a root hash mismatch and regional-suffix variants without fallback", async () => {
  const mismatch = fixture();
  mismatch.head[0x140] ^= 1;
  await rejects(mismatch, "XCI_ROOT_HASH");
  const regional = fixture();
  digest(Buffer.concat([regional.root.bytes, Buffer.from([1])])).copy(regional.head, 0x140);
  await rejects(regional, "XCI_ROOT_HASH");
});

test("requires the declared root header size to match the complete HFS0 index", async () => {
  const image = fixture();
  image.head.writeBigUInt64LE(16n, 0x138);
  digest(image.root.bytes.subarray(0, 16)).copy(image.head, 0x140);
  await rejects(image, "XCI_ROOT_SIZE");
});

test("rejects corrupt partition prefix hashes, including partitions not selected for output", async () => {
  const image = fixture({
    partitions: [
      { name: "normal", contents: hfs([payload("other.nca")]) },
      { name: "secure", contents: hfs([payload("program.nca")]) },
    ],
  });
  image.root.entries[0].contents.bytes[20] ^= 1;
  await rejects(image, "HFS0_PARTITION_HASH");
});

test("checks member hashes even in non-secure partitions and ignored secure files", async () => {
  for (const name of ["normal", "secure"]) {
    const normalContent = Buffer.alloc(32, 0xa5);
    const secureContent = Buffer.alloc(32, 0xa5);
    const image = fixture({
      partitions: [
        { name: "normal", contents: hfs([{ name: "ignore.cert", contents: normalContent }]) },
        {
          name: "secure",
          contents: hfs([payload("program.nca"), { name: "ignore.cert", contents: secureContent }]),
        },
      ],
    });
    (name === "normal" ? normalContent : secureContent)[0] ^= 1;
    await rejects(image, "HFS0_MEMBER_HASH");
  }
});

for (const location of ["root", "partition"]) {
  for (const [label, mutate, code] of [
    ["magic", (bytes) => bytes.write("PFS0"), "HFS0_MAGIC"],
    ["header reserved", (bytes) => bytes.writeUInt32LE(1, 12), "HFS0_RESERVED"],
    ["entry reserved", (bytes) => bytes.writeBigUInt64LE(1n, 16 + 24), "HFS0_RESERVED"],
    ["enormous count", (bytes) => bytes.writeUInt32LE(0xffffffff, 4), "HFS0_LIMIT"],
    ["enormous strings", (bytes) => bytes.writeUInt32LE(0xffffffff, 8), "HFS0_LIMIT"],
    ["outside string offset", (bytes) => bytes.writeUInt32LE(0xffffffff, 16 + 16), "HFS0_NAME"],
    ["interior string offset", (bytes) => bytes.writeUInt32LE(1, 16 + 16), "HFS0_NAME"],
    ["outside member offset", (bytes) => bytes.writeBigUInt64LE(1n << 63n, 16), "HFS0_RANGE"],
    ["outside member size", (bytes) => bytes.writeBigUInt64LE(1n << 63n, 16 + 8), "HFS0_RANGE"],
    ["missing hash prefix", (bytes) => bytes.writeUInt32LE(0, 16 + 20), "HFS0_HASH_RANGE"],
    ["hash beyond member", (bytes) => bytes.writeUInt32LE(1000000, 16 + 20), "HFS0_HASH_RANGE"],
  ]) {
    test(`rejects ${location} HFS0 ${label}`, async () => {
      const image = fixture();
      const bytes = location === "root" ? image.root.bytes : image.root.entries[0].contents.bytes;
      mutate(bytes);
      if (location === "root") image.resealRoot();
      else image.resealPartitions();
      await rejects(image, code);
    });
  }
}

test("rejects an index that extends outside its partition even when inside the full file", async () => {
  const image = fixture({
    partitions: [
      { name: "normal", contents: hfs([payload("normal.cert")]) },
      { name: "secure", contents: hfs([payload("program.nca")]) },
    ],
  });
  const normal = image.root.entries[0];
  image.root.bytes.writeBigUInt64LE(16n, normal.position + 8);
  image.root.bytes.writeUInt32LE(16, normal.position + 20);
  image.resealPartitions();
  await rejects(image, "HFS0_TRUNCATED");
});

test("rejects a member that extends outside its partition even when inside the full file", async () => {
  const normal = hfs([payload("normal.cert")]);
  const image = fixture({
    partitions: [
      { name: "normal", contents: normal },
      { name: "secure", contents: hfs([payload("program.nca")]) },
    ],
  });
  normal.bytes.writeBigUInt64LE(33n, 16 + 8);
  image.resealPartitions();
  await rejects(image, "HFS0_RANGE");
});

test("rejects overlapping root partition and nested member extents", async () => {
  const image = fixture({
    partitions: [
      { name: "normal", contents: hfs([payload("normal.cert")]) },
      { name: "secure", contents: hfs([payload("program.nca")]) },
    ],
  });
  image.root.bytes.writeBigUInt64LE(1n, 16 + 64);
  image.resealRoot();
  await rejects(image, "HFS0_OVERLAP");
  const nested = fixture({ secureMembers: [payload("one.nca"), payload("two.nca")] });
  nested.root.entries[0].contents.bytes.writeBigUInt64LE(1n, 16 + 64);
  nested.resealPartitions();
  await rejects(nested, "HFS0_OVERLAP");
});

test("accepts disjoint out-of-order member offsets without truncating the selected ranges", async () => {
  const image = fixture({
    secureMembers: [
      { ...payload("later.nca"), offset: 32n },
      { ...payload("earlier.nca"), offset: 0n },
    ],
  });
  const result = await inspectXci(image.file);
  assert.equal(result.entries[0].offset - result.entries[1].offset, 32n);
});

for (const name of [
  "../bad.nca",
  "bad\\file.nca",
  "bad:nca",
  "CON.nca",
  "bad. ",
  "x\u0001.nca",
  "e\u0301.nca",
]) {
  test(`rejects unsafe filename ${JSON.stringify(name)}`, async () => {
    await rejects(fixture({ secureMembers: [payload(name)] }), "UNSAFE_NAME");
  });
}

test("rejects empty, oversized, unterminated, and invalid UTF-8 filenames", async () => {
  for (const name of ["", "x".repeat(XCI_INPUT_LIMITS.filenameBytes + 1)]) {
    await rejects(fixture({ secureMembers: [payload(name)] }), "HFS0_NAME");
  }
  const unterminated = fixture();
  const index = unterminated.root.entries[0].contents.bytes;
  index.fill(0x61, 16 + 64);
  unterminated.resealPartitions();
  await rejects(unterminated, "HFS0_NAME");
  const utf8 = fixture();
  utf8.root.entries[0].contents.bytes[16 + 64] = 0xff;
  utf8.resealPartitions();
  await rejects(utf8, "HFS0_NAME");
});

test("rejects case-folded duplicate members and duplicate partitions", async () => {
  await rejects(
    fixture({ secureMembers: [payload("game.nca"), payload("GAME.NCA")] }),
    "DUPLICATE_NAME",
  );
  await rejects(
    fixture({
      partitions: [
        { name: "secure", contents: hfs([payload("one.nca")]) },
        { name: "secure", contents: hfs([payload("two.nca")]) },
      ],
    }),
    "DUPLICATE_NAME",
  );
});

test("rejects missing, unknown, or incorrectly cased secure partition layouts", async () => {
  for (const name of ["normal", "unknown", "Secure"]) {
    await rejects(
      fixture({ partitions: [{ name, contents: hfs([payload("program.nca")]) }] }),
      "XCI_PARTITIONS",
    );
  }
  await rejects(fixture({ partitions: [] }), "HFS0_LIMIT");
  await rejects(
    fixture({
      partitions: ["normal", "update", "secure", "logo", "extra"].map((name) => ({
        name,
        contents: hfs([]),
      })),
    }),
    "HFS0_LIMIT",
  );
});

test("rejects secure partitions without an NCA and empty selected members", async () => {
  await rejects(fixture({ secureMembers: [] }), "XCI_CONTENT");
  await rejects(fixture({ secureMembers: [payload("rights.tik")] }), "XCI_CONTENT");
  await rejects(fixture({ secureMembers: [payload("program.nca", 0)] }), "XCI_EMPTY_MEMBER");
  await rejects(
    fixture({ secureMembers: [payload("program.nca"), payload("rights.tik", 0)] }),
    "XCI_EMPTY_MEMBER",
  );
});

test("explicitly rejects compressed secure members, including mixed NCA/NCZ inputs", async () => {
  for (const name of ["program.ncz", "PROGRAM.NCZ", "metadata.cnmt.ncz"]) {
    await rejects(
      fixture({ secureMembers: [payload("plain.nca"), payload(name)] }),
      "XCI_COMPRESSED",
    );
  }
});

test("rejects oversized root or member hash prefixes before trying an oversized allocation/read", async () => {
  const huge = BigInt(XCI_INPUT_LIMITS.hashPrefixBytes + 1);
  const root = fixture({ secureMembers: [{ ...payload("large.nca"), size: huge * 2n }] });
  root.head.writeBigUInt64LE(huge, 0x138);
  await rejects(root, "HFS0_HASH_LIMIT");
  assert.equal(root.reads.length, 1);
  const member = fixture({ secureMembers: [{ ...payload("large.nca"), size: huge * 2n }] });
  member.root.entries[0].contents.bytes.writeUInt32LE(Number(huge), 16 + 20);
  member.resealPartitions();
  await rejects(member, "HFS0_HASH_LIMIT");
  assert(member.reads.every((read) => read.end - read.start <= 512));
});

test("caps aggregate declared hash work, including many individually bounded prefixes", async () => {
  const members = Array.from({ length: 5 }, (_, i) => ({
    ...payload(`data-${i}.nca`),
    size: BigInt(XCI_INPUT_LIMITS.hashPrefixBytes),
  }));
  const image = fixture({ secureMembers: members });
  const index = image.root.entries[0].contents.bytes;
  for (let i = 0; i < members.length; i++) {
    index.writeUInt32LE(XCI_INPUT_LIMITS.hashPrefixBytes, 16 + i * 64 + 20);
  }
  image.resealPartitions();
  await rejects(image, "HFS0_HASH_LIMIT");
  assert(image.reads.every((read) => read.end - read.start <= 512));
});

test("caps aggregate index bytes across root and partition before reading the index", async () => {
  const image = fixture({
    secureMembers: [{ ...payload("program.nca"), size: BigInt(XCI_INPUT_LIMITS.indexBytes) }],
  });
  const secure = image.root.entries[0].contents;
  // The partition index alone would fit the limit; the root index exhausts the remainder.
  secure.bytes.writeUInt32LE(XCI_INPUT_LIMITS.indexBytes - 16 - 64, 8);
  image.resealPartitions();
  await rejects(image, "HFS0_LIMIT");
  assert(image.reads.every((read) => read.end - read.start <= 512));
});

test("caps aggregate entry count before allocating a partition table", async () => {
  const image = fixture({
    secureMembers: [{ ...payload("program.nca"), size: BigInt(XCI_INPUT_LIMITS.indexBytes) }],
  });
  image.root.entries[0].contents.bytes.writeUInt32LE(XCI_INPUT_LIMITS.entries, 4);
  image.resealPartitions();
  await rejects(image, "HFS0_LIMIT");
  assert(image.reads.every((read) => read.end - read.start <= 512));
});

test("fails closed when the browser SHA-256 operation rejects", async (context) => {
  context.mock.method(globalThis.crypto.subtle, "digest", async () => {
    throw new Error("SHA-256 unavailable");
  });
  await rejects(fixture(), "XCI_CRYPTO");
});

test("normalizes short-read and rejected local read failures", async () => {
  const image = fixture();
  image.file.slice = () => ({ arrayBuffer: async () => new ArrayBuffer(1) });
  await rejects(image, "SHORT_READ");
  image.file.slice = () => ({
    async arrayBuffer() {
      throw new Error("local failure");
    },
  });
  await rejects(image, "READ_FAILED");
});
