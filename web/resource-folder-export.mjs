import { indexFiles, safeRelativePath } from "./preflight.mjs";
import { ROMFS_LIMITS } from "./romfs-tree.mjs";

/** Raw authenticated RomFS export, separate from the unsigned IPA. No ZIP, upload,
 * whole-game buffer, native resource changes or caller-provided validity flags.
 * romfs MUST come from readAuthenticatedAssets(extracted, selection).romfs while
 * that extraction session is still live. This module does not authenticate a
 * caller-invented reader; provenance is enforced by the orchestration adapter.
 */
export const RESOURCE_EXPORT_LIMITS = Object.freeze({
  chunkBytes: 64 * 1024,
  files: ROMFS_LIMITS.members,
  pathBytes: ROMFS_LIMITS.pathBytes,
  totalPathBytes: ROMFS_LIMITS.totalPathBytes,
  maxFileBytes: BigInt(Number.MAX_SAFE_INTEGER),
  maxTotalBytes: BigInt(Number.MAX_SAFE_INTEGER),
});
export const RESOURCE_EXPORT_MARKER = ".d2rm-resource-export.json";
// Native separate-resource acceptance table, dm/host/romfs_validate.c need[]/size[].
// These are full raw archive sizes, not sparse/zero-stripped .holes variants.
const REQUIRED_NATIVE_ARCHIVES = Object.freeze(
  [
    ["00-00000001.data", 1073741824n],
    ["00-00000002.data", 1073741821n],
    ["00-00000003.data", 1026342790n],
    ["00-00000004.data", 3664822n],
    ["00-00000005.data", 391990840n],
    ["00-00000006.data", 3794407n],
    ["01-00000001.data", 344377972n],
    ["01-00000002.data", 37189352n],
    ["02-00000001.data", 368762692n],
    ["02-00000002.data", 23206186n],
    ["03-00000001.data", 251620752n],
    ["03-00000002.data", 55071917n],
    ["04-00000001.data", 118831405n],
    ["04-00000002.data", 8915855n],
    ["05-00000001.data", 478931036n],
    ["05-00000002.data", 92048235n],
    ["17-00000001.data", 204495617n],
    ["17-00000002.data", 4496514n],
  ].map(Object.freeze),
);
const encoder = new TextEncoder();
const fail = (code) => {
  throw new Error(code);
};
const requireValue = (value, code) => {
  if (!value) fail(code);
};

export class ResourceExportError extends Error {
  constructor(cause, report) {
    super("Local resource export did not complete.", { cause });
    this.name = "ResourceExportError";
    this.report = Object.freeze(report);
  }
}

function inventory(romfs) {
  requireValue(
    romfs && Array.isArray(romfs.files) && typeof romfs.getFile === "function",
    "RESOURCE_READER_REQUIRED",
  );
  requireValue(
    romfs.files.length > 0 && romfs.files.length <= RESOURCE_EXPORT_LIMITS.files,
    "RESOURCE_FILE_LIMIT",
  );
  let totalBytes = 0n,
    pathBytes = 0;
  const directories = new Set();
  const entries = romfs.files.map((file) => {
    requireValue(
      file && typeof file.path === "string" && file.path.length <= RESOURCE_EXPORT_LIMITS.pathBytes,
      "RESOURCE_PATH_LIMIT",
    );
    const path = safeRelativePath(file.path),
      parts = path.split("/");
    requireValue(parts.length <= ROMFS_LIMITS.depth + 1, "RESOURCE_DEPTH_LIMIT");
    requireValue(parts[0].toLowerCase() !== RESOURCE_EXPORT_MARKER, "RESOURCE_MARKER_COLLISION");
    requireValue(!/[<>"|?*\u0080-\u009f]/u.test(path), "RESOURCE_UNSAFE_PATH");
    const encoded = encoder.encode(path);
    requireValue(
      new TextDecoder("utf-8", { fatal: true }).decode(encoded) === path,
      "RESOURCE_PATH_ENCODING",
    );
    requireValue(
      encoded.length <= RESOURCE_EXPORT_LIMITS.pathBytes &&
        parts.every((part) => encoder.encode(part).length <= ROMFS_LIMITS.nameBytes),
      "RESOURCE_PATH_LIMIT",
    );
    pathBytes += encoded.length;
    requireValue(pathBytes <= RESOURCE_EXPORT_LIMITS.totalPathBytes, "RESOURCE_METADATA_LIMIT");
    requireValue(
      typeof file.size === "bigint" &&
        file.size >= 0n &&
        file.size <= RESOURCE_EXPORT_LIMITS.maxFileBytes,
      "RESOURCE_FILE_SIZE_LIMIT",
    );
    totalBytes += file.size;
    requireValue(totalBytes <= RESOURCE_EXPORT_LIMITS.maxTotalBytes, "RESOURCE_TOTAL_SIZE_LIMIT");
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
    requireValue(
      directories.size + romfs.files.length <= ROMFS_LIMITS.members,
      "RESOURCE_MEMBER_LIMIT",
    );
    return Object.freeze({ path, parts, size: file.size });
  });
  // Shared duplicate, case-folded alias and file/directory conflict policy.
  indexFiles(entries.map(({ path, size }) => ({ path, size: Number(size) })));
  const sizes = new Map(entries.map(({ path, size }) => [path, size]));
  requireValue(
    REQUIRED_NATIVE_ARCHIVES.every(([name, size]) => sizes.get(`data/${name}`) === size),
    "RESOURCE_NATIVE_ARCHIVE_MISMATCH",
  );
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, totalBytes };
}

/**
 * The directory picker/permission belongs to a prior explicit user gesture.
 * Only a fresh unpredictable child is touched. On failure, removal is limited
 * to individually tracked entries whose handles still match, never recursive.
 * A concurrent external writer is not supported (File System Access has no
 * exclusive-create primitive). Unknown additions/replacements are preserved.
 *
 * onProgress is advisory and receives BigInt counters, at most every 100ms plus
 * file/stage transitions. Do not JSON.stringify it without encoding BigInts.
 */
export async function exportRomfsResources({
  romfs,
  outputDirectoryHandle,
  signal,
  onProgress,
} = {}) {
  let directoryName = null,
    folder,
    marker,
    activeWriter;
  let filesWritten = 0,
    bytesWritten = 0n,
    totalBytes = 0n,
    totalFiles = 0;
  let markerPresent = false,
    lastProgress = 0;
  const owned = [],
    directories = new Map();
  const check = () => signal?.throwIfAborted();
  const emit = (stage, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgress < 100) return;
    lastProgress = now;
    try {
      onProgress?.(
        Object.freeze({
          stage,
          state: stage === "complete" ? "complete" : "running",
          directoryName,
          filesWritten,
          totalFiles,
          bytesWritten,
          totalBytes,
        }),
      );
    } catch {
      /* Observers never alter an authenticated export. */
    }
  };
  async function absent(parent, name, kind) {
    check();
    try {
      if (kind === "directory") await parent.getDirectoryHandle(name);
      else await parent.getFileHandle(name);
    } catch (cause) {
      if (cause?.name === "NotFoundError") return;
      throw cause; // Includes a same-name entry of the wrong kind.
    }
    fail("RESOURCE_DESTINATION_COLLISION");
  }
  async function create(parent, name, kind) {
    await absent(parent, name, kind);
    check();
    const handle =
      kind === "directory"
        ? await parent.getDirectoryHandle(name, { create: true })
        : await parent.getFileHandle(name, { create: true });
    const item = { parent, name, kind, handle, removed: false };
    owned.push(item); // Record ownership before observing cancellation.
    requireValue(typeof handle.isSameEntry === "function", "RESOURCE_OWNERSHIP_UNAVAILABLE");
    check();
    return item;
  }
  async function removeOwned(item) {
    if (item.removed) return;
    let current;
    try {
      current =
        item.kind === "directory"
          ? await item.parent.getDirectoryHandle(item.name)
          : await item.parent.getFileHandle(item.name);
    } catch (cause) {
      if (cause?.name === "NotFoundError") {
        item.removed = true;
        return;
      }
      throw cause;
    }
    requireValue(await item.handle.isSameEntry(current), "RESOURCE_ENTRY_REPLACED");
    // Deliberately nonrecursive: preserve user additions, even inside our folder.
    await item.parent.removeEntry(item.name);
    item.removed = true;
  }
  async function writeMarker(status) {
    check();
    const record = {
      schemaVersion: 1,
      status,
      resourceLayout: "raw-romfs-relative-paths",
      files: totalFiles,
      bytes: totalBytes.toString(),
      filesWritten,
      bytesWritten: bytesWritten.toString(),
      ipaStatus: "separate-output-not-tracked",
      notice:
        status === "complete"
          ? "Resource export complete. This does not establish IPA completion, installation or device compatibility."
          : "Incomplete resource export. Do not use this folder as a finished game resource set.",
    };
    activeWriter = await marker.handle.createWritable({ keepExistingData: false });
    check();
    await activeWriter.write(encoder.encode(JSON.stringify(record, null, 2) + "\n"));
    check();
    await activeWriter.close();
    activeWriter = undefined;
    markerPresent = true;
    // In particular, do not reclassify a completed final marker close as failure.
  }
  try {
    check();
    const planned = inventory(romfs);
    totalBytes = planned.totalBytes;
    totalFiles = planned.entries.length;
    requireValue(globalThis.isSecureContext === true, "RESOURCE_SECURE_CONTEXT_REQUIRED");
    requireValue(
      outputDirectoryHandle?.kind === "directory" &&
        typeof outputDirectoryHandle.queryPermission === "function" &&
        typeof outputDirectoryHandle.getDirectoryHandle === "function" &&
        typeof outputDirectoryHandle.removeEntry === "function",
      "RESOURCE_DIRECTORY_REQUIRED",
    );
    requireValue(
      (await outputDirectoryHandle.queryPermission({ mode: "readwrite" })) === "granted",
      "RESOURCE_WRITE_PERMISSION_REQUIRED",
    );
    check();
    requireValue(
      typeof globalThis.crypto?.randomUUID === "function",
      "RESOURCE_RANDOM_ID_UNAVAILABLE",
    );
    directoryName = `D2R-resources-${globalThis.crypto.randomUUID()}`;
    folder = await create(outputDirectoryHandle, directoryName, "directory");
    directories.set("", folder.handle);
    marker = await create(folder.handle, RESOURCE_EXPORT_MARKER, "file");
    await writeMarker("incomplete");
    check();
    emit("resources", true);
    for (const entry of planned.entries) {
      check();
      const source = romfs.getFile(entry.path);
      requireValue(
        source && source.size === entry.size && typeof source.readAt === "function",
        "RESOURCE_READER_CHANGED",
      );
      let parent = folder.handle;
      for (let i = 0; i < entry.parts.length - 1; i++) {
        const path = entry.parts.slice(0, i + 1).join("/");
        let next = directories.get(path);
        if (!next) {
          next = (await create(parent, entry.parts[i], "directory")).handle;
          directories.set(path, next);
        }
        parent = next;
      }
      const output = await create(parent, entry.parts.at(-1), "file");
      activeWriter = await output.handle.createWritable({ keepExistingData: false });
      check();
      for (let offset = 0n; offset < entry.size;) {
        check();
        const count = Number(
          entry.size - offset < BigInt(RESOURCE_EXPORT_LIMITS.chunkBytes)
            ? entry.size - offset
            : BigInt(RESOURCE_EXPORT_LIMITS.chunkBytes),
        );
        const bytes = await source.readAt(offset, count, { signal });
        try {
          check();
          requireValue(
            bytes instanceof Uint8Array && bytes.byteLength === count,
            "RESOURCE_SHORT_READ",
          );
          await activeWriter.write(bytes);
          offset += BigInt(count);
          bytesWritten += BigInt(count);
          check();
          emit("resources");
        } finally {
          // Authenticated RomFS readers return owned copies, not shared cache views.
          if (bytes instanceof Uint8Array) bytes.fill(0);
        }
      }
      check();
      await activeWriter.close();
      activeWriter = undefined;
      check();
      const writtenFile = await output.handle.getFile();
      requireValue(
        Number.isSafeInteger(writtenFile.size) && BigInt(writtenFile.size) === entry.size,
        "RESOURCE_WRITTEN_SIZE_MISMATCH",
      );
      filesWritten++;
      emit("resources", true);
    }
    requireValue(
      bytesWritten === totalBytes && filesWritten === totalFiles,
      "RESOURCE_EXPORT_INCOMPLETE",
    );
    await writeMarker("complete");
    emit("complete", true);
    return Object.freeze({
      status: "complete",
      directoryName,
      resourceFolder: directoryName,
      markerName: RESOURCE_EXPORT_MARKER,
      filesWritten,
      bytesWritten,
      totalBytes,
    });
  } catch (cause) {
    const cleanupCodes = [];
    if (activeWriter) {
      try {
        await activeWriter.abort();
      } catch {
        cleanupCodes.push("RESOURCE_WRITER_ABORT_FAILED");
      }
      activeWriter = undefined;
    }
    // Keep the incomplete marker until all payload files and child directories
    // have been removed. If cleanup fails it remains an explicit warning.
    for (const item of [...owned].reverse()) {
      if (item === folder || item === marker) continue;
      try {
        await removeOwned(item);
      } catch {
        cleanupCodes.push("RESOURCE_ENTRY_CLEANUP_FAILED");
      }
    }
    if (!cleanupCodes.length) {
      if (marker) {
        try {
          await removeOwned(marker);
          markerPresent = false;
        } catch {
          cleanupCodes.push("RESOURCE_MARKER_CLEANUP_FAILED");
        }
      }
      if (!cleanupCodes.length && folder) {
        try {
          await removeOwned(folder);
        } catch {
          cleanupCodes.push("RESOURCE_FOLDER_CLEANUP_FAILED");
        }
      }
    }
    throw new ResourceExportError(cause, {
      status: "incomplete",
      code: signal?.aborted ? "CANCELLED" : "RESOURCE_EXPORT_FAILED",
      directoryName,
      filesWritten,
      bytesWritten: bytesWritten.toString(),
      totalBytes: totalBytes.toString(),
      cleanupComplete: owned.every((item) => item.removed),
      incompleteMarkerPresent: markerPresent,
      cleanupCodes: Object.freeze([...new Set(cleanupCodes)]),
    });
  }
}
