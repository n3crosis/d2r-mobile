import {
  createExtractionWorkerClient,
  ExtractionClientError,
} from "./extraction-worker-client.mjs";
import { indexRomfs } from "./romfs-tree.mjs";
import { createCascLogicalAssets } from "./casc-logical-reader.mjs";
import { REQUIRED_NSO_MODULES } from "./preflight.mjs";
import { resolveD2rExpansionSelection } from "./d2r-expansion-policy.mjs";

export const EXTRACTION_ADAPTER_CAPABILITIES = Object.freeze({
  authenticatedSelection: true,
  lazyPlaintextReaders: true,
  requiresArchiveSecretLifetime: true,
  productionConversion: false,
  dlcExtraction: false,
  knownExpansionPackageRequired: true,
  offlineRuntimeProven: false,
});
const fail = (code) => {
  throw new ExtractionClientError(code);
};
const canonical = (value) =>
  JSON.stringify(value, (_, child) => {
    if (typeof child === "bigint") return `${child}n`;
    if (child && typeof child === "object" && !Array.isArray(child))
      return Object.fromEntries(
        Object.keys(child)
          .sort()
          .map((key) => [key, child[key]]),
      );
    return child;
  });
// Registration is private to completed authenticated extraction. A copied result,
// a caller boolean, or caller-supplied metadata can never create provenance.
const authenticatedPrograms = new WeakMap();
/** Trusted generator wiring injects this verifier; no extraction imports are
 * required in a separately sealed program runtime. Borrowed bytes MUST be copied
 * and verified against an exact trusted full-file digest before rewriting.
 */
export function readAuthenticatedProgramModules(extracted, selection, { signal } = {}) {
  if (signal?.aborted) fail("EXTRACTION_CANCELLED");
  try {
    const proof = authenticatedPrograms.get(extracted);
    if (!proof || proof.selection !== canonical(selection)) fail("EXTRACTION_PROVENANCE_REJECTED");
    proof.check();
    return proof.modules;
  } catch {
    fail("EXTRACTION_PROVENANCE_REJECTED");
  }
}

/** Only trusted application code supplies createWorker. Combine these three job
 * methods with independently trusted generators/output adapters, compose cleanup,
 * and explicitly runPackagingJob({secretLifetime:"archive", ...}).
 * No worker URL, real build allowlist, UI enablement or network fallback is provided.
 */
export function createExtractionJobAdapter({
  createWorker,
  maxProgramBytes = 32 * 1024 * 1024,
  timeoutMs,
  maxQueue,
} = {}) {
  if (
    typeof createWorker !== "function" ||
    !Number.isSafeInteger(maxProgramBytes) ||
    maxProgramBytes < 1 ||
    maxProgramBytes > 64 * 1024 * 1024
  )
    fail("EXTRACTION_ADAPTER_OPTIONS");
  const sessions = new WeakMap();
  const owned = [];
  let used = false,
    current,
    cleaned = false;
  function lookup(session) {
    const state = sessions.get(session);
    if (!state || state.closed || cleaned) fail("EXTRACTION_DISPOSED");
    return state;
  }
  async function cleanup() {
    cleaned = true;
    try {
      if (current) await current.dispose();
    } finally {
      for (const bytes of owned.splice(0)) bytes.fill(0);
    }
  }
  return Object.freeze({
    async openSecretSession({ inputs, signal } = {}) {
      if (used || cleaned) fail("EXTRACTION_SINGLE_USE");
      used = true;
      signal?.throwIfAborted();
      const client = createExtractionWorkerClient({ createWorker, timeoutMs, maxQueue });
      const state = { client, inspected: null, closed: false, extracted: false };
      const abort = () => {
        state.closed = true;
        state.inspected = null;
        client.close();
      };
      const session = Object.freeze({
        async dispose() {
          signal?.removeEventListener("abort", abort);
          if (state.closed) return;
          state.closed = true;
          state.inspected = null;
          try {
            await client.dispose();
          } finally {
            // Hard termination also revokes a worker stuck beyond its timeout.
            client.close();
          }
        },
      });
      current = session;
      sessions.set(session, state);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        state.inspected = await client.initialize(inputs, { signal });
        if (signal?.aborted) fail("EXTRACTION_CANCELLED");
        return session;
      } catch {
        await session.dispose();
        fail(signal?.aborted ? "EXTRACTION_CANCELLED" : "EXTRACTION_FAILED");
      }
    },
    async inspectContents({ session, signal } = {}) {
      signal?.throwIfAborted();
      const state = lookup(session);
      // Snapshot across the public coordinator boundary, not mutable cached records.
      return structuredClone(state.inspected);
    },
    async extractSelected({ session, selection, signal } = {}) {
      const state = lookup(session);
      try {
        signal?.throwIfAborted();
        if (
          state.extracted ||
          !selection ||
          !Array.isArray(selection.dlc) ||
          selection.dlc.length !== 1
        )
          fail("EXTRACTION_SELECTION_REJECTED");
        state.extracted = true;
        const options = {
          baseVersion: selection.base.version,
          patchVersion: selection.patch?.version,
          dlcVersions: Object.fromEntries(
            selection.dlc.map((row) => [row.titleId.toString(16).padStart(16, "0"), row.version]),
          ),
        };
        // Only retained boundary evidence may satisfy this local package gate.
        // Caller-supplied selection booleans, inventory or DLC objects are not proof.
        const authenticated = resolveD2rExpansionSelection(
          state.inspected.records,
          state.inspected.inventory,
          options,
        );
        const expectedSelection = canonical(authenticated);
        if (expectedSelection !== canonical(selection)) fail("EXTRACTION_SELECTION_MISMATCH");
        const selected = await state.client.select(options, { signal });
        if (canonical(selected.selection) !== expectedSelection)
          fail("EXTRACTION_SELECTION_MISMATCH");
        const names = new Set();
        const modules = new Map();
        for (let i = 0; i < selected.entries.length; i++) {
          const entry = selected.entries[i];
          if (
            !entry ||
            entry.index !== i ||
            typeof entry.name !== "string" ||
            names.has(entry.name) ||
            typeof entry.size !== "bigint" ||
            entry.size < 0n
          )
            fail("EXTRACTION_EXEFS_INVALID");
          names.add(entry.name);
          if (REQUIRED_NSO_MODULES.includes(entry.name)) modules.set(entry.name, entry);
        }
        if (modules.size !== REQUIRED_NSO_MODULES.length) fail("EXTRACTION_PROGRAM_MISSING");
        let total = 0n;
        for (const entry of modules.values()) {
          if (!entry.size) fail("EXTRACTION_PROGRAM_MISSING");
          total += entry.size;
        }
        if (total > BigInt(maxProgramBytes)) fail("EXTRACTION_PROGRAM_BUDGET");
        const programModules = Object.create(null);
        for (const name of REQUIRED_NSO_MODULES) {
          const entry = modules.get(name),
            bytes = new Uint8Array(Number(entry.size));
          owned.push(bytes);
          for (let offset = 0; offset < bytes.length; offset += 65536) {
            const part = await state.client.readExefs(
              {
                token: selected.token,
                index: entry.index,
                offset: BigInt(offset),
                count: Math.min(65536, bytes.length - offset),
              },
              { signal },
            );
            try {
              bytes.set(part, offset);
            } finally {
              part.fill(0);
            }
          }
          programModules[name] = bytes;
        }
        // This revokes the ExeFS generation; all required modules are staged first.
        const opened = await state.client.openRomfs(selected.token, { signal });
        const check = (readSignal) => {
          lookup(session);
          signal?.throwIfAborted();
          readSignal?.throwIfAborted();
        };
        const source = Object.freeze({
          size: opened.size,
          async readAt(offset, count, options = {}) {
            check(options.signal);
            if (
              typeof offset !== "bigint" ||
              offset < 0n ||
              offset > opened.size ||
              !Number.isInteger(count) ||
              count < 0 ||
              count > 65536 ||
              BigInt(count) > opened.size - offset
            )
              fail("EXTRACTION_READ_BOUNDS");
            const combined =
              signal && options.signal
                ? AbortSignal.any([signal, options.signal])
                : (signal ?? options.signal);
            const result = await state.client.readRomfs(
              { token: opened.token, offset, count },
              { signal: combined },
            );
            check(options.signal);
            return result;
          },
        });
        const indexed = await indexRomfs(source, { signal });

        // Expose bounded read-only capabilities, not metadata rows, tokens, key files,
        // raw source handles, sessions or the transport client.
        const romfs = Object.freeze({
          getFile(path) {
            check();
            const file = indexed.getFile(path);
            if (!file) return undefined;
            return Object.freeze({
              size: file.size,
              async readAt(offset, count, options) {
                check(options?.signal);
                const cancel = () => {
                  state.closed = true;
                  state.inspected = null;
                  state.client.close();
                };
                options?.signal?.addEventListener("abort", cancel, { once: true });
                try {
                  const bytes = await file.readAt(offset, count, options);
                  check(options?.signal);
                  return bytes;
                } finally {
                  options?.signal?.removeEventListener("abort", cancel);
                }
              },
            });
          },
        });
        const logical = await createCascLogicalAssets(romfs, { signal });
        const logicalAssets = Object.freeze({
          async read(path, options) {
            check(options?.signal);
            const bytes = await logical.read(path, options);
            check(options?.signal);
            return bytes;
          },
        });
        const extracted = Object.freeze({
          programModules: Object.freeze(programModules),
          romfs,
          logicalAssets,
        });
        authenticatedPrograms.set(extracted, {
          selection: canonical(selected.selection),
          modules: extracted.programModules,
          check: () => check(),
        });
        return extracted;
      } catch {
        try {
          await session.dispose();
        } catch {
          /* Preserve sanitized extraction failure. */
        }
        for (const bytes of owned.splice(0)) bytes.fill(0);
        fail(signal?.aborted ? "EXTRACTION_CANCELLED" : "EXTRACTION_FAILED");
      }
    },
    cleanup,
  });
}
