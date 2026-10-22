// 编译输出边界：验证容器与摘要，不冒充 MSL 编译器或 Metal 语义验证器。
// Compiler output boundary: validate containers and digests, not MSL compilation or Metal semantics.
// Layout overview: https://github.com/YuAo/MetalLibraryArchive#metal-library-archive-binary-layout
// 生产边界匹配实际 Xcode 文件：元数据组长度不包含其 4 字节前缀。
// Production acceptance matches actual Xcode files: metadata lengths exclude the four-byte prefix.
// 仅独立诊断检查允许显式选择旧 floor 写入器的包含前缀布局。
// Only standalone diagnostic inspection may explicitly select the legacy floor prefix-inclusive layout.
// https://github.com/gzorin/floor_llvm/blob/758f59eefe5db70f6e8719be8ca1beb939c38adb/llvm/lib/Bitcode/MetalLib/MetalLibWriterPass.cpp
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_BYTES = 16 * 1024 * 1024;
const TYPES = Object.freeze({ vertex: 0, fragment: 1, kernel: 2 });
const hex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
function fail(message) {
  throw new Error(`Compiled shader rejected: ${message}`);
}
function hashString(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("invalid SHA256");
  return value;
}
function version(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((x) => !Number.isInteger(x) || x < 0 || x > 65535)
  )
    fail("invalid version");
  return Object.freeze([...value]);
}
function sameVersion(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}
function inspect(bytes, expected) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (offset, size, end = bytes.length) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size < 0 ||
      offset > end ||
      size > end - offset
    )
      fail("section out of bounds");
  };
  const u64 = (offset) => {
    range(offset, 8);
    const value = view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("oversized offset");
    return Number(value);
  };
  const tag = (offset) => {
    range(offset, 4);
    return String.fromCharCode(...bytes.subarray(offset, offset + 4));
  };
  // ENDT 没有长度字段；其余标记须完全位于当前组内。
  // ENDT has no length field; all other tags must fit completely in their group.
  const tags = (start, end) => {
    const result = new Map();
    let cursor = start;
    while (cursor < end) {
      range(cursor, 4, end);
      const name = tag(cursor);
      cursor += 4;
      if (name === "ENDT") {
        if (cursor !== end) fail("trailing tag data");
        return result;
      }
      range(cursor, 2, end);
      const size = view.getUint16(cursor, true);
      cursor += 2;
      range(cursor, size, end);
      if (result.has(name)) fail("duplicate tag");
      result.set(name, { offset: cursor, size });
      cursor += size;
    }
    fail("missing tag terminator");
  };
  const field = (fields, name, size) => {
    const found = fields.get(name);
    if (!found || (size !== undefined && found.size !== size)) fail(`invalid ${name} field`);
    return found.offset;
  };
  range(0, 88);
  if (tag(0) !== "MTLB") fail("not a compiled library");
  if (view.getUint16(4, true) !== 1 || bytes[11] !== 0x82 || bytes[10] !== 0)
    fail("not an iOS executable library");
  if (view.getUint16(6, true) !== 2) fail("unsupported container version");
  const minimumOS = [view.getUint16(12, true), bytes[14]];
  // 当前编译选项只有主次版本，不能悄悄忽略补丁版本。
  // Current compiler options represent major/minor only; never silently ignore a patch version.
  if (bytes[15] !== 0) fail("unsupported target OS patch version");
  if (!sameVersion(minimumOS, expected.minimumOS)) fail("target OS mismatch");
  if (u64(16) !== bytes.length) fail("file size mismatch");
  const sections = [24, 40, 56, 72].map((offset, index) => {
    const start = u64(offset),
      size = u64(offset + 8) + (index === 0 ? 4 : 0);
    range(start, size);
    if (start < 88 || size < 4) fail("missing section");
    return { start, size, end: start + size };
  });
  for (let i = 1; i < sections.length; i++) {
    if (sections[i].start < sections[i - 1].end) fail("overlapping sections");
  }
  const [functions, publicMetadata, privateMetadata, bitcode] = sections;
  if (bitcode.end !== bytes.length) fail("unaccounted library tail");
  if (functions.end < publicMetadata.start) tags(functions.end, publicMetadata.start);
  const count = view.getUint32(functions.start, true);
  if (count < 1 || count > 64) fail("invalid function count");
  let cursor = functions.start + 4;
  const records = [],
    names = new Set();
  for (let index = 0; index < count; index++) {
    range(cursor, 4, functions.end);
    const size = view.getUint32(cursor, true);
    if (size < 8) fail("invalid function group");
    range(cursor, size, functions.end);
    const fields = tags(cursor + 4, cursor + size);
    cursor += size;
    const nameOffset = field(fields, "NAME"),
      nameSize = fields.get("NAME").size;
    if (nameSize < 2 || nameSize > 1024 || bytes[nameOffset + nameSize - 1] !== 0)
      fail("invalid function name");
    const nameBytes = bytes.subarray(nameOffset, nameOffset + nameSize - 1);
    if (nameBytes.includes(0)) fail("embedded function-name terminator");
    const name = decoder.decode(nameBytes);
    if (names.has(name)) fail("duplicate function name");
    names.add(name);
    const type = bytes[field(fields, "TYPE", 1)];
    const hashOffset = field(fields, "HASH", 32);
    const offsets = field(fields, "OFFT", 24);
    const versions = field(fields, "VERS", 8);
    const languageVersion = [
      view.getUint16(versions + 4, true),
      view.getUint16(versions + 6, true),
    ];
    if (
      view.getUint16(versions, true) !== 2 ||
      !sameVersion(languageVersion, expected.languageVersion)
    )
      fail("AIR or language version mismatch");
    for (const [section, relative] of [
      [publicMetadata, u64(offsets)],
      [privateMetadata, u64(offsets + 8)],
    ]) {
      range(relative, 4, section.size);
      const start = section.start + relative,
        storedLength = view.getUint32(start, true),
        length = storedLength + (expected.metadataLengthIncludesPrefix === true ? 0 : 4);
      if (length < 8) fail("invalid metadata group length");
      range(relative, length, section.size);
      tags(start + 4, start + length);
    }
    const relative = u64(offsets + 16),
      length = u64(field(fields, "MDSZ", 8));
    range(relative, length, bitcode.size);
    if (length < 8) fail("missing LLVM bitcode");
    const start = bitcode.start + relative;
    let payload = start,
      payloadSize = length;
    if (view.getUint32(start, true) === 0x0b17c0de) {
      if (length < 20 || view.getUint32(start + 4, true) !== 0) fail("invalid bitcode wrapper");
      const offset = view.getUint32(start + 8, true);
      payloadSize = view.getUint32(start + 12, true);
      if (offset < 20) fail("invalid bitcode payload offset");
      range(offset, payloadSize, length);
      payload += offset;
    }
    if (payloadSize < 8 || payloadSize % 4 !== 0 || view.getUint32(payload, true) !== 0xdec04342)
      fail("invalid LLVM bitcode envelope");
    records.push({
      name,
      type,
      airVersion: [view.getUint16(versions, true), view.getUint16(versions + 2, true)],
      languageVersion,
      start,
      length,
      sha256: hex(bytes.subarray(hashOffset, hashOffset + 32)),
    });
  }
  if (cursor !== functions.end) fail("function list size mismatch");
  const entry = records.find((x) => x.name === expected.entry);
  if (!entry || entry.type !== TYPES[expected.stage]) fail("entry or stage mismatch");
  return records;
}

// 仅检查结构和内置摘要，不认证来源、编译器，也不证明 Metal 可加载性。
// Inspect structure and embedded digests only, without authenticating provenance/compiler or proving Metal loadability.
export async function inspectCompiledMetalLibrary(
  binary,
  { entry, stage, minimumOS, languageVersion, metadataLengthIncludesPrefix, signal } = {},
) {
  signal?.throwIfAborted();
  if (
    !(binary instanceof Uint8Array) ||
    binary.length < 88 ||
    binary.length > MAX_BYTES ||
    !(binary.buffer instanceof ArrayBuffer)
  )
    fail("invalid output bytes");
  if (
    typeof entry !== "string" ||
    !/^[a-zA-Z_][a-zA-Z0-9_]{0,255}$/.test(entry) ||
    !Object.hasOwn(TYPES, stage) ||
    typeof metadataLengthIncludesPrefix !== "boolean"
  )
    fail("invalid structural expectations");
  const expected = {
    entry,
    stage,
    minimumOS: version(minimumOS),
    languageVersion: version(languageVersion),
    metadataLengthIncludesPrefix,
  };
  const bytes = new Uint8Array(binary);
  try {
    const records = inspect(bytes, expected);
    await verifyBitcodeDigests(bytes, records, signal);
    const outputSha256 = await sha256(bytes);
    signal?.throwIfAborted();
    const view = new DataView(bytes.buffer);
    return Object.freeze({
      validation: "container-and-integrity-only",
      outputSha256,
      outputSize: bytes.length,
      metadataLengthIncludesPrefix,
      headerVersion: Object.freeze([
        view.getUint16(4, true),
        view.getUint16(6, true),
        view.getUint16(8, true),
      ]),
      minimumOS: expected.minimumOS,
      functions: Object.freeze(
        records.map(
          ({ name, type, sha256: bitcodeSha256, airVersion, languageVersion: language }) =>
            Object.freeze({
              name,
              type,
              bitcodeSha256,
              airVersion: Object.freeze(airVersion),
              languageVersion: Object.freeze(language),
            }),
        ),
      ),
    });
  } finally {
    bytes.fill(0);
  }
}
async function verifyBitcodeDigests(bytes, records, signal) {
  const hashes = new Map();
  for (const record of records) {
    const key = `${record.start}:${record.length}`;
    if (!hashes.has(key))
      hashes.set(key, await sha256(bytes.subarray(record.start, record.start + record.length)));
    signal?.throwIfAborted();
    if (hashes.get(key) !== record.sha256) fail("bitcode digest mismatch");
  }
}

// 此收据只把输入、编译器资产、选项与输出绑定起来，不能自行认证编译器。
// This receipt binds inputs, compiler assets, options and output; it cannot authenticate the compiler itself.
// 调用方仍须使用受信任的隔离编译器，并另行验证 AIR 语义与完整源码集摘要。
// The caller still needs a trusted isolated compiler, semantic AIR validation and the full source-set digest proof.
export async function acceptCompiledShaderOutput({
  source,
  binary,
  compiler,
  options,
  expected,
  signal,
}) {
  signal?.throwIfAborted();
  if (typeof source !== "string" || source.length > MAX_BYTES) fail("invalid source");
  if (
    !(binary instanceof Uint8Array) ||
    binary.length < 88 ||
    binary.length > MAX_BYTES ||
    !(binary.buffer instanceof ArrayBuffer)
  )
    fail("invalid output bytes");
  if (!compiler || typeof compiler.id !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(compiler.id))
    fail("invalid compiler identity");
  const compilerIdentity = Object.freeze({
    id: compiler.id,
    assetSha256: hashString(compiler.assetSha256),
  });
  if (
    options?.platform !== "ios" ||
    typeof options.fastMath !== "boolean" ||
    Object.keys(options).some(
      (key) => !["platform", "minimumOS", "languageVersion", "fastMath"].includes(key),
    )
  )
    fail("invalid compiler options");
  const compileOptions = Object.freeze({
    platform: "ios",
    minimumOS: version(options.minimumOS),
    languageVersion: version(options.languageVersion),
    fastMath: options.fastMath,
  });
  if (
    !expected ||
    typeof expected.key !== "string" ||
    !/^[a-f0-9]{16}$/.test(expected.key) ||
    !["b", "bf"].includes(expected.variant) ||
    typeof expected.entry !== "string" ||
    !/^[a-zA-Z_][a-zA-Z0-9_]{0,255}$/.test(expected.entry) ||
    !Object.hasOwn(TYPES, expected.stage)
  )
    fail("invalid expected shader identity");
  if (
    typeof expected.sourceSetDigest !== "string" ||
    !/^[a-f0-9]{16}$/.test(expected.sourceSetDigest)
  )
    fail("invalid source-set digest");
  const identity = Object.freeze({
    key: expected.key,
    variant: expected.variant,
    entry: expected.entry,
    stage: expected.stage,
    sourceSetDigest: expected.sourceSetDigest,
    sourceSha256: hashString(expected.sourceSha256),
  });
  const sourceBytes = encoder.encode(source.replaceAll("\r\n", "\n"));
  if (sourceBytes.length > MAX_BYTES) fail("source byte limit exceeded");
  // 只返回本地快照，防止异步摘要期间调用方修改输入。
  // Return only an owned snapshot so caller mutations during async hashing cannot change accepted bytes.
  const output = new Uint8Array(binary);
  try {
    const records = inspect(output, {
      ...compileOptions,
      entry: identity.entry,
      stage: identity.stage,
    });
    const sourceSha256 = await sha256(sourceBytes);
    signal?.throwIfAborted();
    if (sourceSha256 !== identity.sourceSha256) fail("source digest mismatch");
    await verifyBitcodeDigests(output, records, signal);
    const outputSha256 = await sha256(output);
    signal?.throwIfAborted();
    const receipt = Object.freeze({
      schemaVersion: 1,
      validation: "container-and-integrity-only",
      ...identity,
      compiler: compilerIdentity,
      options: compileOptions,
      outputSha256,
      outputSize: output.length,
    });
    const receiptSha256 = await sha256(encoder.encode(JSON.stringify(receipt)));
    signal?.throwIfAborted();
    return Object.freeze({ bytes: output, receipt, receiptSha256 });
  } catch (error) {
    output.fill(0);
    throw error;
  } finally {
    sourceBytes.fill(0);
  }
}
