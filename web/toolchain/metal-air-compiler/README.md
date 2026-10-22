# Experimental Metal AIR compiler / 实验性 Metal AIR 编译器

This is a **developer-only, native-tested compiler subset**, not the production browser shader compiler. It adapts a pinned open-source Clang/floor fork: source parsing and semantic analysis → LLVM/AIR lowering → actual MTLB serialization. No Apple compiler executable, SDK headers, simulator, device or remote compilation service is used by this package.

这是仅供开发者使用、已完成原生测试的实验性编译器子集，尚未接入生产浏览器流程。流程包含真实的语法解析、语义分析、AIR 降级和 MTLB 输出，不是容器重打包或固定示例输出。本工具包不调用 Apple 编译器、模拟器、设备或远程编译服务。

## Reproduce the native milestone / 复现原生阶段

Prerequisites: Linux, C++20 compiler (tested GCC 14), CMake 3.20+, Ninja, Git, tar and Node.js or Bun. Tested bootstrap used CMake 4.4.4, Ninja 1.13.2, `-O1`, assertions, four compile jobs and one link job on a roughly 10 GiB RAM machine. Default below is two compile jobs; use `--jobs 1` on a constrained host. This builds a large compiler and needs several GiB of memory/disk, not just the small package directory.

开发依赖：Linux、C++20 编译器、CMake、Ninja、Git、tar、Node.js 或 Bun。这些仅用于开发者构建，不是最终网页用户的安装要求。浏览器 WASM 构建尚未完成。

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

- Authored compute, vertex and fragment inputs compile into source-dependent AIR and MTLB. Sparse buffer/argument resource metadata and selected dynamic 2D sampling are implemented, not replaced with constants.
- Corrected public/private metadata lengths match the prefix-exclusive reference profile. Expected entry names, stages, bounds and embedded bitcode SHA256 were inspected. This does **not** prove Apple runtime acceptance.
- Repeated in-process compilation covers LLVM-context lifetime regressions and error recovery. Unknown/ignored attributes cannot silently turn unsupported source into a successful result.
- This package contains the original 15 authored frontend cases, nine math/header frontend cases, and in-process API/profile regression executables. The development milestone additionally passed targeted interface, resource and malformed-input suites; it does not claim all those separate development harnesses are included here. See [MATH_SUPPORT.md](MATH_SUPPORT.md) for the explicit fast-math profile and versioned header bundle contract.

已验证自编测试中的计算、顶点和片元着色器真实编译，以及部分稀疏资源绑定、动态二维采样、重复调用和错误恢复。输出结构与位码哈希检查通过，不等于 Apple 运行时验收。此包包含原有 15 个前端测试、9 个数学与头文件测试及进程内 API/配置测试，不包含用户游戏资料。

## Not ready / 尚未完成

- Browser/WASM execution and full game corpus compilation.
- Complete MSL standard library, textures/samplers, builtins, function constants, framebuffer fetch and tessellation compatibility.
- Xcode-equivalent shader behavior across the complete supplied corpus.

尚未完成浏览器执行、完整游戏覆盖、完整 MSL 库和高级功能。`api/CMakeLists.txt` includes an unvalidated WASM target scaffold, not a finished browser compiler. The frontend currently accepts Metal 3.0 syntax mode while the iOS 18 AIR writer emits a Metal 3.2 version tag; that tag must not be treated as full Metal 3.2 support.

GPU-specific pipeline archives and iPhone verification are outside this task. Do not invoke an iOS simulator. The target is the Xcode-built IPA's precompiled shader-library behavior, not eliminating all device-side pipeline work.

设备专属管线缓存及 iPhone 验证不属于本任务，禁止调用 iOS 模拟器。目标是匹配 Xcode 构建 IPA 的预编译着色器库行为，并非消除设备端所有管线工作。

## Browser smoke harness / 浏览器冒烟工具

After the actual WASM target builds, run `node browser-smoke-server.mjs --build /path/to/API-WASM-build` and open the printed loopback URL in desktop Chromium. The build directory must contain `d2r_air_wasm.mjs` and `d2r_air_wasm.wasm`. The embedded compatibility header bundle must match this package's fingerprint. For an earlier isolated build, append `--api-source /path/to/matching/API-source`; the harness derives the v1 single-header or v2 sorted-bundle fingerprint from that explicit source directory and requires the module to match it. This only selects a development fixture contract, not a production trust manifest.

This developer-only server serves a fixed allow-list of compiler and authored fixture files. It neither receives nor opens game inputs. Each of six authored source variants runs in its own dedicated Worker. Compiler assets are fingerprint-checked before the verified-byte instantiation hook is used; results undergo entry, stage, container and embedded bitcode integrity checks. The two variants per stage must produce different bitcode hashes. Cancellation terminates the active Worker. Results are shown on the page and in `globalThis.__airSmokeResult` for a browser automation driver.

The harness is not proof of browser execution until it has actually run with the generated compiler. Passing it still does not establish full-game coverage, semantic equivalence or Apple runtime acceptance. It is not connected to production IPA generation and does not replace the existing source-set digest checks.

实际 WASM 构建完成后，运行上述命令并用桌面 Chromium 打开本机网址。工具只提供明确列出的编译器及自编测试文件，不接收或读取游戏输入。六个测试分别使用独立 Worker，验证编译器指纹、输出结构及位码摘要；取消操作会终止 Worker。准备好工具不等于已通过浏览器验证，通过六个测试也不等于完整游戏或 Apple 运行时验收。

No uploaded game source, compiled reference library, private disassembly, build log, archive or compiled object belongs in this directory. No production shader-source digest/integrity logic is bypassed or replaced.

## Licensing / 许可证

See `THIRD_PARTY_NOTICES.md`. The fork contains Apache-2.0 WITH LLVM-exception code **and GPL-2.0-only floor transforms**. Do not describe the combined compiler as wholly permissive or distribute a runtime without satisfying all applicable licenses. This directory preserves patch/source attribution; the source archive remains external and pinned.
