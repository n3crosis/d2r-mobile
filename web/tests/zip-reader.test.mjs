import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createHash } from "node:crypto";
import { openShellZip, ZIP_LIMITS } from "../zip-reader.mjs";

// Independent Python zipfile writer: synthetic public text only, no downloaded shell.
const fixtures = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      String.raw`
import io, json, zipfile, random, hashlib
class Forward(io.BytesIO):
    def seekable(self): return False
    def seek(self, *args): raise io.UnsupportedOperation()
def make(names, compression=0, forward=False, symlink=False, content=None):
    b = Forward() if forward else io.BytesIO()
    with zipfile.ZipFile(b, 'w', compression=compression) as z:
        for name in names:
            info = zipfile.ZipInfo(name)
            info.compress_type = compression
            info.external_attr = ((0o120777 if symlink else (0o40755 if name.endswith('/') else 0o100644)) << 16)
            z.writestr(info, b'' if name.endswith('/') else (content if content is not None else b'public synthetic shell\n' * 400))
    return b.getvalue().hex()
large = random.Random(7).randbytes(65536)
print(json.dumps({
 'large': make(['public.bin'], zipfile.ZIP_DEFLATED, content=large),
 'largeHash': hashlib.sha256(large).hexdigest(),
 'store': make(['Payload/', 'Payload/Demo.app/', 'Payload/Demo.app/Info.plist']),
 'deflate': make(['Payload/Demo.app/main'], zipfile.ZIP_DEFLATED),
 'descriptor': make(['Payload/Demo.app/main'], zipfile.ZIP_DEFLATED, True),
 'utf8': make(['Caf\u00e9/file.txt']),
 'traversal': make(['../escape']),
 'absolute': make(['/escape']),
 'backslash': make(['a\\b']),
 'duplicate': make(['a', 'a']),
 'case': make(['A/a', 'a/b']),
 'ancestor': make(['a/b', 'a']),
 'symlink': make(['a'], symlink=True),
 'empty': make([]),
}))
`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
const fixture = (key) => Uint8Array.from(Buffer.from(fixtures[key], "hex"));
function source(bytes, hook) {
  const reads = [];
  return {
    size: bytes.length,
    reads,
    async read(offset, length) {
      reads.push([offset, length]);
      if (hook) await hook(offset, length);
      return bytes.slice(offset, offset + length);
    },
  };
}
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
function central(b) {
  return dv(b).getUint32(b.length - 6, true);
}
function put16(b, p, v) {
  dv(b).setUint16(p, v, true);
}
function put32(b, p, v) {
  dv(b).setUint32(p, v, true);
}

test("Python STORE inventory is detached, frozen and contract-shaped", async () => {
  const zip = await openShellZip(source(fixture("store")));
  assert.equal(zip.entries.length, 3);
  assert.ok(Object.isFrozen(zip.entries));
  assert.ok(Object.isFrozen(zip.entries[0]));
  assert.equal(zip.entries[0].mode, 0o40755);
  assert.equal(zip.entries[2].mode, 0o100644);
  assert.equal((await zip.readEntry("Payload/")).length, 0);
  assert.equal(
    new TextDecoder().decode(await zip.readEntry(zip.entries[2].path)),
    "public synthetic shell\n".repeat(400),
  );
  await assert.rejects(zip.readEntry("missing"), /Missing ZIP entry/);
});
for (const key of ["deflate", "descriptor", "utf8"]) {
  test(`Python ${key} round-trip with bounded compressed reads`, async () => {
    const input = source(fixture(key));
    const zip = await openShellZip(input);
    input.reads.length = 0;
    assert.equal(
      new TextDecoder().decode(await zip.readEntry(zip.entries[0].path)),
      "public synthetic shell\n".repeat(400),
    );
    if (key !== "utf8")
      assert.ok(input.reads.every(([, length]) => length <= ZIP_LIMITS.compressedSlice));
  });
}
for (const key of [
  "traversal",
  "absolute",
  "backslash",
  "duplicate",
  "case",
  "ancestor",
  "symlink",
  "empty",
]) {
  test(`rejects Python ${key} metadata`, async () => {
    await assert.rejects(openShellZip(source(fixture(key))));
  });
}
for (const [label, mutate] of [
  [
    "encryption",
    (b, c) => {
      put16(b, c + 8, 1);
    },
  ],
  [
    "unsupported compression",
    (b, c) => {
      put16(b, c + 10, 12);
    },
  ],
  [
    "ZIP64 sentinel",
    (b, c) => {
      put32(b, c + 24, 0xffffffff);
    },
  ],
  [
    "oversized decoded metadata",
    (b, c) => {
      put32(b, c + 24, ZIP_LIMITS.entryBytes + 1);
    },
  ],
  [
    "expansion ratio",
    (b, c) => {
      put32(b, c + 24, 1000000);
    },
  ],
  [
    "local name disagreement",
    (b) => {
      b[30] = 88;
    },
  ],
  [
    "local CRC disagreement",
    (b) => {
      put32(b, 14, 1);
    },
  ],
  [
    "overlap",
    (b, c) => {
      put32(b, c + 42, 1);
    },
  ],
  [
    "multi-disk",
    (b) => {
      put16(b, b.length - 18, 1);
    },
  ],
  [
    "wrong central bounds",
    (b) => {
      put32(b, b.length - 10, 1);
    },
  ],
  [
    "invalid UTF8",
    (b, c) => {
      put16(b, c + 8, 0x800);
      b[c + 46] = 0xff;
    },
  ],
]) {
  test(`rejects ${label} before decompression`, async () => {
    const b = fixture("deflate");
    mutate(b, central(b));
    await assert.rejects(openShellZip(source(b)));
  });
}

test("rejects payload corruption by CRC, never returns partial data", async () => {
  const b = fixture("utf8");
  const zip = await openShellZip(source(b));
  b[30 + dv(b).getUint16(26, true)] ^= 1;
  await assert.rejects(zip.readEntry(zip.entries[0].path), /CRC mismatch/);
});

test("validates data descriptor and accepts signatureless ZIP32 descriptor", async () => {
  const b = fixture("descriptor"),
    c = central(b),
    compressed = dv(b).getUint32(c + 20, true);
  const descriptor = 30 + dv(b).getUint16(26, true) + compressed;
  const bad = b.slice();
  put32(bad, descriptor + 4, 1);
  await assert.rejects(openShellZip(source(bad)), /descriptor/);
  const unsigned = new Uint8Array(b.length - 4);
  unsigned.set(b.subarray(0, descriptor));
  unsigned.set(b.subarray(descriptor + 4), descriptor);
  put32(unsigned, unsigned.length - 6, c - 4);
  const zip = await openShellZip(source(unsigned));
  assert.equal((await zip.readEntry(zip.entries[0].path)).length, 9200);
});

test("cancellation and malformed source errors do not expose raw source failures", async () => {
  const controller = new AbortController();
  controller.abort("private detail");
  await assert.rejects(
    openShellZip(source(fixture("store")), { signal: controller.signal }),
    /cancelled/,
  );
  await assert.rejects(
    openShellZip({
      size: 100,
      read() {
        throw new Error("private detail");
      },
    }),
    (e) => !e.message.includes("private detail"),
  );
  await assert.rejects(
    openShellZip({
      size: 100,
      async read() {
        return new Uint8Array(0);
      },
    }),
    /truncated/,
  );
  const zip = await openShellZip(source(fixture("deflate")));
  await assert.rejects(
    zip.readEntry(zip.entries[0].path, { signal: controller.signal }),
    /cancelled/,
  );
});

test("output overshoot and truncated deflate reject with no entry result", async () => {
  for (const wrongSize of [9199, 9201]) {
    const b = fixture("deflate"),
      c = central(b);
    put32(b, 22, wrongSize);
    put32(b, c + 24, wrongSize);
    const zip = await openShellZip(source(b));
    await assert.rejects(zip.readEntry(zip.entries[0].path));
  }
  const b = fixture("deflate");
  const zip = await openShellZip(source(b));
  b.fill(0xff, 30 + dv(b).getUint16(26, true), central(b));
  await assert.rejects(zip.readEntry(zip.entries[0].path));
});

test("one entry read at a time caps simultaneous output allocation", async () => {
  const zip = await openShellZip(source(fixture("deflate")));
  const first = zip.readEntry(zip.entries[0].path);
  await assert.rejects(zip.readEntry(zip.entries[0].path), /Concurrent/);
  await first;
});

test("large deflate is fetched in small slices, never one full encoded entry", async () => {
  const input = source(fixture("large"));
  const zip = await openShellZip(input);
  input.reads.length = 0;
  const output = await zip.readEntry("public.bin");
  assert.equal(createHash("sha256").update(output).digest("hex"), fixtures.largeHash);
  assert.ok(input.reads.length > 60);
  assert.ok(input.reads.every(([, n]) => n <= ZIP_LIMITS.compressedSlice));
});

test("mid-stream cancellation settles both directions and permits another read", async () => {
  const controller = new AbortController();
  let decoding = false,
    chunks = 0;
  const input = source(fixture("large"), () => {
    if (decoding && ++chunks === 3) controller.abort("private reason");
  });
  const zip = await openShellZip(input);
  decoding = true;
  await assert.rejects(
    zip.readEntry("public.bin", { signal: controller.signal }),
    (e) => !e.message.includes("private reason"),
  );
  decoding = false;
  assert.equal((await zip.readEntry("public.bin")).length, 65536);
});

test("trailing compressed junk is not silently accepted", async () => {
  const original = fixture("deflate"),
    c = central(original);
  const b = new Uint8Array(original.length + 1);
  b.set(original.subarray(0, c));
  b[c] = 0xff;
  b.set(original.subarray(c), c + 1);
  const size = dv(original).getUint32(c + 20, true) + 1;
  put32(b, 18, size);
  put32(b, c + 1 + 20, size);
  put32(b, b.length - 6, c + 1);
  const zip = await openShellZip(source(b));
  await assert.rejects(zip.readEntry(zip.entries[0].path));
});

test("trailing junk rejection does not depend on native DEFLATE strictness", async () => {
  const original = fixture("deflate"),
    c = central(original);
  const b = new Uint8Array(original.length + 1);
  b.set(original.subarray(0, c));
  b[c] = 0xff;
  b.set(original.subarray(c), c + 1);
  const size = dv(original).getUint32(c + 20, true) + 1;
  put32(b, 18, size);
  put32(b, c + 1 + 20, size);
  put32(b, b.length - 6, c + 1);
  const Native = globalThis.DecompressionStream;
  globalThis.DecompressionStream = class {
    constructor() {
      // Deliberately permissive runtime: ignores every encoded byte and would
      // return matching decoded bytes/CRC even when compressed junk is present.
      return new TransformStream({
        transform() {},
        flush(controller) {
          controller.enqueue(new TextEncoder().encode("public synthetic shell\n".repeat(400)));
        },
      });
    }
  };
  try {
    const zip = await openShellZip(source(b));
    await assert.rejects(zip.readEntry(zip.entries[0].path));
  } finally {
    globalThis.DecompressionStream = Native;
  }
});
