// 依据原生 casc_overlay 清单规则和现有资源工作线程写入 CASC 增量。
// Write CASC deltas using native casc_overlay manifest rules and the existing asset worker.
/**
 * 真实有界 CASC 增量写入器。原始归档保持惰性读取，绝不克隆。这是内部原语，不是生产 UI 或完整资源流水线。
 * Real bounded CASC delta writer. Original archives stay lazy, never cloned.
 * This is an internal primitive, not a production UI or a complete asset pipeline.
 */
import { archiveLocator, decodeArchiveRecord, ARCHIVE_LIMITS } from "./archive-reader.mjs";
import { verifyMd5 } from "./checksum-verifier.mjs";
import SparkMD5 from "./vendor/spark-md5-3.0.2/spark-md5.mjs";
import { ROMFS_LIMITS } from "./romfs-tree.mjs";
import { CASC_LIMITS } from "./casc-logical-reader.mjs";

export const OVERLAY_LIMITS = Object.freeze({
  config: 1024 * 1024,
  input: 64 * 1024 * 1024,
  output: 64 * 1024 * 1024,
  replacement: 16 * 1024 * 1024,
  jobs: 4096,
});
const fail = () => {
  throw new Error("CASC_OVERLAY_INVALID");
};
const encoder = new TextEncoder();
function normalize(value) {
  if (typeof value !== "string") fail();
  let path = value.trim().replaceAll("\\", "/");
  while (/^data:/i.test(path)) path = path.slice(5);
  path = path.replace(/^\/+/, "").toLowerCase();
  if (
    !path ||
    encoder.encode(path).length > 4096 ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f:]/u.test(path) ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail();
  return path;
}
async function exact(file, offset, count, signal) {
  signal?.throwIfAborted();
  if (
    !file ||
    typeof file.size !== "bigint" ||
    typeof file.readAt !== "function" ||
    offset < 0n ||
    offset + BigInt(count) > file.size
  )
    fail();
  const result = new Uint8Array(count);
  for (let p = 0; p < count; p += ROMFS_LIMITS.readBytes) {
    const size = Math.min(ROMFS_LIMITS.readBytes, count - p);
    const bytes = await file.readAt(offset + BigInt(p), size, { signal });
    signal?.throwIfAborted();
    if (!(bytes instanceof Uint8Array) || bytes.length !== size) fail();
    result.set(bytes, p);
  }
  return result;
}
async function smallFile(romfs, path, limit, signal) {
  const file = romfs.getFile(path);
  if (!file || file.size > BigInt(limit)) fail();
  return exact(file, 0n, Number(file.size), signal);
}
function configValues(bytes) {
  const values = new Map();
  for (const line of new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\n")) {
    const at = line.indexOf(" = ");
    if (at < 0 || line.startsWith("#")) continue;
    const key = line.slice(0, at);
    if (values.has(key)) fail();
    values.set(key, line.slice(at + 3));
  }
  return values;
}
async function tvfs(romfs, values, name, signal) {
  const keys = values.get(name)?.split(" ");
  const sizes = values.get(`${name}-size`)?.split(" ");
  if (
    keys?.length !== 2 ||
    keys.some((k) => !/^[a-f0-9]{32}$/i.test(k)) ||
    sizes?.length !== 2 ||
    sizes.some((n) => !/^\d+$/.test(n))
  )
    fail();
  const [decodedSize, encodedSize] = sizes.map(Number);
  if (
    !Number.isSafeInteger(decodedSize) ||
    !Number.isSafeInteger(encodedSize) ||
    decodedSize > ARCHIVE_LIMITS.decodedRecord ||
    encodedSize > ARCHIVE_LIMITS.encodedRecord
  )
    fail();
  const locator = archiveLocator(keys[1]);
  const file = romfs.getFile(`data/${locator.filename}`);
  const start = BigInt(locator.offset);
  if (!file || start + BigInt(encodedSize) > file.size) fail();
  const read = (offset, count) => exact(file, start + BigInt(offset), count, signal);
  const prefix = await read(0, Math.min(12, encodedSize));
  if (prefix.length < 12 || String.fromCharCode(...prefix.slice(0, 4)) !== "BLTE") fail();
  const headerSize = new DataView(prefix.buffer).getUint32(4);
  if (headerSize < 12 || headerSize > encodedSize || headerSize > 12 + 24 * ARCHIVE_LIMITS.blocks)
    fail();
  const hash = new SparkMD5.ArrayBuffer();
  let digest;
  try {
    digest = hash.append(await read(0, headerSize)).end();
  } finally {
    hash.destroy();
  }
  if (digest.slice(0, 18) !== keys[1].slice(0, 18).toLowerCase()) fail();
  return decodeArchiveRecord(
    { size: encodedSize, read },
    { offset: 0, encodedSize, decodedSize, encoding: "b:256K*=z", ckey: keys[0] },
    { verifyMd5, signal },
  );
}
/**
 * 与原生 casc_overlay.read_manifest 完全一致，首个重复项优先，而非 dmx 的规则。
 * First duplicate wins exactly as native casc_overlay.read_manifest, not dmx.
 */
async function selectedManifest(romfs, wanted, signal) {
  const file = romfs.getFile("data/build_manifest.psv");
  if (!file || file.size > BigInt(CASC_LIMITS.manifestBytes)) fail();
  const selected = new Map();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    rows = 0;
  const line = (text) => {
    if (encoder.encode(text).length > CASC_LIMITS.lineBytes) fail();
    const fields = text.split("|");
    if (fields.length < 11 || fields[0].startsWith("#")) return;
    if (++rows > CASC_LIMITS.rows) fail();
    // 不拒绝原生代码从不使用的无关路径或记录。
    // Do not reject unrelated paths/records that native never uses.
    let path;
    try {
      path = normalize(fields[9]);
    } catch {
      return;
    }
    if (wanted.has(path) && !selected.has(path)) {
      if (!/^[a-f0-9]{32}$/i.test(fields[6])) fail();
      selected.set(path, fields[6]);
    }
  };
  for (let pos = 0n; pos < file.size;) {
    const length = Number(
      file.size - pos > BigInt(ROMFS_LIMITS.readBytes)
        ? BigInt(ROMFS_LIMITS.readBytes)
        : file.size - pos,
    );
    pending += decoder.decode(await exact(file, pos, length, signal), { stream: true });
    pos += BigInt(length);
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const text of lines) line(text);
    if (pending.length > CASC_LIMITS.lineBytes) fail();
  }
  pending += decoder.decode();
  if (pending) line(pending);
  return selected;
}
/**
 * romfs：已认证的 indexRomfs 结果，而非任意用户批准的信任标志。replacements：有序的 [{path,bytes:Uint8Array,add?:boolean}]。worker：支持 casc-overlay 操作的现有 Pyodide AssetWorker。返回实际更改文件的字节及替换清单；未变文件仍保留在调用方的惰性 RomFS 树中。不使用磁盘符号链接或占位计划。调用方拥有工作线程生命周期；取消时关闭线程以停止同步 Python 工作。
 * romfs: authenticated indexRomfs result, not arbitrary user-approved trust flags.
 * replacements: ordered [{path,bytes:Uint8Array,add?:boolean}].
 * worker: existing Pyodide AssetWorker with casc-overlay operation.
 * Returns actual changed file bytes plus replacement inventory; unchanged files
 * remain the caller's lazy RomFS tree. No disk symlinks or placeholder plan.
 * Caller owns worker lifetime; abort closes it to stop synchronous Python work.
 */
export async function writeCascOverlay({ romfs, replacements, worker, signal } = {}) {
  signal?.throwIfAborted();
  if (
    !romfs ||
    typeof romfs.getFile !== "function" ||
    !Array.isArray(romfs.files) ||
    !worker ||
    typeof worker.run !== "function" ||
    typeof worker.close !== "function" ||
    !Array.isArray(replacements) ||
    replacements.length > OVERLAY_LIMITS.jobs
  )
    fail();
  const seen = new Set();
  let total = 0;
  const jobs = replacements.map((job) => {
    const path = normalize(job?.path);
    if (
      seen.has(path) ||
      !(job.bytes instanceof Uint8Array) ||
      job.bytes.length > OVERLAY_LIMITS.replacement ||
      (job.add !== undefined && typeof job.add !== "boolean")
    )
      fail();
    seen.add(path);
    total += job.bytes.length;
    if (total > OVERLAY_LIMITS.input) fail();
    return { path, add: job.add ?? false, bytes: job.bytes };
  });
  if (!jobs.length)
    return Object.freeze({ files: Object.freeze({}), inventory: Object.freeze([]) });
  const used = new Set(romfs.files.map((f) => f.path));
  let location;
  outer: for (let chunk = 0; chunk < 256; chunk++)
    for (let archive = 1; archive < 256; archive++) {
      const name = `data/${String(chunk).padStart(2, "0")}-${String(archive).padStart(8, "0")}.data`;
      if (!used.has(name)) {
        location = [chunk, archive];
        break outer;
      }
    }
  if (!location) fail();
  const config = await smallFile(romfs, "data/.build.config", OVERLAY_LIMITS.config, signal);
  const values = configValues(config);
  const manifest = await selectedManifest(romfs, seen, signal);
  const descriptors = jobs.map((job) => {
    const oldEkey = manifest.get(job.path);
    if (job.add ? oldEkey !== undefined : oldEkey === undefined) fail();
    return { path: job.path, add: job.add, ...(!job.add ? { oldEkey } : {}) };
  });
  const vfs = await tvfs(romfs, values, "vfs-1", signal);
  const root = await tvfs(romfs, values, "vfs-root", signal);
  const buffers = [config, vfs, root, ...jobs.map((j) => j.bytes)];
  const parts = buffers.map((b) => b.length);
  total = parts.reduce((a, b) => a + b, 0);
  if (total > OVERLAY_LIMITS.input) fail();
  const payload = new Uint8Array(total);
  let pos = 0;
  for (const bytes of buffers) {
    payload.set(bytes, pos);
    pos += bytes.length;
  }
  const abort = () => worker.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const result = await worker.run("casc-overlay", payload, {
      parts,
      jobs: descriptors,
      location,
    });
    signal?.throwIfAborted();
    const archive = `data/${String(location[0]).padStart(2, "0")}-${String(location[1]).padStart(8, "0")}.data`;
    const names = Object.keys(result?.files ?? {}).sort();
    if (
      names.length !== 2 ||
      names[0] !== "data/.build.config" ||
      names[1] !== archive ||
      !Array.isArray(result.inventory) ||
      result.inventory.length !== jobs.length
    )
      fail();
    total = 0;
    const files = {};
    for (const name of names) {
      const bytes = result.files[name];
      if (!(bytes instanceof ArrayBuffer)) fail();
      total += bytes.byteLength;
      if (total > OVERLAY_LIMITS.output) fail();
      files[name] = new Uint8Array(bytes);
    }
    return Object.freeze({
      files: Object.freeze(files),
      inventory: Object.freeze(result.inventory),
    });
  } finally {
    payload.fill(0);
    vfs.fill(0);
    root.fill(0);
    signal?.removeEventListener("abort", abort);
  }
}
