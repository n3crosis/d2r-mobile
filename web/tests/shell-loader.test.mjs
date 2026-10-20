import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createShellLoader, SHELL_OUTPUT_CHUNK_BYTES } from "../shell-loader.mjs";
import { validateShellContract } from "../shell-contract.mjs";
import { writeZip } from "../zip-writer.mjs";
const fixture = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      String.raw`
import hashlib, io, json, zipfile
base = 'Payload/Demo.app/'
required = ['dm/derived.tsv', 'Frameworks/Guest.framework/', 'msl/b-test/']
contents = {
 'Payload/': b'', base: b'',
 base + 'Info.plist': b'synthetic-plist:ios:16.0',
 base + 'Demo': b'synthetic-executable:ios:16.0',
 base + 'dm/shell_info.txt': b'PRODUCT=synthetic\nCHAIN=test\nKIND=ios\nSHADER_SRC=0123456789abcdef\n',
 base + 'dm/shell_manifest.txt': '\n'.join(required).encode(),
 base + 'public.bin': bytes(range(256)) * 512,
}
def mode(path): return 0o40755 if path.endswith('/') else (0o100755 if path.endswith('/Demo') else 0o100644)
def make(changed=False):
 b = io.BytesIO()
 with zipfile.ZipFile(b, 'w') as z:
  for path, value in contents.items():
   info = zipfile.ZipInfo(path)
   info.external_attr = mode(path) << 16
   if changed and path.endswith('Info.plist'): value = b'synthetic-plist:ios:17.0'
   z.writestr(info, value)
 return b.getvalue().hex()
files = [{'path': p, 'size': len(v), 'mode': mode(p), 'sha256': hashlib.sha256(v).hexdigest()} for p,v in contents.items()]
print(json.dumps({'zip': make(), 'changed': make(True), 'files': files, 'requiredPaths': required}))
`,
    ],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  ),
);
const base = "Payload/Demo.app/";
function configuration(kind = "zip") {
  const bytes = Uint8Array.from(Buffer.from(fixture[kind], "hex"));
  const source = {
    size: bytes.length,
    async read(offset, length) {
      return bytes.slice(offset, offset + length);
    },
  };
  const release = {
    verified: true,
    releaseId: "synthetic-only",
    files: structuredClone(fixture.files),
    trustedRecipe: {
      schemaVersion: 1,
      product: "synthetic",
      chain: "test",
      kind: "ios",
      shaderDigest: "0123456789abcdef",
      targetOS: { platform: "ios", minimumVersion: "16.0" },
      requiredPaths: [...fixture.requiredPaths],
      extraFiles: [],
    },
  };
  return {
    source,
    releaseId: release.releaseId,
    release,
    resolveTrustedRelease: async () => release,
    async inspectTargetOS(context) {
      assert.equal(context.trustedRecipe, undefined);
      const plist = new TextDecoder().decode(await context.readEntry(base + "Info.plist"));
      const executable = new TextDecoder().decode(await context.readEntry(base + "Demo"));
      // Synthetic parser only, not a production Mach-O/plist implementation.
      assert.equal(plist, "synthetic-plist:ios:16.0");
      assert.equal(executable, "synthetic-executable:ios:16.0");
      return { platform: "ios", minimumVersion: "16.0" };
    },
  };
}
async function collect(entry) {
  const chunks = [];
  for await (const chunk of entry.chunks()) chunks.push(chunk.slice());
  return Buffer.concat(chunks);
}
test("real ZIP bridges to contract and existing writer with verified bounded bytes", async () => {
  const loaded = await createShellLoader(configuration())();
  assert.equal(validateShellContract(loaded.contract).status, "shell-inventory-valid");
  assert.equal(loaded.entries.length, fixture.files.length - 2);
  assert.ok(loaded.entries.every((e) => !e.path.endsWith("/")));
  assert.equal(loaded.contentVerified, false);
  assert.equal(loaded.bytesVerifiedOnRead, true);
  assert.equal(loaded.installable, false);
  const large = loaded.entries.find((e) => e.path.endsWith("public.bin"));
  let total = 0,
    count = 0;
  for await (const bytes of large.chunks()) {
    assert.ok(bytes.length <= SHELL_OUTPUT_CHUNK_BYTES);
    total += bytes.length;
    count++;
  }
  assert.equal(total, 131072);
  assert.equal(count, 2);
  let written = 0,
    closed = false;
  await writeZip(
    loaded.entries.map((e) => ({ ...e, mode: e.mode & 0o777 })),
    {
      async write(bytes) {
        written += bytes.length;
      },
      async close() {
        closed = true;
      },
      async abort() {
        assert.fail("unexpected abort");
      },
    },
  );
  assert.ok(written > total);
  assert.equal(closed, true);
});
test("missing capabilities or unverified releases fail before ZIP I/O", async () => {
  for (const field of ["resolveTrustedRelease", "inspectTargetOS"]) {
    const config = configuration();
    delete config[field];
    assert.throws(() => createShellLoader(config), /CAPABILITY_UNAVAILABLE/);
  }
  for (const mutate of [
    (r) => {
      r.verified = false;
    },
    (r) => {
      r.releaseId = "wrong";
    },
    (r) => {
      r.files[0].sha256 = "invalid";
    },
  ]) {
    const config = configuration();
    mutate(config.release);
    config.source.read = () => assert.fail("must not read before release validation");
    await assert.rejects(createShellLoader(config)(), /RELEASE/);
  }
});
test("exact trusted inventory rejects omitted or altered entry metadata", async () => {
  for (const mutate of [
    (r) => {
      r.files.pop();
    },
    (r) => {
      r.files[2].mode = 0o100755;
    },
    (r) => {
      r.files[2].size++;
    },
    (r) => {
      r.files[2].path = base + "other";
    },
  ]) {
    const config = configuration();
    mutate(config.release);
    await assert.rejects(createShellLoader(config)(), /INVENTORY_MISMATCH/);
  }
});
test("correct CRC cannot bypass trusted SHA-256 and no unverified bytes yield", async () => {
  await assert.rejects(createShellLoader(configuration("changed"))(), /TARGET_INSPECTION_FAILED/);
  const config = configuration();
  config.release.files.find((e) => e.path.endsWith("public.bin")).sha256 = "0".repeat(64);
  const loaded = await createShellLoader(config)();
  let yielded = false;
  await assert.rejects(async () => {
    for await (const chunk of loaded.entries.find((e) => e.path.endsWith("public.bin")).chunks())
      yielded = chunk.length > 0;
  }, /DIGEST_MISMATCH/);
  assert.equal(yielded, false);
});
test("recipe and independent observed target mismatches reject", async () => {
  const config = configuration();
  config.release.trustedRecipe.chain = "other";
  await assert.rejects(createShellLoader(config)(), /mismatch/);
  const wrongTarget = configuration();
  wrongTarget.inspectTargetOS = async () => ({ platform: "ios", minimumVersion: "17.0" });
  await assert.rejects(createShellLoader(wrongTarget)(), /targetOS version mismatch/);
});
test("metadata and recipe are detached frozen snapshots", async () => {
  const config = configuration(),
    loaded = await createShellLoader(config)();
  config.release.trustedRecipe.requiredPaths.push("unexpected");
  config.release.files[2].sha256 = "0".repeat(64);
  assert.equal(loaded.contract.trustedRecipe.requiredPaths.length, 3);
  assert.ok(Object.isFrozen(loaded.contract.trustedRecipe.targetOS));
  assert.ok(Object.isFrozen(loaded.entries[0]));
  assert.equal(
    (await collect(loaded.entries.find((e) => e.path.endsWith("Info.plist")))).toString(),
    "synthetic-plist:ios:16.0",
  );
});
test("cancellation and callback errors do not echo private failure details", async () => {
  const config = configuration();
  config.resolveTrustedRelease = () => {
    throw new Error("private callback data");
  };
  await assert.rejects(
    createShellLoader(config)(),
    (e) => e.message === "SHELL_RELEASE_UNAVAILABLE",
  );
  const controller = new AbortController();
  controller.abort("private abort reason");
  await assert.rejects(
    createShellLoader(configuration())({ signal: controller.signal }),
    /SHELL_CANCELLED/,
  );
  const live = new AbortController(),
    loaded = await createShellLoader(configuration())({ signal: live.signal });
  live.abort("private abort reason");
  await assert.rejects(collect(loaded.entries[0]), /SHELL_CANCELLED/);
});
test("simultaneous output streams cannot accumulate decoded entries", async () => {
  const loaded = await createShellLoader(configuration())();
  const entry = loaded.entries.find((e) => e.path.endsWith("public.bin"));
  const iterator = entry.chunks();
  await iterator.next();
  await assert.rejects(collect(entry), /CONCURRENT_READ_UNSUPPORTED/);
  await iterator.return();
  assert.equal((await collect(entry)).length, 131072);
});
