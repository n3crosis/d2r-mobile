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
      return { id: ++id, parent, name, mode };
    },
    mkdir(path) {
      assert.equal(path, "/work");
    },
    mount(type, opts, path) {
      assert.equal(path, "/work");
      rootNode = type.mount();
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
  const buffer = new Int8Array(8);
  assert.equal(node.stream_ops.read({ node }, buffer, 0, 8, 0), 8);
  assert.equal(buffer[0], -49);
  assert.equal(node.stream_ops.write({ node }, new Int8Array([-1]), 0, 1, 4), 1);
  const signature = app.node_ops.mknod(app, "_CodeSignature", 0o040755);
  const resources = signature.node_ops.mknod(signature, "CodeResources", 0o100644);
  resources.stream_ops.write({ node: resources }, new Int8Array([1]), 0, 1, 0);
  assert.throws(() => app.node_ops.mknod(app, "escape", 0o100644), ErrnoError);
  const output = mount.collectEntries();
  assert.equal(
    new Uint8Array(await output.find((e) => e.path === root + "Test").blob.arrayBuffer())[4],
    255,
  );
  mount.dispose();
  assert.equal(unmounted, true);
  assert.throws(() => mount.collectEntries(), /SIGNING_CLOSED/);
});
