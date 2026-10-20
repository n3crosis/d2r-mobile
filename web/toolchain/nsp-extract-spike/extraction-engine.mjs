import { inspectNsp, NSP_INPUT_LIMITS } from "../../nsp-input.mjs";
import { parseCnmt } from "../../content-selection.mjs";
import { resolveD2rExpansionSelection } from "../../d2r-expansion-policy.mjs";
const CHUNK = 65536,
  META_LIMIT = 16 * 1024 * 1024,
  MAX_CONTENTS = 4096;
const fail = () => {
  throw new Error("EXTRACTION_REQUEST_REJECTED");
};
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
export function createExtractionEngine(boundary, { newToken = () => crypto.randomUUID() } = {}) {
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
        for (const file of [payload.prodKeys, payload.titleKeys])
          if (!(file instanceof Blob) || file.size > NSP_INPUT_LIMITS.keyBytes || !file.size)
            fail();
        let prod, title;
        try {
          prod = new Uint8Array(await payload.prodKeys.arrayBuffer());
          title = new Uint8Array(await payload.titleKeys.arrayBuffer());
          boundary.loadKeys(prod, title);
        } finally {
          prod?.fill(0);
          title?.fill(0);
        }
        const blobs = [],
          ids = [];
        for (const file of payload.nsps) {
          const catalog = await inspectNsp(file);
          for (const entry of catalog.entries) {
            const match = /^([0-9a-f]{32})(?:\.cnmt)?\.nca$/iu.exec(entry.name);
            if (!match) {
              if (/\.(?:nca|ncz)$/iu.test(entry.name)) fail();
              continue;
            }
            if (blobs.length >= MAX_CONTENTS) fail();
            blobs.push(file.slice(Number(entry.offset), Number(entry.offset + entry.size)));
            ids.push(match[1].toLowerCase());
          }
        }
        if (!blobs.length) fail();
        boundary.mount(blobs);
        for (let i = 0; i < blobs.length; i++) {
          const sha256 = boundary.hashInput(i),
            header = boundary.inspect(i);
          if (!header.fixedSignatureValid || header.size !== BigInt(blobs[i].size)) fail();
          const record = { contentId: ids[i], sha256, size: header.size, hashVerified: true };
          const old = contents.get(ids[i]);
          if (old && (old.sha256 !== sha256 || old.size !== record.size)) fail();
          if (old) continue;
          contents.set(ids[i], { ...record, index: i, ncaType: header.contentType });
          inventory.push(record);
          if (header.contentType === 1) {
            const count = boundary.open(i, "meta");
            const candidates = [];
            for (let j = 0; j < count; j++)
              if (boundary.entry(j).name.endsWith(".cnmt")) candidates.push(j);
            if (candidates.length !== 1) fail();
            records.push(await member(candidates[0]));
          }
        }
        if (!records.length) fail();
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
