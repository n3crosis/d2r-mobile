# Bounded streaming SHA-256 primitive

中文: [README.zh-CN.md](README.zh-CN.md)

This primitive hashes staged local File/Blob bytes without buffering the whole file. It reuses pinned hactool/mbedTLS source in the optional `legacy-astc` worker. The browser UI preloads verified bytes and starts the worker on demand; direct API callers select the optional group explicitly. See [optional runtime assets](../../runtime-build/OPTIONAL_ASSETS.md) and [producer lifecycle](../../ASTC_PRODUCER.md).

## Source and boundary

`source-pin.json` independently pins the exact existing hactool commit, mbedTLS 2.6.1 SHA-256 implementation/header, Apache license files and minimal configuration. The explicit source checkout must match both commit and per-file byte length/SHA-256. No download, install or cache-directory discovery occurs. The unmodified upstream source is compiled with the uniquely named `sha256_config.h`, defining only `MBEDTLS_SHA256_C`; upstream default configuration, TLS, generic digest dispatch, alternate implementations and self-test I/O are excluded.

`bridge.c` keeps one SHA-256 context, one 64 KiB input buffer and a 32-byte result. The only lifecycle is begin → zero or more bounded updates → finish, or abort. Begin fails while busy. Every operation requires the current nonzero generation token; tokens never wrap or repeat. Stale owners cannot clear a newer hash. An excessive update length invalidates only its valid owner. Successful updates wipe input; finish/abort clear the upstream context and input. Abort also wipes the result; a finished result remains available for the adapter to copy and is cleared at the next begin. No parser state, key APIs, allocation or filesystem is used.

The standalone WASM recipe uses existing emsdk 4.0.20, fixed 256 KiB linear memory, 16 KiB stack, no memory growth and zero host imports. Those are build gates, not browser-validation evidence. Artifact size must be measured, not estimated. `dist/build-report.json` records exact compiler text, source pins, local source hashes, normalized arguments, raw/gzip byte sizes and artifact SHA-256. Licenses accompany the artifact. Its existing codec-local `productionEnabled: false` is legacy standalone-build metadata, not optional inventory selection status. It neither disables the integrated optional path nor certifies it for production use; the separate outer runtime release gate is unchanged.

## JavaScript API

`await createSha256FileHasher(wasmBytesOrModule)` returns `{ hashFile }`. The caller's release loader must authenticate WASM provenance and its expected digest; the factory itself checks import closure, memory size and rejection of memory growth before private reads. `createSha256FileHasherFromAbi` is an explicit low-level mock/testing seam, not provenance verification.

`await hashFile(file, { signal?, onProgress? })` returns frozen `{ sha256, bytesHashed }` and immediately wipes the native result buffer after copying the digest. Only File/Blob inputs with safe integer sizes are accepted. The adapter reads each immutable slice through `file.slice(offset, offset + length).arrayBuffer()` with length ≤65,536 and verifies exact returned size. It never calls whole-file `arrayBuffer()` or concatenates input. Each update completes before the next read; every 16 chunks it yields a task for cancellation. Concurrent calls on one instance reject. Optional `onProgress` receives frozen `{ bytesHashed, totalBytes }` only after a successful bounded hash update. It reports completed work, not timer heartbeats; observer throws and rejected promises do not affect hashing or ownership.

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

No compiler is installed by these commands. The standalone WASM smoke check verifies the build receipt and small-file digests against Node crypto. The existing extraction build now passes its pinned `$SRC` directly to this build and smoke check, without a separate source fetch or CI job. Runtime assembly validates the receipt and local source hashes before including the WASM, licenses and report in the optional group. Selected setup verifies and initializes those public bytes before private input; the worker does not fetch codecs later.

**Greater-than-4-GiB byte-counter carry verification remains pending.** Native and WASM smoke reports leave `greaterThan4GiBCarryVerified` false; small-file tests do not cover that boundary. Keep this limitation explicit when validating whole-pack hashing.
