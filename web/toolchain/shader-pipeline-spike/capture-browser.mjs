// Synthetic real-worker integration, independent original native CLI oracle.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { code, job as originalJob } from "../shader-spike/synthetic-fixture.mjs";
const key = "0000000000000001",
  job = { ...originalJob, key };
const root = fileURLToPath(new URL("../../../", import.meta.url));
const webRoot = join(root, "web");
const [command, first, second, third] = process.argv.slice(2);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expectedSource = (
  await readFile(new URL("../shader-spike/upstream-source.sha256", import.meta.url), "utf8")
).split(/\s/)[0];
assert.equal(
  hash(await readFile(join(root, "dm/gfx/tools/dmsh_xlate/Program.cs"))),
  expectedSource,
  "Translator native source changed: review bridge first",
);
if (command === "prepare") {
  assert.ok(first);
  const directory = resolve(first);
  await mkdir(directory, { recursive: true });
  const codePath = join(directory, "synthetic-exit.bin");
  await writeFile(codePath, code);
  await writeFile(
    join(directory, "jobs.json"),
    JSON.stringify([{ ...job, code: codePath }], null, 2),
  );
} else if (command === "capture") {
  assert.ok(
    first && second && third,
    "capture <translator-publish-directory> <native-directory> <output-directory>",
  );
  const output = resolve(third);
  await mkdir(output, { recursive: true });
  const candidates = [];
  async function discover(directory, depth = 0) {
    if (depth > 6) return;
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((e) => e.name === "worker.mjs" && e.isFile())) {
      try {
        if ((await stat(join(directory, "_framework/dotnet.js"))).isFile())
          candidates.push(directory);
      } catch {
        /* Not published runtime. */
      }
    }
    for (const e of entries)
      if (e.isDirectory() && e.name !== "_framework")
        await discover(join(directory, e.name), depth + 1);
  }
  await discover(resolve(first));
  assert.equal(candidates.length, 1, "Expected exactly one complete translator publish");
  const translatorRoot = candidates[0],
    native = resolve(second);
  const nativeMsl = (await readFile(join(native, `${key}_b.metal`), "utf8")).replace(/\r\n/g, "\n");
  const nativeSpirv = await readFile(join(native, `${key}.spv`));
  const nativeResources = JSON.parse(await readFile(join(native, `${key}.res.json`), "utf8"));
  const nativeReflection = JSON.parse(await readFile(join(native, `${key}.cross.json`), "utf8"));
  const sourceDigest = createHash("sha256")
    .update(`${key}_b.metal`)
    .update(createHash("sha256").update(nativeMsl).digest())
    .digest("hex")
    .slice(0, 16);
  // Synthetic expected recipe originates from independent native fixture output,
  // never from browser output. It is not a real release-shell trust assertion.
  const chain = "000000000001",
    targetOS = { platform: "ios", minimumVersion: "16.0" },
    requiredPaths = [`msl/b-${chain}/`];
  const shell = {
    entries: ["Info.plist", "App", "dm/shell_info.txt", "dm/shell_manifest.txt"].map((p) => ({
      path: `Payload/App.app/${p}`,
      size: 10,
      mode: 0o100644,
    })),
    shellInfoText: `PRODUCT=synthetic\nCHAIN=${chain}\nKIND=ios\nSHADER_SRC=${sourceDigest}\nSPIRV_CROSS=1.4.357.0\n`,
    shellManifestText: requiredPaths.join("\n"),
    observedTargetOS: targetOS,
    trustedRecipe: {
      schemaVersion: 1,
      product: "synthetic",
      chain,
      kind: "ios",
      shaderDigest: sourceDigest,
      targetOS,
      requiredPaths,
      shaderKeys: [key],
      spirvCrossVersion: "1.4.357.0",
    },
  };
  const mime = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".wasm": "application/wasm",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>Synthetic linked shader pipeline</title>");
        return;
      }
      const [base, relative] = pathname.startsWith("/translator/")
        ? [translatorRoot, pathname.slice("/translator/".length)]
        : pathname.startsWith("/web/")
          ? [webRoot, pathname.slice("/web/".length)]
          : [null, null];
      assert.ok(base);
      const path = resolve(base, relative);
      assert.ok(path.startsWith(base + sep));
      response.setHeader("Content-Type", mime[extname(path)] ?? "application/octet-stream");
      response.end(await readFile(path));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const require = createRequire(new URL("../shader-spike/package.json", import.meta.url));
  const { chromium } = require("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const captured = await page.evaluate(
      async ({ shell, job, code }) => {
        const { createShaderPipeline } = await import("/web/shader-pipeline.mjs");
        const options = {
          trustedShell: shell,
          translatorWorkerUrl: "/translator/worker.mjs",
          crossWorkerUrl: "/web/toolchain/spirv-cross-spike/wwwroot/worker.mjs",
        };
        const pipeline = createShaderPipeline(options);
        try {
          let incompleteRejected = false;
          try {
            await pipeline.verifyCompleteSourceSet();
          } catch {
            incompleteRejected = true;
          }
          const result = await pipeline.translate({ job, code: new Uint8Array(code) });
          const verified = await pipeline.verifyCompleteSourceSet();
          return { result, verified, incompleteRejected };
        } finally {
          pipeline.dispose();
        }
      },
      { shell, job, code: [...code] },
    );
    assert.deepEqual(pageErrors, []);
    assert.equal(captured.incompleteRejected, true);
    assert.equal(captured.result.msl, nativeMsl, "Linked browser MSL bytes differ");
    assert.deepEqual(
      captured.result.resources,
      nativeResources,
      "Linked translator resource sidecar differs",
    );
    assert.equal(
      captured.result.provenance.inputSha256,
      hash(nativeSpirv),
      "Linked translator SPIR-V SHA differs",
    );
    assert.deepEqual(
      captured.result.spirvReflection,
      nativeReflection,
      "Linked Cross reflection differs",
    );
    const oracle = spawnSync(
      "python3",
      [join(webRoot, "toolchain/spirv-cross-spike/native-oracle.py")],
      {
        input: JSON.stringify([{ stage: "cs", msl: nativeMsl, resources: nativeResources }]),
        encoding: "utf8",
      },
    );
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.deepEqual(captured.result.replay, JSON.parse(oracle.stdout)[0]);
    assert.equal(captured.verified.sourceDigest, sourceDigest);
    assert.equal(captured.verified.installable, false);
    assert.equal(captured.verified.chainRewritten, false);
    await writeFile(join(output, "linked-browser-result.json"), JSON.stringify(captured, null, 2));
    await writeFile(join(output, "linked-browser.metal"), captured.result.msl);
    await writeFile(
      join(output, "report.json"),
      JSON.stringify(
        {
          commit: process.env.GITHUB_SHA ?? null,
          browser: browser.version(),
          fixture: "authored Maxwell EXIT",
          codeSha256: hash(code),
          spirvSha256: hash(nativeSpirv),
          mslSha256: hash(nativeMsl),
          sourceDigest,
          byteAndReflectionParity: true,
          realLinkedModuleWorkers: true,
          installable: false,
          scope:
            "Synthetic compute only; no real release shell, game coverage or Metal compilation",
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: real browser translator -> SPIRV-Cross adapter matches native MSL/resources/SPIR-V hash/reflection and complete synthetic SHADER_SRC gate.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
} else throw new Error("Expected prepare or capture command");
