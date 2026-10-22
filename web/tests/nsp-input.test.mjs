import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverNspFolder,
  discoverNspFiles,
  inspectNsp,
  inspectKeyFile,
  normalizeProdKeyBytes,
  preflightNspFolder,
  NSP_INPUT_LIMITS,
} from "../nsp-input.mjs";

const fakeHex = (bytes) => "a5".repeat(bytes);
for (const lateFailure of [false, true])
  test(`folder cancellation does not wait for pending enumeration (${lateFailure ? "reject" : "resolve"})`, async () => {
    const controller = new AbortController();
    let entered, finish;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const pending = new Promise((resolve, reject) => {
      finish = () => (lateFailure ? reject(new Error("late enumeration error")) : resolve());
    });
    let reads = 0;
    let progress = 0;
    let returns = 0;
    let finalized = 0;
    const directory = {
      kind: "directory",
      entries() {
        const iterator = (async function* () {
          try {
            entered();
            await pending;
            yield [
              "game.nsp",
              {
                kind: "file",
                getFile() {
                  reads++;
                  return fixture().file;
                },
              },
            ];
          } finally {
            finalized++;
          }
        })();
        const close = iterator.return.bind(iterator);
        iterator.return = (...args) => {
          returns++;
          return close(...args);
        };
        return iterator;
      },
    };
    const result = discoverNspFolder(directory, {
      signal: controller.signal,
      onProgress() {
        progress++;
      },
    }).then(
      () => "opened",
      (error) => error,
    );
    await started;
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    const waiting = Symbol("waiting");
    const outcome = await Promise.race([result, Promise.resolve(waiting)]);
    const returnsAtCancel = returns;
    const finalizersAtCancel = finalized;
    finish();
    await result;
    await new Promise((resolve) => setImmediate(resolve));
    assert.notEqual(outcome, waiting);
    assert.equal(outcome.name, "AbortError");
    assert.equal(returnsAtCancel, 1);
    assert.equal(finalizersAtCancel, 0, "return queues behind the unfinished next call");
    assert.equal(returns, 1);
    assert.equal(finalized, 1);
    assert.equal(reads, 0);
    assert.equal(progress, 1, "late entries must not update progress");
  });

test("folder cancellation observes late enumeration and iterator cleanup rejections", async () => {
  const controller = new AbortController();
  let entered, rejectNext, rejectReturn;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const next = new Promise((_, reject) => {
    rejectNext = reject;
  });
  const cleanup = new Promise((_, reject) => {
    rejectReturn = reject;
  });
  let returns = 0;
  const directory = {
    kind: "directory",
    entries() {
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          entered();
          return next;
        },
        return() {
          returns++;
          return cleanup;
        },
      };
    },
  };
  const result = discoverNspFolder(directory, { signal: controller.signal }).catch(
    (error) => error,
  );
  await started;
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  const waiting = Symbol("waiting");
  const outcome = await Promise.race([result, Promise.resolve(waiting)]);
  const returnsAtCancel = returns;
  rejectNext(new Error("late enumeration error"));
  rejectReturn(new Error("late cleanup error"));
  await result;
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(outcome, waiting);
  assert.equal(outcome.name, "AbortError");
  assert.equal(returnsAtCancel, 1);
  assert.equal(returns, 1);
});

for (const cancelCleanup of [false, true])
  test(`folder validation preserves its error while closing enumeration (${cancelCleanup ? "cancel" : "reject"})`, async () => {
    const controller = new AbortController();
    let entered, rejectReturn;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const cleanup = new Promise((_, reject) => {
      rejectReturn = reject;
    });
    let returns = 0;
    const directory = {
      kind: "directory",
      entries() {
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          next() {
            return Promise.resolve({ done: false, value: ["../unsafe", { kind: "file" }] });
          },
          return() {
            returns++;
            entered();
            return cleanup;
          },
        };
      },
    };
    const result = discoverNspFolder(directory, {
      signal: cancelCleanup ? controller.signal : undefined,
    }).catch((error) => error);
    await started;
    const waiting = Symbol("waiting");
    assert.equal(await Promise.race([result, Promise.resolve(waiting)]), waiting);
    if (cancelCleanup) controller.abort();
    else rejectReturn(new Error("iterator cleanup failed"));
    await new Promise((resolve) => setImmediate(resolve));
    const outcome = await Promise.race([result, Promise.resolve(waiting)]);
    if (cancelCleanup) rejectReturn(new Error("late iterator cleanup failed"));
    await result;
    await new Promise((resolve) => setImmediate(resolve));
    assert.notEqual(outcome, waiting);
    assert.equal(outcome.code, "UNSAFE_NAME");
    assert.equal(returns, 1);
  });

test("cancellation from initial folder progress does not start enumeration", async () => {
  const controller = new AbortController();
  let enumerations = 0;
  await assert.rejects(
    discoverNspFolder(
      {
        kind: "directory",
        entries() {
          enumerations++;
          return folder([]).entries();
        },
      },
      {
        signal: controller.signal,
        onProgress() {
          controller.abort();
        },
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(enumerations, 0);
});

for (const lateFailure of [false, true])
  test(`folder cancellation does not wait for pending metadata (${lateFailure ? "reject" : "resolve"})`, async () => {
    const controller = new AbortController();
    let entered, finish;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const pending = new Promise((resolve, reject) => {
      finish = () => (lateFailure ? reject(new Error("late metadata error")) : resolve(keys()[0]));
    });
    let laterReads = 0;
    const result = discoverNspFolder(
      folder([
        [
          "prod.keys",
          {
            kind: "file",
            getFile() {
              entered();
              return pending;
            },
          },
        ],
        [
          "game.nsp",
          {
            kind: "file",
            getFile() {
              laterReads++;
              return fixture().file;
            },
          },
        ],
      ]),
      { signal: controller.signal },
    ).then(
      () => "opened",
      (error) => error,
    );
    await started;
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    const waiting = Symbol("waiting");
    const outcome = await Promise.race([result, Promise.resolve(waiting)]);
    finish();
    await result;
    await new Promise((resolve) => setImmediate(resolve));
    assert.notEqual(outcome, waiting);
    assert.equal(outcome.name, "AbortError");
    assert.equal(laterReads, 0);
  });
test("folder progress observers cannot fail discovery, but signal cancellation still applies", async () => {
  for (const asyncFailure of [false, true]) {
    let calls = 0;
    const result = await discoverNspFolder(
      folder([
        ["prod.keys", handle(keys()[0])],
        ["game.nsp", handle(fixture().file)],
      ]),
      {
        onProgress() {
          calls++;
          if (asyncFailure) return Promise.reject(new Error("observer failed"));
          throw new Error("observer failed");
        },
      },
    );
    assert.equal(result.nsps.length, 1);
    assert.ok(calls > 0);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const controller = new AbortController();
  await assert.rejects(
    discoverNspFolder(folder([["game.nsp", handle(fixture().file)]]), {
      signal: controller.signal,
      onProgress() {
        controller.abort();
      },
    }),
    { name: "AbortError" },
  );
});
function localFile(name, content, path = `chosen/${name}`) {
  const blob = new Blob([content]);
  return {
    name,
    size: blob.size,
    webkitRelativePath: path,
    slice: (...args) => blob.slice(...args),
  };
}
function fixture(entries = [{ name: "content.nca", offset: 0n, size: 4n }], extraSize = null) {
  const strings = new TextEncoder().encode(entries.map((e) => e.name + "\0").join(""));
  const dataOffset = 16 + entries.length * 24 + strings.length;
  const bytes = new Uint8Array(dataOffset);
  bytes.set(new TextEncoder().encode("PFS0"));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, entries.length, true);
  view.setUint32(8, strings.length, true);
  let nameOffset = 0;
  for (let i = 0; i < entries.length; i++) {
    const pos = 16 + i * 24;
    view.setBigUint64(pos, entries[i].offset, true);
    view.setBigUint64(pos + 8, entries[i].size, true);
    view.setUint32(pos + 16, nameOffset, true);
    nameOffset += new TextEncoder().encode(entries[i].name).length + 1;
  }
  bytes.set(strings, 16 + entries.length * 24);
  let size = BigInt(dataOffset);
  for (const entry of entries)
    if (BigInt(dataOffset) + entry.offset + entry.size > size)
      size = BigInt(dataOffset) + entry.offset + entry.size;
  const reads = [];
  const file = {
    name: "game.nsp",
    webkitRelativePath: "chosen/game.nsp",
    size: Number(extraSize ?? size),
    slice(start, end) {
      reads.push([start, end]);
      assert.ok(end <= bytes.length, "metadata reader must never read the payload");
      return new Blob([bytes.slice(start, end)]);
    },
  };
  return { file, bytes, view, dataOffset, reads };
}
function folder(entries) {
  return {
    kind: "directory",
    async *entries() {
      yield* entries;
    },
  };
}
function handle(file) {
  return { kind: "file", getFile: async () => file };
}
function keys() {
  return [
    localFile("prod.keys", `header_key = ${fakeHex(32)}\nmaster_key_00 = ${fakeHex(16)}`),
    localFile("title.keys", `${"12".repeat(16)} = ${fakeHex(16)}`),
  ];
}
function code(expected) {
  return (error) => error.code === expected;
}

test("root folder discovery is case insensitive and never recurses or reads unrelated files", async () => {
  const [prod, title] = keys();
  const nsp = fixture().file;
  const selection = await discoverNspFolder(
    folder([
      ["PROD.KEYS", handle(prod)],
      ["title.keys", handle(title)],
      ["game.NSP", handle(nsp)],
      [
        "nested",
        {
          kind: "directory",
          entries() {
            throw new Error("no recursion");
          },
        },
      ],
      [
        "unrelated.txt",
        {
          kind: "file",
          getFile() {
            throw new Error("no unrelated reads");
          },
        },
      ],
    ]),
  );
  assert.equal(selection.prodKeys, prod);
  assert.deepEqual(selection.nsps, [nsp]);
});

test("discovery rejects missing files, unsafe names, duplicates, and oversized keys", async () => {
  const [prod, title] = keys();
  await assert.rejects(discoverNspFolder(folder([])), code("MISSING_INPUT"));
  for (const name of ["../evil", "bad\\name", "CON", "name.", "x\u0000"]) {
    await assert.rejects(discoverNspFolder(folder([[name, handle(prod)]])), code("UNSAFE_NAME"));
  }
  await assert.rejects(
    discoverNspFolder(
      folder([
        ["prod.keys", handle(prod)],
        ["PROD.KEYS", handle(prod)],
      ]),
    ),
    code("DUPLICATE_NAME"),
  );
  await assert.rejects(
    discoverNspFolder(
      folder([
        ["prod.keys", handle({ ...prod, size: NSP_INPUT_LIMITS.keyBytes + 1 })],
        ["title.keys", handle(title)],
        ["a.nsp", handle(fixture().file)],
      ]),
    ),
    code("KEY_SIZE"),
  );
});

test("directory enumeration has a bounded stopping point", async () => {
  let yielded = 0;
  const directory = {
    kind: "directory",
    async *entries() {
      for (let i = 0; i < 100000; i++) {
        yielded++;
        yield [`folder${i}`, { kind: "directory" }];
      }
    },
  };
  await assert.rejects(discoverNspFolder(directory), code("DIRECTORY_LIMIT"));
  assert.equal(yielded, NSP_INPUT_LIMITS.directoryEntries + 1);
});

test("FileList fallback requires one common root, ignores nested matches, validates paths", () => {
  const files = [...keys(), fixture().file];
  assert.equal(discoverNspFiles(files).nsps.length, 1);
  assert.throws(
    () =>
      discoverNspFiles(
        files.map((file) => ({ ...file, webkitRelativePath: `chosen/sub/${file.name}` })),
      ),
    code("MISSING_INPUT"),
  );
  assert.throws(
    () => discoverNspFiles([...files, localFile("other.txt", "", "elsewhere/other.txt")]),
    code("DIRECTORY"),
  );
  assert.throws(() => discoverNspFiles([localFile("x", "", "")]), code("DIRECTORY"));
  assert.throws(() => discoverNspFiles([localFile("x", "", "chosen/../x")]), code("DIRECTORY"));
});

test("PFS0 index parsing keeps sparse offsets and sizes above 4GiB exact without payload reads", async () => {
  const sparse = fixture([{ name: "huge.nca", offset: 0x100000001n, size: 0x100000002n }]);
  const result = await inspectNsp(sparse.file);
  assert.equal(result.entries[0].offset, BigInt(sparse.dataOffset) + 0x100000001n);
  assert.equal(result.entries[0].size, 0x100000002n);
  assert.deepEqual(sparse.reads, [
    [0, 16],
    [16, sparse.dataOffset],
  ]);
});

test("PFS0 validates header and allocation bounds before requesting index", async () => {
  for (const field of [4, 8]) {
    const f = fixture();
    f.view.setUint32(field, 0xffffffff, true);
    await assert.rejects(inspectNsp(f.file), code("PFS0_LIMIT"));
    assert.deepEqual(f.reads, [[0, 16]]);
  }
  const f = fixture();
  f.file.size = f.dataOffset - 1;
  await assert.rejects(inspectNsp(f.file), code("PFS0_TRUNCATED"));
  f.file.size = 15;
  await assert.rejects(inspectNsp(f.file), code("PFS0_HEADER"));
  f.file.size = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(inspectNsp(f.file), code("FILE_SIZE"));
});

test("PFS0 rejects bad magic, reserved fields and short reads", async () => {
  for (const [offset, expected] of [
    [0, "PFS0_MAGIC"],
    [12, "PFS0_RESERVED"],
    [36, "PFS0_RESERVED"],
  ]) {
    const f = fixture();
    f.view.setUint32(offset, 1, true);
    await assert.rejects(inspectNsp(f.file), code(expected));
  }
  await assert.rejects(
    inspectNsp({ size: 100, slice: () => new Blob([new Uint8Array(2)]) }),
    code("SHORT_READ"),
  );
});

test("PFS0 rejects invalid names, string boundaries, UTF8 and case duplicates", async () => {
  for (const name of ["", "../a", "x/y", "x\\y", "name.", "a".repeat(256)]) {
    await assert.rejects(inspectNsp(fixture([{ name, offset: 0n, size: 1n }]).file));
  }
  const f = fixture();
  f.view.setUint32(32, 1, true);
  await assert.rejects(inspectNsp(f.file), code("PFS0_NAME"));
  f.view.setUint32(32, 0xffffffff, true);
  await assert.rejects(inspectNsp(f.file), code("PFS0_NAME"));
  f.view.setUint32(32, 0, true);
  f.bytes[f.bytes.length - 1] = 65;
  await assert.rejects(inspectNsp(f.file), code("PFS0_NAME"));
  f.bytes[f.bytes.length - 1] = 0;
  f.bytes[40] = 255;
  await assert.rejects(inspectNsp(f.file), code("PFS0_NAME"));
  await assert.rejects(
    inspectNsp(
      fixture([
        { name: "a.nca", offset: 0n, size: 1n },
        { name: "A.NCA", offset: 1n, size: 1n },
      ]).file,
    ),
    code("DUPLICATE_NAME"),
  );
});

test("PFS0 checks overlap, adjacency, empty entries, and uint64 ranges without wrapping", async () => {
  await assert.rejects(
    inspectNsp(
      fixture([
        { name: "a", offset: 0n, size: 3n },
        { name: "b", offset: 2n, size: 4n },
      ]).file,
    ),
    code("PFS0_OVERLAP"),
  );
  const valid = fixture([
    { name: "b", offset: 3n, size: 4n },
    { name: "a", offset: 0n, size: 3n },
    { name: "empty", offset: 1n, size: 0n },
  ]);
  assert.equal((await inspectNsp(valid.file)).entries.length, 3);
  const range = fixture();
  range.view.setBigUint64(16, 0xffffffffffffffffn, true);
  await assert.rejects(inspectNsp(range.file), code("PFS0_RANGE"));
  range.view.setBigUint64(16, 0n, true);
  range.view.setBigUint64(24, 0xffffffffffffffffn, true);
  await assert.rejects(inspectNsp(range.file), code("PFS0_RANGE"));
});

test("key parser supports verified ASCII subset, separators, case, CRLF and metadata only", async () => {
  const result = await inspectKeyFile(
    localFile(
      "prod.keys",
      `# comment\r\n\tHEADER_KEY , ${fakeHex(32).toUpperCase()} \t\r\nmaster_key_00=${fakeHex(16)}\nfuture_key = abcd\n`,
    ),
    "prod",
  );
  assert.deepEqual(result, {
    kind: "prod",
    entries: 3,
    verifiedEntries: 2,
    unknownEntries: 1,
    usableForDecryption: false,
  });
  assert.ok(!JSON.stringify(result).includes("a5"));
  assert.equal((await inspectKeyFile(keys()[1], "title")).verifiedEntries, 1);
  assert.equal((await inspectKeyFile(localFile("title.keys", ""), "title")).entries, 0);
});

test("native master KEK source widths are checked before loading keys", async () => {
  for (const name of ["master_kek_source_06", "mariko_master_kek_source_05"]) {
    const valid = await inspectKeyFile(
      localFile("prod.keys", `${name} = ${fakeHex(16)}\n`),
      "prod",
    );
    assert.equal(valid.verifiedEntries, 1);
    const padded = `${name} = ${fakeHex(16)}00\r\n`;
    assert.equal((await inspectKeyFile(localFile("prod.keys", padded), "prod")).verifiedEntries, 1);
    const owned = new TextEncoder().encode(padded);
    const normalized = normalizeProdKeyBytes(owned);
    assert.equal(new TextDecoder().decode(normalized), `${name} = ${fakeHex(16)}\r\n`);
    assert.deepEqual([...owned.subarray(normalized.length)], [0, 0]);
    await assert.rejects(
      inspectKeyFile(localFile("prod.keys", `${name} = ${fakeHex(17)}\n`), "prod"),
      code("KEY_LINE"),
    );
  }
});

test("key parser rejects malformed, odd, wrong-width, duplicate, nonASCII and oversized lines without disclosure", async () => {
  const lines = [
    `header_key = ${fakeHex(16)}`,
    "future = abc",
    "future = gg",
    "future = ",
    `header_key=${fakeHex(32)}\nHEADER_KEY=${fakeHex(32)}`,
    "future = a5 # comment",
    "other = a5\u0000",
    "é = a5",
    "future = " + "ab".repeat(NSP_INPUT_LIMITS.keyLineBytes),
  ];
  for (const text of lines) {
    await assert.rejects(inspectKeyFile(localFile("prod.keys", text), "prod"), (error) => {
      assert.match(error.message, /^Invalid key-file line [12]\.$/u);
      assert.equal(error.code, "KEY_LINE");
      return true;
    });
  }
  await assert.rejects(inspectKeyFile(localFile("prod.keys", "\n"), "prod"), code("KEY_EMPTY"));
  await assert.rejects(
    inspectKeyFile(localFile("title.keys", `wrong=${fakeHex(16)}`), "title"),
    code("KEY_LINE"),
  );
  const id = "12".repeat(16);
  await assert.rejects(
    inspectKeyFile(localFile("title.keys", `${id}=${fakeHex(16)}\n${id}=${fakeHex(16)}`), "title"),
    code("KEY_LINE"),
  );
});

test("key read buffers are cleared best-effort on both success and error", async () => {
  for (const text of [`header_key=${fakeHex(32)}`, "header_key=WRONG"]) {
    const owned = new TextEncoder().encode(text);
    const file = { size: owned.length, slice: () => ({ arrayBuffer: async () => owned.buffer }) };
    try {
      await inspectKeyFile(file, "prod");
    } catch {
      /* Expected invalid fixture. */
    }
    assert.ok(owned.every((byte) => byte === 0));
  }
});

test("full folder preflight returns no key contents, handles, or build readiness claim", async () => {
  const result = await preflightNspFolder([...keys(), fixture().file]);
  assert.equal(result.stage, "metadata-only");
  assert.equal(result.canBuildIpa, false);
  assert.equal(result.packages.length, 1);
  assert.equal(result.prodKeys.verifiedEntries, 2);
  assert.ok(
    !JSON.stringify(result, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ).includes(fakeHex(16)),
  );
});

test("folder discovery cancellation stops before enumeration or after pending metadata read", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverNspFolder(folder([]), { signal: controller.signal }), {
    name: "AbortError",
  });
  const duringRead = new AbortController();
  const root = folder([
    [
      "prod.keys",
      {
        kind: "file",
        async getFile() {
          duringRead.abort();
          return keys()[0];
        },
      },
    ],
  ]);
  await assert.rejects(discoverNspFolder(root, { signal: duringRead.signal }), {
    name: "AbortError",
  });
});

test("FileList fallback detects ambiguous inferred root directory names without rejecting repeated descendants", () => {
  const files = [...keys(), fixture().file];
  assert.equal(
    discoverNspFiles([
      ...files,
      localFile("one", "", "chosen/sub/one"),
      localFile("two", "", "chosen/sub/two"),
    ]).nsps.length,
    1,
  );
  assert.throws(
    () =>
      discoverNspFiles([
        ...files,
        localFile("one", "", "chosen/sub/one"),
        localFile("two", "", "chosen/SUB/two"),
      ]),
    code("DUPLICATE_NAME"),
  );
  assert.throws(
    () =>
      discoverNspFiles([...files, localFile("SUB", ""), localFile("one", "", "chosen/sub/one")]),
    code("DUPLICATE_NAME"),
  );
});

test("NSP filename decoder does not discard a leading BOM or allow format controls", async () => {
  for (const name of ["\ufeffcontent.nca", "evil\u202ename.nca"]) {
    await assert.rejects(
      inspectNsp(fixture([{ name, offset: 0n, size: 1n }]).file),
      code("UNSAFE_NAME"),
    );
  }
});

test("package count and key-size caps apply without reading contents", async () => {
  const many = keys().map((file) => [file.name, handle(file)]);
  for (let i = 0; i <= NSP_INPUT_LIMITS.packages; i++)
    many.push([`${i}.nsp`, handle(fixture().file)]);
  await assert.rejects(discoverNspFolder(folder(many)), code("PACKAGE_LIMIT"));
  await assert.rejects(
    inspectKeyFile(
      {
        size: NSP_INPUT_LIMITS.keyBytes + 1,
        slice() {
          throw new Error("must not read");
        },
      },
      "prod",
    ),
    code("KEY_SIZE"),
  );
});

test("folder discovery and preflight accept absent optional title keys", async () => {
  const [prod] = keys();
  const nsp = fixture().file;
  const inputs = await discoverNspFolder(
    folder([
      ["prod.keys", handle(prod)],
      ["game.nsp", handle(nsp)],
    ]),
  );
  assert.equal(inputs.titleKeys, undefined);
  const result = await preflightNspFolder([prod, nsp]);
  assert.equal(result.titleKeys.entries, 0);
});

test("RSA-sized production dump entries do not reject otherwise valid AES keys", async () => {
  const result = await inspectKeyFile(
    localFile(
      "prod.keys",
      `eticket_rsa_keypair = ${fakeHex(528)}\r\nheader_key = ${fakeHex(32)}\nmaster_key_00 = ${fakeHex(16)}\n`,
    ),
    "prod",
  );
  assert.equal(result.entries, 3);
  assert.equal(result.verifiedEntries, 2);
  assert.equal(result.unknownEntries, 1);
  assert.equal(result.usableForDecryption, false);
});

test("key-line bound includes exact-length content but excludes CRLF and keeps AES widths strict", async () => {
  const line = "extra = " + "ab".repeat((NSP_INPUT_LIMITS.keyLineBytes - 8) / 2);
  assert.equal(line.length, NSP_INPUT_LIMITS.keyLineBytes);
  for (const ending of ["", "\n", "\r\n"])
    assert.equal((await inspectKeyFile(localFile("prod.keys", line + ending), "prod")).entries, 1);
  await assert.rejects(
    inspectKeyFile(localFile("prod.keys", line + "ab\n"), "prod"),
    code("KEY_LINE"),
  );
  await assert.rejects(
    inspectKeyFile(localFile("prod.keys", `header_key = ${fakeHex(528)}\n`), "prod"),
    code("KEY_LINE"),
  );
});
