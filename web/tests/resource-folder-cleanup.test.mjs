// 合成目录/读取器只验证清理所有权，不证明原生验收表或真实资源内容。
// Synthetic directories/readers test cleanup ownership, not native acceptance tables or real resource content.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { exportRomfsResources, RESOURCE_EXPORT_MARKER } from "../resource-folder-export.mjs";
import { resourceOutputLocks } from "./fixtures/resource-output-locks.mjs";
const moduleSource = await readFile(
  new URL("../resource-folder-export.mjs", import.meta.url),
  "utf8",
);
const files = [...moduleSource.matchAll(/\["([\d-]+\.data)", (\d+)n\]/g)].map(([, name, size]) => ({
  path: `data/${name}`,
  size: BigInt(size),
}));
assert.equal(files.length, 18);
function fixture(abortFails) {
  const events = [];
  const primary = Error("synthetic read failure");
  function dir() {
    const entries = new Map();
    const handle = {
      kind: "directory",
      entries,
      queryPermission: async () => "granted",
      isSameEntry: async (other) => other === handle,
      getDirectoryHandle: async (name, options) => get(name, options, true),
      getFileHandle: async (name, options) => get(name, options, false),
      async removeEntry(name, options) {
        assert.equal(options, undefined);
        events.push(name);
        const child = entries.get(name);
        if (child?.entries?.size) throw Error("not empty");
        entries.delete(name);
      },
    };
    function get(name, options, directory) {
      if (!entries.has(name)) {
        if (!options?.create) throw new DOMException("missing", "NotFoundError");
        entries.set(name, directory ? dir() : file());
      }
      return entries.get(name);
    }
    return handle;
  }
  function file() {
    const handle = {
      kind: "file",
      isSameEntry: async (other) => other === handle,
      async createWritable() {
        return {
          write: async () => {},
          close: async () => {},
          abort: async () => {
            if (abortFails) throw Error("still active");
          },
        };
      },
    };
    return handle;
  }
  const root = dir();
  const romfs = {
    files,
    getFile(path) {
      const entry = files.find((file) => file.path === path);
      return {
        size: entry.size,
        readAt: async () => {
          throw primary;
        },
      };
    },
  };
  return { root, romfs, primary, events };
}
for (const abortFails of [true, false])
  test(`resource writer abort ${abortFails ? "failure retains" : "success removes"} owned output`, async () => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
    Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });
    const fs = fixture(abortFails);
    try {
      await assert.rejects(
        exportRomfsResources({
          romfs: fs.romfs,
          outputDirectoryHandle: fs.root,
          locks: resourceOutputLocks(),
        }),
        (error) => {
          assert.equal(error.cause, fs.primary);
          assert.equal(error.report.cleanupComplete, !abortFails);
          assert.equal(error.report.incompleteMarkerPresent, abortFails);
          assert.deepEqual(
            error.report.cleanupCodes,
            abortFails ? ["RESOURCE_WRITER_ABORT_FAILED"] : [],
          );
          return true;
        },
      );
      if (abortFails) {
        assert.equal(fs.events.length, 0);
        const folder = [...fs.root.entries.values()][0];
        assert.ok(folder.entries.has(RESOURCE_EXPORT_MARKER));
        assert.equal([...fs.root.entries.keys()][0], "data");
        assert.ok(folder.entries.has("00-00000001.data"));
      } else assert.equal(fs.root.entries.size, 0);
    } finally {
      if (prior) Object.defineProperty(globalThis, "isSecureContext", prior);
      else delete globalThis.isSecureContext;
    }
  });
