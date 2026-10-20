// 用合成暂存源和文件系统替身验证导出、取消及所有权；不构成真实浏览器证明。
// Verify export, cancellation and ownership with synthetic staged sources and filesystem doubles, not browser proof.
import test from "node:test";
import assert from "node:assert/strict";
import {
  exportLegacyDevicePack,
  LegacyPackExportError,
  LEGACY_PACK_EXPORT_MARKER as MARKER,
} from "../legacy-device-pack-export.mjs";
const uuid = "12345678-1234-4123-8123-123456789abc",
  folderName = `Legacy Device Pack-${uuid}`;
function fixture(faults = {}) {
  const events = [];
  function directory(path = "") {
    const entries = new Map();
    const node = {
      kind: "directory",
      entries,
      isSameEntry: async (other) => other === node,
      queryPermission: async () => faults.permission ?? "granted",
      async getDirectoryHandle(name, options) {
        return get(name, options, "directory");
      },
      async getFileHandle(name, options) {
        return get(name, options, "file");
      },
      async removeEntry(name, options) {
        assert.equal(options, undefined);
        events.push(["remove", `${path}/${name}`]);
        faults.remove?.(`${path}/${name}`);
        const item = entries.get(name);
        if (!item) throw new DOMException("missing", "NotFoundError");
        if (item.kind === "directory" && item.entries.size)
          throw new DOMException("not empty", "InvalidModificationError");
        entries.delete(name);
      },
    };
    async function get(name, options, kind) {
      let item = entries.get(name);
      if (item && item.kind !== kind) throw new DOMException("kind", "TypeMismatchError");
      if (!item && !options?.create) throw new DOMException("missing", "NotFoundError");
      if (!item) {
        item = kind === "directory" ? directory(`${path}/${name}`) : file(`${path}/${name}`);
        entries.set(name, item);
        faults.created?.(`${path}/${name}`, item);
      }
      return item;
    }
    return node;
  }
  function file(path) {
    const node = {
      kind: "file",
      data: new Uint8Array(),
      isSameEntry: async (other) => other === node,
      async getFile() {
        return new Blob([node.data]);
      },
      async createWritable() {
        events.push(["open", path]);
        const pieces = [];
        return {
          async write(bytes) {
            events.push(["write", path, bytes.length]);
            faults.write?.(path, bytes);
            pieces.push(bytes.slice());
          },
          async close() {
            const data = new Uint8Array(Buffer.concat(pieces));
            faults.close?.(path, data);
            node.data = data;
            events.push(["close", path]);
          },
          async abort() {
            faults.abort?.(path);
            events.push(["abort", path]);
          },
        };
      },
    };
    return node;
  }
  const root = directory();
  root.entries.set("unrelated", file("/unrelated"));
  const content = Uint8Array.from({ length: 70003 }, (_, i) => i & 255);
  const pack = { name: "00-00000008.data", size: content.length, sha256: "a".repeat(64) };
  const finalizedPack = {
    pack,
    source: {
      size: content.length,
      file: new Blob([content]),
      async readAt(offset, length) {
        assert.ok(length <= 65536);
        faults.read?.(offset, length);
        return faults.short ? new Uint8Array() : content.slice(offset, offset + length);
      },
    },
  };
  const options = {
    finalizedPack,
    outputDirectoryHandle: root,
    secureContext: true,
    randomUUID: () => uuid,
  };
  return { root, events, content, pack, options };
}
test("exports native manifest and archive to fresh renamed directory with committed marker", async () => {
  const fs = fixture(),
    progress = [];
  const result = await exportLegacyDevicePack({
    ...fs.options,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.status, "complete");
  assert.equal(result.filesWritten, 2);
  assert.equal(result.bytesWritten, fs.content.length);
  const folder = fs.root.entries.get(folderName);
  assert.deepEqual(folder.entries.get("data").entries.get(fs.pack.name).data, fs.content);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(folder.entries.get("manifest.json").data)), {
    files: [fs.pack],
  });
  assert.equal(
    JSON.parse(new TextDecoder().decode(folder.entries.get(MARKER).data)).status,
    "complete",
  );
  assert.equal(progress.at(-1).state, "complete");
  assert.ok(fs.root.entries.has("unrelated"));
});
test("collision, invalid metadata/source/signal and denied permission never overwrite", async () => {
  for (const mode of ["collision", "pack", "source", "signal", "permission"]) {
    const fs = fixture(mode === "permission" ? { permission: "denied" } : {});
    if (mode === "collision") fs.root.entries.set(folderName, { kind: "directory" });
    if (mode === "pack") fs.options.finalizedPack.pack = { ...fs.pack, name: "../bad" };
    if (mode === "source") fs.options.finalizedPack.source.size++;
    if (mode === "signal") fs.options.signal = {};
    await assert.rejects(
      exportLegacyDevicePack(fs.options),
      (error) => error instanceof LegacyPackExportError && error.report.cleanupComplete,
    );
    assert.equal(
      fs.events.some((e) => e[0] === "write" || e[0] === "remove"),
      false,
    );
    assert.ok(fs.root.entries.has("unrelated"));
  }
});
test("read/write/close failures remove only owned output and report partial counts", async () => {
  for (const mode of ["read", "write", "close", "short"]) {
    const faults =
      mode === "short"
        ? { short: true }
        : {
            [mode]: (path) => {
              if (mode === "read" || path.endsWith(".data")) throw new Error("disk failure");
            },
          };
    const fs = fixture(faults);
    await assert.rejects(exportLegacyDevicePack(fs.options), (error) => {
      assert.ok(error.report.cleanupComplete);
      assert.equal(error.report.status, "incomplete");
      return true;
    });
    assert.deepEqual([...fs.root.entries.keys()], ["unrelated"]);
  }
});
test("abort after acquiring owned file cleans it; final marker close is commit boundary", async () => {
  const controller = new AbortController();
  const fs = fixture({
    created: (path) => {
      if (path.endsWith(".data")) controller.abort();
    },
  });
  await assert.rejects(
    exportLegacyDevicePack({ ...fs.options, signal: controller.signal }),
    (error) => error.report.code === "CANCELLED" && error.report.cleanupComplete,
  );
  const after = new AbortController();
  const done = fixture({
    close: (path, bytes) => {
      if (
        path.endsWith(MARKER) &&
        JSON.parse(new TextDecoder().decode(bytes)).status === "complete"
      )
        after.abort();
    },
  });
  assert.equal(
    (await exportLegacyDevicePack({ ...done.options, signal: after.signal })).status,
    "complete",
  );
});
test("cleanup failure preserves incomplete marker and reports remaining output", async () => {
  const fs = fixture({
    write: (path) => {
      if (path.endsWith(".data")) throw new Error("write failed");
    },
    remove: (path) => {
      if (path.endsWith(".data")) throw new Error("remove denied");
    },
  });
  await assert.rejects(exportLegacyDevicePack(fs.options), (error) => {
    assert.equal(error.report.cleanupComplete, false);
    assert.equal(error.report.incompleteMarkerPresent, true);
    assert.ok(error.report.cleanupCodes.includes("LEGACY_PACK_ENTRY_CLEANUP_FAILED"));
    return true;
  });
  assert.equal(
    JSON.parse(new TextDecoder().decode(fs.root.entries.get(folderName).entries.get(MARKER).data))
      .status,
    "incomplete",
  );
});
test("unknown additions and replaced handles survive nonrecursive cleanup", async () => {
  for (const replace of [false, true]) {
    let fs;
    fs = fixture({
      write: (path) => {
        if (!path.endsWith(".data")) return;
        const data = fs.root.entries.get(folderName).entries.get("data");
        if (replace)
          data.entries.set(fs.pack.name, { kind: "file", isSameEntry: async () => false });
        else data.entries.set("user-added", { kind: "file" });
        throw new Error("stop");
      },
    });
    await assert.rejects(
      exportLegacyDevicePack(fs.options),
      (error) => !error.report.cleanupComplete && error.report.incompleteMarkerPresent,
    );
    const data = fs.root.entries.get(folderName).entries.get("data");
    assert.ok(data.entries.has(replace ? fs.pack.name : "user-added"));
  }
});
test("progress observer errors do not change successful export", async () => {
  const fs = fixture();
  assert.equal(
    (
      await exportLegacyDevicePack({
        ...fs.options,
        onProgress: () => Promise.reject(new Error("observer")),
      })
    ).status,
    "complete",
  );
});

test("manifest and final-marker close failures never report completion", async () => {
  for (const target of ["manifest.json", "complete-marker"]) {
    const fs = fixture({
      close: (path, bytes) => {
        if (
          path.endsWith(target) ||
          (target === "complete-marker" &&
            path.endsWith(MARKER) &&
            JSON.parse(new TextDecoder().decode(bytes)).status === "complete")
        )
          throw new Error("close failed");
      },
    });
    await assert.rejects(
      exportLegacyDevicePack(fs.options),
      (error) => error.report.status === "incomplete" && error.report.cleanupComplete,
    );
    assert.deepEqual([...fs.root.entries.keys()], ["unrelated"]);
  }
});
test("unsafe source backing buffers reject and secure context is required", async () => {
  const fs = fixture();
  fs.options.finalizedPack.source.readAt = async (_, count) =>
    new Uint8Array(new ArrayBuffer(65537), 0, count);
  await assert.rejects(
    exportLegacyDevicePack(fs.options),
    (error) => /READ_RANGE/.test(error.cause.message) && error.report.cleanupComplete,
  );
  const insecure = fixture();
  await assert.rejects(
    exportLegacyDevicePack({ ...insecure.options, secureContext: false }),
    (error) => /SECURE_CONTEXT/.test(error.cause.message),
  );
  assert.equal(insecure.events.length, 0);
});
test("abort during streaming reports written bytes and preserves no owned leftovers", async () => {
  const controller = new AbortController();
  const fs = fixture({
    write: (path) => {
      if (path.endsWith(".data")) controller.abort();
    },
  });
  await assert.rejects(
    exportLegacyDevicePack({ ...fs.options, signal: controller.signal }),
    (error) =>
      error.report.code === "CANCELLED" &&
      error.report.bytesWritten === 65536 &&
      error.report.cleanupComplete,
  );
  assert.deepEqual([...fs.root.entries.keys()], ["unrelated"]);
});
