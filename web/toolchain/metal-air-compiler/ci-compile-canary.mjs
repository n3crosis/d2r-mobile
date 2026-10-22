// CI 中仅编译四个固定的原创着色器，覆盖三个阶段；不读取游戏、密钥或用户文件。
// CI-only compilation of four fixed authored shaders across three stages, never game, key or user inputs.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createAirCompilerAdapter } from "../../air-compiler-adapter.mjs";
import { inspectCompiledMetalLibrary } from "../../compiled-shader-boundary.mjs";
import { AIR_COMPILER_SOURCE_LANGUAGE } from "../../air-compiler-contract.mjs";

const cases = Object.freeze([
  { stage: "vertex", filename: "msl-vertex.metal", define: "#define SCALE 2.0f\n" },
  { stage: "fragment", filename: "msl-fragment.metal", define: "#define THRESHOLD 0.5f\n" },
  { stage: "kernel", filename: "msl-compute.metal", define: "#define FACTOR 3\n" },
  { stage: "kernel", filename: "msl-scalar-operations.metal", define: "" },
]);

// The caller authenticates the actual module and passes its independently computed
// fixed-header digest. This probes the real frontend, passes, writer and boundary,
// not Apple acceptance, Chrome execution or full-game compatibility.
export async function runAirCompilerCanary(module, { expectedHeaderSha256 } = {}) {
  const adapter = createAirCompilerAdapter(module, {
    expectedHeaderSha256,
    apiVersion: 2,
    maxCompilations: cases.length,
  });
  const results = [];
  try {
    for (const fixture of cases) {
      const text = await readFile(
        new URL(`./fixtures/${fixture.filename}`, import.meta.url),
        "utf8",
      );
      const source = fixture.define + text;
      const sourceSha256 = createHash("sha256").update(source).digest("hex");
      let output;
      try {
        output = adapter.compile(source, {
          iosMajor: 18,
          output: "metallib",
          sourceLanguage: AIR_COMPILER_SOURCE_LANGUAGE,
          mathProfile: "fast-f32",
        });
        await inspectCompiledMetalLibrary(output.bytes, {
          entry: "main0",
          stage: fixture.stage,
          minimumOS: [18, 0],
          languageVersion: [3, 2],
          metadataLengthIncludesPrefix: false,
        });
        results.push({
          fixture: fixture.filename,
          stage: fixture.stage,
          sourceSha256,
          bytes: output.bytes.byteLength,
        });
      } catch (error) {
        throw new Error(`AIR CI compile canary failed for ${fixture.stage}/${fixture.filename}`, {
          cause: error,
        });
      } finally {
        output?.bytes.fill(0);
      }
    }
    return {
      validation: "authored-four-fixture-three-stage-compilation-and-container-integrity",
      results,
    };
  } finally {
    adapter.dispose();
  }
}
