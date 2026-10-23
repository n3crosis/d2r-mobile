// 验证 air-release-loader 的约定与边界；依据 ../runtime-build/air-release-transport.mjs、../runtime-build/air-release-loader.mjs 及本文件的测试断言。
// Verify air-release-loader contracts and boundaries against ../runtime-build/air-release-transport.mjs、../runtime-build/air-release-loader.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { downloadAirReleaseBytes } from "../runtime-build/air-release-transport.mjs";
import { unpackFreshAirRuntime } from "../runtime-build/air-release-loader.mjs";
import { verifyFreshAirManifest } from "../runtime-build/air-release-contract.mjs";
import {
  createFreshAirReleaseFixture,
  fixtureJson,
  fixtureRecord,
  fixtureSha256,
} from "./fixtures/air-release-generic/fixture.mjs";
const official = "https://github.com/test-only/not-a-release/releases/download/v0.1.0/asset";
test("bounded release download accepts only official HTTPS redirects", async () => {
  const calls = [];
  const bytes = await downloadAirReleaseBytes(official, 8, async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: "https://release-assets.githubusercontent.com/test" },
        })
      : new Response("safe", { headers: { "content-length": "4" } });
  });
  assert.equal(bytes.toString(), "safe");
  assert.equal(calls.length, 2);
  for (const target of [
    "https://untrusted.invalid/a",
    "http://github.com/a",
    "https://github.com:444/a",
    "https://user@github.com/a",
    "file:///tmp/a",
  ])
    await assert.rejects(
      downloadAirReleaseBytes(
        official,
        8,
        async () => new Response(null, { status: 302, headers: { location: target } }),
      ),
      /official GitHub/,
    );
});
test("download rejects oversized declarations/streams, truncation, HTTP failure and redirect loops", async () => {
  for (const response of [
    () => new Response("small", { headers: { "content-length": "1000" } }),
    () => new Response("oversized"),
    () => new Response("tiny", { headers: { "content-length": "6" } }),
    () => new Response("error", { status: 500 }),
    () => new Response(null, { status: 302, headers: { location: official } }),
  ])
    await assert.rejects(downloadAirReleaseBytes(official, 8, async () => response()));
});
function archive(entries, { type = "0", link = "", tail = false, badPadding = false } = {}) {
  const blocks = [];
  for (const [name, data] of entries) {
    const header = Buffer.alloc(512),
      body = Buffer.alloc(Math.ceil(data.length / 512) * 512);
    header.write(name, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write(link, 157, 100);
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.write(
      header
        .reduce((sum, byte) => sum + byte, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
    );
    data.copy(body);
    if (badPadding && body.length > data.length) body[data.length] = 1;
    blocks.push(header, body);
  }
  return gzipSync(
    Buffer.concat([...blocks, Buffer.alloc(1024), ...(tail ? [Buffer.from("unsafe")] : [])]),
  );
}
function withArchive(options = {}) {
  const f = createFreshAirReleaseFixture(options);
  f.assetBytes.runtime = archive(f.runtimeFiles);
  f.manifest.assets.runtime = {
    name: f.manifest.assets.runtime.name,
    ...fixtureRecord(f.assetBytes.runtime),
  };
  f.manifestBytes = fixtureJson(f.manifest);
  f.pin.manifestSha256 = fixtureSha256(f.manifestBytes);
  return f;
}
test("complete inert generic runtime validates exact provenance/header/output closure without execution", () => {
  const f = withArchive();
  const release = verifyFreshAirManifest(f.manifestBytes, f.pin);
  const parsed = unpackFreshAirRuntime(f.assetBytes.runtime, release, f.inputs);
  assert.deepEqual(parsed.receipt, f.receipt);
  assert.deepEqual(parsed.sourceLock, f.sourceLock);
  assert.deepEqual([...parsed.files.keys()].sort(), [...f.runtimeFiles.keys()].sort());
  for (const [name, bytes] of f.runtimeFiles) assert.deepEqual(parsed.files.get(name), bytes);
});
test("runtime parser checks compressed digest before decoding", () => {
  const f = withArchive();
  assert.throws(
    () => unpackFreshAirRuntime(Buffer.from("not gzip"), f.manifest, f.inputs),
    /asset mismatch/,
  );
});
test("runtime parser rejects traversal, links, duplicates, unlisted entries, padding and trailing data", () => {
  const f = withArchive(),
    entries = [...f.runtimeFiles];
  for (const bytes of [
    archive([["../escape", Buffer.from("x")]]),
    archive([["/escape", Buffer.from("x")]]),
    archive([["a//b", Buffer.from("x")]]),
    archive(entries, { type: "2", link: "../escape" }),
    archive([...entries, entries[0]]),
    archive([...entries, ["unlisted", Buffer.from("x")]]),
    archive(entries.slice(1)),
    archive(entries, { tail: true }),
    archive(entries, { badPadding: true }),
  ]) {
    const release = structuredClone(f.manifest);
    release.assets.runtime = { name: release.assets.runtime.name, ...fixtureRecord(bytes) };
    assert.throws(() => unpackFreshAirRuntime(bytes, release, f.inputs));
  }
});
test("runtime parser rejects member substitution even with a correctly pinned outer archive", () => {
  const f = withArchive(),
    replaced = new Map(f.runtimeFiles);
  replaced.set("air_wasm.mjs", Buffer.from("x".repeat(replaced.get("air_wasm.mjs").length)));
  const bytes = archive(replaced),
    release = structuredClone(f.manifest);
  release.assets.runtime = { name: release.assets.runtime.name, ...fixtureRecord(bytes) };
  assert.throws(() => unpackFreshAirRuntime(bytes, release, f.inputs), /member digest mismatch/);
});
test("source closure precedes runtime verification and leaves destination bytes untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "fresh-air-release-")),
    oldFetch = globalThis.fetch;
  try {
    const f = withArchive(),
      web = join(root, "web"),
      compiler = join(web, "toolchain/metal-air-compiler"),
      build = join(web, "runtime-build"),
      cache = join(build, ".build/air-compiler-release", f.pin.manifestSha256);
    for (const directory of [join(compiler, "dist"), cache])
      await mkdir(directory, { recursive: true });
    for (const name of [
      "runtime-build/air-release-contract.mjs",
      "runtime-build/air-release-transport.mjs",
      "runtime-build/air-release-loader.mjs",
      "runtime-build/air-compiler-assets.mjs",
      "air-compiler-runtime-contract.mjs",
      "air-compiler-contract.mjs",
      "shader-diagnostics.mjs",
    ])
      await copyFile(new URL(`../${name}`, import.meta.url), join(web, name));
    await writeFile(join(compiler, "release-pin.json"), fixtureJson(f.pin));
    await writeFile(join(cache, "manifest.json"), f.manifestBytes);
    await writeFile(join(cache, f.manifest.assets.buildInputs.name), f.inputsBytes);
    await writeFile(join(cache, f.manifest.assets.runtime.name), f.assetBytes.runtime);
    const sentinel = join(compiler, "dist/untouched"),
      anchor = join(build, ".build/air-compiler-receipt.sha256");
    await writeFile(sentinel, "existing compiler bytes");
    await writeFile(anchor, "existing receipt trust anchor\n");
    const before = {
      data: await readFile(sentinel, "utf8"),
      anchor: await readFile(anchor, "utf8"),
      names: await readdir(join(compiler, "dist")),
      mtime: (await stat(sentinel)).mtimeMs,
    };
    const { loadFreshAirRelease } = await import(
      pathToFileURL(join(build, "air-release-loader.mjs"))
    );
    const { importAirCompilerAssets, verifyAirCompilerAssets } = await import(
      pathToFileURL(join(build, "air-compiler-assets.mjs"))
    );
    const input = join(root, "inert-input");
    await mkdir(input);
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      throw new Error("OFFLINE source prerequisite missing");
    };
    await rm(join(compiler, "release-pin.json"));
    await assert.rejects(
      importAirCompilerAssets({ directory: input, expectedDigest: f.manifest.buildReceiptSha256 }),
      /Fresh AIR release is not pinned/,
    );
    assert.equal(calls.length, 0, "missing pin must not download or install");
    await writeFile(join(compiler, "release-pin.json"), fixtureJson(f.pin));
    await assert.rejects(loadFreshAirRelease({ download: true }), /OFFLINE source prerequisite/);
    assert.deepEqual(calls, [
      `https://github.com/${f.pin.repository}/releases/download/${f.pin.version}/${f.manifest.assets.correspondingSource.name}`,
    ]);
    await assert.rejects(
      importAirCompilerAssets({ directory: input, expectedDigest: f.manifest.buildReceiptSha256 }),
      /OFFLINE source prerequisite/,
    );
    const sourcePath = join(cache, f.manifest.assets.correspondingSource.name);
    await writeFile(sourcePath, Buffer.alloc(f.assetBytes.correspondingSource.length, 1));
    await assert.rejects(
      loadFreshAirRelease({ download: true }),
      /asset mismatch: correspondingSource/,
    );
    assert.equal(calls.length, 2, "corrupt source must not silently redownload");
    await assert.rejects(
      importAirCompilerAssets({ directory: input, expectedDigest: f.manifest.buildReceiptSha256 }),
      /asset mismatch: correspondingSource/,
    );
    await writeFile(sourcePath, f.assetBytes.correspondingSource);
    const result = await loadFreshAirRelease();
    assert.deepEqual(result.receipt, f.receipt);
    assert.deepEqual(
      {
        data: await readFile(sentinel, "utf8"),
        anchor: await readFile(anchor, "utf8"),
        names: await readdir(join(compiler, "dist")),
        mtime: (await stat(sentinel)).mtimeMs,
      },
      before,
    );
    for (const [name, bytes] of f.runtimeFiles) {
      const local = ["air_wasm.mjs", "air_wasm.wasm"].includes(name) ? `d2r_${name}` : name;
      const path = join(input, local);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, bytes);
    }
    const installed = await importAirCompilerAssets({
      directory: input,
      expectedDigest: f.manifest.buildReceiptSha256,
    });
    assert.deepEqual(installed, f.receipt);
    assert.deepEqual(await verifyAirCompilerAssets(), f.receipt);
    assert.deepEqual(
      await readFile(join(compiler, "dist/build-report.json")),
      f.receiptBytes,
      "raw generic receipt must never be rewritten",
    );
    for (const name of ["air_wasm.mjs", "air_wasm.wasm"])
      assert.deepEqual(
        await readFile(join(compiler, "dist", `d2r_${name}`)),
        f.runtimeFiles.get(name),
        "aliases preserve exact bytes",
      );
    await assert.rejects(stat(join(compiler, "dist/air_wasm.wasm")), { code: "ENOENT" });
  } finally {
    globalThis.fetch = oldFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("fork source transport pins exact commit and bounds inert bytes without redirects", async () => {
  const { downloadAirForkSourceBytes } = await import("../runtime-build/air-release-transport.mjs");
  const url = `https://raw.githubusercontent.com/test-only/not-a-release/${"a".repeat(40)}/wasm/api/air_compiler.h`;
  assert.equal(
    (
      await downloadAirForkSourceBytes(url, 8, async (_url, options) => {
        assert.equal(options.redirect, "error");
        assert.equal(options.credentials, "omit");
        return new Response("source");
      })
    ).toString(),
    "source",
  );
  for (const target of [
    url.replace("a".repeat(40), "main"),
    url.replace("raw.githubusercontent.com", "untrusted.invalid"),
    url.replace("https:", "http:"),
    url + "?auth=untrusted",
    url + "#fragment",
  ]) {
    let called = false;
    await assert.rejects(
      downloadAirForkSourceBytes(target, 8, async () => {
        called = true;
        return new Response("source");
      }),
    );
    assert.equal(called, false);
  }
  for (const response of [
    () => new Response("too-long-source"),
    () => new Response("x", { headers: { "content-length": "9" } }),
    () => new Response("x", { headers: { "content-length": "2" } }),
    () => new Response(null, { status: 302, headers: { location: url } }),
  ])
    await assert.rejects(downloadAirForkSourceBytes(url, 8, async () => response()));
});
