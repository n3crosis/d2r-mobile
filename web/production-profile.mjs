// 依据仓库中的外壳发布证据、资源来源记录及着色器目录加载可信生产配置。
// Load trusted production profiles from repository shell-release evidence, asset provenance and shader catalogs.
import { SHELL_DERIVED_CAPACITIES } from "./toolchain/shell-release-evidence/v1.0.18-derived-capacities.mjs";
import { loadShaderCatalog } from "./shader-catalog-adapter.mjs";
import { createShellLoader } from "./shell-loader.mjs";
import { createShellTargetInspector } from "./shell-target.mjs";
import evidence from "./toolchain/shell-release-evidence/v1.0.18.json" with { type: "json" };
import artPins from "./toolchain/asset-generation-spike/native-art-provenance.json" with { type: "json" };
import hudPins from "./toolchain/asset-generation-spike/hud-provenance.json" with { type: "json" };
const text = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
export async function loadProductionProfile(runtime, { signal } = {}) {
  if (
    SHELL_DERIVED_CAPACITIES.shellSha256 !== evidence.sha256 ||
    evidence.entries.find(
      (entry) => entry.path === SHELL_DERIVED_CAPACITIES.evidence.executablePath,
    )?.sha256 !== SHELL_DERIVED_CAPACITIES.evidence.executableSha256
  )
    throw new Error("SHELL_CAPACITY_BINDING");
  const read = (path) => runtime.readPublicAsset(path);
  const shellBytes = read("profile/shell.zip");
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", shellBytes)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
  if (sha !== evidence.sha256 || shellBytes.length !== evidence.archiveBytes)
    throw new Error("PUBLIC_SHELL_INTEGRITY");
  const catalog = await loadShaderCatalog({
    map: read("catalog/shader_map.tsv"),
    facts: read("catalog/shader_facts.tsv"),
    conflicts: read("catalog/shader_map.tsv.conflicts.tsv"),
  });
  const trustedRecipe = {
    schemaVersion: 1,
    product: evidence.shellInfo.PRODUCT,
    chain: evidence.shellInfo.CHAIN,
    kind: "ios",
    shaderDigest: evidence.shellInfo.SHADER_SRC,
    spirvCrossVersion: evidence.shellInfo.SPIRV_CROSS,
    shaderKeys: catalog.keys,
    targetOS: { platform: "ios", minimumVersion: evidence.machOBuildVersions[0].minimumVersion },
    requiredPaths: evidence.requiredPaths,
    extraFiles: ["dm/pack_info.txt", "dm/content_mode.json"],
  };
  const trustedShell = {
    verified: true,
    releaseId: evidence.release,
    trustedRecipe,
    files: evidence.entries,
  };
  const loadShell = createShellLoader({
    source: {
      size: shellBytes.length,
      read: async (offset, length) => shellBytes.slice(offset, offset + length),
    },
    releaseId: evidence.release,
    resolveTrustedRelease: async () => trustedShell,
    inspectTargetOS: createShellTargetInspector({ executablePath: "DmIOS" }),
  });
  const shell = await loadShell({ signal });
  function metadata(names, pins) {
    const value = {},
      hashes = {};
    for (const [key, path] of Object.entries(names)) {
      value[key] = text(read("profile/" + path.split("/").at(-1)));
      hashes[key] = pins[path];
    }
    return [value, hashes];
  }
  const [nativeArt, nativeArtSha256] = metadata(
    {
      manifest: "dm/ios/Sources/TouchArt/native_art_manifest.json",
      geometry: "dm/ios/docs/native_art_v1_geometry.json",
      binding: "dm/ios/docs/touch_layout_spec_native_binding_v5.json",
      implementation: "dm/ios/tools/native_art/implementation.c.inc",
    },
    artPins,
  );
  const [hud, hudSha256] = metadata(
    {
      manifest: "dm/ios/Sources/TouchArt/native_art_manifest.json",
      patch: "dm/ios/tools/touchrectv1_patch.json",
      i18n: "dm/i18n/ui_text.tsv",
    },
    hudPins,
  );
  return {
    contentMode: "optional-warlock",
    derivedCounts: SHELL_DERIVED_CAPACITIES.counts,
    catalog,
    trustedShell,
    shell,
    nativeArt,
    nativeArtSha256,
    hud,
    hudSha256,
    close() {
      shellBytes.fill(0);
    },
  };
}
