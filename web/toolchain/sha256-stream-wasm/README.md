# Isolated streaming SHA-256 candidate

中文: [README.zh-CN.md](README.zh-CN.md)

This source-only candidate hashes staged local File/Blob bytes without buffering the whole file or acquiring another extraction runtime. It is not connected to production UI, workers, runtime inventories or CI. It introduces no new fetched dependency and does not implement its own cryptographic algorithm.

## Source and boundary

`source-pin.json` independently pins the exact existing hactool commit, mbedTLS 2.6.1 SHA-256 implementation/header, Apache license files and minimal configuration. The explicit source checkout must match both commit and per-file byte length/SHA-256. No download, install or cache-directory discovery occurs. The unmodified upstream source is compiled with the uniquely named `sha256_config.h`, defining only `MBEDTLS_SHA256_C`; upstream default configuration, TLS, generic digest dispatch, alternate implementations and self-test I/O are excluded.

`bridge.c` keeps one SHA-256 context, one 64 KiB input buffer and a 32-byte result. The only lifecycle is begin → zero or more bounded updates → finish, or abort. Begin fails while busy. Every operation requires the current nonzero generation token; tokens never wrap or repeat. Stale owners cannot clear a newer hash. An excessive update length invalidates only its valid owner. Successful updates wipe input; finish/abort clear the upstream context and input. Abort also wipes the result; a finished result remains available for the adapter to copy and is cleared at the next begin. No parser state, key APIs, allocation or filesystem is used.

The standalone WASM recipe uses existing emsdk 4.0.20, fixed 256 KiB linear memory, 16 KiB stack, no memory growth and zero host imports. Those are build gates, not a claim that the currently unbuilt WASM has passed them. Artifact size must be measured, not estimated. `dist/build-report.json` records exact compiler text, source pins, local source hashes, normalized arguments, raw/gzip byte sizes and artifact SHA-256. Licenses accompany the artifact.

## JavaScript API

`await createSha256FileHasher(wasmBytesOrModule)` returns `{ hashFile }`. The caller's release loader must authenticate WASM provenance and its expected digest; the factory itself checks import closure, memory size and rejection of memory growth before private reads. `createSha256FileHasherFromAbi` is an explicit low-level mock/testing seam, not provenance verification.

`await hashFile(file, { signal? })` returns frozen `{ sha256, bytesHashed }` and immediately wipes the native result buffer after copying the digest. Only File/Blob inputs with safe integer sizes are accepted. The adapter reads each immutable slice through `file.slice(offset, offset + length).arrayBuffer()` with length ≤65,536 and verifies exact returned size. It never calls whole-file `arrayBuffer()` or concatenates input. Each update completes before the next read; every 16 chunks it yields a task for cancellation. Concurrent calls on one instance reject.

Cancellation races pending reads and immediately releases native ownership. Late completion or cleanup from an older canceled request cannot write into or release a later request. File reads already started by browser APIs cannot themselves be forcibly canceled; their eventual results are discarded. Read/update/finish errors clean up the current owner without echoing input content. Dispose an unused in-flight operation with its AbortSignal rather than abandoning it.

For a backpatched CASC archive, hash the completed, closed staging snapshot, not an unfinished stream. Content hashes are integrity evidence only, not proof of source authenticity or permission. The existing extraction worker is deliberately untouched: it is one-shot, and its current whole-input hash closes parser state.

## Checks and build

Use an already available exact checkout, for example:

    node web/toolchain/sha256-stream-wasm/native-test.mjs --source /tmp/hactool-source-probe
    node --test web/toolchain/sha256-stream-wasm/adapter.test.mjs

The native runner uses the installed `cc` (or `CC`) and Python standard library, creates an isolated temporary shared library and removes it afterward. It verifies three known-answer vectors, 39 padding/chunk-partition cases against hashlib, ownership, length rejection and wiping. Mock ABI JavaScript checks separately cover bounded reads, exact counts, reuse, pending-read cancellation, stale completion and failures; they are not WASM execution evidence.

When the existing compiler environment is available:

    node web/toolchain/sha256-stream-wasm/build.mjs --source /explicit/pinned/hactool-checkout
    node web/toolchain/sha256-stream-wasm/wasm-smoke.mjs

No compiler is installed by these commands. The standalone WASM smoke check verifies the build receipt and small-file digests against Node crypto. The source checkout can later be passed directly from the existing extraction build's `$SRC`; no new source fetch or CI job is needed, and no integration is included here.

Current local evidence: native checks and five JavaScript lifecycle/module tests passed. No local emcc exists, so WASM compile/link/import/memory/size gates and browser execution remain pending. No multi-GB test was run: **greater-than-4-GiB byte-counter carry verification is explicitly pending**. Do not enable whole-pack production hashing until real WASM and carry tests pass. Upstream crypto is unchanged; missing evidence is not bypassed by reducing its algorithm or claiming a smaller test covers the carry boundary.
