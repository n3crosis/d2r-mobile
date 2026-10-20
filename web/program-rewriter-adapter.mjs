import { buildGuestFramework, guestInfoPlist, planGuestFramework } from "./guest-framework.mjs";

export const PROGRAM_REWRITER_CAPABILITIES = Object.freeze({
  syntheticRewriteToGuest: true,
  productionProgramGeneration: false,
  realVersionCatalog: false,
});
export const PROGRAM_REWRITER_SOURCE =
  "d0bee134202bcc7c976c2713ffec2881f77b43bbfc24f4ebde17f0886c3dc22e";
const REQUIRED_FILES = [
  "build_src.sha256",
  "main.patched.bin",
  "main.fixups.tsv",
  "main.gates.tsv",
  "main.sites.tsv",
  "main.cuts.tsv",
  "main.params.tsv",
  "main.obs.tsv",
].sort();
const MAX_BYTES = 1024 * 1024;
const SHA = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export class ProgramAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProgramAdapterError";
    this.code = code;
  }
}
const fail = (code) => {
  throw new ProgramAdapterError(code);
};
const check = (signal) => {
  if (signal?.aborted) fail("PROGRAM_CANCELLED");
};
const sha256 = async (bytes) =>
  Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
function snapshot(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.byteLength ||
    bytes.byteLength > MAX_BYTES ||
    (globalThis.SharedArrayBuffer && bytes.buffer instanceof globalThis.SharedArrayBuffer)
  )
    fail("PROGRAM_INVALID_BYTES");
  return bytes.slice();
}
function catalogFor(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.scope !== "synthetic-only" ||
    value.sourceSha256 !== PROGRAM_REWRITER_SOURCE ||
    !Array.isArray(value.versions) ||
    !value.versions.length ||
    value.versions.length > 3
  )
    fail("PROGRAM_TRUSTED_CATALOG_REQUIRED");
  const catalog = new Map();
  for (const entry of value.versions) {
    if (
      !entry ||
      !["gates", "x18", "compressed"].includes(entry.id) ||
      catalog.has(entry.id) ||
      entry.buildId !== "534e5448455449430000000000000000" ||
      entry.ruleset !== "native" ||
      !SHA.test(entry.inputSha256) ||
      !SHA.test(entry.guestSha256) ||
      !SHA.test(entry.plistSha256) ||
      !entry.files ||
      JSON.stringify(Object.keys(entry.files).sort()) !== JSON.stringify(REQUIRED_FILES) ||
      Object.values(entry.files).some((hash) => !SHA.test(hash))
    )
      fail("PROGRAM_INVALID_TRUSTED_VERSION");
    catalog.set(entry.id, Object.freeze({ ...entry, files: Object.freeze({ ...entry.files }) }));
  }
  return catalog;
}
function layout(bytes, imageSize) {
  const values = Object.create(null);
  for (const line of decoder.decode(bytes).trim().split("\n")) {
    const match = /^# ([A-Z0-9_]+)\t(0x[0-9a-f]+|[0-9]+)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) fail("PROGRAM_INVALID_FIXUPS");
    values[match[1]] = Number(match[2]);
  }
  for (const key of [
    "TEXT_END",
    "PATCH_OFF",
    "KEY_PAGE_OFF",
    "KEY_PAGE_SIZE",
    "RO_OFF",
    "DATA_OFF",
  ])
    if (!Number.isSafeInteger(values[key]) || values[key] < 0 || values[key] > imageSize)
      fail("PROGRAM_INVALID_FIXUPS");
  if (
    !values.TEXT_END ||
    values.TEXT_END % 4 ||
    values.PATCH_OFF % 65536 ||
    values.KEY_PAGE_OFF % 16384 ||
    values.KEY_PAGE_SIZE !== 16384 ||
    values.KEY_PAGE_OFF + values.KEY_PAGE_SIZE > values.PATCH_OFF ||
    values.TEXT_END > values.RO_OFF ||
    values.RO_OFF > values.DATA_OFF ||
    values.DATA_OFF > values.KEY_PAGE_OFF
  )
    fail("PROGRAM_INVALID_FIXUPS");
  return { textEnd: values.TEXT_END, patchOff: values.PATCH_OFF };
}
/**
 * Trusted application wiring, not a real-game implementation. Catalog must come
 * from a separately trusted CI/release registry, NEVER extracted content or UI.
 * resolveInput(extracted, selection) -> {versionId, bytes}. createWorker() must
 * return {run({bytes,caseName}): Promise<worker response>, close()}.
 * The original worker's exact synthetic fixture gate remains mandatory.
 */
export function createProgramRewriterAdapter({ trustedCatalog, resolveInput, createWorker } = {}) {
  const versions = catalogFor(trustedCatalog);
  if (typeof resolveInput !== "function" || typeof createWorker !== "function")
    fail("PROGRAM_RUNTIME_REQUIRED");
  let used = false,
    disposed = false,
    activeWorker,
    rejectActive;
  const owned = [];
  const own = (bytes) => {
    owned.push(bytes);
    return bytes;
  };
  const wipe = () => {
    for (const bytes of owned) bytes.fill(0);
    owned.length = 0;
  };
  function close() {
    const worker = activeWorker;
    activeWorker = undefined;
    worker?.close();
  }
  async function dispose() {
    disposed = true;
    rejectActive?.(new ProgramAdapterError("PROGRAM_DISPOSED"));
    try {
      close();
    } finally {
      wipe();
    }
  }
  async function generateProgram({ extracted, selection, signal } = {}) {
    check(signal);
    if (used || disposed) fail("PROGRAM_SINGLE_USE");
    used = true;
    let abort;
    const interrupted = new Promise((_, reject) => {
      rejectActive = reject;
      abort = () => {
        try {
          close();
        } catch {
          /* Cancellation still rejects without exposing worker details. */
        }
        reject(new ProgramAdapterError("PROGRAM_CANCELLED"));
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
    const race = (action) => Promise.race([Promise.resolve().then(action), interrupted]);
    try {
      const input = await race(() =>
        resolveInput(extracted, selection, { signal, maxBytes: MAX_BYTES }),
      );
      check(signal);
      const version = versions.get(input?.versionId);
      if (!version) fail("PROGRAM_UNSUPPORTED_VERSION");
      const bytes = own(snapshot(input.bytes));
      if ((await race(() => sha256(bytes))) !== version.inputSha256)
        fail("PROGRAM_INPUT_DIGEST_MISMATCH");
      if (
        Array.from(bytes.subarray(0x40, 0x50), (x) => x.toString(16).padStart(2, "0")).join("") !==
        version.buildId
      )
        fail("PROGRAM_BUILD_ID_MISMATCH");
      check(signal);
      activeWorker = createWorker();
      if (
        !activeWorker ||
        typeof activeWorker.run !== "function" ||
        typeof activeWorker.close !== "function"
      )
        fail("PROGRAM_RUNTIME_REQUIRED");
      const result = await race(() => activeWorker.run({ bytes, caseName: version.id }));
      check(signal);
      if (
        !result?.ok ||
        result.status !== "synthetic-only" ||
        !result.files ||
        JSON.stringify(Object.keys(result.files).sort()) !== JSON.stringify(REQUIRED_FILES)
      )
        fail("PROGRAM_REWRITE_REJECTED");
      const files = Object.create(null);
      let total = 0;
      for (const name of REQUIRED_FILES) {
        const value = result.files[name];
        // Empty gate/site lists are legitimate, but no other non-byte values are.
        if (
          !(value instanceof Uint8Array) ||
          value.byteLength > MAX_BYTES ||
          (globalThis.SharedArrayBuffer && value.buffer instanceof globalThis.SharedArrayBuffer)
        )
          fail("PROGRAM_INVALID_OUTPUT");
        total += value.byteLength;
        if (total > MAX_BYTES) fail("PROGRAM_OUTPUT_BUDGET");
        files[name] = own(value.slice());
        if ((await race(() => sha256(files[name]))) !== version.files[name])
          fail("PROGRAM_OUTPUT_DIGEST_MISMATCH");
        check(signal);
      }
      if (
        decoder.decode(files["build_src.sha256"]) !== `${PROGRAM_REWRITER_SOURCE}  patch_nso.py\n`
      )
        fail("PROGRAM_SOURCE_MISMATCH");
      const module = {
        name: "main",
        image: files["main.patched.bin"],
        ...layout(files["main.fixups.tsv"], files["main.patched.bin"].length),
      };
      const plan = planGuestFramework([module]);
      const guest = own(await race(() => buildGuestFramework([module], { signal })));
      const plist = own(encoder.encode(guestInfoPlist()));
      if (
        (await race(() => sha256(guest))) !== version.guestSha256 ||
        (await race(() => sha256(plist))) !== version.plistSha256
      )
        fail("PROGRAM_GUEST_DIGEST_MISMATCH");
      check(signal);
      close();
      const entry = (path, data, mode = 0o644, signature) => ({
        path,
        size: data.length,
        mode,
        ...(signature ? { signature } : {}),
        async *chunks() {
          if (disposed) fail("PROGRAM_DISPOSED");
          for (let at = 0; at < data.length; at += 65536) {
            check(signal);
            if (disposed) fail("PROGRAM_DISPOSED");
            yield data.slice(at, at + 65536);
          }
        },
      });
      return [
        entry("Frameworks/Guest.framework/Guest", guest, 0o755, {
          kind: "ad-hoc",
          offset: plan.signatureOffset,
          size: plan.signatureSize,
        }),
        entry("Frameworks/Guest.framework/Info.plist", plist),
        ...["main.fixups.tsv", "main.gates.tsv", "main.cuts.tsv"].map((name) =>
          entry(`dm/${name}`, files[name]),
        ),
      ];
    } catch (error) {
      wipe();
      if (error instanceof ProgramAdapterError) throw error;
      fail("PROGRAM_GENERATION_FAILED");
    } finally {
      rejectActive = undefined;
      signal?.removeEventListener("abort", abort);
      try {
        close();
      } catch {
        wipe();
        fail("PROGRAM_WORKER_CLEANUP_FAILED");
      }
    }
  }
  return Object.freeze({ capabilities: PROGRAM_REWRITER_CAPABILITIES, generateProgram, dispose });
}
