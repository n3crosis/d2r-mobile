// CI 中仅编译十二个固定的原创着色器，覆盖三个阶段；不读取游戏、密钥或用户文件。
// CI-only compilation of twelve fixed authored shaders across three stages, never game, key or user inputs.
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
  { stage: "fragment", filename: "msl-fragment-atomic-add.metal", define: "" },
  { stage: "fragment", filename: "msl-internal-helper-function-constant.metal", define: "" },
  { stage: "kernel", filename: "msl-optimizer-bit-reversal.metal", define: "" },
  {
    stage: "vertex",
    filename: "msl-patch-entry-name.metal",
    entry: "patch_linkage_probe",
    define: "",
  },
  {
    stage: "fragment",
    filename: "constant-vector-pointer-reads.metal",
    entry: "constant_vector_pointer_reads",
    define: "",
  },
  {
    stage: "fragment",
    filename: "direct-buffer-vector-pointer.metal",
    entry: "direct_buffer_vector_pointer",
    define: "",
  },
  {
    stage: "fragment",
    filename: "conditional-distinct-buffer-rows.metal",
    entry: "conditional_distinct_buffer_rows",
    define: "",
  },
  {
    stage: "fragment",
    filename: "loop-carried-buffer-pointer.metal",
    entry: "loop_carried_buffer_pointer",
    define: "",
  },
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
          entry: fixture.entry ?? "main0",
          stage: fixture.stage,
          minimumOS: [18, 0],
          languageVersion: [3, 2],
          metadataLengthIncludesPrefix: false,
        });
        results.push({
          fixture: fixture.filename,
          entry: fixture.entry ?? "main0",
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
      validation: "authored-twelve-fixture-three-stage-compilation-and-container-integrity",
      results,
    };
  } finally {
    adapter.dispose();
  }
}
