/** Browser-local, bounded input inspection only. No decryption or network access. */
export const NSP_INPUT_LIMITS = Object.freeze({
  directoryEntries: 4096,
  packages: 128,
  keyBytes: 1024 * 1024,
  keyLineBytes: 4096, // Includes RSA-sized dump entries, not only AES keys.
  entries: 65536,
  indexBytes: 16 * 1024 * 1024,
  filenameBytes: 255,
});

export class NspInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NspInputError";
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new NspInputError(code, message);
};
function safeName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    name !== "." &&
    name !== ".." &&
    !/[\\/:<>"|?*\p{C}]/u.test(name) &&
    !/[ .]$/u.test(name) &&
    name.normalize("NFC") === name &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
  );
}
function fileSize(file) {
  if (
    !file ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    typeof file.slice !== "function"
  ) {
    fail("FILE_SIZE", "File size is not safely representable.");
  }
  return BigInt(file.size);
}
async function readRange(file, start, length) {
  const end = start + BigInt(length);
  if (start < 0n || end > fileSize(file) || end > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("READ_RANGE", "Requested file range is invalid.");
  }
  try {
    const bytes = new Uint8Array(await file.slice(Number(start), Number(end)).arrayBuffer());
    if (bytes.length !== length) {
      bytes.fill(0);
      fail("SHORT_READ", "File data is truncated.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof NspInputError) throw error;
    fail("READ_FAILED", "Could not read the selected local file.");
  }
}
function finishDiscovery(records) {
  const prodKeys = records.get("prod.keys");
  const titleKeys = records.get("title.keys");
  const nsps = [...records.entries()]
    .filter(([name]) => name.endsWith(".nsp"))
    .map(([, file]) => file);
  if (!prodKeys || nsps.length === 0) {
    fail(
      "MISSING_INPUT",
      "Place prod.keys and at least one .nsp directly in the selected folder. title.keys is optional.",
    );
  }
  if (nsps.length > NSP_INPUT_LIMITS.packages)
    fail("PACKAGE_LIMIT", "Too many NSP files in the selected folder.");
  for (const file of [prodKeys, titleKeys].filter(Boolean)) {
    if (fileSize(file) > BigInt(NSP_INPUT_LIMITS.keyBytes))
      fail("KEY_SIZE", "A key file exceeds the size limit.");
  }
  return { prodKeys, titleKeys, nsps };
}
function addName(seen, name) {
  if (!safeName(name)) fail("UNSAFE_NAME", "The selected folder contains an unsafe entry name.");
  const folded = name.toLowerCase();
  if (seen.has(folded))
    fail("DUPLICATE_NAME", "The selected folder contains ambiguous duplicate names.");
  seen.add(folded);
  return folded;
}
/** Enumerates only root entries. Does not recurse or open unrelated files. */
export async function discoverNspFolder(directory, { signal, onProgress } = {}) {
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException("Folder check cancelled.", "AbortError");
  };
  checkAbort();
  if (directory?.kind !== "directory" || typeof directory.entries !== "function")
    fail("DIRECTORY", "Select a local folder.");
  const seen = new Set();
  const records = new Map();
  let count = 0;
  const progress = () => {
    try {
      onProgress?.({
        scannedEntries: count,
        nspCount: [...records.keys()].filter((name) => name.endsWith(".nsp")).length,
        prodKeysFound: records.has("prod.keys"),
        titleKeysFound: records.has("title.keys"),
      });
    } catch {
      /* Read-only progress observers must not change input validation. */
    }
  };
  progress();
  for await (const [name, handle] of directory.entries()) {
    checkAbort();
    if (++count > NSP_INPUT_LIMITS.directoryEntries)
      fail("DIRECTORY_LIMIT", "The selected folder has too many entries.");
    const folded = addName(seen, name);
    if (
      handle.kind === "file" &&
      (folded === "prod.keys" || folded === "title.keys" || folded.endsWith(".nsp"))
    ) {
      records.set(folded, await handle.getFile());
      checkAbort();
    }
    progress();
  }
  checkAbort();
  return finishDiscovery(records);
}
/** Fallback for input[webkitdirectory]. Browser may enumerate recursively before this call. */
export function discoverNspFiles(files) {
  const seen = new Set();
  const directories = new Set();
  const records = new Map();
  let root;
  let count = 0;
  for (const file of files) {
    if (++count > NSP_INPUT_LIMITS.directoryEntries)
      fail("DIRECTORY_LIMIT", "The selected folder has too many entries.");
    const parts = (file.webkitRelativePath || "").split("/");
    if (parts.length < 2 || parts.some((part) => !safeName(part)))
      fail("DIRECTORY", "Select one folder, not individual files.");
    if (root === undefined) root = parts[0];
    if (root !== parts[0]) fail("DIRECTORY", "Select exactly one folder.");
    if (parts.length !== 2) {
      if (!directories.has(parts[1])) {
        addName(seen, parts[1]);
        directories.add(parts[1]);
      }
      continue;
    }
    if (parts[1] !== file.name) fail("UNSAFE_NAME", "File name does not match its selected path.");
    const folded = addName(seen, file.name);
    if (folded === "prod.keys" || folded === "title.keys" || folded.endsWith(".nsp"))
      records.set(folded, file);
  }
  return finishDiscovery(records);
}

/** Validates a PFS0 index. Returned offsets and lengths are BigInt, relative to the NSP. */
export async function inspectNsp(file) {
  const size = fileSize(file);
  if (size < 16n) fail("PFS0_HEADER", "NSP header is truncated.");
  const head = await readRange(file, 0n, 16);
  const header = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (header.getUint32(0, true) !== 0x30534650)
    fail("PFS0_MAGIC", "NSP does not have a PFS0 header.");
  const count = header.getUint32(4, true);
  const stringsSize = header.getUint32(8, true);
  if (header.getUint32(12, true) !== 0)
    fail("PFS0_RESERVED", "Unsupported PFS0 reserved header value.");
  const dataOffset = 16n + BigInt(count) * 24n + BigInt(stringsSize);
  if (
    !count ||
    count > NSP_INPUT_LIMITS.entries ||
    dataOffset > BigInt(NSP_INPUT_LIMITS.indexBytes)
  ) {
    fail("PFS0_LIMIT", "NSP index exceeds supported bounds or is empty.");
  }
  if (dataOffset > size) fail("PFS0_TRUNCATED", "NSP index is truncated.");
  const index = await readRange(file, 16n, Number(dataOffset - 16n));
  const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
  const stringsStart = count * 24;
  const names = new Set();
  const entries = [];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for (let i = 0; i < count; i++) {
    const pos = i * 24;
    const relativeOffset = view.getBigUint64(pos, true);
    const length = view.getBigUint64(pos + 8, true);
    const nameOffset = view.getUint32(pos + 16, true);
    if (view.getUint32(pos + 20, true) !== 0)
      fail("PFS0_RESERVED", "Unsupported PFS0 reserved entry value.");
    if (
      nameOffset >= stringsSize ||
      (nameOffset > 0 && index[stringsStart + nameOffset - 1] !== 0)
    ) {
      fail("PFS0_NAME", "NSP filename offset is invalid.");
    }
    const start = stringsStart + nameOffset;
    let end = start;
    const limit = Math.min(index.length, start + NSP_INPUT_LIMITS.filenameBytes + 1);
    while (end < limit && index[end] !== 0) end++;
    if (end === limit || end === start)
      fail("PFS0_NAME", "NSP filename is empty, too long, or unterminated.");
    let name;
    try {
      name = decoder.decode(index.subarray(start, end));
    } catch {
      fail("PFS0_NAME", "NSP filename is not valid UTF-8.");
    }
    addName(names, name);
    const offset = dataOffset + relativeOffset;
    if (offset > size || length > size - offset)
      fail("PFS0_RANGE", "NSP entry extends beyond the file.");
    entries.push({ name, offset, size: length });
  }
  const occupied = entries
    .filter((entry) => entry.size > 0n)
    .sort((a, b) => (a.offset < b.offset ? -1 : a.offset > b.offset ? 1 : 0));
  for (let i = 1; i < occupied.length; i++) {
    if (occupied[i].offset < occupied[i - 1].offset + occupied[i - 1].size)
      fail("PFS0_OVERLAP", "NSP entries overlap.");
  }
  return { format: "PFS0", size, dataOffset, entries };
}

// Verified lengths only, not proof that a key is genuine or sufficient for any game.
function verifiedProdLength(name) {
  if (name === "header_key" || name === "header_key_source") return 32;
  if (
    /^(aes_kek_generation_source|aes_key_generation_source|key_area_key_(application|ocean|system)_source|titlekek_source|header_kek_source|master_key_source)$/u.test(
      name,
    )
  )
    return 16;
  const family =
    /^(master_key|master_kek|titlekek|key_area_key_application|key_area_key_ocean|key_area_key_system)_([0-9a-f]{2})$/u.exec(
      name,
    );
  return family && Number.parseInt(family[2], 16) < 32 ? 16 : null;
}
/** Parses ASCII key text for metadata only. Does not retain or return keys/rights IDs. */
export async function inspectKeyFile(file, kind) {
  if (kind !== "prod" && kind !== "title") fail("KEY_KIND", "Unsupported key-file kind.");
  const size = fileSize(file);
  if (size > BigInt(NSP_INPUT_LIMITS.keyBytes))
    fail("KEY_SIZE", "A key file exceeds the size limit.");
  const bytes = await readRange(file, 0n, Number(size));
  try {
    return inspectKeyBytes(bytes, kind);
  } finally {
    bytes.fill(0);
  }
}
/** Validate an owned key buffer inside the isolated Worker without another file read.
 * Returns metadata only; the caller MUST wipe bytes after native key loading.
 */
export function inspectKeyBytes(bytes, kind) {
  if (kind !== "prod" && kind !== "title") fail("KEY_KIND", "Unsupported key-file kind.");
  if (!(bytes instanceof Uint8Array) || bytes.length > NSP_INPUT_LIMITS.keyBytes)
    fail("KEY_SIZE", "A key file exceeds the size limit.");
  const seen = new Set();
  let entries = 0;
  let verifiedEntries = 0;
  let lineNumber = 0;
  const invalid = () => fail("KEY_LINE", `Invalid key-file line ${lineNumber}.`);
  try {
    let start = 0;
    for (let end = 0; end <= bytes.length; end++) {
      if (end !== bytes.length && bytes[end] !== 10) continue;
      lineNumber++;
      let stop = end;
      if (stop > start && bytes[stop - 1] === 13) stop--;
      if (stop - start > NSP_INPUT_LIMITS.keyLineBytes) invalid();
      let line = "";
      for (let i = start; i < stop; i++) {
        if ((bytes[i] < 32 && bytes[i] !== 9) || bytes[i] > 126) invalid();
        line += String.fromCharCode(bytes[i]);
      }
      start = end + 1;
      if (/^[ \t]*$/u.test(line)) continue;
      // Full-line comments are a deliberate frontend convenience, not hactool syntax.
      if (/^[ \t]*#/u.test(line)) continue;
      const match = /^[ \t]*([A-Za-z0-9_]+)[ \t]*[=,][ \t]*([0-9a-fA-F]+)[ \t]*$/u.exec(line);
      if (!match || match[2].length % 2 !== 0) invalid();
      const name = match[1].toLowerCase();
      if (seen.has(name)) invalid();
      seen.add(name);
      let length;
      if (kind === "title") {
        if (!/^[0-9a-f]{32}$/u.test(name)) invalid();
        length = 16;
      } else length = verifiedProdLength(name);
      if (length !== null && match[2].length !== length * 2) invalid();
      entries++;
      if (length !== null) verifiedEntries++;
    }
    if (kind === "prod" && entries === 0)
      fail("KEY_EMPTY", "The production key file has no entries.");
    return {
      kind,
      entries,
      verifiedEntries,
      unknownEntries: entries - verifiedEntries,
      usableForDecryption: false,
    };
  } finally {
    seen.clear();
  }
}

/** Accepts a directory handle or webkitdirectory FileList. Retains no file handles in its result. */
export async function preflightNspFolder(input) {
  const files =
    input?.kind === "directory" ? await discoverNspFolder(input) : discoverNspFiles(input);
  const prodKeys = await inspectKeyFile(files.prodKeys, "prod");
  const titleKeys = files.titleKeys
    ? await inspectKeyFile(files.titleKeys, "title")
    : inspectKeyBytes(new Uint8Array(), "title");
  const packages = [];
  for (const file of files.nsps) packages.push({ name: file.name, ...(await inspectNsp(file)) });
  return { packages, prodKeys, titleKeys, stage: "metadata-only", canBuildIpa: false };
}
