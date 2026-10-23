> Historical pre-fork documentation. Commands and source paths below describe the old build, not the current release consumer. See [the current integration](../README.md).

# Reproducing the experimental browser compiler

This is developer tooling, not an end-user requirement or a new CI job. End users must not install Python, LLVM, Xcode, Emscripten, or a native helper. The resulting module compiles shader source in process; it does not launch subprocesses or call a compilation service.

## Proven configuration

The first working build used the manifest-pinned floor/LLVM 14 source and reviewed patches, official Emscripten **4.0.20** (emsdk commit `e4fe26ef59168ff44f4c23c466e497bf60b3411e`), CMake 4.4.4 and Ninja 1.13.2. Node 24.19.0 ran the authored WASM preflight. Emsdk's bundled Node 22.16.0 was available for its build tools. The host was Linux. Windows/macOS developer crossbuilds are not independently proven by this milestone.

Obtain the pinned source archive and official SDK separately. Existing `prepare` verifies the source archive and ordered patch hashes; `build-wasm` does not download or install software. Activate the SDK in the current shell using its `emsdk_env.sh` before invoking `build-wasm`.

From the repository root:

```sh
node web/toolchain/metal-air-compiler/toolchain.mjs prepare --archive /path/to/pinned-archive.tar.gz --work /path/to/new-empty-work
node web/toolchain/metal-air-compiler/toolchain.mjs build --work /path/to/new-empty-work --jobs 4
node web/toolchain/metal-air-compiler/toolchain.mjs build-wasm --work /path/to/new-empty-work --jobs 4
node web/toolchain/metal-air-compiler/toolchain.mjs test-wasm --work /path/to/new-empty-work
```

Native generators remain in `work/build/bin/{llvm,clang}-tblgen`. Crosscompiled dependency libraries go to `work/build-wasm`; the API module goes to `work/api-build-wasm/d2r_air_wasm.{mjs,wasm}`. Native and WASM builds must never share a CMake build directory. `--native-build DIR` can select an existing matching native build. This first configuration deliberately retains the full Clang CodeGen dependency graph; size reduction is separate work.

The executable command records the validated flags: Release `-O1 -DNDEBUG`, assertions on, no LLVM target backends, explicit wasm32 host/default triples, native TableGen paths, threads off, SPIR-V off, no LTO, tests/examples/benchmarks/utilities and unnecessary external libraries off, one link job. Four compile jobs succeeded in the observed environment; use fewer where memory is constrained. LLVM 14 may warn that the ZSTD option is unused.

## Standalone authored preflight

```sh
node web/toolchain/metal-air-compiler/wasm-node-preflight.mjs \
  --build /path/to/api-build-wasm \
  --api-source web/toolchain/metal-air-compiler/api \
  --api-version 2 \
  --output /path/to/result.json
```

Version 2 explicitly selects math profile 1 and checks the sorted three-header bundle fingerprint against the supplied API source directory. It tests the trusted-header boundary, rejected user asm declarations, forged source locations, invalid profiles and recovery. For an archived version-1 module, pass `--api-version 1` and the matching version-1 API source directory; its single-header fingerprint is checked instead. Never substitute a new header fingerprint into old compiled glue or claim that a different profile was tested.

Both modes compile authored compute/vertex/fragment and conversion sources repeatedly in one actual WASM instance. They check source-dependent AIR, MTLB output, invalid-input recovery, protected semantic diagnostics, and public HEAPU8 refresh after deliberate memory growth. The script contains no private game sources or selected-source paths.

Node receives explicit Worker-global shims. A Node pass is **not Chrome execution or Apple GPU acceptance**. The existing developer browser smoke harness is a separate check. The test uses an explicit byte-based `instantiateWasm` callback, asserts one instantiation, rejects fetch and `locateFile`, and checks `Module.HEAPU8`. Merely supplying `wasmBinary` is not a substitute: generated glue may otherwise attempt URL resolution from a blob worker. The public heap view must be reacquired after calls that can grow memory; output must be copied before freeing the result.

## Measured first milestone

At repository checkpoint `27129a1958e0f333e1174559181d32c4ca1ce1a3`, the v2 module measured:

- WASM: 65,552,292 bytes; SHA-256 `9d56f78fcd489c318484bebddc7516bb94861da852c9d14938511e65950925e4`.
- Glue: 93,597 bytes.
- WASM gzip: 17,222,081 bytes; Brotli quality 5: 12,765,735 bytes. These are offline compression measurements, not a deployed transfer size.
- Header bundle: `959bca085fd275c6fc949e7c7a5f40c4712931e84fd5e1f0e061e97106c11814`.
- Normal authored tests stayed at 67,108,864 bytes of linear memory. This excludes compiled WASM code, JS/V8 and process overhead. The first v2 Node run peaked at 608,236 KiB process RSS, not browser memory.

The earlier single-header baseline measured 65,546,563 WASM bytes and 93,321 glue bytes; its three-round test also passed. Build paths/toolchain details can alter emitted binary hashes, so use the preflight's newly measured hashes rather than assuming byte-identical reproducibility.

Ten unchanged privately supplied shader sources also compiled through v2 WASM, passed independent container/digest checks, and matched selected reference AIR-call inventories. Those private inputs, runners and outputs are intentionally not part of this public reproduction package. This selected subset does not prove all 7,212 game shaders compile, full language compatibility, shader semantic equivalence, or Apple runtime acceptance. It does not establish elimination of device-specific graphics pipeline creation.

No Apple compiler tools, iOS simulator, remote compilation, game keys, or native runtime helper were used by the WASM preflight. Future compiler/header patches require fresh matching builds and tests; this document's measurements describe the named checkpoint only.

## 中文说明

此处是开发者复现工具，不是最终网页用户的安装要求。WASM 编译器已实际完成源码到 AIR/MTLB 的编译，并通过 Node 中带明确 Worker 环境模拟的重复调用、错误恢复及内存增长测试。这不等于 Chrome、完整游戏或 Apple GPU 验证。

使用已锁定的 Emscripten 4.0.20；原生 TableGen、WASM 依赖库及 API 模块必须放在独立构建目录。现有工具链新增 `build-wasm`、`test-wasm`，不增加 CI 工作流。测试必须使用与模块一致的头文件集合摘要及数学配置，不得用新摘要冒充旧模块。

上述检查点的 WASM 原始大小约 65.55 MB，Brotli 质量 5 压缩后约 12.77 MB。常规自编测试使用 64 MiB 线性内存，但这不包含编译后机器码、JavaScript 和进程开销，也不是浏览器内存上限承诺。用户提供的游戏源代码、私有测试程序及输出均不包含在本工具包中。
