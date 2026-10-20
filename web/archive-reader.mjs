/** Bounded, read-only record decoder. No manifest traversal or game conversion. */
import { MAX_READ_BYTES, readRange } from "./preflight.mjs";

export const ARCHIVE_LIMITS = Object.freeze({
  encodedRecord: 16 * 1024 * 1024,
  decodedRecord: 16 * 1024 * 1024,
  encodedBlock: MAX_READ_BYTES,
  decodedBlock: 4 * 1024 * 1024,
  blocks: 4096,
  compressedSlice: 1024,
});
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const u32 = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
function bounded(value, limit, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit)
    throw new Error(`Invalid ${name}`);
}

/** Native key-layout-0 locator: chunk, archive, then big-endian 40-bit offset. */
export function archiveLocator(ekey) {
  if (typeof ekey !== "string" || !/^[0-9a-f]{32}$/i.test(ekey)) throw new Error("Invalid EKey");
  const chunk = parseInt(ekey.slice(18, 20), 16);
  const archive = parseInt(ekey.slice(20, 22), 16);
  return {
    chunk,
    archive,
    offset: parseInt(ekey.slice(22), 16),
    filename: `${String(chunk).padStart(2, "0")}-${String(archive).padStart(8, "0")}.data`,
  };
}

async function inflateInto(encoded, output, start, size, signal) {
  if (typeof DecompressionStream !== "function")
    throw new Error("Zlib DecompressionStream unavailable");
  signal?.throwIfAborted();
  // Chromium can synchronously expand an entire write before yielding output.
  // Feed small slices, await every write, and drain output concurrently.
  const stream = new DecompressionStream("deflate");
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  let stopped = false;
  let failure;
  let cleanup;
  const stop = (reason) => {
    if (!stopped) {
      stopped = true;
      failure = reason;
      cleanup = Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
    }
  };
  const check = () => {
    signal?.throwIfAborted();
    if (stopped) throw failure;
  };
  const abort = () => stop(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const producer = (async () => {
    try {
      for (
        let position = 0;
        position < encoded.length;
        position += ARCHIVE_LIMITS.compressedSlice
      ) {
        check();
        await writer.write(encoded.subarray(position, position + ARCHIVE_LIMITS.compressedSlice));
        check();
      }
      await writer.close();
    } catch (error) {
      stop(error);
      throw error;
    }
  })();
  const consumer = (async () => {
    let written = 0;
    try {
      while (true) {
        check();
        const { value, done } = await reader.read();
        check();
        if (done) break;
        if (value.byteLength > size - written)
          throw new Error("Decoded output exceeds declared size");
        output.set(value, start + written);
        written += value.byteLength;
      }
      if (written !== size) throw new Error("Decoded length mismatch");
    } catch (error) {
      stop(error);
      throw error;
    }
  })();
  try {
    await Promise.all([producer, consumer]);
    check();
  } finally {
    // Both directions must settle before returning, including pending writes.
    await Promise.allSettled([producer, consumer]);
    if (cleanup) await cleanup;
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
    writer.releaseLock();
  }
}

/**
 * verifyMd5(bytes, expectedHex, {kind, index?, signal}) MUST resolve exactly true.
 * Supply a trusted MD5 implementation; WebCrypto does not supply MD5. No bypass.
 * record: {offset, encodedSize, decodedSize, encoding: 'n'|'z'|'b:...', ckey}.
 * Only the returned buffer is authenticated; no partial output is published.
 */
export async function decodeArchiveRecord(source, record, { verifyMd5, signal } = {}) {
  signal?.throwIfAborted();
  if (typeof verifyMd5 !== "function") throw new Error("An MD5 verifier is required");
  const { offset, encodedSize, decodedSize, encoding, ckey } = record;
  bounded(offset, Number.MAX_SAFE_INTEGER, "offset");
  bounded(encodedSize, ARCHIVE_LIMITS.encodedRecord, "encoded size");
  bounded(decodedSize, ARCHIVE_LIMITS.decodedRecord, "decoded size");
  if (typeof ckey !== "string" || !/^[0-9a-f]{32}$/i.test(ckey)) throw new Error("Invalid CKey");
  if (
    !Number.isSafeInteger(source.size) ||
    source.size < 0 ||
    offset > source.size ||
    encodedSize > source.size - offset
  )
    throw new Error("Record outside source");
  const read = (position, length) => readRange(source, offset + position, length, signal);
  const verify = async (bytes, expected, context) => {
    signal?.throwIfAborted();
    const ok = await verifyMd5(bytes, expected.toLowerCase(), { ...context, signal });
    signal?.throwIfAborted();
    if (ok !== true) throw new Error(`MD5 mismatch: ${context.kind}`);
  };
  const prefix = await read(0, Math.min(encodedSize, 12));
  const isBlte = prefix.length >= 4 && hex(prefix.subarray(0, 4)) === "424c5445";
  let blocks;
  if (isBlte) {
    if (prefix.length < 12) throw new Error("Truncated BLTE header");
    const headerSize = u32(prefix, 4);
    const count = prefix[9] * 65536 + prefix[10] * 256 + prefix[11];
    if (
      prefix[8] !== 15 ||
      count === 0 ||
      count > ARCHIVE_LIMITS.blocks ||
      headerSize !== 12 + 24 * count ||
      headerSize > encodedSize
    )
      throw new Error("Invalid BLTE block table");
    const header = await read(0, headerSize);
    blocks = [];
    let position = headerSize;
    let decodedTotal = 0;
    for (let index = 0; index < count; index++) {
      const p = 12 + index * 24;
      const encoded = u32(header, p),
        decoded = u32(header, p + 4);
      bounded(encoded, ARCHIVE_LIMITS.encodedBlock, "encoded block size");
      bounded(decoded, ARCHIVE_LIMITS.decodedBlock, "decoded block size");
      if (!encoded || encoded > encodedSize - position || decoded > decodedSize - decodedTotal)
        throw new Error("Invalid BLTE block extent");
      blocks.push({ position, encoded, decoded, checksum: hex(header.subarray(p + 8, p + 24)) });
      position += encoded;
      decodedTotal += decoded;
    }
    if (position !== encodedSize || decodedTotal !== decodedSize)
      throw new Error("BLTE totals mismatch");
  } else {
    if (encoding !== "n" && encoding !== "z") throw new Error("Unsupported record encoding");
    bounded(encodedSize, ARCHIVE_LIMITS.encodedBlock, "encoded block size");
    bounded(decodedSize, ARCHIVE_LIMITS.decodedBlock, "decoded block size");
    if (encoding === "n" && encodedSize !== decodedSize) throw new Error("Raw length mismatch");
    blocks = [{ position: 0, encoded: encodedSize, decoded: decodedSize }];
  }
  const output = new Uint8Array(decodedSize);
  let destination = 0;
  for (const [index, block] of blocks.entries()) {
    const bytes = await read(block.position, block.encoded);
    if (isBlte) await verify(bytes, block.checksum, { kind: "encoded block", index });
    const mode = isBlte ? String.fromCharCode(bytes[0]).toLowerCase() : encoding;
    // Reject lowercase modes in BLTE: native decoder accepts only N and Z.
    if (isBlte && bytes[0] !== 78 && bytes[0] !== 90)
      throw new Error("Unsupported BLTE block mode");
    const payload = isBlte ? bytes.subarray(1) : bytes;
    if (mode === "n") {
      if (payload.length !== block.decoded) throw new Error("Raw length mismatch");
      output.set(payload, destination);
    } else {
      await inflateInto(payload, output, destination, block.decoded, signal);
    }
    destination += block.decoded;
  }
  await verify(output, ckey, { kind: "decoded content" });
  return output;
}
