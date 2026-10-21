import test from "node:test";
import assert from "node:assert/strict";
import { inspectUnsignedSigningArchive, createSignedSigningArchive } from "../ipa-signing-zip.mjs";
import { createSigningFileStore, SIGNING_FS_LIMITS } from "../ipa-signing-fs.mjs";
const root = "Payload/Test.app/";
const entry = (path, bytes, mode = 0o644) => ({
  path: root + path,
  size: bytes.length,
  mode,
  blob: new Blob([bytes]),
});
const entries = () => [
  entry("Info.plist", new Uint8Array([1, 2, 3])),
  entry("Test", new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]), 0o755),
  entry("resource", new Uint8Array([9, 8, 7])),
];

test("canonical unsigned archive is independently checked and repackages unchanged payloads", async () => {
  const blob = await createSignedSigningArchive(entries());
  const archive = await inspectUnsignedSigningArchive(blob);
  assert.equal(archive.appRoot, root);
  assert.equal(archive.entries.length, 3);
  const repacked = await createSignedSigningArchive(archive.entries);
  assert.deepEqual(await repacked.arrayBuffer(), await blob.arrayBuffer());
  const bytes = new Uint8Array(await blob.arrayBuffer());
  bytes[30 + new TextEncoder().encode(root + "Info.plist").length] ^= 1;
  await assert.rejects(inspectUnsignedSigningArchive(new Blob([bytes])), /SIGNING_INPUT_INVALID/);
});

test("canonical input rejects signing files, extensions, other roots and noncanonical trailers", async () => {
  for (const extra of [
    "embedded.mobileprovision",
    "_CodeSignature/CodeResources",
    "PlugIns/Extra.appex/Info.plist",
  ]) {
    const blob = await createSignedSigningArchive([
      ...entries(),
      entry(extra, new Uint8Array([1])),
    ]);
    await assert.rejects(inspectUnsignedSigningArchive(blob), /SIGNING_INPUT_INVALID/);
  }
  const blob = await createSignedSigningArchive(entries());
  await assert.rejects(
    inspectUnsignedSigningArchive(new Blob([blob, new Uint8Array([0])])),
    /SIGNING_INPUT_INVALID/,
  );
  const other = { ...entry("other", new Uint8Array([1])), path: "Payload/Other.app/Info.plist" };
  await assert.rejects(
    inspectUnsignedSigningArchive(await createSignedSigningArchive([...entries(), other])),
    /SIGNING_INPUT_INVALID/,
  );
});

test("signed writer rejects conflicting paths and honours cancellation", async () => {
  await assert.rejects(
    createSignedSigningArchive([...entries(), entries()[0]]),
    /SIGNING_OUTPUT_INVALID/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createSignedSigningArchive(entries(), { signal: controller.signal }), {
    name: "AbortError",
  });
  await assert.rejects(
    inspectUnsignedSigningArchive(await createSignedSigningArchive(entries()), {
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});

class SyncBlob extends Blob {
  constructor(bytes) {
    super([bytes]);
    this.bytes = bytes.slice();
  }
  slice(start = 0, end = this.size) {
    return new SyncBlob(this.bytes.slice(start, end));
  }
}
function storeFixture() {
  const input = entries().map((e) => ({
    ...e,
    blob: new SyncBlob(
      e.path.endsWith("/Test")
        ? new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4])
        : new Uint8Array(e.size).fill(7),
    ),
  }));
  let maxRead = 0;
  const store = createSigningFileStore(
    { appRoot: root, entries: input },
    {
      readBlobSync(blob) {
        maxRead = Math.max(maxRead, blob.size);
        return blob.bytes;
      },
    },
  );
  return {
    store,
    input,
    get maxRead() {
      return maxRead;
    },
  };
}

test("Blob store keeps resources immutable, snapshots changed outputs and wipes on disposal", async () => {
  const fixture = storeFixture(),
    { store, input } = fixture;
  assert.equal(store.allocatedBytes, 0);
  assert.throws(
    () => store.write(root + "resource", 0, new Uint8Array([1])),
    /SIGNING_INPUT_INVALID/,
  );
  store.write(root + "Test", 4, new Uint8Array([42]));
  assert.deepEqual(
    store.read(root + "Test", 0, 8),
    new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 42, 2, 3, 4]),
  );
  assert.equal(input[1].blob.bytes[4], 1);
  const output = store.collectEntries();
  store.write(root + "Test", 4, new Uint8Array([43]));
  assert.equal(
    new Uint8Array(await output.find((e) => e.path === root + "Test").blob.arrayBuffer())[4],
    42,
  );
  assert.ok(fixture.maxRead <= 65536);
  store.dispose();
  store.dispose();
  assert.equal(store.allocatedBytes, 0);
  assert.throws(() => store.read(root + "Test", 0, 1), /SIGNING_INPUT_INVALID/);
});

test("store allows closed signing metadata and executable temporary replacement only", () => {
  const { store } = storeFixture();
  store.write(root + "_CodeSignature/CodeResources", 0, new Uint8Array([1, 2]));
  store.write(root + "embedded.mobileprovision", 0, new Uint8Array([3]));
  assert.throws(
    () => store.write(root + "unexpected", 0, new Uint8Array([1])),
    /SIGNING_INPUT_INVALID/,
  );
  store.write(root + "Test.archo.0", 0, new Uint8Array([1, 2, 3]));
  assert.throws(() => store.collectEntries(), /SIGNING_INPUT_INVALID/);
  store.rename(root + "Test.archo.0", root + "Test");
  assert.equal(store.collectEntries().find((e) => e.path === root + "Test").mode, 0o755);
  store.remove(root + "Info.plist");
  assert.throws(() => store.collectEntries(), /SIGNING_INPUT_INVALID/);
  store.dispose();
});

test("store validates sizes, sparse ranges, metadata bounds and zeroes truncated bytes", () => {
  const { store } = storeFixture();
  assert.throws(
    () => store.write(root + "Test", SIGNING_FS_LIMITS.mutableFileBytes, new Uint8Array([1])),
    /SIGNING_SIZE_LIMIT/,
  );
  assert.throws(
    () => store.truncate(root + "Info.plist", SIGNING_FS_LIMITS.metadataBytes + 1),
    /SIGNING_SIZE_LIMIT/,
  );
  assert.throws(() => store.read(root + "Test", 0, 65537), /SIGNING_INPUT_INVALID/);
  assert.throws(
    () => store.write(root + "Test", Number.MAX_SAFE_INTEGER, new Uint8Array([1])),
    /SIGNING_INPUT_INVALID/,
  );
  store.truncate(root + "Test", 2);
  store.truncate(root + "Test", 8);
  assert.deepEqual(store.read(root + "Test", 2, 6), new Uint8Array(6));
  store.dispose();
});

test("custom mount remaps app root, reads in bounded slices and accepts signed WASM heap writes", async () => {
  const { mountSigningArchive } = await import("../ipa-signing-mount.mjs");
  let rootNode,
    unmounted = false,
    id = 0;
  class ErrnoError extends Error {
    constructor(code) {
      super(String(code));
      this.errno = code;
    }
  }
  const FS = {
    ErrnoError,
    createNode(parent, name, mode) {
      return { id: ++id, parent, name, mode, mount: parent?.mount };
    },
    mkdir(path) {
      assert.equal(path, "/work");
    },
    mount(type, opts, path) {
      assert.equal(path, "/work");
      const mountInfo = { mountpoint: path };
      rootNode = type.mount(mountInfo);
      rootNode.mount = mountInfo;
    },
    unmount(path) {
      assert.equal(path, "/work");
      unmounted = true;
    },
  };
  const archive = {
    appRoot: root,
    entries: entries().map((e) => ({
      ...e,
      blob: new SyncBlob(
        e.path.endsWith("/Test")
          ? new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4])
          : new Uint8Array(e.size).fill(7),
      ),
    })),
  };
  const mount = mountSigningArchive({ FS }, archive, { readBlobSync: (blob) => blob.bytes });
  const app = rootNode.contents.Payload.contents["App.app"],
    node = app.contents.Test;
  const assertOwnership = (node) => {
    assert.equal(node.mount, rootNode.mount);
    for (const child of Object.values(node.contents ?? {})) assertOwnership(child);
  };
  assertOwnership(rootNode);
  const buffer = new Int8Array(8);
  assert.equal(node.stream_ops.read({ node }, buffer, 0, 8, 0), 8);
  assert.equal(buffer[0], -49);
  assert.equal(node.stream_ops.write({ node }, new Int8Array([-1]), 0, 1, 4), 1);
  const signature = app.node_ops.mknod(app, "_CodeSignature", 0o040755);
  // 模拟 Emscripten 4.0.20 open 的 mknod(mode|0777) → chmod(mode) 顺序。
  // Model Emscripten 4.0.20 open's mknod(mode|0777) → chmod(mode) sequence.
  const resources = signature.node_ops.mknod(signature, "CodeResources", 0o100777);
  for (const mode of [0o100755, 0o104644, 0o040644])
    assert.throws(() => resources.node_ops.setattr(resources, { mode }), ErrnoError);
  resources.node_ops.setattr(resources, { mode: 0o100666 });
  assert.equal(resources.mode, 0o100644);
  assert.throws(() => resources.node_ops.setattr(resources, { mode: 0o100666 }), ErrnoError);
  const profile = app.node_ops.mknod(app, "embedded.mobileprovision", 0o100777);
  profile.node_ops.setattr(profile, { mode: 0o100644 });
  assert.throws(() => profile.node_ops.setattr(profile, { mode: 0o100666 }), ErrnoError);
  assert.throws(() => node.node_ops.setattr(node, { mode: 0o100666 }), ErrnoError);
  resources.stream_ops.write({ node: resources }, new Int8Array([1]), 0, 1, 0);
  assertOwnership(rootNode);
  assert.throws(() => app.node_ops.mknod(app, "escape", 0o100644), ErrnoError);
  const output = mount.collectEntries();
  assert.equal(
    new Uint8Array(await output.find((e) => e.path === root + "Test").blob.arrayBuffer())[4],
    255,
  );
  const replacement = app.node_ops.mknod(app, "Test.archo.0", 0o100644);
  replacement.stream_ops.write({ node: replacement }, new Int8Array([4, 5, 6]), 0, 3, 0);
  assert.equal(replacement.node_ops.getattr(replacement).mode & 0o777, 0o644);
  app.node_ops.unlink(app, "Test");
  replacement.node_ops.rename(replacement, app, "Test");
  assert.equal(replacement.node_ops.getattr(replacement).mode & 0o777, 0o755);
  assert.equal(mount.collectEntries().find((e) => e.path === root + "Test").mode, 0o755);
  assert.equal(
    new Uint8Array(await output.find((e) => e.path === root + "Test").blob.arrayBuffer())[4],
    255,
  );
  mount.dispose();
  assert.equal(unmounted, true);
  assert.throws(() => mount.collectEntries(), /SIGNING_CLOSED/);
});

test("signing ZIP reuses only immutable payload slices and matches the canonical byte writer", async () => {
  const { writeZip } = await import("../zip-writer.mjs");
  const { validateStagedZip } = await import("../staged-zip-validator.mjs");
  const { fileSource } = await import("../preflight.mjs");
  const files = [
    ...entries().filter((file) => !file.path.endsWith("/resource")),
    entry("empty", new Uint8Array()),
    entry(
      "resource",
      Uint8Array.from({ length: 65543 }, (_, i) => i & 255),
    ),
  ];
  const baselineParts = [];
  await writeZip(
    files.map((file) => ({
      ...file,
      async *chunks() {
        for (let offset = 0; offset < file.size; offset += 65536)
          yield new Uint8Array(await file.blob.slice(offset, offset + 65536).arrayBuffer());
      },
    })),
    {
      async write(bytes) {
        baselineParts.push(new Blob([bytes]));
      },
      async close() {},
      async abort() {
        baselineParts.length = 0;
      },
    },
  );
  const baseline = new Blob(baselineParts);
  const NativeBlob = globalThis.Blob,
    originalSlice = NativeBlob.prototype.slice,
    originalRead = NativeBlob.prototype.arrayBuffer;
  const readBuffers = new WeakSet(),
    sourceSlices = new WeakSet();
  let payloadRecopies = 0,
    metadataSnapshots = 0,
    finalParts;
  let output;
  try {
    NativeBlob.prototype.slice = function (...args) {
      const slice = originalSlice.apply(this, args);
      sourceSlices.add(slice);
      return slice;
    };
    NativeBlob.prototype.arrayBuffer = async function () {
      const buffer = await originalRead.call(this);
      readBuffers.add(buffer);
      return buffer;
    };
    globalThis.Blob = new Proxy(NativeBlob, {
      construct(target, args) {
        const parts = args[0] ?? [];
        if (args[1]?.type === "application/octet-stream") finalParts = [...parts];
        if (parts.length === 1 && ArrayBuffer.isView(parts[0])) {
          if (readBuffers.has(parts[0].buffer)) payloadRecopies++;
          else metadataSnapshots++;
        }
        return Reflect.construct(target, args, target);
      },
    });
    output = await createSignedSigningArchive(files);
    assert.equal(payloadRecopies, 0);
    assert.equal(metadataSnapshots, files.length * 3 + 1);
    assert.equal(finalParts.filter((part) => sourceSlices.has(part)).length, 4);
    assert.equal(
      finalParts.filter((part) => sourceSlices.has(part)).reduce((sum, part) => sum + part.size, 0),
      files.reduce((sum, file) => sum + file.size, 0),
    );
  } finally {
    globalThis.Blob = NativeBlob;
    NativeBlob.prototype.slice = originalSlice;
    NativeBlob.prototype.arrayBuffer = originalRead;
  }
  assert.deepEqual(await output.arrayBuffer(), await baseline.arrayBuffer());
  const receipt = await validateStagedZip(fileSource(output), files, {
    archiveFormat: "zip32",
    maxOutputBytes: 512 * 1024 * 1024,
  });
  assert.equal(receipt.valid, true);
  assert.equal(receipt.entries, files.length);
});

test("signing ZIP rejects interrupted or inconsistent source reads without stale slice reuse", async () => {
  const originalRead = Blob.prototype.arrayBuffer;
  for (const failure of ["throw", "short", "different", "abort"]) {
    const controller = new AbortController();
    let reads = 0;
    try {
      Blob.prototype.arrayBuffer = async function () {
        const bytes = await originalRead.call(this);
        if (++reads === 2) {
          if (failure === "throw") throw Error("synthetic read failure");
          if (failure === "short") return bytes.slice(1);
          if (failure === "different") {
            new Uint8Array(bytes)[0] ^= 1;
            return bytes;
          }
          controller.abort();
        }
        return bytes;
      };
      await assert.rejects(
        createSignedSigningArchive(entries(), { signal: controller.signal }),
        failure === "abort" ? { name: "AbortError" } : /SIGNING_OUTPUT_INVALID/,
      );
    } finally {
      Blob.prototype.arrayBuffer = originalRead;
    }
  }
  const output = await createSignedSigningArchive(entries());
  assert.equal((await inspectUnsignedSigningArchive(output)).entries.length, 3);
});
