/** Browser compute/vertex/fragment translator -> SPIRV-Cross adapter. No package writer. */
import { validateShellContract } from "./shell-contract.mjs";
import {
  CROSS_COMMIT,
  MSL_ARGUMENTS,
  validateSpirv,
} from "./toolchain/spirv-cross-spike/wwwroot/spirv-contract.mjs";
import { replayFields } from "./toolchain/spirv-cross-spike/wwwroot/replay-reflection.mjs";
export const SHADER_PIPELINE_LIMITS = Object.freeze({
  code: 1024 * 1024,
  metadata: 65536,
  spirv: 16 * 1024 * 1024,
  msl: 16 * 1024 * 1024,
  totalMsl: 256 * 1024 * 1024,
  shaders: 16384,
  timeoutMs: 120000,
});
const encoder = new TextEncoder();
const hex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
const digest = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const hash = async (bytes) => hex(await digest(bytes));
function error(message, name = "Error") {
  const e = new Error(message);
  e.name = name;
  return e;
}
function assetUrl(value, base) {
  const origin = new URL(base),
    url = new URL(value, origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.endsWith(".mjs")
  )
    throw error("Worker assets must be self-hosted same-origin module URLs");
  return url.href;
}
function decodeBase64(value) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(SHADER_PIPELINE_LIMITS.spirv / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw error("Invalid or oversized translator SPIR-V base64");
  const binary = atob(value);
  if (binary.length > SHADER_PIPELINE_LIMITS.spirv) throw error("Oversized translator SPIR-V");
  if (btoa(binary) !== value) throw error("Noncanonical translator SPIR-V base64");
  return validateSpirv(Uint8Array.from(binary, (x) => x.charCodeAt(0)));
}
function metadata(value) {
  const json = JSON.stringify(value);
  if (typeof json !== "string" || encoder.encode(json).length > SHADER_PIPELINE_LIMITS.metadata)
    throw error("Oversized shader metadata");
  return JSON.parse(json);
}
function resourceFacts(value, key, stage) {
  const r = metadata(value);
  if (
    !r ||
    r.key !== key ||
    r.stage !== stage ||
    !Array.isArray(r.notes) ||
    r.notes.some((x) => typeof x !== "string") ||
    !["sbufs", "cbufs", "textures", "images"].every((k) => Array.isArray(r[k]))
  )
    throw error("Translator resource sidecar does not match declared job stage");
  if (r.notes.length) throw error(`Unsupported translator query/defaults: ${r.notes.join("; ")}`);
  for (const b of r.sbufs)
    if (
      !b ||
      !["binding", "slot", "cb_slot", "cb_offset", "flags"].every(
        (k) => Number.isSafeInteger(b[k]) && b[k] >= 0,
      )
    )
      throw error("Malformed storage-buffer reflection");
  return r;
}
function rpc({ workerFactory, url, request, transfer, signal, timeoutMs, decode }) {
  if (signal.aborted) return Promise.reject(error("Shader conversion cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    let worker, timer;
    const finish = (failure, value) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (worker) {
        worker.removeEventListener("message", message);
        worker.removeEventListener("error", failed);
        worker.removeEventListener("messageerror", malformed);
        worker.terminate();
        worker = null;
      }
      if (failure) reject(failure);
      else resolve(value);
    };
    const abort = () => finish(error("Shader conversion cancelled", "AbortError"));
    const failed = (e) =>
      finish(error(`Shader worker failed: ${e.message ?? "startup/runtime error"}`));
    const malformed = () => finish(error("Shader worker returned an unreadable message"));
    const message = ({ data }) => {
      try {
        const reply = decode(data);
        if (reply.matched) finish(null, reply.result);
      } catch (e) {
        finish(e);
      }
    };
    try {
      worker = workerFactory(url, { type: "module" });
      worker.addEventListener("message", message);
      worker.addEventListener("error", failed);
      worker.addEventListener("messageerror", malformed);
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => finish(error("Shader conversion timed out", "TimeoutError")),
        timeoutMs,
      );
      if (signal.aborted) return abort();
      worker.postMessage(request, transfer);
    } catch (e) {
      finish(e);
    }
  });
}
/** trustedShell must come from the application's authenticated release catalog,
 * not from user-edited shell_info alone. It extends trustedRecipe with the full
 * shaderKeys list. Existing validation is metadata-only, not file authentication.
 */
export function createShaderPipeline({
  trustedShell,
  translatorWorkerUrl,
  crossWorkerUrl,
  baseUrl = globalThis.location?.href,
  workerFactory = (url, options) => new Worker(url, options),
  timeoutMs = SHADER_PIPELINE_LIMITS.timeoutMs,
}) {
  validateShellContract(trustedShell);
  const recipe = trustedShell.trustedRecipe;
  const shellCross = /^SPIRV_CROSS=([^\r\n]+)$/m.exec(trustedShell.shellInfoText)?.[1];
  if (recipe.spirvCrossVersion !== "1.4.363.0" || shellCross !== recipe.spirvCrossVersion)
    throw error(
      "Unsupported shell SPIRV_CROSS: this compiler is pinned to 1.4.363.0; a matched source/toolchain is required",
    );
  const keys = recipe.shaderKeys;
  if (
    !Array.isArray(keys) ||
    !keys.length ||
    keys.length > SHADER_PIPELINE_LIMITS.shaders ||
    keys.some((k) => typeof k !== "string" || !/^[0-9a-f]{16}$/.test(k)) ||
    new Set(keys).size !== keys.length
  )
    throw error("Trusted complete shader-key catalog required");
  if (typeof recipe.chain !== "string" || !/^[0-9a-f]{12}$/.test(recipe.chain))
    throw error("Trusted native shell chain required");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > SHADER_PIPELINE_LIMITS.timeoutMs
  )
    throw error("Invalid shader timeout");
  const contract = Object.freeze({
    chain: recipe.chain,
    shaderDigest: recipe.shaderDigest,
    keys: Object.freeze([...keys].sort()),
  });
  const allowed = new Set(contract.keys),
    completed = new Map();
  const translatorUrl = assetUrl(translatorWorkerUrl, baseUrl),
    crossUrl = assetUrl(crossWorkerUrl, baseUrl);
  let disposed = false,
    active = null,
    sequence = 0,
    totalMsl = 0;
  const ensureOpen = () => {
    if (disposed) throw error("Shader pipeline is disposed");
  };
  return Object.freeze({
    async translate({ job, code, signal } = {}) {
      ensureOpen();
      if (active) throw error("Only one shader conversion may run at a time");
      const requestJob = metadata(job);
      if (!requestJob || !["cs", "vs", "ps", "hs", "ds"].includes(requestJob.stage))
        throw error("Unsupported shader stage: geometry remains unsupported");
      const tessellation = ["hs", "ds"].includes(requestJob.stage);
      if (tessellation && requestJob.allowUnverifiedTessellation !== true)
        throw error("Tessellation requires explicit unverified-source-port opt-in");
      if (!allowed.has(requestJob.key))
        throw error("Shader key is outside trusted complete catalog");
      if (completed.has(requestJob.key)) throw error("Shader already converted in this pipeline");
      if (typeof requestJob.debug !== "boolean" || typeof requestJob.reduced !== "boolean")
        throw error("Explicit native debug/reduced translation options required");
      if (
        !(code instanceof Uint8Array) ||
        code.length < 16 ||
        code.length > SHADER_PIPELINE_LIMITS.code ||
        code.length % 8
      )
        throw error("Shader code must be 16 bytes to 1 MiB, 8-byte aligned");
      let hullOutputVertices = null;
      if (requestJob.stage !== "cs") {
        if (code.length < 0x60)
          throw error("Graphics input requires a 0x50-byte SPH plus instructions");
        const headerStage =
          (new DataView(code.buffer, code.byteOffset, code.byteLength).getUint32(0, true) >>> 10) &
          15;
        if (headerStage !== { vs: 1, hs: 2, ds: 3, ps: 5 }[requestJob.stage])
          throw error("Declared graphics stage does not match SPH stage bits 10..13");
        if (requestJob.stage === "hs")
          hullOutputVertices =
            new DataView(code.buffer, code.byteOffset, code.byteLength).getUint32(8, true) >>> 24;
        if (requestJob.stage === "hs" && hullOutputVertices === 0)
          throw error("Hull SPH requires nonzero threads per input primitive");
        for (const [name, limit] of [
          ["attr", 32],
          ["fout", 8],
        ]) {
          const types = requestJob[name];
          if (!types || typeof types !== "object" || Array.isArray(types))
            throw error("Graphics jobs require explicit attr and fout type tables");
          for (const [slot, type] of Object.entries(types))
            if (
              !/^(0|[1-9][0-9]*)$/.test(slot) ||
              Number(slot) >= limit ||
              !["float", "sint", "uint"].includes(type)
            )
              throw error("Invalid graphics attribute/output component type or slot");
        }
      }
      if (signal?.aborted) throw error("Shader conversion cancelled", "AbortError");
      const controller = new AbortController();
      active = controller;
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const deadline = Date.now() + timeoutMs,
        requestId = ++sequence;
      const remaining = () => Math.max(1, deadline - Date.now());
      try {
        const bytes = code.slice(),
          codeSha256 = await hash(bytes),
          jobSha256 = await hash(encoder.encode(JSON.stringify(requestJob)));
        const translated = await rpc({
          workerFactory,
          url: translatorUrl,
          signal: controller.signal,
          timeoutMs: remaining(),
          request: { requestId, job: requestJob, code: bytes },
          transfer: [bytes.buffer],
          decode(data) {
            if (data?.requestId !== requestId) return { matched: false };
            if (data.error) throw error(`Shader translation failed: ${data.error}`);
            if (!data.result) throw error("Missing translator result");
            return { matched: true, result: data.result };
          },
        });
        const resources = resourceFacts(translated.resources, requestJob.key, requestJob.stage),
          spirv = decodeBase64(translated.spirvBase64),
          spirvSha256 = await hash(spirv);
        const converted = await rpc({
          workerFactory,
          url: crossUrl,
          signal: controller.signal,
          timeoutMs: remaining(),
          request: {
            id: requestId,
            type: "convert",
            spirv: spirv.buffer,
            replayContext: { stage: requestJob.stage, resources },
          },
          transfer: [spirv.buffer],
          decode(data) {
            if (data?.id !== requestId) return { matched: false };
            if (data.ok !== true)
              throw error(`SPIRV-Cross conversion failed: ${data.error ?? "invalid reply"}`);
            return { matched: true, result: data.result };
          },
        });
        if (
          !converted ||
          typeof converted.msl !== "string" ||
          converted.msl.length > SHADER_PIPELINE_LIMITS.msl ||
          converted.msl.includes("\r")
        )
          throw error("Invalid or oversized LF Metal source");
        const mslBytes = encoder.encode(converted.msl);
        if (
          mslBytes.length > SHADER_PIPELINE_LIMITS.msl ||
          totalMsl + mslBytes.length > SHADER_PIPELINE_LIMITS.totalMsl
        )
          throw error("Shader-source memory budget exceeded");
        const sourceHash = await digest(mslBytes),
          provenance = converted.provenance;
        if (
          converted.schema !== "spirv-cross-browser-stage-v1" ||
          provenance?.spirvCrossCommit !== CROSS_COMMIT ||
          JSON.stringify(provenance.mslArguments) !== JSON.stringify(MSL_ARGUMENTS) ||
          provenance.inputSha256 !== spirvSha256 ||
          provenance.mslSha256 !== hex(sourceHash) ||
          provenance.nativeChainClaimed !== false ||
          provenance.metalCompiled !== false
        )
          throw error("SPIRV-Cross provenance mismatch");
        const replay = replayFields(requestJob.stage, converted.msl, resources);
        const mode = { cs: "comp", vs: "vert", ps: "frag", hs: "tesc", ds: "tese" }[
          requestJob.stage
        ];
        if (
          converted.reflection?.entryPoints?.length !== 1 ||
          converted.reflection.entryPoints[0].mode !== mode ||
          replay.msl_entry_kind !==
            { cs: "kernel", vs: "vertex", ps: "fragment", hs: "kernel", ds: "vertex" }[
              requestJob.stage
            ]
        )
          throw error("Compiled SPIR-V/MSL stage does not match declared job");
        if (
          requestJob.stage === "ds" &&
          !/\[\[\s*patch\(\s*triangle(?:\s*,\s*\d+)?\s*\)\s*\]\]/.test(converted.msl)
        )
          throw error("Domain MSL must preserve the original triangle patch contract");
        if (JSON.stringify(replay) !== JSON.stringify(converted.replay))
          throw error("SPIRV-Cross replay fields mismatch");
        if (controller.signal.aborted || disposed)
          throw error("Shader conversion cancelled", "AbortError");
        if (Date.now() > deadline) throw error("Shader conversion timed out", "TimeoutError");
        completed.set(requestJob.key, sourceHash);
        totalMsl += mslBytes.length;
        return {
          status: "shader-source-candidate",
          key: requestJob.key,
          stage: requestJob.stage,
          stageSupport: tessellation ? "source-ported-unverified" : "synthetic-parity-verified",
          tessellation: tessellation
            ? {
                nativeParityVerified: false,
                outputVertices: hullOutputVertices,
                domain: requestJob.stage === "ds" ? "triangles" : null,
                spacing: requestJob.stage === "ds" ? "equal" : null,
                stageLinkageVerified: false,
              }
            : null,
          threadgroup_size: requestJob.stage === "cs" ? (requestJob.local ?? null) : null,
          sourceName: `${requestJob.key}_b.metal`,
          msl: converted.msl,
          resources,
          replay,
          spirvReflection: converted.reflection,
          provenance: { ...provenance, codeSha256, jobSha256 },
          shellChain: contract.chain,
          shaderSourceSetVerified: false,
          installable: false,
          metalCompiled: false,
        };
      } finally {
        signal?.removeEventListener("abort", abort);
        active = null;
      }
    },
    async verifyCompleteSourceSet() {
      ensureOpen();
      if (active) throw error("Shader conversion is still running");
      const missing = contract.keys.filter((k) => !completed.has(k));
      if (missing.length)
        throw error(`Incomplete shader source set: ${missing.length} expected shaders missing`);
      // Exact d2rm_pack.py src_digest: sorted filename UTF-8 + raw SHA256(source),
      // then first 16 hex digits of SHA256 over that concatenation.
      const chunks = contract.keys.map((k) => {
        const name = encoder.encode(`${k}_b.metal`),
          data = new Uint8Array(name.length + 32);
        data.set(name);
        data.set(completed.get(k), name.length);
        return data;
      });
      const input = new Uint8Array(chunks.reduce((n, x) => n + x.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        input.set(chunk, offset);
        offset += chunk.length;
      }
      const sourceDigest = (await hash(input)).slice(0, 16);
      ensureOpen();
      if (sourceDigest !== contract.shaderDigest)
        throw error(
          `SHADER_SRC mismatch: generated ${sourceDigest}, trusted shell ${contract.shaderDigest}`,
        );
      return {
        status: "shader-source-set-equivalent",
        sourceDigest,
        shellChain: contract.chain,
        shaderCount: completed.size,
        installable: false,
        metalCompiled: false,
        chainRewritten: false,
      };
    },
    dispose() {
      disposed = true;
      active?.abort();
      completed.clear();
      totalMsl = 0;
    },
  });
}
