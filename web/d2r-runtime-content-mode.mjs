/** Exact v1.0.18 shell data-only derivation. Not an instruction or entitlement patch. */
export const D2R_RUNTIME_CONTENT_PIN = Object.freeze({
  release: "v1.0.18",
  executablePath: "DmIOS",
  size: 2327536,
  originalSha256: "2d4b0299ff5d4856e12e14948da369ca35c27d2d0afd78dfed44cf4f6442b9ba",
  noDlcSha256: "0d6bae055ea5ee0571ff592ece73b90e9f3e7399fa8c59216f70a8f3707988fa",
  symbol: "_aoc_owned.v",
  address: 0x10018ef78n,
  fileOffset: 0x18ef78,
});
const fail = () => {
  throw new Error("D2R_RUNTIME_CONTENT_BINDING");
};
const digest = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

function cacheOffset(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (offset, size) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size < 0 ||
      offset > bytes.length - size
    )
      fail();
  };
  const u32 = (p) => {
    range(p, 4);
    return view.getUint32(p, true);
  };
  const u64 = (p) => {
    range(p, 8);
    return view.getBigUint64(p, true);
  };
  const string = (p, length, requireTerminator = true) => {
    range(p, length);
    let end = p;
    while (end < p + length && bytes[end] !== 0) end++;
    if (requireTerminator && end === p + length) fail();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(p, end));
  };
  if (u32(0) !== 0xfeedfacf || u32(4) !== 0x0100000c) fail();
  const commandCount = u32(16),
    commandBytes = u32(20);
  range(32, commandBytes);
  if (commandCount > 4096) fail();
  let cursor = 32,
    symbols;
  const sections = [];
  for (let i = 0; i < commandCount; i++) {
    const command = u32(cursor),
      size = u32(cursor + 4);
    if (size < 8 || size % 8 !== 0 || cursor + size > 32 + commandBytes) fail();
    if (command === 0x19) {
      if (size < 72) fail();
      const count = u32(cursor + 64);
      if (count > 255 || size !== 72 + count * 80) fail();
      for (let j = 0; j < count; j++) {
        const p = cursor + 72 + j * 80;
        sections.push({
          name: string(p, 16, false),
          segment: string(p + 16, 16, false),
          address: u64(p + 32),
          size: u64(p + 40),
          offset: u32(p + 48),
          flags: u32(p + 64),
        });
      }
    } else if (command === 2) {
      if (symbols || size !== 24) fail();
      symbols = {
        offset: u32(cursor + 8),
        count: u32(cursor + 12),
        strings: u32(cursor + 16),
        stringSize: u32(cursor + 20),
      };
    }
    cursor += size;
  }
  if (cursor !== 32 + commandBytes || !symbols) fail();
  range(symbols.offset, symbols.count * 16);
  range(symbols.strings, symbols.stringSize);
  const matches = [];
  for (let i = 0; i < symbols.count; i++) {
    const p = symbols.offset + i * 16,
      type = bytes[p + 4],
      index = u32(p);
    if (type & 0xe0) continue; // STAB/debug duplicates are not definitions.
    if (index >= symbols.stringSize) fail();
    if (
      string(symbols.strings + index, symbols.stringSize - index) !== D2R_RUNTIME_CONTENT_PIN.symbol
    )
      continue;
    if ((type & 0x0e) !== 0x0e || bytes[p + 5] === 0) fail();
    const section = sections[bytes[p + 5] - 1],
      address = u64(p + 8);
    if (
      !section ||
      section.name !== "__data" ||
      section.segment !== "__DATA" ||
      (section.flags & 0xff) !== 0 ||
      address !== D2R_RUNTIME_CONTENT_PIN.address ||
      address < section.address ||
      address + 4n > section.address + section.size
    )
      fail();
    const offset = section.offset + Number(address - section.address);
    range(offset, 4);
    if (offset !== D2R_RUNTIME_CONTENT_PIN.fileOffset || u32(offset) !== 0xffffffff) fail();
    matches.push(offset);
  }
  if (matches.length !== 1) fail();
  return matches[0];
}

/**
 * Invoke only after original shell validation, on its unmodified executable.
 * Derive effective mode from authenticated selection, not a UI ownership flag.
 * Source dm/host/hle_misc.c:18 initializes static int v=-1; v<0 triggers getenv,
 * otherwise Count/List use cached v. A zero initializer permanently reports none.
 * The four-byte mutation invalidates any existing signature; output is unsigned
 * and must be signed by the user after all packaging mutations.
 */
export async function deriveD2rRuntimeContentMode(input, { contentMode } = {}) {
  if (
    !(input instanceof Uint8Array) ||
    input.length !== D2R_RUNTIME_CONTENT_PIN.size ||
    !["base-update-only", "warlock"].includes(contentMode)
  )
    fail();
  const bytes = input.slice();
  if ((await digest(bytes)) !== D2R_RUNTIME_CONTENT_PIN.originalSha256) fail();
  const offset = cacheOffset(bytes);
  if (contentMode === "base-update-only") bytes.fill(0, offset, offset + 4);
  const sha256 = await digest(bytes);
  const expected =
    contentMode === "base-update-only"
      ? D2R_RUNTIME_CONTENT_PIN.noDlcSha256
      : D2R_RUNTIME_CONTENT_PIN.originalSha256;
  if (sha256 !== expected) fail();
  return {
    bytes,
    receipt: Object.freeze({
      kind: "d2r-runtime-content-mode-v1",
      release: D2R_RUNTIME_CONTENT_PIN.release,
      path: D2R_RUNTIME_CONTENT_PIN.executablePath,
      contentMode,
      originalSha256: D2R_RUNTIME_CONTENT_PIN.originalSha256,
      sha256,
      size: bytes.length,
      modifiedOffset: contentMode === "base-update-only" ? offset : null,
      modifiedBytes: contentMode === "base-update-only" ? 4 : 0,
      signatureState:
        contentMode === "base-update-only" ? "invalidated-needs-signing" : "unchanged",
    }),
  };
}
