/** Full-catalog noMetal source assembly. Never invokes Apple Metal or relabels before digest proof. */
import { assertShaderCatalog } from "./shader-catalog-adapter.mjs";
import { createShaderPipeline } from "./shader-pipeline.mjs";
import {
  readAuthenticatedAssets,
  readAuthenticatedProgramModules,
} from "./extraction-job-adapter.mjs";
import { validateNsoSegments } from "./nso-validation.mjs";
import { c1NeedsFullBuffer, readableTileVariant } from "./shader-native-artifacts.mjs";
import { assertSealedRuntime } from "./sealed-runtime/clients.mjs";
const encoder = new TextEncoder();
const MAX_TOTAL = 512 * 1024 * 1024;
const IOS_RECORD =
  "xcrun -sdk iphoneos metal -c -mios-version-min=18.0; xcrun -sdk iphoneos metallib";
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
  let active = null,
    disposed = false,
    used = false,
    pipeline = null;
  const retained = [];
  function dispose() {
    disposed = true;
    active?.abort();
    pipeline?.dispose();
    for (const bytes of retained) bytes.fill(0);
    retained.length = 0;
  }
  return Object.freeze({
    async generateShaders({ extracted, selection, signal } = {}) {
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
      let pack = null,
        image = null,
        total = 0;
      const pending = [],
        c1 = [];
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
        let packName = null;
        // Group by physical source to avoid repeatedly decoding the same pack;
        // completion/digest and c1 output use native sorted filename order.
        const keys = [...expected].sort((a, b) => {
          const x = catalog.describe(a),
            y = catalog.describe(b);
          return x.name < y.name ? -1 : x.name > y.name ? 1 : x.index - y.index;
        });
        for (const key of keys) {
          check();
          const descriptor = catalog.describe(key);
          let input;
          if (descriptor.embedded) {
            if (!image) image = await mainImage(modules.main, controller.signal);
            input = { mainImage: image };
          } else {
            if (packName !== descriptor.name) {
              pack?.fill(0);
              const path = assets.logicalAssets.findUniquePathSuffix(
                `/hd/shaders/${descriptor.name}`,
              );
              if (path.toLowerCase() !== `data:data/hd/shaders/${descriptor.name}`)
                fail("Unexpected logical shader pack path");
              pack = await assets.logicalAssets.read(path, {
                maxBytes: 256 * 1024 * 1024,
                signal: controller.signal,
              });
              if (!(pack instanceof Uint8Array)) fail("Shader pack did not return bytes");
              packName = descriptor.name;
            }
            input = { packBytes: pack };
          }
          const prepared = await catalog.prepare(key, {
            ...input,
            debug: true,
            reduced: true,
            allowUnverifiedTessellation: true,
          });
          check();
          let converted;
          try {
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
            chain_metal: IOS_RECORD,
          };
          const variant =
            prepared.job.stage === "ps"
              ? readableTileVariant(source, replay.bindings, catalog.bfWant.includes(key))
              : null;
          if (variant) replay.fetch = variant.metadata;
          const base = encoder.encode(source),
            fetch = variant ? encoder.encode(variant.msl) : null;
          total +=
            base.length + (fetch?.length ?? 0) + encoder.encode(JSON.stringify(replay)).length;
          if (total > MAX_TOTAL) fail("Full shader source/replay byte budget exceeded");
          retained.push(base);
          if (fetch) retained.push(fetch);
          pending.push({ key, replay, base, fetch });
          // Yield without networking; permit cancellation between catalog records.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        check();
        const proof = await pipeline.verifyCompleteSourceSet();
        if (
          proof.sourceDigest !== trustedShell.trustedRecipe.shaderDigest ||
          pending.length !== 6927
        )
          fail("Full shader digest/completion proof failed");
        check();
        // This is the only point at which shell chain labels are applied.
        // Native local source/header labels need not equal the shell label.
        const chain = trustedShell.trustedRecipe.chain,
          entries = [];
        const entry = (path, bytes) =>
          Object.freeze({
            path,
            size: bytes.length,
            mode: 0o644,
            async *chunks() {
              check();
              yield bytes.slice();
            },
          });
        for (const row of pending.sort((a, b) => a.key.localeCompare(b.key))) {
          row.replay.chain = chain;
          const json = encoder.encode(JSON.stringify(row.replay, null, 1));
          retained.push(json);
          entries.push(
            entry(`msl/b-${chain}/${row.key}_b.metallib`, row.base),
            entry(`msl/b-${chain}/${row.key}_b.json`, json),
          );
          if (row.fetch) entries.push(entry(`msl/b-${chain}/${row.key}_bf.metallib`, row.fetch));
        }
        const index = encoder.encode(
          `# chain b-${chain} ${localStamp()}\n` +
            c1
              .sort()
              .map((key) => key + "\n")
              .join(""),
        );
        retained.push(index);
        entries.push(entry("dm/c1_full.tsv", index));
        return entries;
      } catch (error) {
        dispose();
        throw error;
      } finally {
        pack?.fill(0);
        image?.fill(0);
        pipeline?.dispose();
        pipeline = null;
        active = null;
        signal?.removeEventListener("abort", abort);
      }
    },
    dispose,
  });
}
