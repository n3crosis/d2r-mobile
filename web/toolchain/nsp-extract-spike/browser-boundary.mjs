// Must run in a fresh dedicated Worker. This is a metadata-first bridge, not
// the application's production NSP input validator or an IPA builder.
const MAX_KEYS = 1024 * 1024;
const CHUNK = 64 * 1024;
const messages = new Map([
  [-1, "Extractor state or input is invalid"],
  [-2, "Container metadata exceeds supported bounds"],
  [-3, "Required key or content integrity verification failed"],
  [-4, "This content format is not supported by the metadata boundary"],
  [-5, "Local file read failed"],
]);
const check = (result) => {
  if (result < 0) throw new Error(messages.get(result) || "Extraction failed");
  return result;
};
export async function createBoundary(factory) {
  if (typeof FileReaderSync === "undefined")
    throw new Error("A dedicated browser Worker is required");
  // Suppress even runtime diagnostics; exceptions never expose upstream text.
  const module = await factory({ print() {}, printErr() {}, onAbort() {} });
  module.FS.mkdir("/input");
  module.FS.mkdir("/secret");
  let mounted = false,
    disposed = false,
    generation = 0;
  const guard = (fn) => {
    if (disposed) throw new Error("Extractor has been disposed");
    try {
      return fn();
    } catch {
      throw new Error("Local extraction operation failed");
    }
  };
  const wipeFile = (path) => {
    try {
      const node = module.FS.lookupPath(path).node;
      if (node.contents?.fill) node.contents.fill(0);
      module.FS.unlink(path);
    } catch {
      /* File may not have been created. Never log parser state. */
    }
  };
  const withBuffer = (size, fn) => {
    const ptr = module._malloc(size);
    if (!ptr) throw new Error("Extractor memory limit reached");
    try {
      return fn(ptr);
    } finally {
      module._nsp_zero(ptr, size);
      module._free(ptr);
    }
  };
  const path = (index) => {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error("Invalid input index");
    return `/input/input-${index}`;
  };
  return {
    mount(blobs) {
      return guard(() => {
        generation++;
        module._nsp_close();
        if (mounted) module.FS.unmount("/input");
        if (
          !Array.isArray(blobs) ||
          blobs.length > 100000 ||
          blobs.some((blob) => !(blob instanceof Blob))
        )
          throw new Error("Invalid local input");
        module.FS.mount(
          module.WORKERFS,
          { blobs: blobs.map((data, i) => ({ name: `input-${i}`, data })) },
          "/input",
        );
        mounted = true;
      });
    },
    loadKeys(prod, title) {
      // Take mutable arrays, not immutable decoded key strings. Caller transfers
      // ArrayBuffers into this Worker; both arrays are wiped in every path.
      try {
        return guard(() => {
          if (
            !(prod instanceof Uint8Array) ||
            !(title instanceof Uint8Array) ||
            prod.length > MAX_KEYS ||
            title.length > MAX_KEYS ||
            !prod.length ||
            !title.length
          )
            throw new Error("Invalid key input");
          generation++;
          module.FS.writeFile("/secret/prod.keys", prod);
          module.FS.writeFile("/secret/title.keys", title);
          return check(module._nsp_load_keys());
        });
      } finally {
        prod?.fill?.(0);
        title?.fill?.(0);
        wipeFile("/secret/prod.keys");
        wipeFile("/secret/title.keys");
      }
    },
    inspect(index) {
      return guard(() =>
        withBuffer(24, (ptr) => {
          generation++;
          check(
            module.ccall("nsp_inspect_nca", "number", ["string", "number"], [path(index), ptr]),
          );
          const view = new DataView(module.HEAPU8.buffer, ptr, 24);
          return {
            applicationId: view.getBigUint64(0, true).toString(16).padStart(16, "0"),
            size: view.getBigUint64(8, true),
            contentType: view.getUint32(16, true),
            fixedSignatureValid: view.getUint32(20, true) === 1,
          };
        }),
      );
    },
    open(index, kind = "meta") {
      return guard(() => {
        generation++;
        const operation =
          kind === "meta"
            ? "nsp_open_meta"
            : kind === "program-exefs"
              ? "nsp_open_exefs"
              : kind === "synthetic-pfs0"
                ? "nsp_open_pfs0"
                : null;
        if (!operation) throw new Error("Unsupported operation");
        check(module.ccall(operation, "number", ["string"], [path(index)]));
        return check(module._nsp_entry_count());
      });
    },
    // Reader lifetime is bound to this exact authenticated NCA. A later open,
    // inspect, key load, mount or input hash invalidates it even if that fails.
    openPatchedRomfs(baseIndex, patchIndex) {
      if (!Number.isSafeInteger(patchIndex) || patchIndex < 0)
        throw new Error("Invalid patch index");
      return this.openRomfs(baseIndex, patchIndex);
    },
    openRomfs(index, patchIndex) {
      return guard(() => {
        const current = ++generation;
        const size = withBuffer(8, (ptr) => {
          check(
            patchIndex === undefined
              ? module.ccall("nsp_open_romfs", "number", ["string", "number"], [path(index), ptr])
              : module.ccall(
                  "nsp_open_patched_romfs",
                  "number",
                  ["string", "string", "number"],
                  [path(index), path(patchIndex), ptr],
                ),
          );
          return new DataView(module.HEAPU8.buffer, ptr, 8).getBigUint64(0, true);
        });
        return Object.freeze({
          size,
          readAt(offset, count) {
            return guard(() => {
              if (current !== generation) throw new Error("RomFS reader expired");
              if (
                typeof offset !== "bigint" ||
                offset < 0n ||
                offset > size ||
                !Number.isInteger(count) ||
                count < 0 ||
                count > CHUNK ||
                BigInt(count) > size - offset
              )
                throw new Error("Invalid bounded read");
              return withBuffer(Math.max(count, 1), (ptr) => {
                const length = check(
                  module._nsp_read_romfs(
                    Number(offset & 0xffffffffn),
                    Number(offset >> 32n),
                    ptr,
                    count,
                  ),
                );
                return module.HEAPU8.slice(ptr, ptr + length);
              });
            });
          },
        });
      });
    },
    // Whole-NCA input digest is independent of header/CNMT declarations.
    // Hashing an input closes the current member directory; reopen afterward.
    hashInput(index) {
      return guard(() =>
        withBuffer(32, (ptr) => {
          generation++;
          check(module.ccall("nsp_hash_input", "number", ["string", "number"], [path(index), ptr]));
          return Array.from(module.HEAPU8.subarray(ptr, ptr + 32), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
        }),
      );
    },
    hashEntry(index) {
      if (!Number.isInteger(index) || index < 0 || index > 0xffffffff)
        throw new Error("Invalid entry index");
      return guard(() =>
        withBuffer(32, (ptr) => {
          check(module._nsp_hash_entry(index, ptr));
          return Array.from(module.HEAPU8.subarray(ptr, ptr + 32), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
        }),
      );
    },
    entry(index) {
      if (!Number.isInteger(index) || index < 0 || index > 0xffffffff)
        throw new Error("Invalid entry index");
      return guard(() =>
        withBuffer(4096, (ptr) => {
          const length = check(module._nsp_entry_info(index, ptr, 4096));
          const view = new DataView(module.HEAPU8.buffer, ptr, length);
          const name = new TextDecoder("utf-8", { fatal: true }).decode(
            module.HEAPU8.subarray(ptr + 16, ptr + length - 1),
          );
          return { name, size: view.getBigUint64(8, true), offset: view.getBigUint64(0, true) };
        }),
      );
    },
    read(index, offset, count) {
      if (!Number.isInteger(index) || index < 0 || index > 0xffffffff)
        throw new Error("Invalid entry index");
      return guard(() => {
        if (
          typeof offset !== "bigint" ||
          offset < 0n ||
          offset > 0xffffffffffffffffn ||
          !Number.isInteger(count) ||
          count < 0 ||
          count > CHUNK
        )
          throw new Error("Invalid bounded read");
        return withBuffer(Math.max(count, 1), (ptr) => {
          const size = check(
            module._nsp_read_entry(
              index,
              Number(offset & 0xffffffffn),
              Number(offset >> 32n),
              ptr,
              count,
            ),
          );
          return module.HEAPU8.slice(ptr, ptr + size);
        });
      });
    },
    async streamEntry(index, sink, signal) {
      const { size } = this.entry(index);
      for (let offset = 0n; offset < size; ) {
        if (signal?.aborted) throw new Error("Extraction cancelled");
        const count = Number(size - offset > BigInt(CHUNK) ? BigInt(CHUNK) : size - offset);
        const bytes = this.read(index, offset, count);
        try {
          await sink(bytes);
        } finally {
          bytes.fill(0);
        }
        offset += BigInt(count);
      }
    },
    cryptoFixture() {
      return guard(() => check(module._nsp_crypto_fixture()));
    },
    bktrFixture() {
      return guard(() => check(module._nsp_bktr_fixture()));
    },
    ivfcFixture() {
      return guard(() => check(module._nsp_ivfc_fixture()));
    },
    secretFilesPresent() {
      return module.FS.readdir("/secret").some((name) => name !== "." && name !== "..");
    },
    dispose() {
      if (disposed) return;
      try {
        module._nsp_reset();
      } finally {
        wipeFile("/secret/prod.keys");
        wipeFile("/secret/title.keys");
        if (mounted) module.FS.unmount("/input");
        // After native teardown, erase the owned linear-memory view. The owner
        // must terminate this one-shot Worker next; do not call C again.
        module.HEAPU8.fill(0);
        disposed = true;
      }
    },
  };
}
