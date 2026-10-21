import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCascLogicalAssets, CASC_LIMITS } from "../casc-logical-reader.mjs";

// Actual dmx.py is the lookup/decode oracle. Fixtures are synthetic and contain no
// game bytes. A sparse archive exercises the native 40-bit locator above 4 GiB.
const fixture = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      String.raw`
import hashlib, importlib.util, json, pathlib, struct, sys, tempfile, zlib
spec=importlib.util.spec_from_file_location('dmx',pathlib.Path(sys.argv[1])/'dm/tools/dmx.py')
dmx=importlib.util.module_from_spec(spec); spec.loader.exec_module(dmx)
content=bytes(range(256))*300+b'logical asset fixture'
base=(1<<35)+7
rows=[]; records=[]; pos=base
for i, encoding in enumerate(['n','z','b:synthetic']):
    if encoding=='n': raw=content
    elif encoding=='z': raw=zlib.compress(content)
    else:
        block=b'Z'+zlib.compress(content)
        raw=b'BLTE'+struct.pack('>I',36)+b'\x0f\x00\x00\x01'+struct.pack('>II',len(block),len(content))+hashlib.md5(block).digest()+block
    ekey=b'\0'*9+bytes([2,3])+pos.to_bytes(5,'big')
    rows.append('|'.join(['0','0','2','3',hashlib.md5(content).hexdigest(),str(len(content)),ekey.hex(),str(len(raw)),encoding,'data:data/Test/File'+str(i),'0']))
    records.append({'offset':str(pos),'hex':raw.hex()}); pos+=len(raw)+31
# Last duplicate wins, including case-only duplicate; native first match is not used.
rows.insert(0,rows[0].replace(hashlib.md5(content).hexdigest(),'f'*32))
manifest='FileId|KeyLayout|Chunk|Archive|CKey|CSize|EKey|ESize|Encoding|Path|Flags\n# comment\nshort|row\n'+'\n'.join(rows)+'\n'
with tempfile.TemporaryDirectory() as root:
    dmx.ROOT=root
    pathlib.Path(root,'build_manifest.psv').write_text(manifest)
    with open(pathlib.Path(root,'02-00000003.data'),'wb') as f:
        for r in records: f.seek(int(r['offset'])); f.write(bytes.fromhex(r['hex']))
    queries=['TEST\\FILE0','data/test/file1','DATA:DATA/TEST/FILE2']
    answers=[dmx.get(q).hex() for q in queries]
print(json.dumps({'manifest':manifest,'records':records,'queries':queries,'answers':answers}))
`,
      fileURLToPath(new URL("../../", import.meta.url)),
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  ).toString(),
);

function romfs({ manifest = fixture.manifest, mutate, onRead } = {}) {
  const text = new TextEncoder().encode(manifest);
  const reads = [];
  const records = fixture.records.map((r) => ({
    offset: BigInt(r.offset),
    bytes: Uint8Array.from(Buffer.from(r.hex, "hex")),
  }));
  return {
    reads,
    getFile(path) {
      if (path === "data/build_manifest.psv")
        return {
          size: BigInt(text.length),
          readAt(offset, count) {
            reads.push([path, offset, count]);
            return text.slice(Number(offset), Number(offset) + count);
          },
        };
      if (path !== "data/02-00000003.data") return undefined;
      return {
        size: 1n << 60n,
        readAt(offset, count, { signal } = {}) {
          signal?.throwIfAborted();
          reads.push([path, offset, count]);
          assert.equal(typeof offset, "bigint");
          assert.ok(count <= 65536);
          const record = records.find(
            (r) =>
              offset >= r.offset && offset + BigInt(count) <= r.offset + BigInt(r.bytes.length),
          );
          assert.ok(record, "must read only requested record bytes");
          const bytes = record.bytes.slice(
            Number(offset - record.offset),
            Number(offset - record.offset) + count,
          );
          mutate?.(bytes);
          onRead?.();
          return bytes;
        },
      };
    },
  };
}

test("logical reads match original dmx lookup, duplicate resolution and all encodings", async () => {
  const source = romfs();
  const assets = await createCascLogicalAssets(source);
  assert.equal(assets.count, 3);
  assert.ok(
    source.reads.every(([path]) => path.endsWith("build_manifest.psv")),
    "archive remains lazy",
  );
  for (const [i, query] of fixture.queries.entries()) {
    const result = await assets.read(query, { maxBytes: 100000 });
    assert.equal(Buffer.from(result).toString("hex"), fixture.answers[i]);
    result.fill(0); // Consumer mutation must not affect future reads or other assets.
  }
  assert.equal(
    Buffer.from(await assets.read(fixture.queries[0])).toString("hex"),
    fixture.answers[0],
  );
  assert.equal([...assets.entries()].length, 3);
  assert.ok(Object.isFrozen(assets.lookup(fixture.queries[0])));
});

test("unnamed manifest records do not prevent indexed logical reads", async () => {
  const unnamed = ["0", "0", "0", "0", "0", "0", "0", "0", "n", "", "0"].join("|");
  const manifest = fixture.manifest.replace("# comment\n", `# comment\n${unnamed}\n`);
  const assets = await createCascLogicalAssets(romfs({ manifest }));
  assert.equal(assets.count, 3);
  assert.equal(
    Buffer.from(await assets.read(fixture.queries[0])).toString("hex"),
    fixture.answers[0],
  );
});

test("budgets and unsupported layout reject before reading archive bytes", async () => {
  const source = romfs();
  const assets = await createCascLogicalAssets(source);
  await assert.rejects(assets.read("test/file0", { maxBytes: 1 }), /byte budget/);
  await assert.rejects(assets.read("test/file0", { maxBytes: -1 }), /maxBytes/);
  assert.ok(source.reads.every(([p]) => p.endsWith("build_manifest.psv")));
  const other = await createCascLogicalAssets(
    romfs({ manifest: fixture.manifest.replaceAll("0|0|2|3|", "0|1|2|3|") }),
  );
  await assert.rejects(other.read("test/file0"), /key layout/);
  const mismatch = await createCascLogicalAssets(
    romfs({ manifest: fixture.manifest.replaceAll("0|0|2|3|", "0|0|1|3|") }),
  );
  await assert.rejects(mismatch.read("test/file0"), /chunk\/archive mismatch/);
});

test("integrity errors never publish bytes", async () => {
  const assets = await createCascLogicalAssets(
    romfs({
      mutate: (bytes) => {
        if (bytes.length) bytes[0] ^= 1;
      },
    }),
  );
  await assert.rejects(assets.read("test/file0"), /MD5 mismatch/);
  const short = romfs();
  const get = short.getFile;
  short.getFile = (path) =>
    path.endsWith(".data")
      ? {
          size: 10n,
          readAt() {
            assert.fail("out-of-bounds read");
          },
        }
      : get(path);
  await assert.rejects((await createCascLogicalAssets(short)).read("test/file0"), /extent/);
});

test("abort before and during lazy reads, including lifetime cancellation", async () => {
  const controller = new AbortController();
  const source = romfs({ onRead: () => controller.abort(new Error("cancelled read")) });
  const assets = await createCascLogicalAssets(source);
  await assert.rejects(assets.read("test/file0", { signal: controller.signal }), /cancelled read/);
  const lifetime = new AbortController();
  const indexed = await createCascLogicalAssets(romfs(), { signal: lifetime.signal });
  lifetime.abort(new Error("expired mount"));
  await assert.rejects(indexed.read("test/file0"), /expired mount/);
  await assert.rejects(
    createCascLogicalAssets(romfs(), { signal: lifetime.signal }),
    /expired mount/,
  );
});

test("unsafe paths, absent assets and oversized manifest fail closed", async () => {
  const assets = await createCascLogicalAssets(romfs());
  for (const path of [
    "../test/file0",
    "/test/file0",
    "data:data/../test/file0",
    "data:data:test/file0",
    "test//file0",
    "test\0/file0",
  ])
    await assert.rejects(assets.read(path), /path/);
  await assert.rejects(assets.read("missing"), /not found/);
  await assert.rejects(
    createCascLogicalAssets({
      getFile: () => ({
        size: BigInt(CASC_LIMITS.manifestBytes) + 1n,
        readAt() {
          assert.fail("oversized manifest read");
        },
      }),
    }),
    /manifest byte budget/,
  );
  await assert.rejects(
    createCascLogicalAssets(
      romfs({ manifest: fixture.manifest.replace("data:data/Test/File0", "data:data/../File0") }),
    ),
    /unsafe logical path/,
  );
  await assert.rejects(
    createCascLogicalAssets(romfs({ manifest: "x".repeat(CASC_LIMITS.lineBytes + 1) })),
    /line budget/,
  );
});
