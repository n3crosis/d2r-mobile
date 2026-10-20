import { fileSource, readRange } from "./preflight.mjs";
import { planStagedZip, validateStagedZip, STAGED_ZIP_LIMITS } from "./staged-zip-validator.mjs";

const error = (code) => new Error(code);
const assert = (value, code) => {
  if (!value) throw error(code);
};
const sameManifest = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snapshot = (manifest) => manifest.map(({ path, size, mode }) => ({ path, size, mode }));

/**
 * Local-only OPFS staging adapter. The caller obtains destinationHandle from a
 * user gesture and grants readwrite permission BEFORE creating the output. This
 * module never prompts, uploads, chooses a destination, or touches input handles.
 * A unique temporary OPFS file is the only entry it may remove. No scavenging or
 * global storage clearing. Crashes can leave that file; never delete unknown files.
 *
 * Match archiveFormat/maxOutputBytes to runPackagingJob options. Budget covers
 * ALL bytes, including metadata. Quota estimates are advisory; disk/full errors
 * still fail closed. User destination disk space is not exposed by browser APIs.
 * Two local copies may coexist during transfer. No whole-archive Blob/ArrayBuffer.
 */
export function createBrowserStagedOutputAdapters({
  destinationHandle,
  archiveFormat,
  maxOutputBytes,
  quotaReserveBytes = 16 * 1024 * 1024,
  storage = globalThis.navigator?.storage,
  secureContext = globalThis.isSecureContext,
  randomUUID = () => globalThis.crypto.randomUUID(),
} = {}) {
  assert(
    Number.isSafeInteger(quotaReserveBytes) && quotaReserveBytes >= 0,
    "OUTPUT_INVALID_RESERVE",
  );
  const owned = new WeakMap();
  return {
    async createOutput({ manifest, signal: callerSignal }) {
      const cancellation = new AbortController();
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, cancellation.signal])
        : cancellation.signal;
      signal.throwIfAborted();
      const captured = snapshot(manifest);
      const plan = planStagedZip(captured, { archiveFormat, maxOutputBytes });
      assert(
        secureContext === true &&
          typeof storage?.getDirectory === "function" &&
          typeof storage?.estimate === "function",
        "OUTPUT_OPFS_UNAVAILABLE",
      );
      assert(
        destinationHandle?.kind === "file" &&
          typeof destinationHandle.createWritable === "function" &&
          typeof destinationHandle.queryPermission === "function",
        "OUTPUT_DESTINATION_UNAVAILABLE",
      );
      assert(
        (await destinationHandle.queryPermission({ mode: "readwrite" })) === "granted",
        "OUTPUT_DESTINATION_PERMISSION_REQUIRED",
      );
      signal?.throwIfAborted();
      const estimate = await storage.estimate();
      assert(
        Number.isFinite(estimate.quota) &&
          Number.isFinite(estimate.usage) &&
          estimate.quota >= 0 &&
          estimate.usage >= 0 &&
          estimate.quota - estimate.usage >= plan.totalBytes + quotaReserveBytes,
        "OUTPUT_INSUFFICIENT_QUOTA",
      );
      const root = await storage.getDirectory();
      signal?.throwIfAborted();
      const uuid = randomUUID();
      assert(
        typeof uuid === "string" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(uuid),
        "OUTPUT_RANDOM_ID_UNAVAILABLE",
      );
      const name = `d2rm-output-${uuid}.tmp`;
      // OPFS has no exclusive-create primitive. A cryptographic UUID plus an
      // existence check avoids reusing existing entries; same-origin scripts
      // remain trusted, as they can modify any OPFS file independently.
      try {
        await root.getFileHandle(name);
        throw error("OUTPUT_TEMP_COLLISION");
      } catch (cause) {
        if (cause?.name !== "NotFoundError") throw cause;
      }
      signal?.throwIfAborted();
      let stageHandle, stageWriter, destinationWriter, pending;
      let state = "opening",
        bytesWritten = 0,
        removed = false;
      const remove = async () => {
        if (!stageHandle || removed) return;
        try {
          await root.removeEntry(name);
        } catch (cause) {
          if (cause?.name !== "NotFoundError") throw cause;
        }
        removed = true;
      };
      const release = async () => {
        const failures = [];
        for (const stream of [stageWriter, destinationWriter]) {
          if (stream) {
            try {
              await stream.abort();
            } catch (cause) {
              failures.push(cause);
            }
          }
        }
        stageWriter = destinationWriter = undefined;
        try {
          await remove();
        } catch (cause) {
          failures.push(cause);
        }
        if (failures.length) throw error("OUTPUT_CLEANUP_FAILED");
      };
      const run = async (operation) => {
        assert(!pending, "OUTPUT_CONCURRENT_OPERATION");
        const promise = operation();
        pending = promise;
        try {
          return await promise;
        } finally {
          pending = undefined;
        }
      };
      try {
        stageHandle = await root.getFileHandle(name, { create: true });
        signal?.throwIfAborted();
        stageWriter = await stageHandle.createWritable({ keepExistingData: false });
        signal?.throwIfAborted();
        state = "writing";
      } catch (cause) {
        try {
          await release();
        } catch {
          /* Preserve failure; no final destination was opened. */
        }
        throw cause;
      }
      const output = Object.freeze({
        write(bytes) {
          return run(async () => {
            assert(state === "writing", "OUTPUT_NOT_WRITABLE");
            signal?.throwIfAborted();
            assert(
              bytes instanceof Uint8Array && bytes.byteLength <= STAGED_ZIP_LIMITS.maxChunkBytes,
              "OUTPUT_INVALID_CHUNK",
            );
            assert(bytes.byteLength <= plan.totalBytes - bytesWritten, "OUTPUT_BYTE_LIMIT");
            await stageWriter.write(bytes);
            bytesWritten += bytes.byteLength;
            signal?.throwIfAborted();
          });
        },
        close() {
          return run(async () => {
            assert(state === "validated", "OUTPUT_NOT_VALIDATED");
            signal?.throwIfAborted();
            state = "transferring";
            try {
              destinationWriter = await destinationHandle.createWritable({
                keepExistingData: false,
              });
              signal?.throwIfAborted();
              const source = fileSource(await stageHandle.getFile());
              assert(source.size === plan.totalBytes, "OUTPUT_STAGE_CHANGED");
              // Revalidate the snapshot actually being copied. It cannot be
              // silently replaced between initial validation and final transfer.
              await validateStagedZip(source, captured, { archiveFormat, maxOutputBytes, signal });
              for (let offset = 0; offset < source.size; ) {
                const length = Math.min(STAGED_ZIP_LIMITS.maxChunkBytes, source.size - offset);
                const bytes = await readRange(source, offset, length, signal);
                await destinationWriter.write(bytes);
                offset += length;
                signal?.throwIfAborted();
              }
              // Cleanup failures happen before the irreversible commit boundary.
              await remove();
              signal?.throwIfAborted();
              await destinationWriter.close();
              destinationWriter = undefined;
              state = "committed"; // No post-close cancellation check.
            } catch (cause) {
              state = "failed";
              try {
                await release();
              } catch {
                /* abort() can retry owned-entry removal. */
              }
              throw cause;
            }
          });
        },
        async abort() {
          cancellation.abort();
          // Drain an in-flight browser operation before disposing its resources.
          if (pending) {
            try {
              await pending;
            } catch {
              /* Preserve caller error. */
            }
          }
          if (state === "committed" || state === "aborted") return;
          state = "failed";
          await release();
          state = "aborted";
        },
      });
      owned.set(output, {
        async validate(nextManifest, nextSignal) {
          return run(async () => {
            assert(
              state === "writing" && sameManifest(captured, snapshot(nextManifest)),
              "OUTPUT_MANIFEST_MISMATCH",
            );
            signal?.throwIfAborted();
            nextSignal?.throwIfAborted();
            assert(bytesWritten === plan.totalBytes, "OUTPUT_SHORT_ARCHIVE");
            state = "validating";
            await stageWriter.close();
            stageWriter = undefined;
            const source = fileSource(await stageHandle.getFile());
            const validationSignal = nextSignal ? AbortSignal.any([signal, nextSignal]) : signal;
            const result = await validateStagedZip(source, captured, {
              archiveFormat,
              maxOutputBytes,
              signal: validationSignal,
            });
            nextSignal?.throwIfAborted();
            state = "validated";
            return result;
          });
        },
      });
      return output;
    },
    async validateArchive({ output, manifest, signal }) {
      const owner = owned.get(output);
      assert(owner, "OUTPUT_NOT_OWNED");
      return owner.validate(manifest, signal);
    },
  };
}
