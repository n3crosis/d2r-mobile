# Experimental Metal AIR compiler / 实验性 Metal AIR 编译器

This is an **experimental compiler integrated into the browser IPA shader path**. The authenticated CI artifact for `440eb1a7eedbde6f8c95e037260aed1006365d99` has sealed compiler-only Node WASM acceptance: all 7,212 supplied original shaders compile. Chrome, Apple/GPU/device acceptance, numerical behavior and full-game equivalence remain unverified. It adapts a pinned open-source Clang/floor fork: source parsing and semantic analysis → LLVM/AIR lowering → actual MTLB serialization. No Apple compiler executable, SDK headers, simulator, device or remote compilation service is used by this package.

这是已接入浏览器 IPA 着色器流程的实验性编译器。上述 440eb1a 版本的已认证 CI 产物已通过仅限编译器的 Node WASM 验收：所提供的 7,212 个原始着色器全部编译成功。Chrome、Apple/GPU/设备验收、数值行为及完整游戏等效性仍未验证。流程包含真实的语法解析、语义分析、AIR 降级和 MTLB 输出，不是容器重打包或固定示例输出。本工具包不调用 Apple 编译器、模拟器、设备或远程编译服务。

## Upstream migration / 上游迁移

The source base is now pinned to a2flo/floor_llvm at `4b173e3db383ec7164afb11ee7dc86609c88f052`. Earlier native and Node WASM milestones refer to the previous gzorin baseline and are not transferred automatically. The separately authenticated 440eb1a result above uses the current a2flo source and CI-built compiler. No local rebuild or full-game validation is claimed.

当前基于固定的 a2flo 上游版本。历史原生及 Node WASM 阶段记录属于先前的 gzorin 基线，不能自动转移；上述 440eb1a 结果来自当前 a2flo 源码的独立认证 CI 构建。未宣称本地重建或完整游戏验证。

See [CORPUS_FIXES.md](CORPUS_FIXES.md) for the incremental compiler corrections, exact source-provenance coverage, sealed compiler-only results and remaining validation boundaries.

## Native build procedure / 原生构建流程

Prerequisites: Linux, C++20 compiler (tested GCC 14), CMake 3.20+, Ninja, Git, tar and Node.js or Bun. Tested bootstrap used CMake 4.4.4, Ninja 1.13.2, `-O1`, assertions, four compile jobs and one link job on a roughly 10 GiB RAM machine. Default below is two compile jobs; use `--jobs 1` on a constrained host. This builds a large compiler and needs several GiB of memory/disk, not just the small package directory.

开发依赖：Linux、C++20 编译器、CMake、Ninja、Git、tar、Node.js 或 Bun。这些仅用于开发者构建，不是最终网页用户的安装要求。WASM 已完成交叉编译，并通过 Node 中的真实 WASM 执行测试；尚不能视为 Chrome 或 Apple 运行时验证。

1. Download the exact `archiveUrl` in `manifest.json`. The preparation command checks the pinned archive SHA256 before extraction. It does not fetch floating branches or install dependencies.
2. Run from this directory:

```sh
node toolchain.mjs prepare --archive /path/to/floor_llvm.tar.gz --work /path/to/empty-work
node toolchain.mjs build --work /path/to/empty-work --jobs 2
node toolchain.mjs test --work /path/to/empty-work
```

`prepare` refuses an existing nonempty work directory; it never overwrites or cleans user files. Patches are applied in manifest order, then every modified source file is checked against its expected SHA256. `build` checks those hashes again. Source pins, patch order and integrity checks must remain intact.

`prepare` 拒绝非空工作目录，不覆盖或清理用户文件。按清单顺序应用补丁后，会验证修改后的源文件哈希；构建前再次检查。请保留版本锁定、补丁顺序和完整性校验。

`node toolchain.mjs check` checks packaged patch integrity without building. To exercise these packaged tests against an existing compatible native build, use `test --clang /path/to/clang --smoke /path/to/d2r_air_api_smoke --work /path/to/test-output`.

## Verified scope / 已验证范围

The current 440eb1a acceptance also passes 55 targeted original-corpus compile checks, the strict
31-call canary (23 metallib and eight LLVM-text outputs), and all 15 expected
storage/interface rejections. Those 55 targets are a subset of the 7,212 original
inputs; the authored canary and negative phases are separate. It removes 417 signed
and 469 unsigned i1 conversion
calls; all 445 changed libraries passed the separate ABI review. These are
compiler/output checks, not GPU execution or complete MSL compatibility. The
historical native milestones below remain distinct; the authored LLVM pass-level
fixtures in [CORPUS_FIXES.md](CORPUS_FIXES.md) have not been executed.

当前 440eb1a 验收还通过 55 项原始着色器目录的定向编译检查、31 次严格 canary 调用（23 次 metallib、8 次 LLVM 文本输出）以及全部 15 项预期的存储/接口拒绝测试。这 55 项属于上述 7,212 项原始输入的子集；canary 与负例属于另外的原创测试。417 个有符号和 469 个无符号 i1 转换调用已移除，全部 445 个发生变化的库通过独立 ABI 审查。这些是编译器与输出检查，不是 GPU 执行或完整 MSL 支持证明。下述历史原生阶段结果与本次验收分开记录；原创 LLVM pass 级测试仍未执行。

- Authored compute, vertex and fragment inputs compile into source-dependent AIR and MTLB. Sparse buffer/argument resource metadata and selected dynamic 2D sampling are implemented, not replaced with constants.
- Corrected public/private metadata lengths match the prefix-exclusive reference profile. Expected entry names, stages, bounds and embedded bitcode SHA256 were inspected. This does **not** prove Apple runtime acceptance.
- Repeated in-process compilation covers LLVM-context lifetime regressions and error recovery. Unknown/ignored attributes cannot silently turn unsupported source into a successful result.
- This package contains the original 15 authored frontend cases, nine math/header frontend cases, eleven NaN-classification IR cases, and in-process API/profile regression executables. The development milestone additionally passed targeted interface, resource and malformed-input suites; it does not claim all those separate development harnesses are included here. See [MATH_SUPPORT.md](MATH_SUPPORT.md) for the explicit fast-math profile and versioned header bundle contract.

已验证自编测试中的计算、顶点和片元着色器真实编译，以及部分稀疏资源绑定、动态二维采样、重复调用和错误恢复。输出结构与位码哈希检查通过，不等于 Apple 运行时验收。此包包含原有 15 个前端测试、9 个数学与头文件测试、11 个 NaN 分类 IR 测试及进程内 API/配置测试，不包含用户游戏资料。

## Not ready / 尚未完成

- Real Chrome execution of the supplied corpus and browser/GPU/device acceptance.
- Complete MSL compatibility beyond the implemented resource, builtin, function-constant and language subset; passing the supplied corpus does not establish general MSL support.
- Xcode-equivalent numerical shader behavior and full-game equivalence across the supplied corpus.
- The historical gzorin domain milestone retained unsupported control-point records requiring padding and implicit vector `llvm.fmuladd`. Those old focused checks are not current proof of support for every input in these categories.

历史 gzorin 域着色器检查保留了两个未支持的输入类别：需要填充的控制点记录，以及隐式向量 `llvm.fmuladd`。旧接口检查或当前所提供目录的编译通过，均不代表这些类别的所有输入已获支持。

尚未完成浏览器/设备执行、完整游戏等效性、完整 MSL 库和高级功能验证。`api/CMakeLists.txt` now builds a real WASM target tested under Node with Worker shims; production wiring does not by itself establish a finished or fully validated browser compiler. The migrated a2flo frontend uses Metal 3.2 syntax mode with iOS 18 / AIR 2.7 / MSL 3.2 output. Selecting that mode does not establish complete MSL 3.2 support. Earlier native/Node milestones in this document describe the prior gzorin-based baseline unless explicitly identified as a2flo results; the separately sealed 440eb1a acceptance does not execute the unrun native fixtures.

GPU-specific pipeline archives and iPhone verification are outside this task. Do not invoke an iOS simulator. The target is the Xcode-built IPA's precompiled shader-library behavior, not eliminating all device-side pipeline work.

设备专属管线缓存及 iPhone 验证不属于本任务，禁止调用 iOS 模拟器。目标是匹配 Xcode 构建 IPA 的预编译着色器库行为，并非消除设备端所有管线工作。

## Browser smoke harness / 浏览器冒烟工具

The production build's separate `ci-compile-canary.mjs` compiles nineteen fixed authored MSL fixtures and four fragment-input liveness variants across vertex, fragment and kernel stages using the actual WASM artifact. Including supplemental LLVM-text checks, it makes 31 API calls: 23 metallib and eight LLVM-text outputs. It covers the added scalar operations, barrier, half-valued quad tessellation factors, fragment device atomic add, and the public [compiler-correction probes](CORPUS_FIXES.md#real-wasm-ci-canaries). Named entries are checked exactly, with `main0` only the default; stage, platform/version and container/bitcode checks are unchanged. These source-only/test fixtures are not production runtime payload assets. The source archive includes every tracked fixture under this compiler directory. The authenticated 440eb1a artifact passes this strict canary, including reflection/layout and live/dead-input checks. This is distinct from the six-variant interactive harness below, whose Chrome execution remains unverified.

生产构建中的独立 CI 检查使用实际 WASM 编译器，编译 19 个固定原创测试及 4 个片元输入存活性变体，覆盖三个阶段。连同补充的 LLVM 文本检查，共调用 API 31 次（23 次 metallib、8 次 LLVM 文本），严格验证入口、容器、反射/布局及输入存活性。440eb1a 已通过这些检查。测试仅进入测试与源码包，不进入生产运行时资源；这不等同于下方尚未完成 Chrome 执行验证的六变体交互式工具。

After building the actual WASM target, run `node browser-smoke-server.mjs --build /path/to/API-WASM-build` and open the printed loopback URL in desktop Chromium. The build directory must contain `d2r_air_wasm.mjs` and `d2r_air_wasm.wasm`. The embedded compatibility header bundle must match this package's fingerprint. For an earlier isolated build, append `--api-source /path/to/matching/API-source`; the harness derives the v1 single-header or v2 sorted-bundle fingerprint from that explicit source directory and requires the module to match it. This only selects a development fixture contract, not a production trust manifest.

This developer-only server serves a fixed allow-list of compiler and authored fixture files. It neither receives nor opens game inputs. Each of six authored source variants runs in its own dedicated Worker. Compiler assets are fingerprint-checked before the verified-byte instantiation hook is used; results undergo entry, stage, container and embedded bitcode integrity checks. The two variants per stage must produce different bitcode hashes. Cancellation terminates the active Worker. Results are shown on the page and in `globalThis.__airSmokeResult` for a browser automation driver.

The harness is not proof of browser execution until it has actually run with the generated compiler. Passing it still does not establish full-game coverage, semantic equivalence or Apple runtime acceptance. It is not connected to production IPA generation and does not replace the existing source-set digest checks.

实际 WASM 构建完成后，运行上述命令并用桌面 Chromium 打开本机网址。工具只提供明确列出的编译器及自编测试文件，不接收或读取游戏输入。六个测试分别使用独立 Worker，验证编译器指纹、输出结构及位码摘要；取消操作会终止 Worker。准备好工具不等于已通过浏览器验证，通过六个测试也不等于完整游戏或 Apple 运行时验收。

No uploaded game source, compiled reference library, private disassembly, build log, archive or compiled object belongs in this directory. No production shader-source digest/integrity logic is bypassed or replaced.

## Licensing / 许可证

See `THIRD_PARTY_NOTICES.md`. The fork contains Apache-2.0 WITH LLVM-exception code **and GPL-2.0-only floor transforms**. Do not describe the combined compiler as wholly permissive or distribute a runtime without satisfying all applicable licenses. This directory preserves patch/source attribution; the source archive remains external and pinned.

## WebAssembly reproduction

The compiler has now been cross-built with Emscripten 4.0.20 and executed in Node
using explicit Worker shims. This is actual source-to-AIR/MTLB compilation, not
container repacking, but it does not establish Chrome or Apple runtime acceptance.
See [WASM_BUILD.md](WASM_BUILD.md) for the validated configuration, measured payload
and memory limits, and the existing toolchain's `build-wasm` / `test-wasm` commands.
No extra CI workflow is required. The authored preflight verifies the matching
header fingerprint and does not contain game sources.
