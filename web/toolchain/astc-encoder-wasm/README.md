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

Run `node --test synthetic.test.mjs` for lightweight synthetic JS validation, allocation cleanup, ownership transfer, cancellation, deadline, and error handling. These tests use a fake codec/worker and do not demonstrate actual ASTC encoding, WASM build correctness, quality, speed, or game parity. Run the separate [WASM smoke harness](README.md#actual-wasm-encoding-smoke-harness) after building the artifact.

The optional producer now connects bounded texture/descriptor transformations and CASC writing in source. Remaining evidence gates include native parity for BC3 decoding/rounding, block-grid stitching/order, mip/thumbnail rewriting and descriptor cache updates, quality verification, browser execution, and end-to-end independently owned inputs. Its streaming SHA stage also retains the [unverified greater-than-4-GiB carry boundary](../sha256-stream-wasm/README.md). A scalar source recipe is a correctness-first starting point, not a measured speed improvement.

## Native smoke evidence (not WASM)

`bash native-smoke.sh` uses an already installed C++ compiler, checks out the same exact official Arm commit, reads its 22-file static-library source list, and builds only a scalar native smoke executable inside ignored `.build/`. It uses `-ffp-contract=off` to match the invariant backend configuration. It installs no compiler or SDK and fetches no executable. The test uses no game assets.

## Bounded native-equivalent BC3 decoder

Standalone source building block only. Not wired into the ASTC worker, production UI, complete texture conversion, or CI. No game inputs or generated game data are included. Based precisely on `dm/tools/astc_pack.py` functions `bc3_decode()` and `blocks_to_image()`; this is parity with that native reference, not a claim about every possible BC3 decoder implementation.

### API and memory

- `decodeBC3Blocks(input)` takes a fixed, non-shared Uint8Array view containing complete 16-byte BC3 blocks and returns a Uint8Array of RGBA8 in block order. Each block contains 16 pixels in row-major order, four bytes per pixel. View offsets are respected. Input is neither changed nor detached.
- `decodeBC3BlockGrid(input, { rowBlocks = 1024 })` decodes directly into a row-major RGBA8 image and returns `{ rgba, width, height, blockCount, rowBlocks, paddedBlocks }`. `rgba` is a new owned ArrayBuffer suitable for the existing ASTC primitive's image contract. The caller must explicitly select the correct linear/sRGB profile when encoding. The default reproduces native stitching width 4096; the last row is padded with zero RGBA blocks.
- Both APIs accept 1–65,536 blocks: at most 1 MiB compressed input and 4 MiB decoded output. Grid dimensions are at most 4096 each and the padded grid must fit 1,048,576 pixels. Validation happens before output allocation; padding can make an otherwise valid block count fail the grid budget. Split at the caller's known block boundaries if necessary, not by truncating input.
- The direct grid path allocates one final RGBA image plus 20 bytes of reusable palette storage, not a full decoded block-order intermediate followed by another image. This is an allocation-structure property, not a measured browser RSS or speed claim. JavaScript engine overhead and the caller's retained input are additional memory.
- Output remains synchronous and bounded. If used for cancellable work later, call it inside a disposable worker and terminate that worker; this module does not itself create a worker, queue jobs, or promise mid-function cooperative cancellation.

### Exact interpretation

RGB565 endpoints are expanded by bit replication. Color selectors always use four colors, even when color endpoint 0 is less than or equal to endpoint 1. Interpolated RGB values use integer floors `(2*c0+c1+1)/3` and `(c0+2*c1+1)/3`; there is no BC1 transparent-color branch.

For alpha endpoint 0 greater than endpoint 1, intermediate entries use the native `+3` then divide-by-7 rounding. Otherwise entries 2–5 use `+2` then divide-by-5, and entries 6 and 7 are 0 and 255. Two 24-bit selector words avoid lossy JavaScript 32-bit operations on the full 48-bit alpha selector. Byte and selector order match the native little-endian interpretation. No gamma conversion, premultiplication, channel swizzle, normal reconstruction, or vertical flip occurs.

Grid output preserves source block order left-to-right, then top-to-bottom. Within every block, pixels remain row-major. This function does not interpret game mip tables, physical texture tiling, texture dimensions, descriptors, or thumbnail metadata. The native pipeline's separate block-region ordering and any later container rewriting remain the caller's responsibility.

### Deterministic verification

Run `node --test bc3-decoder.test.mjs`. With already installed Python and NumPy, the test extracts only the two pure native functions using Python's AST, without importing the rest of the native game tools. If NumPy is unavailable, the oracle case is explicitly skipped and no installation is attempted.

Executed with NumPy 2.3.5: all three tests passed, including byte-for-byte comparison on 1,031 deterministic synthetic blocks and the padded native block grid. Fixtures cover both alpha modes, equal alpha endpoints, all alpha/color selectors, reversed color endpoints, 24-bit selector boundary crossing, and the second grid row. Additional cases verify subarray offsets, unchanged input, malformed lengths/types, shared buffers, padded grid overflow, and the 65,536-block allocation ceiling.

These results establish decoder and stitching equivalence on synthetic cases, not browser worker integration, full game-texture parity, ASTC quality, or end-to-end pack generation.

## Bounded BC3-to-ASTC batch orchestration

Isolated, unintegrated source building block. This combines the existing bounded BC3 decoder and ASTC worker client; real browser WASM transcoding remains unverified. Tests explicitly inject a fake codec, not Arm ASTC encoding. No production UI, CI, game files, texture metadata rewriting, or pack writer is involved.

### Contract

`transcodeBC3Batches(source, { profile, signal, batchBlocks = 65536, encode })` is a lazy async generator. `source.size` must be a nonnegative safe integer multiple of 16. Zero bytes yield nothing. `source.readAt(offset, length, { signal })` must return or resolve to an exact-length, fixed, non-shared Uint8Array view. Short reads and oversized reads fail; the generator never retries or silently truncates them. The profile must explicitly be `linear` or `srgb`. `encode` defaults to `encodeAstc4x4`; overriding it is a dependency-injection seam, not an alternative verified codec.

Each yielded item contains `blocks` (Uint8Array of raw ASTC blocks), `blockOffset`, `blockCount`, `completedBlocks`, `totalBlocks`, and `profile`. Offsets/counts are in blocks, not bytes. Completed counts increase after encoding succeeds and reach the total only for a completely consumed successful generator. Counts are caller-visible progress information, not a persisted transaction record.

Only one read and one encode are awaited at a time. The next batch is not read until the consumer requests another item; there is no prefetch queue. Batch size is 1–65,536 blocks, at most 1 MiB compressed input and 1 MiB yielded ASTC. The decoder's default 1024-block row grid bounds RGBA to 4 MiB including final row padding. The padded ASTC length is validated before trimming. Only trailing zero-grid padding is removed; genuine source blocks are never reordered or trimmed. The source is sampled in increasing byte offsets.

Consumers must write or consume each yielded chunk and release it before advancing; collecting all chunks intentionally retains a whole output and defeats streaming. This module does not retain a complete texture or pack, perform output writes, or provide rollback if a later batch fails. Callers own partial-output cleanup. Transfer of RGBA to the real worker consumes that intermediate buffer; the source input is not detached or changed. A final partial grid may briefly require both padded encoded output and its compact copied prefix. Browser/module overhead, source caching, and delayed garbage collection are additional memory, not included in the buffer bounds.

### Cancellation and limitations

An AbortSignal is checked before work, after reading, and after encoding. It is forwarded to both source and codec. Waiting for either operation is abortable even if the injected operation ignores the signal, but the underlying source can only release its own pending I/O resources if it honors that signal. The real encoder client terminates its disposable worker. An ignored abort in a custom codec cannot be forcibly stopped by this generator. Synchronous decoding is bounded; it is not cooperatively interruptible mid-function. Calling `return()` or breaking iteration while paused at a yielded result prevents subsequent reads; use the signal to cancel an operation already pending.

A caller that cancels or stops early must not treat prior chunks as a complete texture. This does not interpret texture dimensions, mip boundaries, block-linear tiling, descriptor caches, thumbnails, or CASC layout. It is not the complete native `astc_pack.py` workflow, and source-equivalent BC3 decoding does not establish real BC3-to-ASTC transcode parity.

### Verification

`node --test bc3-astc-batches.test.mjs` passes four deterministic fake-codec tests. They cover lazy sequential processing, a 65,536-block batch plus a three-block padded tail, bounded output, monotonic counts, exact tail trimming, malformed lengths/profiles, short reads, invalid codec lengths, empty input, cancellation before/during read and encoding, consumer stop, and preservation of decoded source-block identity across three batches. Real WASM compilation, browser execution, encoding quality, and native-versus-browser block equivalence remain outstanding.

## Bounded texture-container streaming adapter

Isolated source only, not production integration. `texture-stream.mjs` wraps `bc3-astc-batches.mjs` using the structural interpretation in `dm/tools/astc_pack.py`: format byte at offset 4, unsigned little-endian relative data pointer at offset 40, and `dataStart = 40 + pointer`. BC3 format 0x3d maps to ASTC 0x5f with linear encoding; 0x3e maps to 0x51 with sRGB encoding. Every other header byte is preserved exactly. The payload remains 16 bytes per block, so output file length and offsets are unchanged.

### Stream contract

`transcodeTextureStream(source, { signal, batchBlocks, encode })` consumes a readAt source with a nonnegative safe integer `size`. `readAt(offset, length, { signal })` must return an exact-length fixed, non-shared Uint8Array. It yields typed events:

- `skip`: reason `short-input` for fewer than 48 bytes, or `unsupported-format` with the observed numeric format. These cases produce no output bytes and no completion event. Skipping is explicit; unsupported files are never silently rewritten.
- `header`: an owned byte chunk and its absolute output offset. The first event also reports original/new format, dataStart, and profile. Byte 4 alone is changed. The initial read is 48 bytes; subsequent header chunks are at most 64 KiB. Even an unusually long header is streamed rather than retained as a whole.
- `blocks`: raw ASTC byte chunk, absolute output offset, block count, completed block count, and total block count. These use the existing serial bounded batch adapter, at most 1 MiB per chunk. Profile is derived from the original format, not guessed or overridden by callers.
- `complete`: emitted only after all header and payload bytes have been yielded successfully, with unchanged file size and format/profile information. It does not mean a downstream file writer has persisted the output.

The consumer must distinguish event kinds, consume each byte chunk promptly, and handle skip explicitly. The adapter performs no writes and retains no complete texture or CASC pack. Consumers own partial-output cleanup after errors, cancellation, or early termination. Holding all emitted chunks intentionally defeats streaming. Header chunks are copied to avoid retaining a large source backing buffer; source caching and JavaScript garbage collection remain outside the adapter's control.

### Bounds, cancellation, and native distinctions

For supported formats, the data start must be at least 48, strictly below source size, and leave a nonempty tail divisible by 16. Rejecting dataStart below 48 is deliberately stricter malformed-input validation than the native script, which does not explicitly reject header overlap. The format mapping, pointer interpretation, untouched header bytes, and block ordering match the native structural rules; this does not establish full native conversion parity.

Options that predictably fail batch validation are checked before the first output. Short reads, wrong buffer types, shared/resizable buffers, unsafe sizes, and malformed offsets fail. Errors from the caller's read function or injected codec are replaced by fixed category messages without private filenames or original causes. Abort errors retain the generic AbortError category.

Cancellation is forwarded to header reads and the batch adapter, checked between chunks, and stops waiting for pending reads. Underlying reads only release their resources if the source honors its signal. Synchronous bounded decoding is not cooperatively interrupted. Breaking at a yielded chunk prevents subsequent reads; an AbortSignal is needed to interrupt already-pending work. Earlier emitted chunks are not a complete valid conversion if the stream does not finish.

No mip table parsing, texture-dimension interpretation, descriptor-cache updates, thumbnail changes, CASC writing, quality reporting, or game content handling is implemented here. The native script's separate container and pack responsibilities remain outstanding.

### Synthetic evidence

`node --test texture-stream.test.mjs` passes five deterministic tests using an injected fake encoder, not actual ASTC compression. Cases cover both format/profile mappings, exact header preservation, ordered batch offsets and counts, bounded long-header reads, lazy early stop, explicit skips, overlapping/out-of-range/misaligned pointers, short reads, invalid sizes/options, pending-read cancellation, and privacy-safe error categories. Real WASM transcoding, game-file behavior, and full native pipeline equivalence are not claimed.

## Bounded texture descriptor-cache transform

`descriptor-cache.mjs` follows `dm/tools/astc_pack.py:desc_cache` without reading
files or creating a pack. Call `transformTextureDescriptorCache(bytes, converted,
{ signal, batchBlocks, encode })`; `converted` is a Map from lowercase ASCII
logical names to boolean sRGB flags. This map must describe textures actually
converted by the caller; it is not authentication or an ownership assertion.
The result contains `bytes`, `convertedEntries` and `thumbnailCount` only.

For selected entries, format 61 maps to 95 and 62 to 81. Format62 must agree with
the selected sRGB flag. Other formats and unselected entries remain unchanged.
Absent, null and empty thumbnails retain their shape. JSON metadata is preserved
semantically, not with original whitespace or numeric spelling.

Thumbnail interpretation matches native little-endian relative addressing:
count is u32 at0; table starts at4 + signed i32 at4; each table row has size u32
and a signed relative pointer measured from that pointer field itself. Every
payload range must lie after the complete table and within the thumbnail, and
have a nonzero multiple-of16 length. Table order determines conversion order,
not physical range order. Header, table, gaps, trailing bytes and all other
non-payload bytes are preserved exactly; pointers are not rewritten.

All selected metadata/layouts are checked before the first codec call. The
transform then retains at most one decoded thumbnail and calls the existing
`transcodeBC3Batches` serially for each mip. Its bounded source is a view into
that thumbnail, not a wholepack buffer. Input descriptor bytes are not modified.
No partial JSON output is returned after failure or cancellation. Errors contain
only fixed codes (`ASTC_DESCRIPTOR_INVALID`, `ASTC_DESCRIPTOR_TRANSCODE`) or a
fixed AbortError, never filenames, parser details or injected codec text.
Underlying codec cancellation/resource release remains its responsibility.

### Intentionally narrower acceptance

- UTF-8 JSON array, at most16MiB input,32MiB output,100,000 entries/map keys.
- At most4MiB per thumbnail,1–64 nonempty mips, no overlapping payload ranges.
- Table starts at or after byte8; no signed pointer may reach metadata or escape
  the thumbnail. Gaps and reverse physical order are supported.
- Canonical padded base64 only, without whitespace or alternate padding bits.
- Map keys are lowercase printable ASCII,1–1024 characters; record filenames
  are strings of at most1024 characters. Matching lowercases record names.
- Metadata traversal is capped at500,000 nodes and64 levels. Nonfinite numbers
  and integers outside JavaScript's safe range reject instead of corrupting
  metadata during serialization. Thumbnail fields other than strings, null or absent reject.
- Batch constraints remain those of `transcodeBC3Batches` (up to65,536 blocks).

Native groups all thumbnails by sRGB before encoding. This implementation runs
mips/entries serially for bounded memory. Descriptor layout/preservation behavior
is covered, but this grouping change is not claimed to produce native-identical
ASTC bytes. Genuine codec, complete-cache, image-fidelity, full pack, device and
gameplay parity remain unproved. No runtime/UI/CI integration is enabled.

### Focused validation

`node --test web/toolchain/astc-encoder-wasm/descriptor-cache.test.mjs`
uses authored JSON/thumbnails and injected fake codecs only. It covers format
mapping, sRGB mismatch, serialized calls, metadata preservation, relative
pointer/count/size/overlap rejection, reverse physical mip ordering, unchanged
non-payload bytes, input immutability, base64/budget failures, sanitized errors
and cancellation of a hung codec. No game files or filenames are fixtures.

## Actual WASM encoding smoke harness

Run `node wasm-smoke.mjs` with Node 24 or newer, immediately after `bash build.sh` produces the isolated `dist/` artifacts. This is a test-only Node worker_threads harness, not the production browser worker or a deployed runtime. It makes no changes to build environment flags.

The harness requires the generated module, WASM binary, exact Arm commit receipt, and Emscripten 4.0.20 version receipt. Each artifact is limited to 32 MiB before reading. It dynamically imports the actual generated module and supplies the exact local WASM bytes using Emscripten's `wasmBinary` factory option. The Node test worker explicitly defines `self` and `WorkerGlobalScope` shims; fetch and XMLHttpRequest calls throw instead of using network loading. This is an adaptation for testing, not proof of native browser-worker compatibility.

Thirty-two tiny deterministic fixtures cover thorough/fast presets, linear/sRGB profiles, 1×1, 4×4, 5×7, and 17×3 dimensions, and opaque red plus RGBA gradients. Each is encoded twice with the real WASM C ABI to check determinism; thorough fixtures also run with the preset omitted to verify default byte identity (80 encode calls total). Checks cover ABI version 2 and export availability, output lengths, nonzero data, differing fixture outputs, invalid dimensions, profile, preset, lengths, and null pointers. The existing `encodeWithModule` wrapper provides allocation cleanup. There is no WASM decode export, so this test does not assert decode quality or native byte equivalence.

One worker is terminated on success, failure, or a 30-second parent deadline. The parent returns nonzero on missing artifacts, test failure, unexpected worker exit, or timeout; missing artifacts are not silently skipped. A JSON success record identifies the test-only shimmed Node environment, fixture results, artifact hashes, and maximum observed heap length. Observing the heap within its configured range on tiny fixtures does not test maximum-memory enforcement or total process/browser RSS. Node's JavaScript heap resource limit also does not cap WebAssembly linear memory.
