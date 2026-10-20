/** Legacy archive-format checksum only, never authentication or game identity. */
import SparkMD5 from "./vendor/spark-md5-3.0.2/spark-md5.mjs";

export const MD5_CHUNK_BYTES = 64 * 1024;
const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Archive-reader injection: verifyMd5(bytes, expectedHex, { signal, kind, index }).
 * Hash only the exact Uint8Array view. The caller must not mutate it until settled.
 * Memory overhead is bounded by the chunk size, not the total input size.
 */
export async function verifyMd5(bytes, expectedHex, { signal } = {}) {
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected Uint8Array bytes");
  if (
    typeof expectedHex !== "string" ||
    expectedHex.length !== 32 ||
    !/^[0-9a-f]{32}$/i.test(expectedHex)
  )
    throw new TypeError("Expected a 32-character MD5 hex digest");
  const hash = new SparkMD5.ArrayBuffer();
  try {
    for (let offset = 0; offset < bytes.byteLength; offset += MD5_CHUNK_BYTES) {
      signal?.throwIfAborted();
      // Pass the view itself, not its backing buffer. Upstream copies this bounded
      // chunk into its working buffer and retains at most 63 bytes between calls.
      hash.append(bytes.subarray(offset, offset + MD5_CHUNK_BYTES));
      // A task (not just a microtask) lets UI cancellation run between chunks.
      await yieldTask();
      signal?.throwIfAborted();
    }
    signal?.throwIfAborted();
    return hash.end() === expectedHex.toLowerCase();
  } finally {
    hash.destroy();
  }
}
