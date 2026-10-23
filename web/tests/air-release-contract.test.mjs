import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AIR_RELEASE_CAPS,
  AIR_RELEASE_OUTPUTS,
  airReleaseFileMaximum,
  airReleaseSha256,
  safeAirReleasePath,
  parseAirReleaseJson,
  validateFreshAirReleasePin,
  verifyFreshAirManifest,
  freshAirAssetUrl,
  verifyFreshAirAsset,
  freshAirSourceFingerprint,
  verifyFreshAirBuildInputs,
  verifyFreshAirReceipt,
  verifyFreshAirSourceLock,
  verifyFreshAirNotices,
} from "../runtime-build/air-release-contract.mjs";
import {
  createFreshAirReleaseFixture,
  fixtureJson,
  fixtureRecord,
  fixtureSha256,
  fixtureSourceFingerprint,
  fixtureHeaderDigest,
} from "./fixtures/air-release-generic/fixture.mjs";

// These tests parse/hash pinned metadata and synthetic bytes. No compiler or WASM runs.
const checkManifest = (fixture) => verifyFreshAirManifest(fixture.manifestBytes, fixture.pin);
const checkInputs = (fixture) => verifyFreshAirBuildInputs(fixture.inputsBytes, fixture.manifest);
const checkReceipt = (fixture) =>
  verifyFreshAirReceipt(fixture.receiptBytes, fixture.manifest, fixture.inputs);
const checkLock = (fixture) =>
  verifyFreshAirSourceLock(fixture.sourceLockBytes, fixture.manifest, fixture.inputs);

test("synthetic fresh metadata has deterministic, mutually bound source/API/output identities", () => {
  const fixture = createFreshAirReleaseFixture();
  const repeated = createFreshAirReleaseFixture();
  for (const name of ["manifestBytes", "receiptBytes", "inputsBytes", "sourceLockBytes"])
    assert.deepEqual(fixture[name], repeated[name], name);
  assert.deepEqual(checkManifest(fixture), fixture.manifest);
  assert.deepEqual(checkInputs(fixture), fixture.inputs);
  assert.deepEqual(checkReceipt(fixture), fixture.receipt);
  assert.deepEqual(checkLock(fixture), fixture.sourceLock);
  assert.equal(fixture.pin.commit, "1".repeat(40), "dummy commit, never an actual release pin");
  assert.equal(fixture.manifest.tree, "2".repeat(40));
  assert.equal(fixture.sourceFiles.size, 50);
  assert.equal(Object.keys(fixture.sourceLock.compilerFiles).length, 31);
  assert.equal(Object.keys(fixture.sourceLock.sdkFiles).length, 19);
  assert.equal(freshAirSourceFingerprint(fixture.inputs), fixtureSourceFingerprint(fixture.inputs));
  assert.equal(fixture.manifest.headerSha256, fixtureHeaderDigest(fixture.sourceLock));
  for (const [path, bytes] of fixture.runtimeFiles)
    assert.deepEqual(fixture.manifest.runtimeFiles[path], fixtureRecord(bytes), path);
  for (const [path, bytes] of fixture.sourceFiles)
    assert.equal(fixture.inputs.sourceInputs[path], fixtureSha256(bytes), path);
  assert.deepEqual(AIR_RELEASE_OUTPUTS, ["air_wasm.mjs", "air_wasm.wasm"]);
});

test("exact release pins reject aliases, malformed hashes, missing and extra fields", () => {
  const { pin } = createFreshAirReleaseFixture();
  assert.deepEqual(validateFreshAirReleasePin(pin), pin);
  const cases = [
    { schemaVersion: 2 },
    { repository: "https://github.com/example/project" },
    { repository: "../project" },
    { repository: "example/project/extra" },
    { commit: "main" },
    { commit: "A".repeat(40) },
    { commit: "1".repeat(39) },
    { version: "latest" },
    { version: "0.1.0" },
    { version: "v1.0.0/evil" },
    { manifestSha256: "F".repeat(64) },
    { manifestSha256: "a".repeat(63) },
    { historicalCommit: "3".repeat(40) },
  ];
  for (const change of cases)
    assert.throws(() => validateFreshAirReleasePin({ ...pin, ...change }), JSON.stringify(change));
  for (const key of Object.keys(pin)) {
    const changed = { ...pin };
    delete changed[key];
    assert.throws(() => validateFreshAirReleasePin(changed), key);
  }
  for (const invalid of [null, [], "pin", 0])
    assert.throws(() => validateFreshAirReleasePin(invalid));
});

test("signed JSON rejects duplicate keys including nested/escaped forms and bounded malformed input", () => {
  for (const json of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"outer":{"a":1,"a":2}}',
    '[{"a":1,"a":2}]',
    '{"a":[{"nested":1,"nested":2}]}',
    '{"__proto__":{},"__proto__":{}}',
  ])
    assert.throws(
      () => parseAirReleaseJson(Buffer.from(json)),
      /Duplicate AIR release JSON key/,
      json,
    );
  assert.deepEqual(
    parseAirReleaseJson(Buffer.from('{"a":{"x":1},"b":{"x":2},"text":"\\\"x\\\":1,\\\"x\\\":2"}')),
    {
      a: { x: 1 },
      b: { x: 2 },
      text: '"x":1,"x":2',
    },
  );
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from([0xff]),
    Buffer.from('{"a":'),
    Buffer.from("{}{}"),
  ])
    assert.throws(() => parseAirReleaseJson(bytes));
  assert.throws(() => parseAirReleaseJson(Buffer.from('{"x":1}'), 2), /cap/);
  assert.throws(
    () => parseAirReleaseJson(Buffer.from(`${"[".repeat(64)}0${"]".repeat(64)}`)),
    /nesting exceeds cap/,
  );
  assert.deepEqual(parseAirReleaseJson(Buffer.from("{}"), 2), {});
});

test("manifest checks the byte digest before schema and independently binds the exact pin", () => {
  const fixture = createFreshAirReleaseFixture();
  assert.throws(
    () =>
      verifyFreshAirManifest(Buffer.concat([fixture.manifestBytes, Buffer.from(" ")]), fixture.pin),
    /digest mismatch/,
  );
  for (const [field, value] of [
    ["repository", "other/fork"],
    ["commit", "3".repeat(40)],
    ["version", "v99.0.0"],
  ]) {
    const changed = createFreshAirReleaseFixture({
      mutateManifest: (report) => {
        report[field] = value;
      },
    });
    assert.throws(() => checkManifest(changed), /pin mismatch/, field);
  }
  for (const [field, value] of [
    ["schemaVersion", 2],
    ["status", "draft"],
    ["kind", "migrated-compiler"],
    ["binaryBuiltFromNewFork", false],
  ]) {
    const changed = createFreshAirReleaseFixture({
      mutateManifest: (report) => {
        report[field] = value;
      },
    });
    assert.throws(() => checkManifest(changed), /unfinished AIR fork release/, field);
  }
});

test("manifest rejects wrong source/API/header identity and provenance/output inconsistencies", () => {
  for (const change of [
    { tree: "main" },
    { sourceLockSha256: "bad" },
    { sourceFingerprintSha256: "bad" },
    { apiVersion: 1 },
    { headerBundleVersion: 1 },
    { sourceLanguage: "metal" },
    { headerSha256: "bad" },
    { buildReceiptSha256: "bad" },
  ])
    assert.throws(
      () =>
        checkManifest(
          createFreshAirReleaseFixture({
            mutateManifest: (report) => Object.assign(report, change),
          }),
        ),
      JSON.stringify(change),
    );
  for (const name of ["build-report.json", "source-lock.json", ...AIR_RELEASE_OUTPUTS]) {
    const fixture = createFreshAirReleaseFixture({
      mutateManifest: (report) => {
        report.runtimeFiles[name].sha256 = "a".repeat(64);
      },
    });
    assert.throws(() => checkManifest(fixture), /inventory differs/, name);
  }
});

test("runtime inventory has safe bounded paths, required closure and exact output records", () => {
  const valid = createFreshAirReleaseFixture();
  for (const path of [
    "",
    "/abs",
    "../escape",
    "a/../b",
    "a//b",
    "a/./b",
    "a\\b",
    "a\0b",
    "a".repeat(101),
  ]) {
    assert.equal(safeAirReleasePath(path), false, path);
    assert.throws(
      () =>
        checkManifest(
          createFreshAirReleaseFixture({
            mutateManifest: (report) => {
              report.runtimeFiles[path] = fixtureRecord(Buffer.from("x"));
            },
          }),
        ),
      path,
    );
  }
  for (const path of ["air_wasm.mjs", "licenses/llvm/LICENSE.TXT", "include/simd/simd.h"])
    assert.equal(safeAirReleasePath(path), true);
  for (const name of [
    "air_wasm.mjs",
    "air_wasm.wasm",
    "build-report.json",
    "source-lock.json",
    "air_compiler.h",
    "README.txt",
    "CONTENTS.sha256",
    "licenses/llvm/LICENSE.TXT",
    "licenses/clang/LICENSE.TXT",
    "licenses/llvm/include/llvm/Support/LICENSE.TXT",
    "licenses/llvm/include/llvm/Transforms/LibFloor/cfg/LICENSE",
    "licenses/llvm/lib/Transforms/LibFloor/cfg/LICENSE",
    "licenses/llvm/lib/Bitcode/MetalLib/bzip2/LICENSE",
    "licenses/llvm/lib/Bitcode/MetalLib/tar/LICENSE",
    "licenses/GPL-2.0.txt",
    "licenses/ORIGINS.json",
  ]) {
    const fixture = createFreshAirReleaseFixture({
      mutateManifest: (report) => {
        delete report.runtimeFiles[name];
      },
    });
    assert.throws(() => checkManifest(fixture), /Missing AIR runtime member/, name);
  }
  for (const bytes of [
    0,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    airReleaseFileMaximum("air_wasm.wasm") + 1,
  ]) {
    assert.throws(
      () =>
        checkManifest(
          createFreshAirReleaseFixture({
            mutateManifest: (report) => {
              report.files["air_wasm.wasm"].bytes = bytes;
            },
          }),
        ),
      /output records/,
      String(bytes),
    );
  }
  assert.throws(
    () =>
      checkManifest(
        createFreshAirReleaseFixture({
          mutateManifest: (report) => {
            report.files.extra = report.files["air_wasm.mjs"];
          },
        }),
      ),
    /output records/,
  );
  assert.throws(
    () =>
      checkManifest(
        createFreshAirReleaseFixture({
          mutateManifest: (report) => {
            report.files["air_wasm.mjs"].extra = true;
          },
        }),
      ),
    /output records/,
  );
  assert.throws(
    () =>
      checkManifest(
        createFreshAirReleaseFixture({
          mutateManifest: (report) => {
            for (let i = 0; i < 65; i++)
              report.runtimeFiles[`extra-${i}`] = valid.manifest.files["air_wasm.mjs"];
          },
        }),
      ),
    /runtime inventory/,
  );
});

test("asset closure enforces unique safe names, SHA-256 and positive bounded byte sizes", () => {
  const fixture = createFreshAirReleaseFixture();
  for (const [kind, maximum] of Object.entries(AIR_RELEASE_CAPS)) {
    assert.equal(
      freshAirAssetUrl(fixture.manifest, kind),
      `https://github.com/example/synthetic-air-fixture/releases/download/v0.0.0-test/${fixture.manifest.assets[kind].name}`,
    );
    verifyFreshAirAsset(fixture.assetBytes[kind], fixture.manifest, kind);
    assert.throws(
      () => verifyFreshAirAsset(Buffer.from("tampered"), fixture.manifest, kind),
      /asset mismatch/,
    );
    for (const bytes of [0, -1, 0.5, maximum + 1])
      assert.throws(
        () =>
          checkManifest(
            createFreshAirReleaseFixture({
              mutateManifest: (report) => {
                report.assets[kind].bytes = bytes;
              },
            }),
          ),
        /bounded AIR asset/,
        `${kind}:${bytes}`,
      );
    for (const name of ["../escape", "sub/path.tgz", "bad name", ""])
      assert.throws(
        () =>
          checkManifest(
            createFreshAirReleaseFixture({
              mutateManifest: (report) => {
                report.assets[kind].name = name;
              },
            }),
          ),
        /bounded AIR asset/,
        name,
      );
    assert.throws(
      () =>
        checkManifest(
          createFreshAirReleaseFixture({
            mutateManifest: (report) => {
              delete report.assets[kind];
            },
          }),
        ),
      /closure/,
    );
  }
  assert.throws(
    () =>
      checkManifest(
        createFreshAirReleaseFixture({
          mutateManifest: (report) => {
            report.assets.runtime.name = report.assets.correspondingSource.name;
          },
        }),
      ),
    /bounded AIR asset/,
  );
  assert.throws(() => freshAirAssetUrl(fixture.manifest, "unknown"), /Unknown/);
  assert.throws(
    () => verifyFreshAirAsset(Buffer.from("x"), fixture.manifest, "unknown"),
    /mismatch/,
  );
});

test("source fingerprints are order independent and bind repository, commit, tree, lock and all 50 inputs", () => {
  const { inputs } = createFreshAirReleaseFixture();
  assert.equal(freshAirSourceFingerprint(inputs), inputs.sourceFingerprintSha256);
  assert.equal(
    freshAirSourceFingerprint({
      ...inputs,
      sourceInputs: Object.fromEntries(Object.entries(inputs.sourceInputs).reverse()),
    }),
    inputs.sourceFingerprintSha256,
  );
  for (const [key, value] of [
    ["repository", "other/fork"],
    ["commit", "3".repeat(40)],
    ["tree", "4".repeat(40)],
    ["sourceLockSha256", "a".repeat(64)],
  ])
    assert.notEqual(
      freshAirSourceFingerprint({ ...inputs, [key]: value }),
      inputs.sourceFingerprintSha256,
      key,
    );
  const path = Object.keys(inputs.sourceInputs)[0];
  assert.notEqual(
    freshAirSourceFingerprint({
      ...inputs,
      sourceInputs: { ...inputs.sourceInputs, [path]: "a".repeat(64) },
    }),
    inputs.sourceFingerprintSha256,
  );
  for (const mutate of [
    (map) => {
      delete map[path];
    },
    (map) => {
      map["wasm/unexpected.cpp"] = "a".repeat(64);
    },
    (map) => {
      map[path] = "invalid";
    },
    (map) => {
      map["../escape"] = map[path];
      delete map[path];
    },
    (map) => {
      map["unbounded/root.cpp"] = map[path];
      delete map[path];
    },
  ]) {
    const sourceInputs = { ...inputs.sourceInputs };
    mutate(sourceInputs);
    assert.throws(
      () => freshAirSourceFingerprint({ ...inputs, sourceInputs }),
      /source input closure/,
    );
  }
});

test("inputs bind the release identity, digest, fingerprints, commands and tooling inventory", () => {
  const fixture = createFreshAirReleaseFixture();
  assert.throws(
    () =>
      verifyFreshAirBuildInputs(
        Buffer.concat([fixture.inputsBytes, Buffer.from(" ")]),
        fixture.manifest,
      ),
    /asset mismatch/,
  );
  for (const [key, value] of [
    ["schemaVersion", 2],
    ["version", "v4.0.0"],
    ["commit", "3".repeat(40)],
    ["tree", "4".repeat(40)],
    ["sourceFingerprintSha256", "a".repeat(64)],
  ])
    assert.throws(
      () =>
        checkInputs(
          createFreshAirReleaseFixture({
            mutateInputs: (report) => {
              report[key] = value;
            },
          }),
        ),
      key,
    );
  for (const commands of [
    [],
    [""],
    [42],
    [[""]],
    [["x".repeat(8193)]],
    Array.from({ length: 33 }, () => ["x"]),
  ])
    assert.throws(
      () =>
        checkInputs(
          createFreshAirReleaseFixture({
            mutateInputs: (report) => {
              report.commands = commands;
            },
          }),
        ),
      /build commands/,
    );
  for (const tooling of [
    {},
    { "../escape": "a".repeat(64) },
    { "wasm/build.mjs": "bad" },
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`file-${i}`, "a".repeat(64)])),
  ])
    assert.throws(
      () =>
        checkInputs(
          createFreshAirReleaseFixture({
            mutateInputs: (report) => {
              report.tooling = tooling;
            },
          }),
        ),
      /tooling inputs/,
    );
  const changed = createFreshAirReleaseFixture({
    mutateInputs: (report) => {
      report.sourceInputs[Object.keys(report.sourceInputs)[0]] = "a".repeat(64);
    },
  });
  assert.throws(() => checkInputs(changed), /fingerprint mismatch/);
});

test("receipt and build-input toolchains reject unsupported or incompletely disclosed environments", () => {
  const changes = [
    (tool) => {
      tool.emscriptenVersion = "latest";
    },
    (tool) => {
      tool.emsdkCommit = "a".repeat(40);
    },
    (tool) => {
      tool.nodeMajor = 22;
    },
    (tool) => {
      tool.platform = "Darwin";
    },
    (tool) => {
      tool.byteIdenticalRebuildClaimed = true;
    },
    ...[0, 5, 1.5].map((jobs) => (tool) => {
      tool.jobs = jobs;
    }),
    (tool) => {
      delete tool.versions.emcc;
    },
    (tool) => {
      tool.versions.node = "v22.0.0-test-fixture";
    },
    (tool) => {
      tool.versions.emcc = "emcc (synthetic metadata only) 3.1.0";
    },
    (tool) => {
      tool.versions.emcc = "emcc (synthetic metadata only) 4.0.200";
    },
    (tool) => {
      tool.runner.os = "Windows";
    },
    (tool) => {
      tool.versions.ccache = "";
    },
    (tool) => {
      tool.versions.python = "x".repeat(4097);
    },
    (tool) => {
      delete tool.runner.imageVersion;
    },
    (tool) => {
      tool.runner.arch = 64;
    },
  ];
  for (const mutate of changes) {
    assert.throws(
      () =>
        checkInputs(
          createFreshAirReleaseFixture({ mutateInputs: (report) => mutate(report.buildTool) }),
        ),
      /toolchain|environment disclosure|tool versions\/platform/,
    );
    assert.throws(
      () =>
        checkReceipt(
          createFreshAirReleaseFixture({ mutateReceipt: (report) => mutate(report.buildTool) }),
        ),
      /toolchain|environment disclosure|tool versions\/platform/,
    );
  }
});

test("fresh receipts bind digest/source/API/output records and agree with disclosed build inputs", () => {
  const fixture = createFreshAirReleaseFixture();
  assert.throws(
    () =>
      verifyFreshAirReceipt(
        Buffer.concat([fixture.receiptBytes, Buffer.from(" ")]),
        fixture.manifest,
        fixture.inputs,
      ),
    /receipt digest mismatch/,
  );
  for (const [key, value] of [
    ["schemaVersion", 2],
    ["kind", "migrated-compiler"],
    ["repository", "other/fork"],
    ["commit", "3".repeat(40)],
    ["tree", "4".repeat(40)],
    ["sourceLockSha256", "a".repeat(64)],
    ["headerSha256", "b".repeat(64)],
    ["apiVersion", 1],
    ["sourceLanguage", "old-metal"],
  ])
    assert.throws(
      () =>
        checkReceipt(
          createFreshAirReleaseFixture({
            mutateReceipt: (report) => {
              report[key] = value;
            },
          }),
        ),
      key,
    );
  assert.throws(
    () =>
      checkReceipt(
        createFreshAirReleaseFixture({
          mutateReceipt: (report) => {
            report.files["air_wasm.wasm"].sha256 = "a".repeat(64);
          },
        }),
      ),
    /output mismatch/,
  );
  assert.throws(
    () =>
      checkReceipt(
        createFreshAirReleaseFixture({
          mutateReceipt: (report) => {
            report.buildTool.jobs = 1;
          },
        }),
      ),
    /tool mismatch/,
  );
  const differentInputs = structuredClone(fixture.inputs);
  differentInputs.sourceInputs[Object.keys(differentInputs.sourceInputs)[0]] = "a".repeat(64);
  assert.throws(
    () => verifyFreshAirReceipt(fixture.receiptBytes, fixture.manifest, differentInputs),
    /source mismatch/,
  );
});

test("receipt verification cannot claim browser, device, GPU or full application execution", () => {
  for (const key of [
    "browserExecutionVerified",
    "deviceExecutionVerified",
    "gpuExecutionVerified",
    "fullApplicationVerified",
  ])
    for (const value of [true, undefined, "false"])
      assert.throws(
        () =>
          checkReceipt(
            createFreshAirReleaseFixture({
              mutateReceipt: (report) => {
                report.verification[key] = value;
              },
            }),
          ),
        /verification scope/,
        `${key}:${value}`,
      );
  for (const mutate of [
    (probe) => {
      probe.exportsVerified = false;
    },
    (probe) => {
      probe.headerVerified = false;
    },
    (probe) => {
      probe.abiVersion = 1;
    },
    (probe) => {
      probe.headerBundleVersion = 1;
    },
    (probe) => {
      probe.headerSha256 = "a".repeat(64);
    },
    (probe) => {
      probe.smoke.passed = false;
    },
    (probe) => {
      probe.smoke.cases = [];
    },
    (probe) => {
      probe.smoke.cases = Array(33).fill({});
    },
  ])
    assert.throws(
      () =>
        checkReceipt(
          createFreshAirReleaseFixture({ mutateReceipt: (report) => mutate(report.verification) }),
        ),
      /verification scope/,
    );
});

test("fresh metadata rejects historical receipt relabeling and unsupported full-game claims", () => {
  for (const [hook, check] of [
    ["mutateManifest", checkManifest],
    ["mutateReceipt", checkReceipt],
    ["mutateInputs", checkInputs],
    ["mutateLock", checkLock],
  ]) {
    for (const claim of [
      { historicalReceiptSha256: "a".repeat(64) },
      { originalBuildReceiptSha256: "a".repeat(64) },
      { migratedFromHistoricalReceipt: true },
      { fullGameCompilationVerified: true },
    ])
      assert.throws(
        () =>
          check(createFreshAirReleaseFixture({ [hook]: (report) => Object.assign(report, claim) })),
        `${hook}: ${Object.keys(claim)[0]}`,
      );
  }
});

test("source locks require exact compiler/SDK closure and independently recomputed header digests", () => {
  const fixture = createFreshAirReleaseFixture();
  assert.throws(
    () =>
      verifyFreshAirSourceLock(
        Buffer.concat([fixture.sourceLockBytes, Buffer.from(" ")]),
        fixture.manifest,
        fixture.inputs,
      ),
    /lock digest mismatch/,
  );
  for (const mutate of [
    (lock) => {
      delete lock.compilerFiles[Object.keys(lock.compilerFiles)[0]];
    },
    (lock) => {
      delete lock.sdkFiles[Object.keys(lock.sdkFiles)[0]];
    },
    (lock) => {
      lock.sdkFiles["unexpected"] = "a".repeat(64);
    },
    (lock) => {
      lock.compilerFiles[Object.keys(lock.compilerFiles)[0]] = "bad";
    },
    (lock) => {
      const key = Object.keys(lock.compilerFiles)[0];
      lock.compilerFiles["wasm/compiler.cpp"] = lock.compilerFiles[key];
      delete lock.compilerFiles[key];
    },
  ])
    assert.throws(
      () => checkLock(createFreshAirReleaseFixture({ mutateLock: mutate })),
      /source lock|input closure/,
    );
  const changedInputs = structuredClone(fixture.inputs);
  changedInputs.sourceInputs[Object.keys(changedInputs.sourceInputs)[0]] = "a".repeat(64);
  assert.throws(
    () => verifyFreshAirSourceLock(fixture.sourceLockBytes, fixture.manifest, changedInputs),
    /closure mismatch/,
  );
  assert.throws(
    () =>
      verifyFreshAirSourceLock(
        fixture.sourceLockBytes,
        { ...fixture.manifest, headerSha256: "a".repeat(64) },
        fixture.inputs,
      ),
    /header identity mismatch/,
  );
  assert.throws(
    () =>
      checkLock(
        createFreshAirReleaseFixture({
          mutateLock: (lock) => {
            lock.sdkFiles["api/not-a-header"] = lock.sdkFiles["api/include/metal_atomic"];
            delete lock.sdkFiles["api/include/metal_atomic"];
          },
        }),
      ),
    /header identity mismatch/,
  );
  const digestText =
    "floor-air-header-bundle-v2\n" +
    Object.entries(fixture.sourceLock.sdkFiles)
      .filter(([path]) => path.startsWith("api/include/"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, digest]) => `${path.slice(12)}:${digest}\n`)
      .join("");
  assert.equal(airReleaseSha256(digestText), fixture.manifest.headerSha256);
});

test("producer top-level metadata rejects missing keys and unknown schema extensions", () => {
  for (const [name, hook, check] of [
    ["manifest", "mutateManifest", checkManifest],
    ["receipt", "mutateReceipt", checkReceipt],
    ["inputs", "mutateInputs", checkInputs],
  ]) {
    const fixture = createFreshAirReleaseFixture();
    for (const key of Object.keys(fixture[name]))
      assert.throws(
        () =>
          check(
            createFreshAirReleaseFixture({
              [hook]: (report) => {
                delete report[key];
              },
            }),
          ),
        `${name} missing ${key}`,
      );
    assert.throws(
      () =>
        check(
          createFreshAirReleaseFixture({
            [hook]: (report) => {
              report.unrecognizedExtension = false;
            },
          }),
        ),
      name,
    );
  }
  const fixture = createFreshAirReleaseFixture();
  for (const key of [...Object.keys(fixture.sourceLock), "unrecognizedExtension"]) {
    const lock = structuredClone(fixture.sourceLock);
    if (key === "unrecognizedExtension") lock[key] = false;
    else delete lock[key];
    const bytes = fixtureJson(lock);
    assert.throws(
      () =>
        verifyFreshAirSourceLock(
          bytes,
          { ...fixture.manifest, sourceLockSha256: fixtureSha256(bytes) },
          fixture.inputs,
        ),
      /source lock/,
      key,
    );
  }
});

test("equivalent reordered output records, source inputs and build environments remain valid", () => {
  const reverse = (object) => Object.fromEntries(Object.entries(object).reverse());
  const fixture = createFreshAirReleaseFixture({
    mutateManifest: (report) => {
      for (const name of AIR_RELEASE_OUTPUTS)
        report.runtimeFiles[name] = reverse(report.runtimeFiles[name]);
    },
    mutateInputs: (report) => {
      report.sourceInputs = reverse(report.sourceInputs);
      report.buildTool = reverse(report.buildTool);
      report.buildTool.versions = reverse(report.buildTool.versions);
      report.buildTool.runner = reverse(report.buildTool.runner);
    },
    mutateReceipt: (report) => {
      report.files = reverse(report.files);
      for (const name of AIR_RELEASE_OUTPUTS) report.files[name] = reverse(report.files[name]);
    },
  });
  checkManifest(fixture);
  checkInputs(fixture);
  checkReceipt(fixture);
  checkLock(fixture);
});

test("build inputs and receipts require clean sources and exact SDK/archive/command disclosures", () => {
  for (const sourceTreeClean of [false, undefined, "true"])
    for (const [hook, check] of [
      ["mutateInputs", checkInputs],
      ["mutateReceipt", checkReceipt],
    ])
      assert.throws(
        () =>
          check(
            createFreshAirReleaseFixture({
              [hook]: (report) => {
                report.sourceTreeClean = sourceTreeClean;
              },
            }),
          ),
        /build inputs|build receipt/,
      );
  for (const mutate of [
    (report) => {
      report.sourceDateEpoch = 0;
    },
    (report) => {
      report.sourceDateEpoch = 0.5;
    },
    (report) => {
      report.sourceDateEpoch = Number.MAX_SAFE_INTEGER + 1;
    },
    (report) => {
      report.sourceArchivePrefix = "../escape/";
    },
    (report) => {
      report.sourceArchivePrefix = "air-wasm-v9.0.0-source/";
    },
    (report) => {
      report.sdkSource.repository = "https://example.invalid/sdk";
    },
    (report) => {
      report.sdkSource.commit = "3".repeat(40);
    },
    (report) => {
      report.sdkSource.manifestSha256 = "bad";
    },
    (report) => {
      report.sdkSource.extra = true;
    },
    (report) => {
      delete report.sdkSource;
    },
  ])
    assert.throws(
      () => checkInputs(createFreshAirReleaseFixture({ mutateInputs: mutate })),
      /build inputs/,
    );
  for (const command of [
    [],
    ["node", null],
    Array.from({ length: 33 }, () => "argument"),
    "node build.mjs",
  ])
    assert.throws(
      () =>
        checkInputs(
          createFreshAirReleaseFixture({
            mutateInputs: (report) => {
              report.commands = [command];
            },
          }),
        ),
      /build commands/,
    );
  const fixture = createFreshAirReleaseFixture();
  for (const path of Object.keys(fixture.inputs.tooling))
    assert.throws(
      () =>
        checkInputs(
          createFreshAirReleaseFixture({
            mutateInputs: (report) => {
              delete report.tooling[path];
            },
          }),
        ),
      /tooling inputs/,
      path,
    );
});

test("lock build toolchain and upstream identity cannot conflict with build-input disclosure", () => {
  const fixture = createFreshAirReleaseFixture();
  for (const mutate of [
    (lock) => {
      delete lock.buildTool;
    },
    (lock) => {
      delete lock.buildTool.emsdkCommit;
    },
    (lock) => {
      lock.buildTool.emscriptenVersion = "0.0.0";
    },
    (lock) => {
      lock.buildTool.byteIdenticalRebuildClaimed = true;
    },
    (lock) => {
      lock.buildTool.jobs = 2;
    },
    (lock) => {
      lock.upstream.repository = "https://evil.invalid/project";
    },
    (lock) => {
      lock.upstream.commit = "main";
    },
    (lock) => {
      lock.upstream.archiveSha256 = "bad";
    },
    (lock) => {
      lock.upstream.originalBuildReceiptSha256 = "a".repeat(64);
    },
  ]) {
    const lock = structuredClone(fixture.sourceLock);
    mutate(lock);
    const bytes = fixtureJson(lock);
    assert.throws(
      () =>
        verifyFreshAirSourceLock(
          bytes,
          { ...fixture.manifest, sourceLockSha256: fixtureSha256(bytes) },
          fixture.inputs,
        ),
      /source lock/,
    );
  }
});

test("all three smoke records have strict shape, bounded outputs and expected rejection diagnostics", () => {
  for (const cases of [[null], [null, null, null], [true, true, true]])
    assert.throws(
      () =>
        checkReceipt(
          createFreshAirReleaseFixture({
            mutateReceipt: (report) => {
              report.verification.smoke.cases = cases;
            },
          }),
        ),
      /verification scope/,
    );
  for (const mutate of [
    (probe) => {
      probe.smoke.cases.reverse();
    },
    (probe) => {
      probe.smoke.cases[0].passed = false;
    },
    (probe) => {
      probe.smoke.cases[0].status = 3;
    },
    (probe) => {
      probe.smoke.cases[0].outputBytes = 4;
    },
    (probe) => {
      probe.smoke.cases[0].outputBytes = 64 * 1024 ** 2 + 1;
    },
    (probe) => {
      probe.smoke.cases[1].outputBytes = 1;
    },
    (probe) => {
      probe.smoke.cases[1].diagnosticBytes = 0;
    },
    (probe) => {
      probe.smoke.cases[2].diagnosticBytes = 64 * 1024 + 1;
    },
    (probe) => {
      probe.smoke.cases[2].diagnosticBytes = 0.5;
    },
    (probe) => {
      probe.smoke.cases[2].fullGameCompilationVerified = true;
    },
    (probe) => {
      probe.fullGameCompilationVerified = true;
    },
    (probe) => {
      probe.smoke.legacyReceipt = true;
    },
  ])
    assert.throws(
      () =>
        checkReceipt(
          createFreshAirReleaseFixture({ mutateReceipt: (report) => mutate(report.verification) }),
        ),
      /verification scope/,
    );
});

test("runtime notice origins bind original repository paths and pinned artifact-only GPL text", () => {
  const f = createFreshAirReleaseFixture();
  assert.deepEqual(verifyFreshAirNotices(f.runtimeFiles, f.manifest), f.noticeOrigins);
  for (const mutate of [
    (r) => {
      r.schemaVersion = 2;
    },
    (r) => {
      r.repository = "other/not-the-source";
    },
    (r) => {
      r.commit = "f".repeat(40);
    },
    (r) => {
      r.tree = "e".repeat(40);
    },
    (r) => {
      r.historicalReceiptSha256 = "a".repeat(64);
    },
    (r) => {
      delete r.files["licenses/llvm/LICENSE.TXT"];
    },
    (r) => {
      r.files["licenses/SDK-MIT.txt"] = r.files["licenses/llvm/LICENSE.TXT"];
    },
    (r) => {
      r.files["licenses/llvm/LICENSE.TXT"].repositoryPath = "wasm/licenses/LLVM-LICENSE.txt";
    },
    (r) => {
      r.files["licenses/llvm/LICENSE.TXT"].sha256 = "0".repeat(64);
    },
    (r) => {
      r.files["licenses/GPL-2.0.txt"].sourceUrl = "https://untrusted.invalid/license";
    },
  ]) {
    const candidate = createFreshAirReleaseFixture();
    mutate(candidate.noticeOrigins);
    const bytes = fixtureJson(candidate.noticeOrigins);
    candidate.runtimeFiles.set("licenses/ORIGINS.json", bytes);
    candidate.manifest.runtimeFiles["licenses/ORIGINS.json"] = fixtureRecord(bytes);
    assert.throws(() => verifyFreshAirNotices(candidate.runtimeFiles, candidate.manifest));
  }
  const changed = createFreshAirReleaseFixture(),
    text = Buffer.from("Not the pinned GPL text");
  changed.runtimeFiles.set("licenses/GPL-2.0.txt", text);
  changed.manifest.runtimeFiles["licenses/GPL-2.0.txt"] = fixtureRecord(text);
  Object.assign(changed.noticeOrigins.files["licenses/GPL-2.0.txt"], fixtureRecord(text));
  const originBytes = fixtureJson(changed.noticeOrigins);
  changed.runtimeFiles.set("licenses/ORIGINS.json", originBytes);
  changed.manifest.runtimeFiles["licenses/ORIGINS.json"] = fixtureRecord(originBytes);
  assert.throws(
    () => verifyFreshAirNotices(changed.runtimeFiles, changed.manifest),
    /pinned official source/,
  );
});

test("committed release pin selects the authenticated build, not the fork default branch", async () => {
  const bytes = await readFile(
    new URL("../toolchain/metal-air-compiler/release-pin.json", import.meta.url),
  );
  assert.deepEqual(validateFreshAirReleasePin(parseAirReleaseJson(bytes, 4096)), {
    schemaVersion: 1,
    repository: "n3crosis/floor_llvm",
    commit: "1bd8db2f0fefbd13636e51c209ef09292675dff5",
    version: "v0.1.0",
    manifestSha256: "27b7682418911945a5908eaf0276d9a8afc6c2fe2e853119fa540fdfd95a08fc",
  });
});
