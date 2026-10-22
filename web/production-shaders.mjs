// 依据受信任目录和原生源码摘要生成真实的编译着色器库。
// Generate real compiled shader libraries from the trusted catalog and native source digest rules.
/**
 * 全目录浏览器编译。绝不调用 Apple Metal，也不在摘要证明之前发布输出。
 * Full-catalog browser compilation. Never invokes Apple Metal or publishes before digest proof.
 */
import { yieldBrowserTask } from "./browser-task-yield.mjs";
import { resolveLogicalAssetSuffixes } from "./logical-asset-suffixes.mjs";
import { assertShaderCatalog } from "./shader-catalog-adapter.mjs";
import { createShaderPipeline } from "./shader-pipeline.mjs";
import {
  readAuthenticatedAssets,
  readAuthenticatedProgramModules,
} from "./extraction-job-adapter.mjs";
import { validateNsoSegments } from "./nso-validation.mjs";
import { c1NeedsFullBuffer, readableTileVariant } from "./shader-native-artifacts.mjs";
import { assertSealedRuntime } from "./sealed-runtime/clients.mjs";
import { acceptCompiledShaderOutput } from "./compiled-shader-boundary.mjs";
const encoder = new TextEncoder();
const MAX_TOTAL = 512 * 1024 * 1024;
function fail(message) {
  throw new Error(message);
}
function localStamp() {
  const date = new Date(),
    offset = -date.getTimezoneOffset(),
    sign = offset >= 0 ? "+" : "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
async function mainImage(bytes, signal) {
  if (!(bytes instanceof Uint8Array)) fail("Authenticated main NSO missing");
  const nso = await validateNsoSegments(
    { size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) },
    { signal },
  );
  const data = nso.segments[2],
    size = data.memoryOffset + data.decodedSize + nso.bssSize;
  if (!Number.isSafeInteger(size) || size > 256 * 1024 * 1024)
    fail("Main image exceeds shader bounds");
  const image = new Uint8Array(size);
  for (const segment of nso.segments) {
    signal?.throwIfAborted();
    if (segment.memoryOffset + segment.bytes.length > size)
      fail("Main segment exceeds native memory image");
    image.set(segment.bytes, segment.memoryOffset);
  }
  return image;
}
export function createProductionShaderAdapter({ runtime, catalog, trustedShell }) {
  assertSealedRuntime(runtime);
  assertShaderCatalog(catalog);
  trustedShell = structuredClone(trustedShell);
  if (catalog.keys.length !== 6927 || new Set(catalog.keys).size !== 6927)
    fail("Full pinned shader catalog required");
  const expected = [...catalog.keys].sort(),
    supplied = [...(trustedShell?.trustedRecipe?.shaderKeys ?? [])].sort();
  if (JSON.stringify(expected) !== JSON.stringify(supplied))
    fail("Trusted release shader catalog differs from pinned full catalog");
  if (trustedShell.trustedRecipe.shaderDigest !== "be59c864f087b377")
    fail("Unsupported production shader source digest");
  if (typeof runtime.createAirCompilerClient !== "function")
    fail("Compiled shader runtime is unavailable; rebuild application assets");
  let compiler = runtime.createAirCompilerClient();
  if (typeof compiler?.compile !== "function" || typeof compiler?.dispose !== "function")
    fail("Invalid compiled shader runtime");
  let active = null,
    disposed = false,
    used = false,
    pipeline = null;
  const retained = [],
    releaseEntries = [];
  function dispose() {
    disposed = true;
    try {
      active?.abort();
      pipeline?.dispose();
      compiler?.dispose();
    } finally {
      try {
        for (const bytes of retained) bytes.fill(0);
      } finally {
        retained.length = 0;
        compiler = null;
        // 保留元数据，但解除已清理输出在条目闭包中的引用。
        // Keep metadata, but release cleaned output references held by entry closures.
        for (const release of releaseEntries.splice(0)) release();
      }
    }
  }
  return Object.freeze({
    async generateShaders({ extracted, selection, signal, onProgress } = {}) {
      if (disposed || used) fail("Production shader adapter is disposed or already used");
      signal?.throwIfAborted();
      used = true;
      const controller = new AbortController();
      active = controller;
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const check = () => {
        if (disposed) fail("Shader adapter disposed");
        signal?.throwIfAborted();
        controller.signal.throwIfAborted();
      };
      const budget = createShaderOutputBudget(MAX_TOTAL);
      const reportRecords = createShaderRecordProgress(
        expected.length,
        onProgress,
        controller.signal,
      );
      let sources;
      const pending = [],
        c1 = [];
      const compileLibrary = async (source, key, variant, replay) => {
        check();
        const sourceBytes = encoder.encode(source.replaceAll("\r\n", "\n"));
        let output;
        try {
          const sourceSha256 = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", sourceBytes)),
            (value) => value.toString(16).padStart(2, "0"),
          ).join("");
          check();
          output = await compiler.compile(source, {
            entry: replay.entry,
            stage: replay.msl_entry_kind,
            signal: controller.signal,
          });
          check();
          return await acceptCompiledShaderOutput({
            source,
            binary: output.bytes,
            compiler: output.compiler,
            options: output.options,
            expected: {
              key,
              variant,
              entry: replay.entry,
              stage: replay.msl_entry_kind,
              sourceSetDigest: trustedShell.trustedRecipe.shaderDigest,
              sourceSha256,
            },
            signal: controller.signal,
          });
        } finally {
          sourceBytes.fill(0);
          if (output?.bytes instanceof Uint8Array) output.bytes.fill(0);
        }
      };
      try {
        const assets = readAuthenticatedAssets(extracted, selection, { signal: controller.signal });
        const modules = readAuthenticatedProgramModules(extracted, selection, {
          signal: controller.signal,
        });
        pipeline = createShaderPipeline({
          trustedShell,
          translatorWorkerUrl: runtime.workerUrls.translator,
          crossWorkerUrl: runtime.workerUrls.spirvCross,
          workerFactory: runtime.createShaderWorkerFactory(),
        });
        // 按物理源分组，避免反复解码同一个包；
        // 完成、摘要及 c1 输出采用原生排序后的文件名顺序。
        // Group by physical source to avoid repeatedly decoding the same pack;
        // completion/digest and c1 output use native sorted filename order.
        const keys = [...expected].sort((a, b) => {
          const x = catalog.describe(a),
            y = catalog.describe(b);
          return x.name < y.name ? -1 : x.name > y.name ? 1 : x.index - y.index;
        });
        const packNameSet = new Set();
        for (const key of keys) {
          check();
          const descriptor = catalog.describe(key);
          if (!descriptor.embedded) packNameSet.add(descriptor.name);
        }
        const packNames = [...packNameSet];
        const packPaths = resolveLogicalAssetSuffixes(
          assets.logicalAssets,
          packNames.map((name) => `/hd/shaders/${name}`),
          check,
        );
        const pathsByPack = new Map(packNames.map((name, index) => [name, packPaths[index]]));
        sources = createShaderSourceCache(
          keys.filter((key) => catalog.describe(key).embedded).length,
        );
        for (const key of keys) {
          check();
          const descriptor = catalog.describe(key);
          let prepare;
          sources.enter(descriptor);
          if (descriptor.embedded) {
            if (!sources.image) sources.setImage(await mainImage(modules.main, controller.signal));
            prepare = (flags) => catalog.prepare(key, { mainImage: sources.image, ...flags });
          } else {
            if (sources.packName !== descriptor.name) {
              const path = pathsByPack.get(descriptor.name);
              if (path.toLowerCase() !== `data:data/hd/shaders/${descriptor.name}`)
                fail("Unexpected logical shader pack path");
              const pack = await assets.logicalAssets.read(path, {
                maxBytes: 256 * 1024 * 1024,
                signal: controller.signal,
              });
              if (!(pack instanceof Uint8Array)) fail("Shader pack did not return bytes");
              try {
                check();
                sources.setPack(
                  descriptor.name,
                  catalog.createOwnedPackSource(descriptor.name, pack),
                );
              } catch (error) {
                // 转移前失败仍由此处清理读取结果；成功转移后的清理由源所有者负责。
                // Before transfer, failed handoff still owns the read buffer; after transfer, the source owner handles cleanup.
                if (pack.byteLength) pack.fill(0);
                throw error;
              }
            }
            prepare = (flags) => sources.pack.prepare(key, flags);
          }
          const prepared = await prepare({
            debug: true,
            reduced: true,
            allowUnverifiedTessellation: true,
            signal: controller.signal,
          });
          let converted;
          try {
            // 准备期间取消也必须清理已返回的独立代码字节。
            // Cancellation during preparation must also wipe the returned owned code bytes.
            check();
            converted = await pipeline.translate({
              job: prepared.job,
              code: prepared.code,
              signal: controller.signal,
            });
          } finally {
            prepared.code.fill(0);
          }
          check();
          const source = converted.msl.replaceAll("\r\n", "\n");
          if (c1NeedsFullBuffer(source)) c1.push(key);
          const replay = {
            key: `${key}_b`,
            route: "B",
            dm_ctl: key,
            source: `${descriptor.name}#${descriptor.index}`,
            pc_paired: descriptor.pcPaired,
            stage: prepared.job.stage,
            entry: converted.replay.entry,
            msl_entry_kind: converted.replay.msl_entry_kind,
            threadgroup_size: prepared.job.local ?? null,
            c1: prepared.job.c1,
            notes: converted.resources.notes,
            drv_reads: converted.replay.drv_reads,
            drv_unfillable: converted.replay.drv_unfillable,
            bindings: converted.replay.bindings,
            vertex_inputs: converted.replay.vertex_inputs,
            raster: converted.replay.raster,
          };
          const variant =
            prepared.job.stage === "ps"
              ? readableTileVariant(source, replay.bindings, catalog.bfWant.includes(key))
              : null;
          if (variant) replay.fetch = variant.metadata;
          // 编译后只保留库字节，不再为整个目录保留所有 MSL 文本。
          // Retain compiled bytes rather than the whole catalog's MSL text.
          const baseResult = await compileLibrary(source, key, "b", replay);
          const base = baseResult.bytes;
          retained.push(base);
          budget.replace(0, base.length);
          let fetch = null,
            fetchResult;
          if (variant) {
            fetchResult = await compileLibrary(variant.msl, key, "bf", replay);
            fetch = fetchResult.bytes;
            retained.push(fetch);
            budget.replace(0, fetch.length);
          }
          check();
          // 记录实际 WASM 编译器，不再把参考 Xcode 命令写成已执行的编译器。
          // Record the actual WASM compiler, never an unexecuted reference Xcode command.
          replay.chain_metal = `${baseResult.receipt.compiler.id}; wasm; ios18; fastMath=true`;
          replay.compiled = {
            base: baseResult.receipt,
            baseReceiptSha256: baseResult.receiptSha256,
            ...(fetchResult
              ? { fetch: fetchResult.receipt, fetchReceiptSha256: fetchResult.receiptSha256 }
              : {}),
          };
          const replayReservation = encoder.encode(JSON.stringify(replay)).length;
          budget.replace(0, replayReservation);
          pending.push({ key, replay, base, fetch, replayReservation });
          reportRecords(pending.length);
          if (descriptor.embedded) sources.completeEmbedded();
          // 不联网地让出执行，允许在目录记录之间取消。
          // Yield without networking; permit cancellation between catalog records.
          await yieldBrowserTask({ signal: controller.signal });
        }
        check();
        const proof = await pipeline.verifyCompleteSourceSet();
        if (
          proof.sourceDigest !== trustedShell.trustedRecipe.shaderDigest ||
          pending.length !== 6927
        )
          fail("Full shader digest/completion proof failed");
        check();
        // 只有此处会应用外壳链标签。
        // 原生本地源码或头文件标签无需与外壳标签一致。
        // This is the only point at which shell chain labels are applied.
        // Native local source/header labels need not equal the shell label.
        const chain = trustedShell.trustedRecipe.chain,
          entries = [];
        const entry = (path, bytes) => {
          releaseEntries.push(() => {
            bytes = undefined;
          });
          return Object.freeze({
            path,
            size: bytes.length,
            mode: 0o644,
            async *chunks() {
              check();
              if (!bytes) fail("Shader adapter disposed");
              yield* shaderOutputChunks(bytes, check);
            },
          });
        };
        const checkpoint = createShaderFinalizationCheckpoint(check, controller.signal);
        for (const row of pending.sort((a, b) => a.key.localeCompare(b.key))) {
          check();
          row.replay.chain = chain;
          const json = encoder.encode(JSON.stringify(row.replay, null, 1));
          budget.replace(row.replayReservation, json.length);
          // 最终 JSON 已生成，后续只使用字节；解除回放对象的引用。
          // Final JSON is encoded; later steps use only bytes, so release the replay object reference.
          row.replay = undefined;
          retained.push(json);
          entries.push(
            entry(`msl/b-${chain}/${row.key}_b.metallib`, row.base),
            entry(`msl/b-${chain}/${row.key}_b.json`, json),
          );
          if (row.fetch) entries.push(entry(`msl/b-${chain}/${row.key}_bf.metallib`, row.fetch));
          const pause = checkpoint(json.length);
          if (pause) await pause;
        }
        check();
        const index = encoder.encode(
          `# chain b-${chain} ${localStamp()}\n` +
            c1
              .sort()
              .map((key) => key + "\n")
              .join(""),
        );
        budget.replace(0, index.length);
        retained.push(index);
        entries.push(entry("dm/c1_full.tsv", index));
        check();
        return entries;
      } catch (error) {
        dispose();
        throw error;
      } finally {
        sources?.dispose();
        pipeline?.dispose();
        pipeline = null;
        compiler?.dispose();
        compiler = null;
        active = null;
        signal?.removeEventListener("abort", abort);
      }
    },
    dispose,
  });
}

// 紧凑 JSON 只预留临时预算；最终格式化 JSON 必须替换预留，索引也计入上限。
// Compact JSON only reserves temporary budget; final formatted JSON replaces that reservation and the index counts too.
export function createShaderOutputBudget(limit = MAX_TOTAL) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_TOTAL)
    fail("Invalid shader output budget");
  let used = 0;
  return Object.freeze({
    replace(previous, actual) {
      if (
        !Number.isSafeInteger(previous) ||
        previous < 0 ||
        previous > used ||
        !Number.isSafeInteger(actual) ||
        actual < 0 ||
        actual > limit - (used - previous)
      )
        fail("Full shader source/replay byte budget exceeded");
      used = used - previous + actual;
    },
    get used() {
      return used;
    },
  });
}

// 输出每次只复制 64 KiB，且每块交付前检查取消和释放状态。
// Copy at most 64 KiB per output chunk, checking cancellation and disposal before each delivery.
export async function* shaderOutputChunks(bytes, check) {
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    check();
    yield bytes.slice(offset, offset + 65536);
  }
}

// 按实际使用次数释放镜像，而非假设嵌入记录连续；切换来源时释放包所有者及其有界索引。
// Release the image by actual remaining uses, not assumed contiguous embedded ordering; dispose the pack owner and bounded index on source switches.
export function createShaderSourceCache(embeddedCount) {
  if (!Number.isSafeInteger(embeddedCount) || embeddedCount < 0)
    fail("Invalid embedded shader count");
  let pack,
    packName = null,
    image;
  const clearPack = () => {
    pack?.dispose();
    pack = undefined;
    packName = null;
  };
  return Object.freeze({
    get pack() {
      return pack;
    },
    get packName() {
      return packName;
    },
    get image() {
      return image;
    },
    enter(descriptor) {
      if (descriptor.embedded || packName !== descriptor.name) clearPack();
    },
    setPack(name, source) {
      clearPack();
      pack = source;
      packName = name;
    },
    setImage(bytes) {
      image?.fill(0);
      image = bytes;
    },
    completeEmbedded() {
      if (embeddedCount <= 0) fail("Unexpected embedded shader completion");
      if (--embeddedCount === 0) {
        image?.fill(0);
        image = undefined;
      }
    },
    dispose() {
      clearPack();
      image?.fill(0);
      image = undefined;
    },
  });
}

// 仅报告已转换且计入预算的记录；全部记录完成不代表完整证明、阶段或 IPA 完成。
// Report only converted, budgeted records; all records counted does not mean proof, stage or IPA completion.
export function createShaderRecordProgress(
  totalRecords,
  onProgress,
  signal,
  now = () => performance.now(),
) {
  if (!Number.isSafeInteger(totalRecords) || totalRecords < 1 || totalRecords > 6927)
    fail("Invalid shader progress total");
  let previous = 0,
    lastEmitted = 0,
    lastTime = -Infinity;
  return (completedRecords) => {
    if (
      signal?.aborted ||
      typeof onProgress !== "function" ||
      !Number.isSafeInteger(completedRecords) ||
      completedRecords <= previous ||
      completedRecords > totalRecords
    )
      return;
    previous = completedRecords;
    const time = now();
    if (lastEmitted && completedRecords !== totalRecords && time - lastTime < 250) return;
    lastEmitted = completedRecords;
    lastTime = time;
    try {
      Promise.resolve(onProgress(Object.freeze({ completedRecords, totalRecords }))).catch(
        () => {},
      );
    } catch {
      // 观察者异常不得影响转换或证明。
      // Observer errors must not affect conversion or proof.
    }
  };
}

// 按实际输出工作量或单次任务时间让出；不为每条记录安排定时器。
// Yield by actual output work or task duration, without scheduling per-record timers.
export function createShaderFinalizationCheckpoint(
  check,
  signal,
  yieldTask = yieldBrowserTask,
  now = () => performance.now(),
) {
  let bytes = 0,
    started = now();
  return (written) => {
    check();
    if (!Number.isSafeInteger(written) || written < 0 || written > MAX_TOTAL)
      fail("Invalid shader finalization work");
    bytes += written;
    if (bytes < 4 * 1024 * 1024 && now() - started < 8) return undefined;
    return yieldTask({ signal }).then(() => {
      check();
      bytes = 0;
      started = now();
    });
  };
}
