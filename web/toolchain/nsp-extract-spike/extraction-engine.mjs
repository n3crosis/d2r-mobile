import {
  inspectNsp,
  inspectKeyBytes,
  normalizeProdKeyBytes,
  NSP_INPUT_LIMITS,
} from "../../nsp-input.mjs";
import { extractionDiagnosticError } from "../../extraction-errors.mjs";
import { parseCnmt } from "../../content-selection.mjs";
import { resolveD2rExpansionSelection } from "../../d2r-expansion-policy.mjs";
const CHUNK = 65536,
  META_LIMIT = 16 * 1024 * 1024,
  MAX_CONTENTS = 4096;
const TICKET_MIN_SIZE = 0x2b0;
const HEX = "0123456789abcdef";
function ticketKeyLine(bytes) {
  if (
    bytes.length !== TICKET_MIN_SIZE ||
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) !== 0x10004 ||
    bytes[0x281] !== 0
  )
    diagnostic("PACKAGE_INDEX_INVALID");
  const id = bytes.subarray(0x2a0, 0x2b0);
  const key = bytes.subarray(0x180, 0x190);
  if (id.every((byte) => byte === 0) || key.every((byte) => byte === 0))
    diagnostic("PACKAGE_INDEX_INVALID");
  const line = new Uint8Array(68);
  const writeHex = (source, at) => {
    for (const byte of source) {
      line[at++] = HEX.charCodeAt(byte >>> 4);
      line[at++] = HEX.charCodeAt(byte & 15);
    }
  };
  writeHex(id, 0);
  line.set([32, 61, 32], 32);
  writeHex(key, 35);
  line[67] = 10;
  return line;
}
function containsTitleId(bytes, id) {
  for (let start = 0; start < bytes.length;) {
    let end = bytes.indexOf(10, start);
    if (end < 0) end = bytes.length;
    let at = start;
    while (at < end && (bytes[at] === 32 || bytes[at] === 9)) at++;
    if (end - at >= 32) {
      let same = true;
      for (let i = 0; i < 32; i++) {
        const c = bytes[at + i];
        if ((c >= 65 && c <= 70 ? c + 32 : c) !== id[i]) same = false;
      }
      if (same) return true;
    }
    start = end + 1;
  }
  return false;
}
function mergeTicketKeys(title, tickets) {
  const additional = [...tickets.values()].filter((line) => !containsTitleId(title, line));
  if (!additional.length) return title;
  const separator = title.length && title[title.length - 1] !== 10 ? 1 : 0;
  const size = title.length + separator + additional.length * 68;
  if (size > NSP_INPUT_LIMITS.keyBytes) diagnostic("TITLE_KEYS_TOO_LARGE");
  const merged = new Uint8Array(size);
  merged.set(title);
  if (separator) merged[title.length] = 10;
  let at = title.length + separator;
  for (const line of additional) {
    merged.set(line, at);
    at += line.length;
  }
  title.fill(0);
  return merged;
}
const fail = () => {
  throw new Error("EXTRACTION_REQUEST_REJECTED");
};
const diagnostic = (code) => {
  throw extractionDiagnosticError(code);
};
const checked = (code, operation) => {
  try {
    return operation();
  } catch (error) {
    diagnostic(error?.code === "TITLE_KEY_REQUIRED" ? "TITLE_KEY_REQUIRED" : code);
  }
};
async function readKeys(file, kind) {
  if (kind === "title" && file == null) return new Uint8Array();
  const prefix = kind === "prod" ? "PROD_KEYS" : "TITLE_KEYS";
  if (!(file instanceof Blob)) diagnostic(`${prefix}_MISSING`);
  if (file.size > NSP_INPUT_LIMITS.keyBytes) diagnostic(`${prefix}_TOO_LARGE`);
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size) diagnostic(`${prefix}_UNREADABLE`);
  } catch {
    bytes?.fill(0);
    diagnostic(`${prefix}_UNREADABLE`);
  }
  try {
    if (kind === "prod") bytes = normalizeProdKeyBytes(bytes);
    else inspectKeyBytes(bytes, kind);
    return bytes;
  } catch (error) {
    bytes.fill(0);
    diagnostic(error?.code === "KEY_EMPTY" ? "PROD_KEYS_EMPTY" : `${prefix}_MALFORMED`);
  }
}
const bounded = (offset, count, size) => {
  if (
    typeof offset !== "bigint" ||
    offset < 0n ||
    offset > size ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > CHUNK ||
    BigInt(count) > size - offset
  )
    fail();
};
function fields(value, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail();
}
/** Dedicated-Worker engine. Native boundary is a trusted capability, never RPC input.
 * Only read capabilities leave this object. Real-content coverage remains unproven. */
export function createExtractionEngine(
  boundary,
  { newToken = () => crypto.randomUUID(), onProgress = () => {} } = {},
) {
  const progress = (stage, completed = 0, total = 0, bytes = 0) => {
    try {
      onProgress(Object.freeze({ stage, completed, total, bytes }));
    } catch {
      // Diagnostics cannot change the extraction result.
    }
  };
  let state = "new",
    token,
    contents = new Map(),
    records = [],
    inventory = [],
    selection;
  let entries = [],
    romfs,
    baseIndex,
    programIndex;
  const revoke = () => {
    token = newToken();
    return token;
  };
  const requireState = (...states) => {
    if (!states.includes(state)) fail();
  };
  const checkToken = (value) => {
    if (typeof value !== "string" || value !== token) fail();
  };
  const member = async (index) => {
    const info = boundary.entry(index);
    if (info.size > BigInt(META_LIMIT)) fail();
    const bytes = new Uint8Array(Number(info.size));
    try {
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const part = boundary.read(index, BigInt(offset), Math.min(CHUNK, bytes.length - offset));
        try {
          bytes.set(part, offset);
        } finally {
          part.fill(0);
        }
      }
      return parseCnmt(bytes);
    } finally {
      bytes.fill(0);
    }
  };
  return {
    async execute(operation, payload = {}) {
      fields(
        payload,
        operation === "initialize"
          ? ["nsps", "prodKeys", "titleKeys"]
          : operation === "select"
            ? ["options"]
            : operation === "openRomfs"
              ? ["token"]
              : operation === "readExefs"
                ? ["token", "index", "offset", "count"]
                : operation === "readRomfs"
                  ? ["token", "offset", "count"]
                  : [],
      );
      if (operation === "initialize") {
        requireState("new");
        state = "initializing";
        if (
          !Array.isArray(payload.nsps) ||
          !payload.nsps.length ||
          payload.nsps.length > NSP_INPUT_LIMITS.packages ||
          payload.nsps.some((file) => !(file instanceof Blob))
        )
          fail();
        const blobs = [],
          ids = [],
          tickets = new Map();
        let prod, title;
        try {
          progress("prod-keys-read");
          prod = await readKeys(payload.prodKeys, "prod");
          progress("title-keys-read");
          title = await readKeys(payload.titleKeys, "title");
          for (const [index, file] of payload.nsps.entries()) {
            progress("package-index", index, payload.nsps.length);
            let catalog;
            try {
              catalog = await inspectNsp(file);
            } catch {
              diagnostic("PACKAGE_INDEX_INVALID");
            }
            for (const entry of catalog.entries) {
              const match = /^([0-9a-f]{32})(?:\.cnmt)?\.nca$/iu.exec(entry.name);
              if (!match) {
                const ticket = /^([0-9a-f]{32})\.tik$/iu.exec(entry.name);
                if (ticket) {
                  if (entry.size < BigInt(TICKET_MIN_SIZE) || entry.size > 4096n)
                    diagnostic("PACKAGE_INDEX_INVALID");
                  let bytes, line;
                  try {
                    bytes = new Uint8Array(
                      await file
                        .slice(Number(entry.offset), Number(entry.offset + BigInt(TICKET_MIN_SIZE)))
                        .arrayBuffer(),
                    );
                    line = ticketKeyLine(bytes);
                    if (ticket[1].toLowerCase() !== String.fromCharCode(...line.subarray(0, 32)))
                      diagnostic("PACKAGE_INDEX_INVALID");
                    const id = ticket[1].toLowerCase();
                    const old = tickets.get(id);
                    if (old && old.some((byte, i) => byte !== line[i]))
                      diagnostic("PACKAGE_INDEX_INVALID");
                    if (!old) {
                      tickets.set(id, line);
                      line = undefined;
                    }
                  } catch {
                    diagnostic("PACKAGE_INDEX_INVALID");
                  } finally {
                    bytes?.fill(0);
                    line?.fill(0);
                  }
                } else if (/\.(?:nca|ncz|tik)$/iu.test(entry.name))
                  diagnostic("PACKAGE_INDEX_INVALID");
                continue;
              }
              if (blobs.length >= MAX_CONTENTS) diagnostic("PACKAGE_INDEX_INVALID");
              blobs.push(file.slice(Number(entry.offset), Number(entry.offset + entry.size)));
              ids.push(match[1].toLowerCase());
            }
          }
          title = mergeTicketKeys(title, tickets);
          progress("keys-load");
          checked("KEYS_RUNTIME_FAILED", () => boundary.loadKeys(prod, title));
        } finally {
          prod?.fill(0);
          title?.fill(0);
          for (const line of tickets.values()) line.fill(0);
        }
        if (!blobs.length) diagnostic("PACKAGE_INDEX_INVALID");
        checked("CONTENT_READ_FAILED", () => boundary.mount(blobs));
        for (let i = 0; i < blobs.length; i++) {
          progress("content-hash", i, blobs.length, blobs[i].size);
          const sha256 = checked("CONTENT_READ_FAILED", () => boundary.hashInput(i));
          progress("content-header", i, blobs.length);
          const header = checked("CONTENT_AUTHENTICATION_FAILED", () => boundary.inspect(i));
          if (!header.fixedSignatureValid || header.size !== BigInt(blobs[i].size))
            diagnostic("CONTENT_AUTHENTICATION_FAILED");
          const record = { contentId: ids[i], sha256, size: header.size, hashVerified: true };
          const old = contents.get(ids[i]);
          if (old && (old.sha256 !== sha256 || old.size !== record.size))
            diagnostic("CONTENT_METADATA_INVALID");
          if (old) continue;
          contents.set(ids[i], { ...record, index: i, ncaType: header.contentType });
          inventory.push(record);
          if (header.contentType === 1) {
            progress("content-metadata", i, blobs.length);
            const count = checked("CONTENT_AUTHENTICATION_FAILED", () => boundary.open(i, "meta"));
            try {
              const candidates = [];
              for (let j = 0; j < count; j++)
                if (boundary.entry(j).name.endsWith(".cnmt")) candidates.push(j);
              if (candidates.length !== 1) fail();
              records.push(await member(candidates[0]));
            } catch {
              diagnostic("CONTENT_METADATA_INVALID");
            }
          }
        }
        if (!records.length) diagnostic("CONTENT_METADATA_INVALID");
        state = "inspected";
        return { records, inventory };
      }
      if (operation === "select") {
        requireState("inspected");
        fields(payload.options ?? {}, [
          "baseVersion",
          "patchVersion",
          "dlcVersions",
          "contentMode",
        ]);
        selection = resolveD2rExpansionSelection(records, inventory, payload.options);
        // Require the known add-on's full measured NCA evidence and signed Data
        // header. This is package-input validation, not entitlement/ownership.
        // Its unlock-only content is never substituted for Program RomFS.
        for (const addOn of selection.dlc)
          for (const content of addOn.contents)
            if (contents.get(content.contentId)?.ncaType !== 2) fail();
        const program = (row) => {
          const found = row.contents.filter((c) => c.type === 1);
          if (found.length !== 1 || found[0].idOffset !== 0) fail();
          return contents.get(found[0].contentId).index;
        };
        baseIndex = program(selection.base);
        programIndex = selection.patch ? program(selection.patch) : baseIndex;
        const count = boundary.open(programIndex, "program-exefs");
        entries = Array.from({ length: count }, (_, index) => ({
          index,
          ...boundary.entry(index),
        }));
        state = "exefs";
        return { selection, token: revoke(), entries };
      }
      if (operation === "readExefs") {
        requireState("exefs");
        checkToken(payload.token);
        if (
          !Number.isInteger(payload.index) ||
          payload.index < 0 ||
          payload.index >= entries.length
        )
          fail();
        bounded(payload.offset, payload.count, entries[payload.index].size);
        return boundary.read(payload.index, payload.offset, payload.count);
      }
      if (operation === "openRomfs") {
        requireState("exefs");
        checkToken(payload.token);
        revoke();
        romfs = selection.patch
          ? boundary.openPatchedRomfs(baseIndex, programIndex)
          : boundary.openRomfs(baseIndex);
        state = "romfs";
        entries = [];
        return { token, size: romfs.size };
      }
      if (operation === "readRomfs") {
        requireState("romfs");
        checkToken(payload.token);
        bounded(payload.offset, payload.count, romfs.size);
        return romfs.readAt(payload.offset, payload.count);
      }
      if (operation === "dispose") {
        if (state !== "disposed") boundary.dispose();
        state = "disposed";
        revoke();
        contents.clear();
        records = [];
        inventory = [];
        entries = [];
        romfs = null;
        selection = null;
        return { disposed: true };
      }
      fail();
    },
  };
}
