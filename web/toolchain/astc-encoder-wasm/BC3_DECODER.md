# Bounded native-equivalent BC3 decoder

[简体中文](BC3_DECODER.zh-CN.md)

Standalone source building block only. Not wired into the ASTC worker, production UI, complete texture conversion, or CI. No game inputs or generated game data are included. Based precisely on `dm/tools/astc_pack.py` functions `bc3_decode()` and `blocks_to_image()`; this is parity with that native reference, not a claim about every possible BC3 decoder implementation.

## API and memory

- `decodeBC3Blocks(input)` takes a fixed, non-shared Uint8Array view containing complete 16-byte BC3 blocks and returns a Uint8Array of RGBA8 in block order. Each block contains 16 pixels in row-major order, four bytes per pixel. View offsets are respected. Input is neither changed nor detached.
- `decodeBC3BlockGrid(input, { rowBlocks = 1024 })` decodes directly into a row-major RGBA8 image and returns `{ rgba, width, height, blockCount, rowBlocks, paddedBlocks }`. `rgba` is a new owned ArrayBuffer suitable for the existing ASTC primitive's image contract. The caller must explicitly select the correct linear/sRGB profile when encoding. The default reproduces native stitching width 4096; the last row is padded with zero RGBA blocks.
- Both APIs accept 1–65,536 blocks: at most 1 MiB compressed input and 4 MiB decoded output. Grid dimensions are at most 4096 each and the padded grid must fit 1,048,576 pixels. Validation happens before output allocation; padding can make an otherwise valid block count fail the grid budget. Split at the caller's known block boundaries if necessary, not by truncating input.
- The direct grid path allocates one final RGBA image plus 20 bytes of reusable palette storage, not a full decoded block-order intermediate followed by another image. This is an allocation-structure property, not a measured browser RSS or speed claim. JavaScript engine overhead and the caller's retained input are additional memory.
- Output remains synchronous and bounded. If used for cancellable work later, call it inside a disposable worker and terminate that worker; this module does not itself create a worker, queue jobs, or promise mid-function cooperative cancellation.

## Exact interpretation

RGB565 endpoints are expanded by bit replication. Color selectors always use four colors, even when color endpoint 0 is less than or equal to endpoint 1. Interpolated RGB values use integer floors `(2*c0+c1+1)/3` and `(c0+2*c1+1)/3`; there is no BC1 transparent-color branch.

For alpha endpoint 0 greater than endpoint 1, intermediate entries use the native `+3` then divide-by-7 rounding. Otherwise entries 2–5 use `+2` then divide-by-5, and entries 6 and 7 are 0 and 255. Two 24-bit selector words avoid lossy JavaScript 32-bit operations on the full 48-bit alpha selector. Byte and selector order match the native little-endian interpretation. No gamma conversion, premultiplication, channel swizzle, normal reconstruction, or vertical flip occurs.

Grid output preserves source block order left-to-right, then top-to-bottom. Within every block, pixels remain row-major. This function does not interpret game mip tables, physical texture tiling, texture dimensions, descriptors, or thumbnail metadata. The native pipeline's separate block-region ordering and any later container rewriting remain the caller's responsibility.

## Deterministic verification

Run `node --test bc3-decoder.test.mjs`. With already installed Python and NumPy, the test extracts only the two pure native functions using Python's AST, without importing the rest of the native game tools. If NumPy is unavailable, the oracle case is explicitly skipped and no installation is attempted.

Executed with NumPy 2.3.5: all three tests passed, including byte-for-byte comparison on 1,031 deterministic synthetic blocks and the padded native block grid. Fixtures cover both alpha modes, equal alpha endpoints, all alpha/color selectors, reversed color endpoints, 24-bit selector boundary crossing, and the second grid row. Additional cases verify subarray offsets, unchanged input, malformed lengths/types, shared buffers, padded grid overflow, and the 65,536-block allocation ceiling.

These results establish decoder and stitching equivalence on synthetic cases, not browser worker integration, full game-texture parity, ASTC quality, or end-to-end pack generation.
