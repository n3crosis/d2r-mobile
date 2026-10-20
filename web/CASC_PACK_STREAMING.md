# Bounded supplemental CASC pack primitive

中文: [CASC_PACK_STREAMING.zh-CN.md](CASC_PACK_STREAMING.zh-CN.md)

`casc-pack-writer.mjs` is an isolated internal primitive. It is not connected to the browser UI, shell loader, asset conversion, export workflow, or installation. It implements the serialization rules in `dm/tools/casc_overlay.py` (`write_pack`, `blte_encode`, `ekey_for`) and the `{name,size,sha256}` metadata shape from `dm/tools/astc_pack.py finalize`. No game files or keys are included or accessed.

## Contract

`writeCascPack({jobs, location, locationAvailable, root, maxPackBytes, expectedEntries, codec, hashFile, signal?})` consumes an async iterable of jobs serially. Each job is `{path,spec,decodedSize,source}`:

- `path` is an existing normalized lowercase logical path, not a `+` addition. Leading `#` is rejected because native `read_prebuilt` treats that TSV row as a comment. Duplicate paths, malformed paths, and paths longer than 4096 UTF-8 bytes are rejected. A cheap 4096-code-unit guard runs before allocating normalization/validation intermediates. The writer does not resolve or authenticate paths. Use `inspectCascPackStorageSpecs` with the original bounded TVFS first, and carry forward its `spec`; `decodedSize` is the replacement's size, not the original record size.
- `spec` is exactly `n`, `z`, or `b:256K*=z`. The original specification is preserved, not silently converted.
- `source` is an async iterable of ordinary non-resizable `Uint8Array` chunks with entire backing buffers at most 1 MiB. Producers must not mutate a yielded buffer until consumption advances. Oversized backing buffers are rejected even for tiny views. Input consumption must exactly match the unsigned 32-bit `decodedSize`.
- `location` is `[chunk,archive]`, each an integer from 0 to 255, matching the native 8/8/40 EKey layout. `locationAvailable(name,{signal})` must return exactly `true` only after checking both original archives and planned outputs for collisions. This trusted host callback is not an atomic reservation or authentication boundary. It must use actual source inventory, not an unverified user assertion.
- `maxPackBytes` is an explicit safe integer at most `2**40`; each record offset must be below `2**40`. Encoded and decoded record sizes remain unsigned 32-bit. `expectedEntries` must exactly match actual jobs, at most 32,768; combined path bytes are capped at 8 MiB. The existing overlay caps are unchanged.
- `codec` must be the trusted source-pinned codec with `genericZlibVersion === "1.2.13"` and `compressZlibStream`. The version property is a contract check, not proof of provenance. Compression uses level 9, bounded input/output budgets, and one active codec stream at a time.
- `root` is the caller-provided OPFS root. The default `createRawFileStage` creates and owns only its unique temporary child. There is no memory fallback, source-directory write, or network operation. The optional `createStage` argument exists for dependency injection and tests; injected implementations must uphold the same bounded ownership contract.
- `hashFile(file,{signal,chunkBytes})` is an explicit trusted host dependency. It must incrementally SHA-256 the finalized File with reads no larger than `chunkBytes` (1 MiB), honor cancellation, and return `{sha256,bytesHashed}`. The writer checks a lowercase 64-character digest and the exact byte count before returning. It cannot prove that an injected callback actually read or hashed bytes. The generated hash describes this output only; it does not authenticate externally supplied content. No new cryptographic implementation is provided here.

## Output and memory

The result is `{source,index,records,pack,dispose}`. `source` is the finalized replayable raw-stage source (`file`, `size`, bounded `readAt`); `index` is native-compatible `pack_index.tsv` text, beginning `# pack\t<name>\n`; each frozen record is `{path,newEkey,encodedSize,decodedSize}`. `pack` is `{name,size,sha256}`. Combine records with the original `oldEkey` associations before calling `patchCascPrebuiltReferences`. This module does not patch TVFS, create an ASTC variant, or publish/install the archive. Call `dispose()` only after downstream consumers finish; it removes the owned temporary stage.

There is no whole-record or whole-pack concatenation. Raw/zlib streams are appended with serial backpressure. BLTE uses one 256 KiB decoded block, one bounded encoded chunk, and a reserved/backpatched header at most 393,228 bytes. The empty BLTE representation is the native single `N` block. EKeys use MD5 of the BLTE header or raw encoded bytes plus location. Native magic-based behavior is preserved even when an `n` record starts with `BLTE`, including a zero-length hash prefix. Index text and record/path collections are bounded metadata, not constant-memory structures; the final joined index temporarily coexists with its row strings. Input producer, codec, and hash callback memory are separate trusted responsibilities.

Job completion, source exhaustion, encoded sizes, stage snapshot size, and final hash count are checked before exposure. Cancellation races iterator advances, location checks, stage acquisition/operations, codec output, and final hashing, so a hung await does not indefinitely prevent rejection. It requests iterator closure and owned-stage disposal, preserving the primary failure as `cause` when cleanup also fails. Cleanup settlement is bounded to 1000 ms; if still pending, an `AggregateError` includes `CASC_PACK_CLEANUP_PENDING` and a `cleanup` Promise of all settlement results. This reports pending cleanup, not completed cancellation. Late-acquired stages retain a disposal handler even after rejection. A distinct late acquisition failure, including an acquisition cleanup failure, remains visible in the aggregate error or pending `cleanup` settlement results; only the identical primary failure is deduplicated. Raw-stage disposal still drains in-flight filesystem work before removal; the writer never deletes ahead of a pending write. External callbacks and sources must cooperate to actually release resources. Synchronously blocked JavaScript cannot be interrupted by this mechanism. Successful callers retain responsibility for awaiting `dispose()`; its raw-stage draining semantics are unchanged.

## Verification and limits

Run portable synthetic serializer tests:

```
node --test web/tests/casc-pack-writer.test.mjs
```

The default codec is explicitly a test double using the host Python zlib, with the expected version field mocked. The in-memory stage is also a test double. These tests establish native serializer/index/EKey agreement for the tested inputs, not pinned codec or browser memory proof.

When the existing native codec library has already been built, run the same tests through its real pinned streaming C ABI:

```
CASC_PACK_NATIVE_CODEC="$PWD/web/toolchain/png-codec-exact/dist/png_codec_native.so" node --test web/tests/casc-pack-writer.test.mjs
```

The optional bridge asserts the library reports zlib 1.2.13 and feeds `zlib_begin`/`zlib_push` in 64 KiB pieces. Both modes passed all sixteen tests during development. The pinned library's encoded bytes matched unmodified native `casc_overlay.py` using host Python zlib 1.3.2 for these synthetic fixtures only. Coverage includes n/z/multiblock BLTE/empty records, magic-based EKeys, exact index and SHA-256 metadata, collision preflight, count/budget checks, backing-buffer bounds, serial writes, abort cleanup, failures, and incomplete codec consumption. The bridge itself buffers small test fixtures and is not production code.

No actual browser, OPFS quota/device behavior, WASM integration for this writer, large-pack performance, game load, or end-to-end supplemental-pack installation was tested. Original CFT resolution, asset conversion, trusted streaming SHA-256, original-location inventory, export integration, and browser/device validation remain caller/integration work.
