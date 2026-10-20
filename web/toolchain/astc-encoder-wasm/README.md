# Bounded ASTC WASM primitive

[简体中文](README.zh-CN.md)

Experimental, isolated source only. Not a production option, full-texture converter, or browser/native parity claim. No game assets, keys, generated binaries, or upstream source copies are included.

## Provenance

- Official [Arm astc-encoder 5.0.0](https://github.com/ARM-software/astc-encoder/releases/tag/5.0.0), exact commit `2ff200e08c98a61775351687ea2b5d38e455ad8b`. This is an intentional stable pin, not a claim of latest release.
- [Pinned API](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/Source/astcenc.h), [build configuration](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/Source/cmake_core.cmake), [Apache-2.0 license](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/LICENSE.txt). The source checkout retains upstream notices; build copies the license next to artifacts. Preserve these on any future distribution.
- Native baseline: `dm/tools/astc_pack.py`, `encode_batch()`: `-cl` or `-cs`, `4x4`, default `-thorough`, identity RGBA, no normal-map or alpha-weighting flags. The primitive maps these to `ASTCENC_PRF_LDR` / `ASTCENC_PRF_LDR_SRGB`, `ASTCENC_PRE_THOROUGH`, flags 0, and identity swizzle.

## Contract and limits

`encodeAstc4x4({ rgba, width, height, profile }, { signal, timeoutMs })` returns an ArrayBuffer of raw ASTC blocks, not an ASTC file. Input is one exact owned, fixed-length ArrayBuffer of tightly packed row-major RGBA8. Profiles are `linear` (default) and `srgb`. RGB values are passed unchanged; the selected ASTC profile determines encoding interpretation. Alpha stays linear; no premultiplication, gamma conversion, channel rearrangement, vertical flip, or normal reconstruction is applied. Output size is `ceil(width/4) * ceil(height/4) * 16`; partial edge blocks use upstream edge handling.

At most 1,048,576 pixels, 4096 per dimension, one job per imported module realm, one encoder thread. These limits describe this primitive only, not support for complete game textures. Input transfer detaches the caller buffer; it is not returned after failure or cancellation. One disposable worker is terminated after every result, abort, error, or deadline (maximum 120 seconds). Cancellation does not wait for synchronous compression to yield. Different tabs or independent module copies are not globally coordinated.

WASM starts at 32 MiB and has a 128 MiB linear-memory ceiling with recoverable malloc failure where supported. The input is at most 4 MiB; raw output has a conservative 4 MiB bound (the combined dimension limits make the actual maximum lower). There is one copy into WASM and one compact copy out. The WASM ceiling is not a total browser RSS limit: engine/module overhead, transferred input, copied output, and transient growth/GC allocations remain outside it. The worker is discarded to release its heap; browser reclamation timing is not guaranteed. No filesystem, PNG staging, pthread pool, or SharedArrayBuffer is required.

## Build and checks

Use an already installed official Emscripten 4.0.20 SDK, Git, and CMake: `bash build.sh`. The recipe fetches official source only, verifies the exact clean commit, builds the scalar backend with floating-point invariance enabled, and writes ignored `dist/` artifacts plus compiler version and license. No SDK installer or downloaded executable is run. The recipe requires exactly Emscripten 4.0.20 before fetching sources and retains its version receipt. Native-vs-WASM fidelity measurements remain a future gate. Do not commit generated binaries or expose this primitive in production until reviewed and tested.

Run `node --test synthetic.test.mjs` for lightweight synthetic JS validation, allocation cleanup, ownership transfer, cancellation, deadline, and error handling. These tests use a fake codec/worker and do not demonstrate actual ASTC encoding, WASM build correctness, quality, speed, or game parity. Separate CI WASM evidence is recorded below; browser codec tests remain unrun.

Remaining pipeline work includes BC3 decoding and rounding parity, block-grid stitching/order, mip/thumbnail rewriting, descriptor cache updates, quality verification, CASC writing, browser execution evidence, and end-to-end independently owned inputs. A scalar source recipe is a correctness-first starting point, not a measured speed improvement.

## Native smoke evidence (not WASM)

`bash native-smoke.sh` uses an already installed C++ compiler, checks out the same exact official Arm commit, reads its 22-file static-library source list, and builds only a scalar native smoke executable inside ignored `.build/`. It uses `-ffp-contract=off` to match the invariant backend configuration. It installs no compiler or SDK and fetches no executable. The test uses no game assets.

Executed with GCC 14.2.0: all 16 real encode/decode round trips passed for linear and sRGB profiles, dimensions 1×1, 4×4, 5×7, and 17×3, with solid RGBA and synthetic color/alpha gradients. Solid opaque red was exact; nontrivial gradient four-channel PSNR ranged from 20.83 to 35.12 dB (a smoke threshold only, not a game-quality target). Invalid dimensions, overflow dimensions, profile, buffer lengths, and null input were rejected. Compiler receipt and results remain ignored under `.build/`.

This verifies the actual C ABI compiles and links against the pinned upstream core and produces decodable ASTC. Source inspection confirms the upstream `astcenc-none-static` target and the selected CMake options exist. The local environment lacks Emscripten/CMake; separate CI evidence below covers actual WASM compilation. Native success alone is not WASM or full-pipeline parity. Browser execution, cancellation and full-scale memory remain unverified.

## CI evidence

[Run 39477410207](https://github.com/n3crosis/d2r-mobile/actions/runs/39477410207), source f4f3326, compiled with pinned Emscripten 4.0.20 and passed 16 fixtures / 32 actual WASM encode calls in the explicitly shimmed Node worker. Small fixtures observed a 33,554,432-byte linear heap; this is not a peak browser-memory or maximum-heap enforcement measurement. WASM SHA-256: `518e199e5fc29f743909093d478eb3d650c0398f3c0a17dfd25fcc27a115c2ee`. Browser-worker execution, native/WASM byte equivalence, decode fidelity and full game texture-pack integration remain unverified. ASTC is not included in the published runtime payload.
