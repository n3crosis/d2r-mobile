import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { writeZip } from "../zip-writer.mjs";
import { writeZip64 } from "../zip64-writer.mjs";
import { planStagedZip, validateStagedZip } from "../staged-zip-validator.mjs";
const manifest = [
  { path: "Payload/Test.app/zéro", size: 5, mode: 0o100755 },
  { path: "Payload/Test.app/a", size: 0, mode: 0o100644 },
];
const payload = Uint8Array.of(0, 1, 127, 128, 255);
const options = (archiveFormat) => ({ archiveFormat, maxOutputBytes: 1024 * 1024 });
async function fixture(format, files = manifest) {
  const chunks = [];
  await (format === "zip64" ? writeZip64 : writeZip)(
    files.map((entry) => ({
      ...entry,
      mode: entry.mode & 0o777,
      async *chunks() {
        if (entry.size) yield payload;
      },
    })),
    {
      async write(bytes) {
        chunks.push(bytes.slice());
      },
      async close() {},
      async abort() {},
    },
    { maxTotalBytes: 1024 * 1024 },
  );
  return new Uint8Array(Buffer.concat(chunks));
}
const source = (bytes) => ({
  size: bytes.length,
  async read(offset, length) {
    return bytes.slice(offset, offset + length);
  },
});
for (const format of ["zip32", "zip64"]) {
  test(`${format}: exact plan, byte validation and independent Python ZIP oracle`, async () => {
    const bytes = await fixture(format);
    assert.equal(bytes.length, planStagedZip(manifest, options(format)).totalBytes);
    assert.equal((await validateStagedZip(source(bytes), manifest, options(format))).valid, true);
    const dir = await mkdtemp(join(tmpdir(), "staged-zip-oracle-"));
    try {
      const file = join(dir, "fixture.zip");
      await writeFile(file, bytes);
      const result = JSON.parse(
        execFileSync(
          "python3",
          [
            "-c",
            `import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 print(json.dumps([{'name':i.filename,'size':i.file_size,'mode':i.external_attr >> 16,'bytes':list(z.read(i))} for i in z.infolist()]))`,
            file,
          ],
          { encoding: "utf8" },
        ),
      );
      assert.deepEqual(result, [
        { name: "Payload/Test.app/a", size: 0, mode: 0o100644, bytes: [] },
        { name: "Payload/Test.app/zéro", size: 5, mode: 0o100755, bytes: [...payload] },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test(`${format}: every single-byte corruption is rejected`, async () => {
    const bytes = await fixture(format);
    for (let i = 0; i < bytes.length; i++) {
      const changed = bytes.slice();
      changed[i] ^= 1;
      await assert.rejects(
        validateStagedZip(source(changed), manifest, options(format)),
        undefined,
        `byte ${i}`,
      );
    }
  });
  test(`${format}: truncation, trailing bytes, changed manifest, cancellation`, async () => {
    const bytes = await fixture(format);
    await assert.rejects(validateStagedZip(source(bytes.slice(1)), manifest, options(format)));
    await assert.rejects(
      validateStagedZip(source(Uint8Array.from([...bytes, 0])), manifest, options(format)),
    );
    await assert.rejects(
      validateStagedZip(
        source(bytes),
        manifest.map((entry) => ({ ...entry, mode: 0o644 })),
        options(format),
      ),
    );
    await assert.rejects(
      validateStagedZip(source(bytes), manifest, {
        ...options(format),
        signal: AbortSignal.abort(),
      }),
    );
    assert.equal(
      (await validateStagedZip(source(await fixture(format, [])), [], options(format))).entries,
      0,
    );
  });
}
test("ZIP64 >4GiB exact metadata without allocating large payloads", () => {
  const big = [{ path: "Payload/Test.app/large", mode: 0o644, size: 2 ** 32 + 1 }];
  const opts = { archiveFormat: "zip64", maxOutputBytes: 2 ** 33 };
  const plan = planStagedZip(big, opts);
  assert.ok(plan.centralOffset > 2 ** 32 && plan.totalBytes > 2 ** 32);
  assert.throws(() => planStagedZip(big, { ...opts, maxOutputBytes: plan.totalBytes - 1 }));
  assert.throws(() => planStagedZip(big, { ...opts, archiveFormat: "zip32" }));
  assert.throws(() =>
    planStagedZip([{ ...big[0], size: Number.MAX_SAFE_INTEGER }], {
      ...opts,
      maxOutputBytes: Number.MAX_SAFE_INTEGER,
    }),
  );
  for (const path of ["../bad", "x\ud800"])
    assert.throws(() => planStagedZip([{ ...big[0], path }], opts));
});
