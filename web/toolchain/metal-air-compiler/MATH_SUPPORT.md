# Experimental authored math/header subset / 实验性数学与头文件子集

This is a native-validated addition to the experimental compiler, not a claim of full MSL support, browser completion, or Apple runtime acceptance. It does not contain Apple SDK headers or user shader material.

## Interface and provenance

- Existing `air_compile_v1` stays source/ABI-compatible and selects the conservative subset.
- New `air_compile_v2` takes an explicit final math-profile argument: `0` conservative, `1` fast-f32. Other values are rejected. Profile 1 sets fast-math/no-NaN/no-infinity/no-signed-zero flags and explicitly selects single-precision unsuffixed literals with Clang’s `-cl-single-precision-constant`; it must only be selected when the source's intended compilation profile permits them.
- The fixed header bundle is force-included before caller source and kept entirely in the in-memory filesystem. Source bytes are not rewritten; callers must continue hashing the original source separately.
- `air_compiler_header_bundle_version()` returns `2`. `air_compiler_header_sha256()` now fingerprints the complete bundle: SHA-256 of `d2r-air-header-bundle-v2\n`, followed by lexically sorted `relative-path:sha256\n` records. It is no longer the digest of a single header. Existing caches must be invalidated when this value changes. Cache identity must also include API version, selected math profile, target OS and original source digest. The browser adapter defaults to v1 and requires explicit v2 capability/profile selection. Its v2 ABI checks and real Node-hosted WASM execution pass; Chrome and full-game verification remain pending.
- Trusted AIR declarations are limited to exact float signatures and known symbols in the physical embedded math header. Caller assembly, fake `#line` filenames, user redeclarations and macro-defined assembly labels are rejected. No host includes are available.

## Implemented and tested

Authored float scalar/vector math wrappers emit real AIR calls for fma, sqrt, rsqrt, exp2, log2, floor, trunc, rint, abs, min, max and clamp. Standard fast wrappers require profile 1; `metal::fast` explicitly names the fast behavior. The subset includes integer min/max/clamp, equal-size bit casting, scalar select/isnan, and a vector-alias-only `simd/simd.h` shim.

Nine authored frontend fixtures and the API header/profile regression suite pass, alongside the original API smoke suite. The regression suite covers exact profile selection, forged filename rejection, assembly/redeclaration rejection, and repeated compilations. These execution results belong to the prior gzorin-based baseline. The migrated a2flo frontend selects `metal3.2` mode and retains AIR 2.7/MSL 3.2 output; it still needs its own CI build and validation, and does not imply complete MSL 3.2 language support.

The narrow `select(floatN, floatN, isnan(floatN))` path uses internal component masks for N=2,3,4; these are not MSL bool-vector storage or interface types. Scalar and vector NaN classification uses IEEE float-bit tests so fast-math cannot remove sanitization. See [NAN_CLASSIFICATION.md](NAN_CLASSIFICATION.md).

### Added scalar and compute operations (execution validation pending)

The authored headers now provide `sin(float)`, `cos(float)` and `ceil(float)` through exact `air.fast_sin.f32`, `air.fast_cos.f32` and `air.fast_ceil.f32` declarations. Like the existing fast math subset, ordinary `metal::` exports require profile 1; explicit `metal::fast::` calls remain available without changing the selected profile. No half or vector overloads were added for these three operations.

`reverse_bits(uint)` calls `air.reverse_bits.i32`; the signed overload preserves input and result bits with equal-size bit casts, not float conversion or signed arithmetic. A deleted generic overload rejects unsupported widths and vectors instead of silently promoting 16-bit inputs to a 32-bit reversal. `simd_all(bool)` calls the boolean `air.simd_all` intrinsic, marked convergent and never const/pure. Its currently supported project subset is compute-only, including calls reached through helper functions. The frontend-wide `ConvergentFunctions` option remains enabled. These declarations use the direct AIR path, not compiler builtins requiring unimplemented LLVM intrinsic lowering.

`api/operations_smoke.h` adds independent executable regression sources to the existing header/profile suite. They cover exact AIR signatures, profile gates, unsupported argument types, signed/unsigned reversal, convergent SIMD calls and helpers, fragment/vertex rejection, and forged labels, filenames, redeclarations and definitions. Negative cases check the expected failure status and empty output, rather than accepting a missing entry point as proof of declaration rejection. The scalar/integer frontend fixtures also exercise the added operations. Two obsolete negatives were corrected: implemented scalar integer `abs` and uint `simd_shuffle` are positive cases with integer-preservation checks; unsupported int-vector `abs` and half `simd_shuffle` retain type-rejection coverage.

The production CI canary includes a fourth fixed authored fixture, `fixtures/msl-scalar-operations.metal`, with runtime buffer inputs and separate output stores for all five added operations. A fifth fixture, `fixtures/msl-fragment-atomic-add.metal`, exercises a device uint atomic add with runtime index/value inputs and a returned color derived from the previous value. The original vertex, fragment and compute fixtures remain unchanged. With the five additional [compiler-correction canaries](CORPUS_FIXES.md#real-wasm-ci-canaries), the canary is configured to compile ten fixtures across three stages through the real WASM compiler and validate their metallib containers; it does not run the native header smoke suite or establish device execution.

The standard `metal_stdlib` umbrella also includes the existing guarded `metal_atomic` subset, exposing `mem_flags` and `threadgroup_barrier` without a separate include. The fourth canary exercises `threadgroup_barrier(mem_flags::mem_threadgroup)` using only that umbrella. Existing atomic declaration trust and compute-only barrier argument checks are unchanged.

The authored `metal_tessellation` header supplies `metal::MTLQuadTessellationFactorsHalf` as four half-valued edge factors followed by two half-valued interior factors. Apple's [public tessellation description](https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/MetalProgrammingGuide/Tessellation/Tessellation.html) specifies the field names, order and array lengths, and distinguishes host `uint16_t` storage from shader half values. The [MSL Specification](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf), Table 2.2 (2026-06-04 edition, page 27), specifies half size/alignment as two bytes. The resulting natural array layout is 12 bytes, aligned to two, with member offsets zero and eight; header and native-fixture assertions enforce those values. The fourth canary writes all six fields from runtime float inputs as actual half values. This is an independent public-ABI declaration, not copied SDK implementation text or a host-integer substitution.

The stage validator also permits the reference-established `air.atomic.global.add.u.i32` in fragments, with the same exact relaxed order, device scope and volatile argument checks used for compute. No other atomic gains fragment support: fragment local atomics, global min and barriers, and all vertex atomics remain rejected. Authored native cases cover the allowed fragment add and retained stage/argument restrictions; declaration provenance and signatures are unchanged.

This addition has source-only regression checks; its compiler fixtures and extended canary have not been built or executed locally. A rebuilt CI compiler artifact and real compiler runs remain required. Header fingerprints update automatically from the existing fixed bundle algorithm; no artifact digest, source-integrity check or prior reference expectation is replaced to claim a pass. No Apple SDK text or private application shader source is included.

Unsupported types/operations remain errors, including general bool-vector storage/operations, accurate transcendental replacements, and APIs outside the authored SIMD, texture and math subsets. Do not substitute integer vectors for bool vectors or treat successful packaging as rendering equivalence.

Build the existing API CMake project with targets `d2r_air_api_smoke` and `d2r_air_header_smoke`, then run:

`node run-math-fixtures.mjs /path/to/clang /path/to/api-build`

## 中文说明

这是已经过原生编译验证的实验性子集，不代表完整 MSL、浏览器端流程或 Apple 设备兼容性已经完成。头文件为自行实现，不包含 Apple SDK 或用户提供的着色器。

保留原有 v1 接口；新增 v2 接口显式选择数学配置。配置 1 会启用快速浮点假设，只有与源代码预期编译配置一致时才可使用。头文件摘要升级为版本 2 的完整、排序后的头文件集合摘要，原始着色器摘要仍需独立保存，不能用注入头文件后的文本替代。

验证覆盖真实 AIR 数学调用、整数精度保持、非法类型诊断、伪造文件名与汇编符号拒绝，以及重复编译。尚未支持的接口必须报错，不能用空实现、错误的向量类型或重新打包冒充编译成功。WASM 集成和完整游戏着色器覆盖仍需后续验证。
