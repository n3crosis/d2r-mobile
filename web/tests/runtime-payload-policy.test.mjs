// 验证已审计源码副本不会再次进入传输，同时保留真实字节加载入口和构建内的前端依赖。
// Keep audited source copies out of transport while retaining byte-loader entries and frontend build dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RUNTIME_DIRECT_ASSETS,
  RUNTIME_SEALED_WORKERS,
  SOURCE_ONLY_RUNTIME_ASSETS,
  assertNoSourceOnlyRuntimeAsset,
} from "../runtime-build/payload-policy.mjs";
import { OPTIONAL_RUNTIME_ASSET_GROUPS } from "../runtime-asset-groups.mjs";
const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("only the 55 audited source copies are rejected; live assets and proof records remain", () => {
  assert.equal(SOURCE_ONLY_RUNTIME_ASSETS.length, 55);
  assert.equal(new Set(SOURCE_ONLY_RUNTIME_ASSETS).size, 55);
  assert.ok(Object.isFrozen(SOURCE_ONLY_RUNTIME_ASSETS));
  for (const path of SOURCE_ONLY_RUNTIME_ASSETS)
    assert.throws(() => assertNoSourceOnlyRuntimeAsset(path), /Source-only module/);
  for (const path of [
    ...RUNTIME_DIRECT_ASSETS,
    ...RUNTIME_SEALED_WORKERS,
    ...OPTIONAL_RUNTIME_ASSET_GROUPS["legacy-astc"],
    "toolchain/offline-runtime-spike/dist/worker.mjs",
    "toolchain/offline-runtime-spike/dist/texture.mjs",
    "toolchain/offline-runtime-spike/dist/browser-texture.mjs",
    "toolchain/offline-runtime-spike/dist/manifest.json",
    "toolchain/offline-runtime-spike/dotnet-dist/worker.mjs",
    "toolchain/offline-runtime-spike/dotnet-dist/manifest.json",
    "toolchain/asset-runtime-js/dist/licenses/spark-md5-LICENSE.txt",
    "toolchain/shell-release-evidence/v1.0.18-derived-capacities.mjs",
    "toolchain/program-rewrite-spike/dist/toolchain/shell-release-evidence/v1.0.18-derived-capacities.mjs",
  ])
    assert.doesNotThrow(() => assertNoSourceOnlyRuntimeAsset(path));
});

test("frontend imports the shared client at build time, not through runtime byte loading", async () => {
  const [app, packager, build, loader, assembly] = await Promise.all([
    source("../src/App.tsx"),
    source("../browser-packager.mjs"),
    source("../scripts/build.mjs"),
    source("../sealed-runtime/clients.mjs"),
    source("../runtime-build/package.mjs"),
  ]);
  assert.match(
    app,
    /import \{[^}]*\bprepareBrowserPackager\b[^}]*\} from "\.\.\/browser-packager\.mjs"/,
  );
  assert.match(
    packager,
    /import \{ prepareSealedRuntime \} from "\.\/sealed-runtime\/clients\.mjs"/,
  );
  assert.match(build, /entrypoints: \[resolve\(root, "index\.html"\)\]/);
  assert.doesNotMatch(build, /\bexternal\s*:/);
  for (const path of SOURCE_ONLY_RUNTIME_ASSETS) assert.ok(!loader.includes(`"${path}"`));
  assert.match(assembly, /assertNoSourceOnlyRuntimeAsset\(path\)/);
  assert.match(assembly, /for \(const path of RUNTIME_DIRECT_ASSETS\) await copy\(path\)/);
  assert.match(assembly, /await sealed\(`\$\{offline\}\/dist`, \{ bootstrap: false \}\)/);
  assert.match(assembly, /await sealed\(`\$\{offline\}\/dotnet-dist`, \{ bootstrap: false \}\)/);
  for (const path of RUNTIME_SEALED_WORKERS) {
    assert.ok(loader.includes(`"${path}"`));
    assert.ok(assembly.includes(`entry: "${path}"`));
  }
  assert.match(
    assembly,
    /translator: \{\s+sealedEntry: "sealed-runtime\/dotnet-worker\.mjs",\s+entry: "sealed-runtime\/dotnet-worker\.mjs"/,
  );
});
