// 依据生产配置的固定入口验证配置选择；成功路径只使用合成字节和隔离的适配器。
// Verify closed production-profile selection; success paths use synthetic bytes and isolated adapters only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadProductionProfile } from "../production-profile.mjs";
import { resolveShellProfile, SHELL_PROFILE_IDS } from "../shell-profiles.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const moduleURL = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
function rewriteImports(source, resolve) {
  const file = ts.createSourceFile(
    "fixture.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(file.parseDiagnostics.length, 0);
  // 只替换真实导入的模块字面量，保留注释、字符串与 JSON 导入属性。
  // Replace only real import module literals, preserving comments, strings and JSON import attributes.
  for (const statement of [...file.statements].reverse()) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    assert.ok(ts.isStringLiteral(specifier));
    source =
      source.slice(0, specifier.getStart(file)) +
      JSON.stringify(resolve(specifier.text)) +
      source.slice(specifier.end);
  }
  return source;
}

test("isolated profile imports accept comments, quotes and newlines without rewriting text", async () => {
  for (const declaration of [
    'import { value } from "./synthetic.mjs";',
    "import{value}from'./synthetic.mjs';",
    "import {\n value,\n} from /* unchanged import */\n './synthetic.mjs';",
  ]) {
    const resolved = [];
    const text = 'from "./text-only.mjs"';
    const source = `${declaration}\nexport default value;\nexport const text = ${JSON.stringify(text)};\n// from "./comment-only.mjs"`;
    const rewritten = rewriteImports(source, (specifier) => {
      resolved.push(specifier);
      assert.equal(specifier, "./synthetic.mjs");
      return moduleURL("export const value = 7;");
    });
    const loaded = await import(moduleURL(rewritten));
    assert.equal(loaded.default, 7);
    assert.equal(loaded.text, text);
    assert.deepEqual(resolved, ["./synthetic.mjs"]);
    assert.ok(rewritten.endsWith('// from "./comment-only.mjs"'));
  }
});

const syntheticBytes = new Uint8Array([1, 3, 5, 7]);
function syntheticProfile() {
  return {
    id: "synthetic-profile",
    releaseId: "synthetic-release",
    archivePath: "profile/synthetic.zip",
    assetRecipe: { artRevision: "v1.0.18", overlayRevision: "v1.0.18" },
    guestTarget: { platform: "ios", minimumVersion: "18.0.0", sdkVersion: "26.0.0" },
    contentPin: { executablePath: "Synthetic", originalSha256: digest(syntheticBytes) },
    capacities: {
      shellSha256: digest(syntheticBytes),
      counts: { EXP: 7 },
      evidence: { executablePath: "Payload/Demo.app/Synthetic", executableSha256: "a".repeat(64) },
    },
    evidence: {
      sha256: digest(syntheticBytes),
      archiveBytes: syntheticBytes.length,
      entries: [{ path: "Payload/Demo.app/Synthetic", sha256: "a".repeat(64) }],
      shellInfo: {
        PRODUCT: "synthetic",
        CHAIN: "test",
        SHADER_SRC: "0123456789abcdef",
        SPIRV_CROSS: "test",
      },
      machOBuildVersions: [{ minimumVersion: "18.0.0" }],
      requiredPaths: ["synthetic-required"],
    },
  };
}
async function isolatedLoader(profile) {
  // 仅替换测试副本的依赖；生产入口不开放配方、摘要或适配器注入。
  // Replace dependencies only in the test copy; production exposes no recipe, digest or adapter injection.
  const mocks = {
    "./shell-profiles.mjs": `export const resolveShellProfile = () => (${JSON.stringify(profile)});`,
    "./shader-catalog-adapter.mjs": `export const loadShaderCatalog = async () => ({keys: ["synthetic-key"]});`,
    "./shell-target.mjs": `export const createShellTargetInspector = (options) => options;`,
    "./shell-loader.mjs": `export const createShellLoader = ({source, releaseId, resolveTrustedRelease, inspectTargetOS}) => async ({signal}) => ({source, releaseId, trusted: await resolveTrustedRelease(), inspector: inspectTargetOS, signal});`,
  };
  const sourceURL = new URL("../production-profile.mjs", import.meta.url);
  const source = rewriteImports(await readFile(sourceURL, "utf8"), (specifier) =>
    mocks[specifier] ? moduleURL(mocks[specifier]) : new URL(specifier, sourceURL).href,
  );
  return (await import(moduleURL(source))).loadProductionProfile;
}

test("default and explicit profiles read only their own archive, without fallback", async () => {
  for (const profileId of [undefined, ...SHELL_PROFILE_IDS]) {
    const reads = [];
    await assert.rejects(
      loadProductionProfile(
        {
          readPublicAsset(path) {
            reads.push(path);
            throw new Error("SYNTHETIC_MISSING_ARCHIVE");
          },
        },
        { profileId },
      ),
      /SYNTHETIC_MISSING_ARCHIVE/,
    );
    assert.deepEqual(reads, [resolveShellProfile(profileId).archivePath]);
  }
});

test("unknown, object and prototype profile identifiers fail before asset reads", async () => {
  for (const profileId of [
    null,
    "",
    "ios18",
    "constructor",
    "__proto__",
    {},
    { id: SHELL_PROFILE_IDS[0] },
  ]) {
    await assert.rejects(
      loadProductionProfile(
        {
          readPublicAsset() {
            assert.fail("unexpected asset read");
          },
        },
        { profileId },
      ),
      /SHELL_PROFILE_UNKNOWN/,
    );
  }
});

test("synthetic untrusted bytes cannot pass either built-in archive digest", async () => {
  for (const profileId of SHELL_PROFILE_IDS) {
    const reads = [];
    await assert.rejects(
      loadProductionProfile(
        {
          readPublicAsset(path) {
            reads.push(path);
            return syntheticBytes.slice();
          },
        },
        { profileId },
      ),
      /PUBLIC_SHELL_INTEGRITY/,
    );
    assert.deepEqual(reads, [resolveShellProfile(profileId).archivePath]);
  }
});

test("synthetic selection binds recipe, capacities, content pin, target and lifecycle", async () => {
  const selected = syntheticProfile();
  const load = await isolatedLoader(selected);
  const reads = [],
    bytes = syntheticBytes.slice(),
    signal = new AbortController().signal;
  const result = await load(
    {
      readPublicAsset(path) {
        reads.push(path);
        return path === selected.archivePath ? bytes : new TextEncoder().encode("{}");
      },
    },
    { profileId: selected.id, signal },
  );
  assert.equal(result.profileId, selected.id);
  assert.deepEqual(result.assetRecipe, selected.assetRecipe);
  assert.equal(result.contentMode, "optional-warlock");
  assert.deepEqual(result.derivedCounts, selected.capacities.counts);
  assert.deepEqual(result.contentPin, selected.contentPin);
  assert.deepEqual(result.guestTarget, selected.guestTarget);
  assert.equal(result.shell.releaseId, selected.releaseId);
  assert.equal(result.shell.signal, signal);
  assert.deepEqual(result.shell.inspector, { executablePath: selected.contentPin.executablePath });
  assert.deepEqual(result.trustedShell.files, selected.evidence.entries);
  assert.equal(result.trustedShell.trustedRecipe.product, selected.evidence.shellInfo.PRODUCT);
  assert.equal(
    result.trustedShell.trustedRecipe.shaderDigest,
    selected.evidence.shellInfo.SHADER_SRC,
  );
  assert.deepEqual(result.trustedShell.trustedRecipe.targetOS, {
    platform: "ios",
    minimumVersion: "18.0.0",
  });
  assert.deepEqual(
    result.trustedShell.trustedRecipe.requiredPaths,
    selected.evidence.requiredPaths,
  );
  assert.deepEqual(result.trustedShell.trustedRecipe.shaderKeys, ["synthetic-key"]);
  assert.equal(reads[0], selected.archivePath);
  assert.ok(!reads.includes("profile/shell.zip"));
  assert.deepEqual(await result.shell.source.read(0, bytes.length), syntheticBytes);
  result.close();
  result.close();
  assert.deepEqual(bytes, new Uint8Array(bytes.length));
  await assert.rejects(result.shell.source.read(0, 1), /PROFILE_CLOSED/);
});

test("mixed capacity evidence fails before I/O and matching digest cannot bypass archive size", async () => {
  for (const field of ["shellSha256", "executableSha256", "executablePath"]) {
    const selected = syntheticProfile();
    if (field === "shellSha256") selected.capacities[field] = "b".repeat(64);
    else selected.capacities.evidence[field] = "mismatch";
    const load = await isolatedLoader(selected);
    await assert.rejects(
      load({
        readPublicAsset() {
          assert.fail("unexpected asset read");
        },
      }),
      /SHELL_CAPACITY_BINDING/,
    );
  }
  const selected = syntheticProfile();
  selected.evidence.archiveBytes++;
  const load = await isolatedLoader(selected);
  await assert.rejects(
    load({ readPublicAsset: () => syntheticBytes.slice() }),
    /PUBLIC_SHELL_INTEGRITY/,
  );
});
