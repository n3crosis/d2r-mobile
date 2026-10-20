// Outer-container indexing only. This does NOT decrypt NCA or merge BKTR.
// readAt(offset: bigint, size: number) -> Promise<Uint8Array>.
export async function indexPfs0(readAt, size) {
  const fail = () => {
    throw new Error("Invalid or unsupported PFS0 container");
  };
  if (typeof size !== "bigint" || size < 16n) fail();
  const exact = async (offset, count) => {
    if (offset < 0n || offset + BigInt(count) > size) fail();
    const bytes = await readAt(offset, count);
    if (!(bytes instanceof Uint8Array) || bytes.length !== count) fail();
    return bytes;
  };
  const head = await exact(0n, 16);
  if (head[0] !== 80 || head[1] !== 70 || head[2] !== 83 || head[3] !== 48) fail();
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const count = hv.getUint32(4, true),
    stringSize = hv.getUint32(8, true);
  const metadataSize = count * 24 + stringSize;
  // Bound attacker-controlled allocation before reading metadata.
  if (count > 100000 || metadataSize > 16 * 1024 * 1024) fail();
  const dataStart = 16n + BigInt(metadataSize);
  const metadata = await exact(16n, metadataSize);
  const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
  const strings = metadata.subarray(count * 24);
  const seen = new Set(),
    entries = [];
  for (let i = 0; i < count; i++) {
    const at = i * 24;
    const offset = dataStart + view.getBigUint64(at, true);
    const length = view.getBigUint64(at + 8, true);
    const str = view.getUint32(at + 16, true);
    if (str >= strings.length || offset + length > size) fail();
    const end = strings.indexOf(0, str);
    if (end < 0) fail();
    let name;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(strings.subarray(str, end));
    } catch {
      fail();
    }
    if (
      !name ||
      name === "." ||
      name === ".." ||
      /[\\/:]/.test(name) ||
      [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      seen.has(name)
    )
      fail();
    seen.add(name);
    entries.push({ name, offset, size: length });
  }
  const sorted = [...entries].sort((a, b) =>
    a.offset < b.offset ? -1 : a.offset > b.offset ? 1 : 0,
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].offset + sorted[i - 1].size > sorted[i].offset) fail();
  }
  return entries;
}

// Browser adapter: bounded Blob slices, never file.arrayBuffer() on a whole NSP.
export function blobReader(blob) {
  return async (offset, size) => {
    if (
      offset < 0n ||
      offset + BigInt(size) > BigInt(blob.size) ||
      offset + BigInt(size) > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new Error("Read outside file");
    return new Uint8Array(await blob.slice(Number(offset), Number(offset) + size).arrayBuffer());
  };
}
