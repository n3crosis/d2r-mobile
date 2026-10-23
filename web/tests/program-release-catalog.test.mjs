// 只用已登记的公开摘要与合成字节测试版本选择及拒绝边界；不读取游戏内容。
// Test release selection and rejection boundaries with registered public digests and synthetic bytes, without reading game content.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  REGISTERED_PROGRAM_CATALOG,
  REGISTERED_PROGRAM_RELEASE,
  findRegisteredProgramRelease,
  diagnoseRegisteredProgramDigests,
} from "../program-release-catalog.mjs";
import {
  PROGRAM_COMPATIBILITY,
  isProgramCompatibilityDiagnosticCode,
} from "../program-compatibility.mjs";
import { createProgramRewriterAdapter } from "../program-rewriter-adapter.mjs";
import {
  resolveShellProfile,
  SHELL_PROFILE_IDS,
  BUNDLED_SHELL_PROFILE_IDS,
} from "../shell-profiles.mjs";
import { createJavaScriptProgramRewriter } from "../toolchain/program-rewrite-spike/js/rewrite.mjs";

const knownDigests = Object.fromEntries(
  REGISTERED_PROGRAM_RELEASE.modules.map((module) => [module.name, module.inputSha256]),
);

test("registered release selection requires the complete exact module digest tuple", () => {
  const result = diagnoseRegisteredProgramDigests({ ...knownDigests });
  assert.deepEqual(result, {
    status: "registered",
    releaseId: REGISTERED_PROGRAM_RELEASE.id,
    gameVersion: "3.3.94012",
  });
  assert.equal(findRegisteredProgramRelease(result.releaseId), REGISTERED_PROGRAM_RELEASE);
  assert.ok(Object.isFrozen(result));
  for (const name of ["main", "sdk"]) {
    assert.equal(
      diagnoseRegisteredProgramDigests({ ...knownDigests, [name]: "0".repeat(64) }).status,
      "incompatible-modules",
    );
  }
  assert.deepEqual(
    diagnoseRegisteredProgramDigests({ main: "0".repeat(64), sdk: "1".repeat(64) }),
    {
      status: "unsupported-version",
      releaseId: null,
      gameVersion: null,
    },
  );
  assert.equal(
    diagnoseRegisteredProgramDigests({ main: knownDigests.sdk, sdk: knownDigests.main }).status,
    "unsupported-version",
  );
});

test("malformed claims and unknown release IDs never select a default", () => {
  for (const invalid of [
    null,
    {},
    { main: knownDigests.main },
    { ...knownDigests, rtld: "0".repeat(64) },
    { ...knownDigests, main: knownDigests.main.toUpperCase() },
    { ...knownDigests, sdk: "x".repeat(64) },
  ])
    assert.throws(() => diagnoseRegisteredProgramDigests(invalid), /PROGRAM_INVALID_MODULE_SET/);
  for (const id of [undefined, null, {}, "", "__proto__", "constructor", "3.3.94012", "latest"])
    assert.equal(findRegisteredProgramRelease(id), null);
  assert.throws(() => REGISTERED_PROGRAM_CATALOG.versions.push({ id: "custom" }), TypeError);
});

test("compatibility catalog stays honest, frozen and explicitly binds each shell to registered programs", () => {
  assert.equal(PROGRAM_COMPATIBILITY.arbitraryGameVersions, false);
  assert.equal(PROGRAM_COMPATIBILITY.arbitraryShellImports, false);
  assert.equal(PROGRAM_COMPATIBILITY.browserNativeSourceRebuild, false);
  assert.equal(PROGRAM_COMPATIBILITY.realGameVerified, false);
  assert.deepEqual(
    PROGRAM_COMPATIBILITY.releases.map((release) => release.gameVersion),
    ["3.3.94012"],
  );
  assert.deepEqual(
    PROGRAM_COMPATIBILITY.shellProfiles.map((profile) => profile.id),
    BUNDLED_SHELL_PROFILE_IDS,
  );
  for (const summary of PROGRAM_COMPATIBILITY.shellProfiles) {
    const profile = resolveShellProfile(summary.id);
    assert.equal(summary.minimumVersion, profile.guestTarget.minimumVersion);
    assert.deepEqual(summary.programReleaseIds, [REGISTERED_PROGRAM_RELEASE.id]);
    assert.throws(() => summary.programReleaseIds.push("caller-release"), TypeError);
  }
  assert.throws(() => PROGRAM_COMPATIBILITY.releases.push({}), TypeError);
});

test("only fixed program diagnostic codes can reach a public report", () => {
  for (const code of [
    "PROGRAM_UNSUPPORTED_VERSION",
    "PROGRAM_MODULE_RELEASE_MISMATCH",
    "PROGRAM_SHELL_RELEASE_MISMATCH",
    "PROGRAM_INVALID_MODULE_SET",
    "PROGRAM_INPUT_DIGEST_MISMATCH",
    "PROGRAM_BUILD_ID_MISMATCH",
  ])
    assert.equal(isProgramCompatibilityDiagnosticCode(code), true);
  for (const code of [null, {}, "PROGRAM_UNSUPPORTED_VERSION /private/file", knownDigests.main])
    assert.equal(isProgramCompatibilityDiagnosticCode(code), false);
});

function syntheticInput() {
  const main = new Uint8Array(256).fill(1),
    sdk = new Uint8Array(256).fill(2);
  main.set(Buffer.from(REGISTERED_PROGRAM_RELEASE.modules[0].buildId, "hex"), 0x40);
  return { main, sdk };
}
function adapter(input, profileId, createWorker = () => assert.fail("Unexpected worker creation")) {
  return createProgramRewriterAdapter({
    profileId,
    verifyProvenance: () => input,
    createWorker,
  });
}

test("unknown registered bytes reject before worker creation and leave borrowed input intact", async () => {
  const input = syntheticInput();
  const originals = Object.fromEntries(
    Object.entries(input).map(([name, bytes]) => [name, bytes.slice()]),
  );
  await assert.rejects(adapter(input).generateProgram(), { code: "PROGRAM_UNSUPPORTED_VERSION" });
  for (const name of ["main", "sdk"]) assert.deepEqual(input[name], originals[name]);
  await assert.rejects(adapter({ main: input.main }).generateProgram(), {
    code: "PROGRAM_INVALID_MODULE_SET",
  });
});

// 仅在测试中替换摘要结果以抵达注册路线；不是对真实游戏输入的验证。
// Substitute digest results only in this test to reach the registered route, never as evidence about real game input.
function mockMeasuredDigests(t, input, partial = false) {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const originals = Object.fromEntries(
    Object.entries(input).map(([name, bytes]) => [
      name,
      createHash("sha256").update(bytes).digest("hex"),
    ]),
  );
  t.mock.method(globalThis.crypto.subtle, "digest", (algorithm, bytes) => {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const name = Object.keys(originals).find((key) => originals[key] === hash);
    if (name && (!partial || name === "main"))
      return Promise.resolve(Uint8Array.from(Buffer.from(knownDigests[name], "hex")).buffer);
    return digest(algorithm, bytes);
  });
}

test("known main with a mismatched SDK produces the fixed mixed-release diagnostic", async (t) => {
  const input = syntheticInput();
  mockMeasuredDigests(t, input, true);
  await assert.rejects(adapter(input).generateProgram(), {
    code: "PROGRAM_MODULE_RELEASE_MISMATCH",
  });
});

test("measured release identity routes to both pinned shells and the worker, never a caller version label", async (t) => {
  const input = syntheticInput();
  mockMeasuredDigests(t, input);
  for (const profileId of SHELL_PROFILE_IDS) {
    let calls = 0;
    const expected = new Error("Synthetic worker stop");
    const instance = adapter(input, profileId, () => ({
      run(request) {
        calls++;
        assert.equal(request.releaseId, REGISTERED_PROGRAM_RELEASE.id);
        assert.equal(request.caseName, undefined);
        assert.equal(request.moduleName, "main");
        throw expected;
      },
      close() {},
    }));
    await assert.rejects(instance.generateProgram(), { code: "PROGRAM_GENERATION_FAILED" });
    assert.equal(calls, 1);
  }
});

test("a matching digest cannot bypass the independent build-ID check", async (t) => {
  const input = syntheticInput();
  input.main.fill(0, 0x40, 0x50);
  mockMeasuredDigests(t, input);
  await assert.rejects(adapter(input).generateProgram(), { code: "PROGRAM_BUILD_ID_MISMATCH" });
});

test("worker rejects an unknown release or mismatched bytes before native initialization", async () => {
  const rewrite = createJavaScriptProgramRewriter(() =>
    assert.fail("Unexpected native initialization"),
  );
  for (const releaseId of ["caller-release", REGISTERED_PROGRAM_RELEASE.id]) {
    await assert.rejects(
      rewrite({ bytes: new Uint8Array(256), releaseId, moduleName: "main" }),
      /Unsupported registered program input/,
    );
  }
});

// 仅在隔离的测试模块中加入第二份合成登记，验证无需新增生产注入接口的目录扩展。
// Add a second synthetic registration only inside isolated test modules, proving extension without introducing a production injection API.
async function extendedCatalogFixture() {
  const inputs = syntheticInput();
  const release = {
    ...REGISTERED_PROGRAM_RELEASE,
    id: "second-repository-fixture",
    gameVersion: "synthetic-only",
    modules: REGISTERED_PROGRAM_RELEASE.modules.map((module) => ({
      ...module,
      inputSha256: createHash("sha256").update(inputs[module.name]).digest("hex"),
    })),
  };
  const asModule = (source) =>
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const catalogSource = await readFile(
    new URL("../program-release-catalog.mjs", import.meta.url),
    "utf8",
  );
  const marker = "versions: Object.freeze([REGISTERED_PROGRAM_RELEASE]),";
  assert.equal(catalogSource.split(marker).length, 2);
  const catalogUrl = asModule(
    catalogSource.replace(
      marker,
      `versions: Object.freeze([REGISTERED_PROGRAM_RELEASE, Object.freeze(${JSON.stringify(release)})]),`,
    ),
  );
  async function sourceWithImports(path, overrides, transform = (source) => source) {
    const sourceUrl = new URL(path, import.meta.url);
    let source = transform(await readFile(sourceUrl, "utf8"));
    const file = ts.createSourceFile(
      "isolated.mjs",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    assert.equal(file.parseDiagnostics.length, 0);
    for (const statement of [...file.statements].reverse()) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier) continue;
      const specifier = statement.moduleSpecifier;
      assert.ok(ts.isStringLiteral(specifier));
      source =
        source.slice(0, specifier.getStart(file)) +
        JSON.stringify(overrides[specifier.text] ?? new URL(specifier.text, sourceUrl).href) +
        source.slice(specifier.end);
    }
    return asModule(source);
  }
  const profileUrl = await sourceWithImports(
    "../shell-profiles.mjs",
    { "./program-release-catalog.mjs": catalogUrl },
    (source) =>
      source.replace(
        "programReleaseIds: [REGISTERED_PROGRAM_RELEASE.id],",
        `programReleaseIds: [REGISTERED_PROGRAM_RELEASE.id, ${JSON.stringify(release.id)}],`,
      ),
  );
  const adapterUrl = await sourceWithImports("../program-rewriter-adapter.mjs", {
    "./program-release-catalog.mjs": catalogUrl,
    "./shell-profiles.mjs": profileUrl,
  });
  return {
    inputs,
    release,
    catalog: await import(catalogUrl),
    createAdapter: (await import(adapterUrl)).createProgramRewriterAdapter,
  };
}

test("a second repository registration is measured, selected and bound to its explicit shell", async () => {
  const { inputs, release, catalog, createAdapter } = await extendedCatalogFixture();
  const measured = Object.fromEntries(
    release.modules.map((module) => [module.name, module.inputSha256]),
  );
  assert.equal(catalog.diagnoseRegisteredProgramDigests(measured).releaseId, release.id);
  assert.equal(
    catalog.diagnoseRegisteredProgramDigests({ ...measured, main: knownDigests.main }).status,
    "incompatible-modules",
  );
  let workerRelease;
  await assert.rejects(
    createAdapter({
      verifyProvenance: () => inputs,
      createWorker: () => ({
        run(request) {
          workerRelease = request.releaseId;
          throw new Error("Synthetic worker stop");
        },
        close() {},
      }),
    }).generateProgram(),
    { code: "PROGRAM_GENERATION_FAILED" },
  );
  assert.equal(workerRelease, release.id);
  await assert.rejects(
    createAdapter({
      profileId: "v1.0.18-ios18",
      verifyProvenance: () => inputs,
      createWorker: () => assert.fail("Unbound release reached worker"),
    }).generateProgram(),
    { code: "PROGRAM_SHELL_RELEASE_MISMATCH" },
  );
  assert.equal(findRegisteredProgramRelease(release.id), null);
  assert.equal(REGISTERED_PROGRAM_CATALOG.versions.length, 1);
});
