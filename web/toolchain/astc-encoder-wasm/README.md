# Bounded ASTC WASM primitive

[简体中文](README.zh-CN.md)

Experimental encoder used by the optional Older-GPU mode. Its bytes are preloaded with the public runtime and its worker starts on demand. See [optional runtime assets](../../runtime-build/OPTIONAL_ASSETS.md).

## Provenance

- Official [Arm astc-encoder 5.0.0](https://github.com/ARM-software/astc-encoder/releases/tag/5.0.0), exact commit `2ff200e08c98a61775351687ea2b5d38e455ad8b`. This is an intentional stable pin, not a claim of latest release.
- [Pinned API](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/Source/astcenc.h), [build configuration](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/Source/cmake_core.cmake), [Apache-2.0 license](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/LICENSE.txt). The source checkout retains upstream notices; build copies the license next to artifacts. Preserve these on any future distribution.
- Native baseline: `dm/tools/astc_pack.py`, `encode_batch()`: `-cl` or `-cs`, `4x4`, default `-thorough`, identity RGBA, no normal-map or alpha-weighting flags. The primitive maps these to `ASTCENC_PRF_LDR` / `ASTCENC_PRF_LDR_SRGB`, `ASTCENC_PRE_THOROUGH`, flags 0, and identity swizzle.

## Bounded presets

`preset` accepts only `thorough` (omitted default) or `fast`. They map to Arm `ASTCENC_PRE_THOROUGH` and `ASTCENC_PRE_FAST`; fast can trade image quality for less encoding work, without a measured browser speed claim. Block size, profile, alpha handling, flags, limits and context lifecycle are unchanged. ABI version 2 adds a final integer preset argument (0 thorough, 1 fast); unknown values reject. The JS wrapper rejects old ABI artifacts before allocation rather than silently encoding fast requests as thorough. Rebuild the module and WASM together. Callers should apply one preset consistently to textures and descriptor thumbnails, matching native `--preset` semantics.

## Contract and limits

The following limits and disposable-worker lifecycle describe the standalone primitive API, not the [integrated producer lifecycle](../../ASTC_PRODUCER.md).

`encodeAstc4x4({ rgba, width, height, profile, preset }, { signal, timeoutMs })` returns an ArrayBuffer of raw ASTC blocks, not an ASTC file. Input is one exact owned, fixed-length ArrayBuffer of tightly packed row-major RGBA8. Profiles are `linear` (default) and `srgb`. RGB values are passed unchanged; the selected ASTC profile determines encoding interpretation. Alpha stays linear; no premultiplication, gamma conversion, channel rearrangement, vertical flip, or normal reconstruction is applied. Output size is `ceil(width/4) * ceil(height/4) * 16`; partial edge blocks use upstream edge handling.

At most 1,048,576 pixels, 4096 per dimension, one job per imported module realm, one encoder thread. These limits describe this primitive only, not support for complete game textures. Input transfer detaches the caller buffer; it is not returned after failure or cancellation. One disposable worker is terminated after every result, abort, error, or deadline (maximum 120 seconds). Cancellation does not wait for synchronous compression to yield. Different tabs or independent module copies are not globally coordinated.

WASM starts at 32 MiB and has a 128 MiB linear-memory ceiling with recoverable malloc failure where supported. The input is at most 4 MiB; raw output has a conservative 4 MiB bound (the combined dimension limits make the actual maximum lower). There is one copy into WASM and one compact copy out. The WASM ceiling is not a total browser RSS limit: engine/module overhead, transferred input, copied output, and transient growth/GC allocations remain outside it. The worker is discarded to release its heap; browser reclamation timing is not guaranteed. No filesystem, PNG staging, pthread pool, or SharedArrayBuffer is required.

## Build and checks

Use an already installed official Emscripten 4.0.20 SDK, Git, and CMake: `bash build.sh`. The recipe fetches official source only, verifies the exact clean commit, builds the scalar backend with floating-point invariance enabled, and writes ignored `dist/` artifacts plus compiler version and license. No SDK installer or downloaded executable is run. The recipe requires exactly Emscripten 4.0.20 before fetching sources and retains its version receipt. Native-vs-WASM fidelity measurements remain a future gate. Do not commit generated binaries. Optional production wiring uses verified preload and the separate bounded producer; browser/device validation remains a release gate.

Run `node --test synthetic.test.mjs` for lightweight synthetic JS validation, allocation cleanup, ownership transfer, cancellation, deadline, and error handling. These tests use a fake codec/worker and do not demonstrate actual ASTC encoding, WASM build correctness, quality, speed, or game parity. Run the separate [WASM smoke harness](WASM_SMOKE.md) after building the artifact.

The optional producer now connects bounded texture/descriptor transformations and CASC writing in source. Remaining evidence gates include native parity for BC3 decoding/rounding, block-grid stitching/order, mip/thumbnail rewriting and descriptor cache updates, quality verification, browser execution, and end-to-end independently owned inputs. Its streaming SHA stage also retains the [unverified greater-than-4-GiB carry boundary](../sha256-stream-wasm/README.md). A scalar source recipe is a correctness-first starting point, not a measured speed improvement.

## Native smoke evidence (not WASM)

`bash native-smoke.sh` uses an already installed C++ compiler, checks out the same exact official Arm commit, reads its 22-file static-library source list, and builds only a scalar native smoke executable inside ignored `.build/`. It uses `-ffp-contract=off` to match the invariant backend configuration. It installs no compiler or SDK and fetches no executable. The test uses no game assets.
