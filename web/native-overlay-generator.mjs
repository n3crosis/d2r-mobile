// 依据原生覆盖配方及 CASC 增量写入契约生成覆盖资源。
// Generate overlay assets from native overlay recipes and the CASC delta-writing contract.
/**
 * 原始原生布局、表及字符串配方，加上真实 CASC 增量序列化。受信任的生成图像按精确原生路径进入；游戏字节只能经提取适配器的私有已认证能力进入。不复制整个 RomFS。
 * Original native layout/table/string recipe plus real CASC delta serialization.
 * Trusted generated art enters by exact native path; game bytes only through the
 * extraction adapter's private authenticated capability. No whole RomFS copy.
 */
import { readAuthenticatedAssets } from "./extraction-job-adapter.mjs";
import { writeCascOverlay } from "./casc-overlay-writer.mjs";

export const NATIVE_OVERLAY_LIMITS = Object.freeze({
  manifest: 128 * 1024 * 1024,
  projectedManifest: 16 * 1024 * 1024,
  assets: 64 * 1024 * 1024,
  generated: 48 * 1024 * 1024,
  payload: 128 * 1024 * 1024,
  output: 128 * 1024 * 1024,
  file: 16 * 1024 * 1024,
  rows: 262144,
  inputs: 8192,
});
export const NATIVE_OVERLAY_GENERATED = Object.freeze([
  "NativeHUD/v4/base.png",
  "NativeHUD/v4/hud.json",
  "NativeHUD/v4/hud_v4_ui/ui.json",
  "NativeHUD/touch/fe_rightpanel.sprite",
  "NativeHUD/mercslots/HirelingInventoryBG.sprite",
  "NativeHUD/pouch/PouchBox.sprite",
  "NativeHUD/widestash/MainPanelBG_Wide.sprite",
  "NativeHUD/widestash/VaultBottom.sprite",
  ...[
    "StashPanelBG",
    "StashPanelBGPersonal",
    "StashPanelBGShared",
    "AdvancedStash_Gems_Console",
    "AdvancedStash_Consumables_Console",
    "AdvancedStash_Runes_Console",
  ].map((n) => `NativeHUD/widestash/${n}_wide.sprite`),
]);
class OverlayRecipeError extends Error {}
const fail = (code) => {
  throw new OverlayRecipeError(code);
};
const bytes = (value) =>
  value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
const utf8 = new TextEncoder();
function path(value) {
  if (typeof value !== "string") fail("OVERLAY_PATH");
  value = value.toLowerCase().replaceAll("\\", "/").split(":").at(-1);
  if (!value.startsWith("data/")) value = `data/${value}`;
  if (
    value.length > 4096 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === ":") ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail("OVERLAY_PATH");
  return value;
}
function needed(p) {
  return (
    p.startsWith("data/global/ui/layouts/") ||
    (p.startsWith("data/local/lng/strings/") && p.endsWith(".json")) ||
    (p.startsWith("data/global/excel/") && (p.endsWith(".txt") || p.endsWith("/inventory.bin"))) ||
    (p.startsWith("data/hd/items/") && p.endsWith(".json")) ||
    p.startsWith("data/hd/global/ui/controller/controllerbuttons/switch/") ||
    (p.startsWith("data/hd/global/ui/controller/cursor/") && p.endsWith(".sprite"))
  );
}
function base64(raw) {
  let text = "";
  for (let i = 0; i < raw.length; i += 32768)
    text += String.fromCharCode(...raw.subarray(i, i + 32768));
  return btoa(text);
}
async function manifestInputs(romfs, logicalAssets, signal) {
  const file = romfs.getFile("data/build_manifest.psv");
  if (!file || file.size > BigInt(NATIVE_OVERLAY_LIMITS.manifest)) fail("OVERLAY_MANIFEST_LIMIT");
  const selected = new Map(),
    projected = [];
  let projectedBytes = 0,
    assetBytes = 0;
  const line = (text) => {
    if (!text || text.startsWith("#")) return;
    const f = text.replace(/\r$/, "").split("|");
    if (f.length < 11) return;
    const key = path(f[9]);
    const row = ["", "", "", "", f[4], f[5], "", "", "", f[9], ""].join("|") + "\n";
    projectedBytes += utf8.encode(row).length;
    if (
      projectedBytes > NATIVE_OVERLAY_LIMITS.projectedManifest ||
      projected.length >= NATIVE_OVERLAY_LIMITS.rows
    )
      fail("OVERLAY_MANIFEST_LIMIT");
    projected.push(row);
    if (!needed(key) || selected.has(key)) return;
    const actual = logicalAssets.lookup(key);
    // 原生变换选择清单中第一个匹配行，而通用
    // CASC 读取器索引最后一行。不要悄悄改变重复项语义。
    // Native transforms choose the first matching manifest row, while the generic
    // CASC reader indexes the last. Do not silently change duplicate semantics.
    if (actual[4] !== f[4] || actual[6] !== f[6] || actual[5] !== f[5])
      fail("OVERLAY_MANIFEST_DUPLICATE");
    if (!/^\d+$/.test(f[5])) fail("OVERLAY_RECORD_SIZE");
    const size = Number(f[5]);
    assetBytes += size;
    if (
      !Number.isSafeInteger(size) ||
      size > NATIVE_OVERLAY_LIMITS.file ||
      assetBytes > NATIVE_OVERLAY_LIMITS.assets ||
      selected.size >= NATIVE_OVERLAY_LIMITS.inputs
    )
      fail("OVERLAY_INPUT_LIMIT");
    selected.set(key, size);
  };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  for (let at = 0n; at < file.size;) {
    signal?.throwIfAborted();
    const length = Number(file.size - at > 65536n ? 65536n : file.size - at);
    const chunk = await file.readAt(at, length, { signal });
    if (!(chunk instanceof Uint8Array) || chunk.length !== length) fail("OVERLAY_MANIFEST_READ");
    pending += decoder.decode(chunk, { stream: true });
    at += BigInt(length);
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const text of lines) line(text);
    if (pending.length > 16384) fail("OVERLAY_MANIFEST_LINE");
  }
  pending += decoder.decode();
  if (pending) line(pending);
  return { manifest: projected.join(""), selected };
}

export async function generateNativeOverlay({
  extracted,
  selection,
  generated,
  worker,
  signal,
} = {}) {
  signal?.throwIfAborted();
  const assets = readAuthenticatedAssets(extracted, selection, { signal });
  if (
    !worker ||
    typeof worker.run !== "function" ||
    typeof worker.close !== "function" ||
    !generated ||
    Object.keys(generated).length !== NATIVE_OVERLAY_GENERATED.length
  )
    fail("OVERLAY_OPTIONS");
  const bundle = { manifest: "", assets: {}, generated: {} };
  let total = 0;
  for (const name of NATIVE_OVERLAY_GENERATED) {
    const data = bytes(generated[name]);
    if (
      !data?.length ||
      data.length > NATIVE_OVERLAY_LIMITS.file ||
      (total += data.length) > NATIVE_OVERLAY_LIMITS.generated
    )
      fail("OVERLAY_GENERATED_ART_REQUIRED");
    bundle.generated[name] = base64(data);
  }
  const output = {},
    owned = [];
  const abort = () => worker.close();
  signal?.addEventListener("abort", abort, { once: true });
  let payload;
  try {
    const input = await manifestInputs(assets.romfs, assets.logicalAssets, signal);
    bundle.manifest = input.manifest;
    for (const [key, size] of input.selected) {
      signal?.throwIfAborted();
      const data = await assets.logicalAssets.read(key, { maxBytes: size, signal });
      if (!(data instanceof Uint8Array) || data.length !== size) fail("OVERLAY_ASSET_READ");
      try {
        bundle.assets[key] = base64(data);
      } finally {
        data.fill(0);
      }
    }
    payload = utf8.encode(JSON.stringify(bundle));
    bundle.assets = {};
    bundle.generated = {};
    bundle.manifest = "";
    if (payload.length > NATIVE_OVERLAY_LIMITS.payload) fail("OVERLAY_INPUT_LIMIT");
    const result = await worker.run("overlay-recipe", payload, {});
    for (const value of Object.values(result?.files ?? {})) {
      const data = bytes(value);
      if (data) owned.push(data);
    }
    signal?.throwIfAborted();
    if (
      !Array.isArray(result?.variants) ||
      result.variants.length !== 2 ||
      result.variants[0].name !== "base" ||
      result.variants[1].name !== "item_notes"
    )
      fail("OVERLAY_VARIANT_SET");
    const used = new Set();
    const take = (id) => {
      const data = bytes(result.files[id]);
      if (
        typeof id !== "string" ||
        used.has(id) ||
        !data ||
        data.length > NATIVE_OVERLAY_LIMITS.file
      )
        fail("OVERLAY_RESULT_FILE");
      used.add(id);
      return data;
    };
    let outputBytes = 0;
    for (const variant of result.variants) {
      signal?.throwIfAborted();
      if (
        !Array.isArray(variant.replacements) ||
        variant.replacements.length > 4096 ||
        !Array.isArray(variant.sidecars)
      )
        fail("OVERLAY_RESULT");
      const replacements = variant.replacements.map((r) => {
        if (r.path !== path(r.path) || typeof r.add !== "boolean") fail("OVERLAY_RESULT_PATH");
        return { path: r.path, add: r.add, bytes: take(r.file) };
      });
      const overlay = await writeCascOverlay({ romfs: assets.romfs, replacements, worker, signal });
      const prefix =
        variant.name === "base" ? "romfs_overlay" : "romfs_overlay_variants/item_notes";
      for (const [name, value] of Object.entries(overlay.files)) {
        const data = bytes(value);
        owned.push(data);
        if (!data || (outputBytes += data.length) > NATIVE_OVERLAY_LIMITS.output)
          fail("OVERLAY_OUTPUT_LIMIT");
        output[`${prefix}/${name}`] = data.slice();
      }
      const sideNames = variant.sidecars.map((s) => s.path).sort();
      const expected =
        variant.name === "base"
          ? ["ctrl_touch", "touch_strings.tsv"]
          : ["ctrl_touch", "dm_textbox_plain.tsv", "features.txt", "touch_strings.tsv"];
      if (JSON.stringify(sideNames) !== JSON.stringify(expected)) fail("OVERLAY_SIDECAR_SET");
      for (const side of variant.sidecars) {
        const data = take(side.file);
        if ((outputBytes += data.length) > NATIVE_OVERLAY_LIMITS.output)
          fail("OVERLAY_OUTPUT_LIMIT");
        output[`${prefix}/${side.path}`] = data.slice();
      }
    }
    if (used.size !== Object.keys(result.files).length) fail("OVERLAY_UNEXPECTED_FILE");
    return Object.freeze({
      files: Object.freeze(output),
      variants: Object.freeze(["base", "item_notes"]),
    });
  } catch (error) {
    for (const value of Object.values(output)) value.fill(0);
    if (signal?.aborted) throw signal.reason ?? new Error("OVERLAY_CANCELLED");
    if (error instanceof OverlayRecipeError) throw error;
    throw new OverlayRecipeError("OVERLAY_RECIPE_FAILED");
  } finally {
    signal?.removeEventListener("abort", abort);
    payload?.fill(0);
    for (const value of owned) value?.fill(0);
  }
}
