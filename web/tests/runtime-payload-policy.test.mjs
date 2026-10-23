// 验证已审计源码副本不会再次进入传输，同时保留真实字节加载入口和构建内的前端依赖。
// Keep audited source copies out of transport while retaining byte-loader entries and frontend build dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  RUNTIME_DIRECT_ASSETS,
  RUNTIME_SEALED_WORKERS,
  SOURCE_ONLY_RUNTIME_ASSETS,
  assertNoSourceOnlyRuntimeAsset,
} from "../runtime-build/payload-policy.mjs";
import { AIR_COMPILER_RUNTIME } from "../air-compiler-runtime-contract.mjs";
import { OPTIONAL_RUNTIME_ASSET_GROUPS } from "../runtime-asset-groups.mjs";
const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

// 检查真实静态值导入，不要求空格、引号样式或本地别名一致。
// Check real static value imports without requiring whitespace, quote style or local aliases.
function hasStaticValueImport(text, module, imported) {
  const file = ts.createSourceFile(
    "source.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return file.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== module
    )
      return false;
    const clause = statement.importClause;
    if (
      !clause ||
      clause.isTypeOnly ||
      !clause.namedBindings ||
      !ts.isNamedImports(clause.namedBindings)
    )
      return false;
    return clause.namedBindings.elements.some(
      (binding) => !binding.isTypeOnly && (binding.propertyName ?? binding.name).text === imported,
    );
  });
}

test("static import checks accept equivalent formatting but not comments, types or dynamic imports", () => {
  for (const text of [
    'import { prepareBrowserPackager } from "../browser-packager.mjs";',
    "import{prepareBrowserPackager as prepare}from'../browser-packager.mjs';",
    "import {\n /* value import */ prepareBrowserPackager,\n} from '../browser-packager.mjs'",
  ])
    assert.ok(hasStaticValueImport(text, "../browser-packager.mjs", "prepareBrowserPackager"));
  for (const text of [
    '// import { prepareBrowserPackager } from "../browser-packager.mjs";',
    'import type { prepareBrowserPackager } from "../browser-packager.mjs";',
    'import { type prepareBrowserPackager } from "../browser-packager.mjs";',
    'const { prepareBrowserPackager } = await import("../browser-packager.mjs");',
    'import { anotherValue } from "../browser-packager.mjs";',
    'import { prepareBrowserPackager } from "../other.mjs";',
  ])
    assert.equal(
      hasStaticValueImport(text, "../browser-packager.mjs", "prepareBrowserPackager"),
      false,
    );
});

test("only the 84 audited source-only assets are rejected; live assets and proof records remain", () => {
  assert.equal(SOURCE_ONLY_RUNTIME_ASSETS.length, 84);
  assert.equal(new Set(SOURCE_ONLY_RUNTIME_ASSETS).size, 84);
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

test("the fixed added CI shaders cannot enter the public runtime payload", () => {
  for (const fixture of [
    "toolchain/metal-air-compiler/fixtures/msl-scalar-operations.metal",
    "toolchain/metal-air-compiler/fixtures/msl-fragment-atomic-add.metal",
    "toolchain/metal-air-compiler/fixtures/msl-internal-helper-function-constant.metal",
    "toolchain/metal-air-compiler/fixtures/msl-optimizer-bit-reversal.metal",
    "toolchain/metal-air-compiler/fixtures/msl-patch-entry-name.metal",
    "toolchain/metal-air-compiler/fixtures/constant-vector-pointer-reads.metal",
    "toolchain/metal-air-compiler/fixtures/direct-buffer-vector-pointer.metal",
    "toolchain/metal-air-compiler/fixtures/conditional-distinct-buffer-rows.metal",
    "toolchain/metal-air-compiler/fixtures/loop-carried-buffer-pointer.metal",
    "toolchain/metal-air-compiler/fixtures/retyped-buffer-pointer-load.metal",
    "toolchain/metal-air-compiler/fixtures/metal-constant-pointer-slots.ll",
    "toolchain/metal-air-compiler/fixtures/metal-canonical-gep-recasts.ll",
    "toolchain/metal-air-compiler/fixtures/scalar-i1-conversions.ll",
    "toolchain/metal-air-compiler/fixtures/scalar-i1-conversions.expected.ll",
    "toolchain/metal-air-compiler/fixtures/scalar-i1-conversions.json",
    "toolchain/metal-air-compiler/fixtures/msl-stage-record-threadgroup.metal",
    "toolchain/metal-air-compiler/fixtures/msl-stage-record-buffers.metal",
    "toolchain/metal-air-compiler/fixtures/msl-buffer-reflection-mixed.metal",
    "toolchain/metal-air-compiler/fixtures/msl-buffer-reflection-array.metal",
    "toolchain/metal-air-compiler/fixtures/msl-buffer-reflection-float3.metal",
    "toolchain/metal-air-compiler/fixtures/msl-buffer-reflection-nested.metal",
    "toolchain/metal-air-compiler/fixtures/msl-fragment-input-liveness.metal",
    "toolchain/metal-air-compiler/check-fragment-input-reflection.mjs",
  ]) {
    assert(SOURCE_ONLY_RUNTIME_ASSETS.includes(fixture));
    assert(!RUNTIME_DIRECT_ASSETS.includes(fixture));
    assert(!RUNTIME_SEALED_WORKERS.includes(fixture));
    assert.throws(() => assertNoSourceOnlyRuntimeAsset(fixture), /Source-only module/);
  }
});

test("frontend imports the shared client at build time, not through runtime byte loading", async () => {
  const [app, packager, build, loader, assembly] = await Promise.all([
    source("../src/App.tsx"),
    source("../browser-packager.mjs"),
    source("../scripts/build.mjs"),
    source("../sealed-runtime/clients.mjs"),
    source("../runtime-build/package.mjs"),
  ]);
  assert.ok(hasStaticValueImport(app, "../browser-packager.mjs", "prepareBrowserPackager"));
  assert.ok(hasStaticValueImport(packager, "./sealed-runtime/clients.mjs", "prepareSealedRuntime"));
  assert.match(build, /entrypoints: \[resolve\(root, "index\.html"\)\]/);
  assert.doesNotMatch(build, /\bexternal\s*:/);
  for (const path of SOURCE_ONLY_RUNTIME_ASSETS) assert.ok(!loader.includes(`"${path}"`));
  assert.match(assembly, /assertNoSourceOnlyRuntimeAsset\(path\)/);
  assert.match(assembly, /for \(const path of RUNTIME_DIRECT_ASSETS\) await copy\(path\)/);
  assert.match(assembly, /await sealed\(`\$\{offline\}\/dist`, \{ bootstrap: false \}\)/);
  assert.match(assembly, /await sealed\(`\$\{offline\}\/dotnet-dist`, \{ bootstrap: false \}\)/);
  for (const path of RUNTIME_SEALED_WORKERS) {
    if (path === AIR_COMPILER_RUNTIME.entry) {
      assert.ok(
        hasStaticValueImport(
          loader,
          "../air-compiler-runtime-contract.mjs",
          "validateAirCompilerRuntimeComponent",
        ),
      );
      assert.match(loader, /validateAirCompilerRuntimeComponent\(manifest/);
      assert.match(assembly, /airCompilerRuntimeComponent\(airCompilerReport\)/);
      continue;
    }
    assert.ok(loader.includes(`"${path}"`));
    assert.ok(assembly.includes(`entry: "${path}"`));
  }
  assert.match(
    assembly,
    /translator: \{\s+sealedEntry: "sealed-runtime\/dotnet-worker\.mjs",\s+entry: "sealed-runtime\/dotnet-worker\.mjs"/,
  );
});
