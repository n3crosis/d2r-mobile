/** Data-free preflight primitives. No conversion, uploads, or writes. */
export const NSO_HEADER_BYTES = 0x100;
export const MAX_READ_BYTES = 4 * 1024 * 1024;

export function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFC') ||
      /[\\:\x00-\x1f\x7f]/u.test(value)) throw new Error('Unsafe relative path');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new Error('Unsafe relative path');
  }
  return value;
}

export function indexFiles(files) {
  const index = new Map();
  const folded = new Set();
  const directories = new Set();
  for (const file of files) {
    const path = safeRelativePath(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Invalid file size');
    const key = path.toLowerCase();
    if (folded.has(key)) throw new Error(`Conflicting path: ${path}`);
    // Track ancestor directories in O(total path depth), not O(file count squared).
    if (directories.has(key)) throw new Error(`File/directory conflict: ${path}`);
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      if (folded.has(ancestor)) throw new Error(`File/directory conflict: ${path}`);
      directories.add(ancestor);
    }
    folded.add(key);
    index.set(path, Object.freeze({path, size: file.size}));
  }
  return index;
}

/** The adapter must expose size and read(offset, length) => Uint8Array. */
export async function readRange(source, offset, length, signal) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 0 ||
      !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length < 0 || length > MAX_READ_BYTES ||
      offset > source.size || length > source.size - offset) throw new Error('Invalid read range');
  const bytes = await source.read(offset, length);
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) throw new Error('Short or invalid read');
  return bytes;
}

export function fileSource(file) {
  return {size: file.size, read: async (offset, length) =>
    new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())};
}

/** Header validation only. Does NOT authenticate game version or rewrite an NSO. */
export async function inspectNso(source, signal) {
  const bytes = await readRange(source, 0, NSO_HEADER_BYTES, signal);
  if (bytes[0] !== 0x4e || bytes[1] !== 0x53 || bytes[2] !== 0x4f || bytes[3] !== 0x30) {
    throw new Error('Expected NSO0 header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = offset => view.getUint32(offset, true);
  if (u32(4) !== 0) throw new Error('Unsupported NSO version');
  const flags = u32(0x0c);
  if (flags & ~0x3f) throw new Error('Unsupported NSO flags');
  const segments = ['text', 'rodata', 'data'].map((name, i) => {
    const p = 0x10 + i * 0x10;
    const fileOffset = u32(p), memoryOffset = u32(p + 4), decodedSize = u32(p + 8);
    const compressed = Boolean(flags & (1 << i));
    const storedSize = compressed ? u32(0x60 + i * 4) : decodedSize;
    if (fileOffset < NSO_HEADER_BYTES || fileOffset > source.size ||
        storedSize > source.size - fileOffset || (decodedSize > 0 && storedSize === 0) ||
        memoryOffset + decodedSize > 0x100000000) throw new Error(`Invalid ${name} segment`);
    return {name, fileOffset, memoryOffset, storedSize, decodedSize, compressed};
  });
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if ((a.storedSize && b.storedSize && a.fileOffset < b.fileOffset + b.storedSize && b.fileOffset < a.fileOffset + a.storedSize) ||
          (a.decodedSize && b.decodedSize && a.memoryOffset < b.memoryOffset + b.decodedSize && b.memoryOffset < a.memoryOffset + a.decodedSize)) {
        throw new Error('Overlapping segments');
      }
    }
  }
  return {moduleId: Array.from(bytes.subarray(0x40, 0x60), n => n.toString(16).padStart(2, '0')).join(''),
    flags, segments, bssSize: u32(0x3c), versionVerified: false};
}
