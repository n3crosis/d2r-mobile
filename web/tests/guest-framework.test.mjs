import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGuestFramework,
  planGuestFramework,
  guestInfoPlist,
  MAX_IMAGE_BYTES,
  PAGE_SIZE,
} from "../guest-framework.mjs";
const source = fileURLToPath(new URL("../../dm/tools/guest_dylib.py", import.meta.url));
const options = { crypto: webcrypto };
const fixture = (name, size, textEnd, patchOff) => ({
  name,
  image: Uint8Array.from({ length: size }, (_, i) => (i * 13 + 31) % 256),
  textEnd,
  patchOff,
});

function pythonBuild(modules, dir) {
  for (const m of modules) {
    writeFileSync(join(dir, `${m.name}.patched.bin`), m.image);
    writeFileSync(
      join(dir, `${m.name}.fixups.tsv`),
      `# TEXT_END ${m.textEnd.toString(16)}\n# PATCH_OFF ${m.patchOff.toString(16)}\n`,
    );
  }
  const r = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      `import importlib.util,sys\ns=importlib.util.spec_from_file_location('guest',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)\nm.write(sys.argv[2],sys.argv[2],sys.argv[3:])`,
      source,
      dir,
      ...modules.map((m) => m.name),
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(join(dir, "Guest.framework", "Guest"));
}

test("synthetic byte parity with stdlib Python writer, repeated builds and plist", async () => {
  const cases = [
    [fixture("a", 1, 1, PAGE_SIZE)],
    [
      fixture("a", PAGE_SIZE * 3 + 17, PAGE_SIZE - 1, PAGE_SIZE * 2),
      fixture("b", PAGE_SIZE * 2, 0, PAGE_SIZE),
    ],
    [fixture("abcdefghij", PAGE_SIZE, PAGE_SIZE, PAGE_SIZE)],
    Array.from({ length: 48 }, (_, i) => fixture(`m${i}`, 1, 0, 0)),
  ];
  for (const modules of cases) {
    const dir = mkdtempSync(join(tmpdir(), "guest-parity-"));
    try {
      const expected = pythonBuild(modules, dir);
      const actual = await buildGuestFramework(modules, options);
      assert.deepEqual(Buffer.from(actual), expected);
      assert.deepEqual(await buildGuestFramework(modules, options), actual);
      assert.equal(
        guestInfoPlist(),
        readFileSync(join(dir, "Guest.framework", "Info.plist"), "utf8"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("16 KiB layout, UUID and structural ad-hoc signature cover the entire unsigned prefix", async () => {
  const modules = [fixture("foo", PAGE_SIZE * 3 + 71, PAGE_SIZE, PAGE_SIZE * 2)];
  const p = planGuestFramework(modules),
    out = await buildGuestFramework(modules, options),
    v = new DataView(out.buffer);
  let pos = 32,
    uuid,
    textSize;
  for (let i = 0; i < v.getUint32(16, true); i++) {
    const cmd = v.getUint32(pos, true),
      size = v.getUint32(pos + 4, true);
    if (cmd === 0x19) {
      const at = Number(v.getBigUint64(pos + 24, true)),
        len = Number(v.getBigUint64(pos + 32, true));
      assert.equal(at % PAGE_SIZE, 0);
      assert.equal(len % PAGE_SIZE, 0);
      if (pos === 32) textSize = len;
      for (let j = 0; j < v.getUint32(pos + 64, true); j++) {
        const s = pos + 72 + 80 * j;
        assert.equal(v.getUint32(s + 48, true) % PAGE_SIZE, 0);
        assert.equal(Number(v.getBigUint64(s + 40, true)) % PAGE_SIZE, 0);
        assert.equal(v.getUint32(s + 52, true), 14);
      }
    }
    if (cmd === 0x1b) uuid = out.slice(pos + 8, pos + 24);
    if (i === v.getUint32(16, true) - 1) {
      assert.equal(cmd, 0x1d);
      assert.equal(v.getUint32(pos + 8, true), p.signatureOffset);
      assert.equal(v.getUint32(pos + 12, true), p.signatureSize);
    }
    pos += size;
  }
  assert.deepEqual(
    Buffer.from(uuid),
    createHash("sha256").update(out.subarray(PAGE_SIZE, p.bodyEnd)).digest().subarray(0, 16),
  );
  const sig = p.signatureOffset,
    cd = sig + 20;
  assert.equal(v.getUint32(sig), 0xfade0cc0);
  assert.equal(v.getUint32(cd), 0xfade0c02);
  assert.equal(v.getUint32(cd + 12), 0x20002);
  assert.equal(v.getUint32(cd + 32), sig);
  assert.equal(Number(v.getBigUint64(cd + 72)), textSize);
  const count = v.getUint32(cd + 28);
  for (let i = 0; i < count; i++)
    assert.deepEqual(
      Buffer.from(out.subarray(cd + 94 + i * 32, cd + 126 + i * 32)),
      createHash("sha256")
        .update(out.subarray(i * 4096, Math.min((i + 1) * 4096, sig)))
        .digest(),
    );
  assert.ok(out.subarray(sig + v.getUint32(sig + 4)).every((b) => b === 0));
  assert.ok(p.signatureSize - v.getUint32(sig + 4) >= 0x40000);
});

test("malformed inputs reject before output allocation or hashing", async () => {
  const valid = fixture("a", PAGE_SIZE, 1, PAGE_SIZE);
  const sharedImage = new Uint8Array(new SharedArrayBuffer(1));
  const repeatedImage = new Uint8Array(4 * 1024 * 1024);
  const bad = [
    null,
    [],
    Array(49).fill(valid),
    [valid, valid],
    ...["", "../x", "abcdefghijk", "é", "a\0b"].map((name) => [{ ...valid, name }]),
    ...[-1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER, MAX_IMAGE_BYTES + 1].flatMap((n) => [
      [{ ...valid, textEnd: n }],
      [{ ...valid, patchOff: n }],
    ]),
    [{ ...valid, image: new ArrayBuffer(1) }],
    [{ ...valid, image: sharedImage }],
    [{ ...valid, image: new Uint8Array() }],
    [{ ...valid, textEnd: PAGE_SIZE + 1 }],
    [{ ...valid, patchOff: 1 }],
    [{ ...valid, patchOff: 0 }],
    [{ ...valid, patchOff: PAGE_SIZE * 2 }],
    Array.from({ length: 33 }, (_, i) => ({
      name: `m${i}`,
      image: repeatedImage,
      textEnd: 0,
      patchOff: 0,
    })),
    [
      ...Array.from({ length: 32 }, (_, i) => ({
        name: `m${i}`,
        image: repeatedImage.subarray(1),
        textEnd: 0,
        patchOff: 0,
      })),
      { name: "tail", image: new Uint8Array(1), textEnd: 0, patchOff: 0 },
    ],
  ];
  const Native = globalThis.Uint8Array;
  let allocations = 0,
    hashes = 0;
  globalThis.Uint8Array = new Proxy(Native, {
    construct(target, args) {
      allocations++;
      return Reflect.construct(target, args);
    },
  });
  try {
    for (const modules of bad)
      await assert.rejects(
        buildGuestFramework(modules, {
          crypto: {
            subtle: {
              digest() {
                hashes++;
                throw Error("Unexpected hashing");
              },
            },
          },
        }),
      );
    assert.equal(allocations, 0);
    assert.equal(hashes, 0);
  } finally {
    globalThis.Uint8Array = Native;
  }
  for (const id of ["a&b.c", "", "a", "<evil/>", "a.".repeat(200)])
    assert.throws(() => guestInfoPlist(id));
});

test("subarray input views, missing WebCrypto and unchanged inputs", async () => {
  const full = fixture("a", PAGE_SIZE + 4, 1, PAGE_SIZE);
  const image = full.image.subarray(2, PAGE_SIZE + 2),
    original = image.slice();
  const modules = [{ ...full, image }];
  await buildGuestFramework(modules, options);
  assert.deepEqual(image, original);
  await assert.rejects(buildGuestFramework(modules, { crypto: null }), /WebCrypto/);
});

test("AbortSignal rejects before validation/allocation and during UUID/page hashing", async () => {
  const controller = new AbortController();
  controller.abort("custom reason");
  const Native = globalThis.Uint8Array;
  let allocations = 0;
  globalThis.Uint8Array = new Proxy(Native, {
    construct(target, args) {
      allocations++;
      return Reflect.construct(target, args);
    },
  });
  try {
    // Invalid metadata ensures cancellation is checked even before validation.
    await assert.rejects(buildGuestFramework(null, { ...options, signal: controller.signal }), {
      name: "AbortError",
    });
    assert.equal(allocations, 0);
  } finally {
    globalThis.Uint8Array = Native;
  }
  for (const abortOnCall of [1, 2, 4]) {
    const c = new AbortController();
    let calls = 0;
    const crypto = {
      subtle: {
        async digest(algorithm, bytes) {
          calls++;
          const result = await webcrypto.subtle.digest(algorithm, bytes);
          if (calls === abortOnCall) c.abort();
          return result;
        },
      },
    };
    await assert.rejects(
      buildGuestFramework([fixture("a", PAGE_SIZE, 1, PAGE_SIZE)], { crypto, signal: c.signal }),
      { name: "AbortError" },
    );
    assert.equal(calls, abortOnCall, "No further digests after cancellation");
  }
});
