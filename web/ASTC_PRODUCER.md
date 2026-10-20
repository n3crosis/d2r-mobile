# Initialized ASTC producer lifecycle

[简体中文](ASTC_PRODUCER.zh-CN.md)

The parent client and dedicated worker join the bounded record RPC, verified streaming decoder, one-at-a-time texture/descriptor jobs, CASC pack writer, and fixed codecs. This is internal infrastructure; these modules do not enable UI, download assets, or authenticate arbitrary caller metadata.

## Setup and API

The sealed loader calls `await createAstcProducerClient({worker,assets,signal})` only with verified worker code and four verified public byte entries: `astc-encoder.mjs`, `astc-encoder.wasm`, `png-codec.wasm`, `sha256.wasm`. All four exact ArrayBuffers transfer before the helper resolves `{initialized:true,produce,close}`. Actual ASTC, PNG and SHA initialization must succeed first. Optional inventory selection belongs to the loader: default setup must not download this optional closure.

The worker imports only fixed bundled implementation modules. The ASTC factory is imported from a verified-byte Blob; `wasmBinary` and an explicit byte-instantiation hook supply the module. `locateFile` accepts only the exact ASTC WASM filename and resolves its verified Blob. Temporary URLs are revoked after startup. Worker fetch/XHR are blocked before initialization and remain blocked. This is not a sandbox against malicious same-origin code.

`produce(extracted,selection,{root,maxEncodedBytes,maxDecodedBytes,maxPackBytes,batchBlocks=65536,signal,inactivityTimeoutMs=300000,overallTimeoutMs,onProgress})` is one-shot. Encoded/decoded budgets are positive safe integers up to uint32; pack budget is positive up to 2^40; batches are 1–65,536 blocks. No caller-supplied rows, filenames, CKeys, EKeys, TVFS or pack location replace authenticated inputs.

The parent itself enumerates first-match authenticated records, opens the original WeakMap tokens, reads/copies bounded authenticated TVFS, and reserves the pack location after reserving the default overlay location. Each RPC source additionally checks `[record.offset,record.offset+encodedSize]` while retaining absolute BigInt offsets and archive size. Worker metadata and random descriptors come only from this trusted parent. CFT lookup, staging, transforms, compression and final SHA run in the worker.

## Progress and deadlines

Initialization has a 60-second deadline. Production uses a five-minute default inactivity deadline, configurable up to two hours, rather than an implicit total elapsed-time cutoff. Only validated, strictly advancing work counters renew it: completed ASTC batches, successful stage writes/backpatches, and successful SHA updates. There are no timer-only heartbeats. A single synchronous ASTC batch cannot report midway, so choose an inactivity budget appropriate to the device/batch size. An overall deadline exists only when explicitly supplied as `overallTimeoutMs` (at most 2,147,483,647 ms).

Optional `onProgress` receives frozen `{phase,processedBytes,completedBlocks,completedRecords?}`; phases are `preparing`, `converting`, and `complete`. Converting notifications are capped at ten per second; observer throws/rejections are ignored. Byte counts describe completed staging/backpatch/hash work, not a percentage of original data. Block counts include padded grid blocks actually encoded. No paths or keys are reported. The SHA adapter's optional `hashFile(file,{signal,onProgress})` reports `{bytesHashed,totalBytes}` only after successful hash updates and also isolates observer failures.

## Finalized output and ownership

Success returns `{source,pack,records,index,count,dispose}`. `source` contains the structured-cloned finalized File, exact size, and cancellable `readAt(number,count,{signal})` capped at 64 KiB. File slices have a 30-second read deadline. The whole pack is never converted to an ArrayBuffer for transport. Parent validation checks File size, reserved archive name, digest shape, bounded unique selected records, contiguous offsets, matching locator bytes, exact count, and the writer's complete index including `# pack` header. The digest is computed by the initialized fixed worker; validation alone does not authenticate external File/hash objects.

The parent creates and retains a dedicated job-directory lease before the worker gets its handle. Successful workers are terminated and record RPC is closed, but the lease remains until output export completes. Call `result.dispose()` or `client.close()`; both converge on the same retryable lease cleanup. Aborts/failures stop worker/RPC before cleanup. Pending/failed cleanup errors retain `error.lease` and internal `cleanupCause`; callers must retain/retry the lease and not expose internal diagnostic causes. Directory deletion errors are not silently treated as success. Native filesystem writes may outlive termination, so deletion/lock failures remain observable rather than claiming worker termination proves storage quiescence.

## Evidence and limits

Synthetic tests exercise authenticated extraction fixtures through source-bound RPC, output File ownership, malformed initialization, cancellation, progress renewal/stall/explicit deadlines, cleanup retry, and real pack-writer receipt compatibility. Worker/codec and directory doubles are explicitly synthetic. Existing actual WASM smoke remains separate. Browser worker Blob loading, real OPFS behavior under termination, full optional-runtime startup and device memory/performance still require browser validation. No game inputs are used, and this is not a claim of full native transcode parity.

Worker failures expose only validated `detailCode` values: `STORAGE_QUOTA`, `SIZE_LIMIT`, `INTEGRITY_FAILED`, or fallback `CODEC_FAILED`. Original error strings, filenames and keys never cross the worker error boundary. Internal cleanup diagnostics remain lease-owned, not user-facing.
