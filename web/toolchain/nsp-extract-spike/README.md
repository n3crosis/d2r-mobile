# NSP extraction runtime

The browser extraction worker uses pinned hactool source at `1d64a83450e025622f3468c28fc4164dad2c5ef6`, compiled with Emscripten 4.0.20. Build static assets with `bash web/toolchain/nsp-extract-spike/build-wasm.sh`; end users do not install an SDK. See [production flow](../../PRODUCTION_FLOW.md) for orchestration and [local tests](../../TESTING.md) for optional extraction checks.

## Non-BKTR ExeFS boundary

The API provides `open(index,"program-exefs")` / `nsp_open_exefs` for a signed Program NCA with exactly one supported PFS0 ExeFS section. It verifies the fixed retail RSA-PSS signature, every present section-header hash, section extents/non-overlap, and the selected PFS0 hash hierarchy before exposing entries. It requires `main` with NSO0 magic and `main.npdm` with META magic. These markers identify ExeFS; they do not establish game-version compatibility, full NSO/NPDM validity, runtime permissions, or a bootable program.

Unknown crypto, ambiguous PFS0 selection, unsupported selected-section encryption, or malformed directories are rejected. The patch reader permits an unselected BKTR RomFS section alongside independently verified ExeFS. **RomFS contents are not extracted or authenticated by the ExeFS-only operation.** A standard unused RomFS section may coexist, but only its signed header/hash/range is checked. The separate legacy patch operation is described below; there is no signature bypass for synthetic tests.

`hashInput(index)` returns an independently computed SHA256 hex digest of the entire selected raw Blob, supporting content inventory checks. It closes the current member directory, which must be reopened afterward. `hashEntry(index)` returns SHA256 of one open decrypted member for the existing exact `main`/`sdk`/`subsdk0` version gate. Both use the same bounded 64 KiB incremental hashing helper as section verification. The Program PFS0 payload is not limited to 16 MiB or copied into memory; hash tables and directory metadata remain limited to 16 MiB. Verification is synchronous within the Worker, so cancellation during a long hash/verification requires terminating the disposable Worker rather than waiting for another message to execute.

PFS0 directory handling rejects duplicate names, overlapping nonempty members and failed-open state.

## Non-BKTR RomFS boundary

`openRomfs(index)` returns a frozen `{size: bigint, readAt(offset: bigint,count: number)}` reader only after fixed retail RSA-PSS signature verification, all present section-header hashes and ranges, and the selected section's complete six-level IVFC hierarchy verification. Offsets are relative to the final IVFC data level, and reads are limited to 64 KiB. This synchronous dedicated-Worker reader can be passed to `indexRomfs` in `web/romfs-tree.mjs`, which awaits reads and validates the separate directory/file tree. A reader expires on another mount, inspect, open, key load, full-input hash or disposal. Do not mutate the mounted files or expose the underlying WASM module to other callers.

Supported layout is legacy IVFC `0x20000`, seven levels including the signed root, a 32-byte master hash, six nonoverlapping data/hash extents and block exponents 5–24. Each level is checked against its already-verified parent; final partial blocks are zero-padded for SHA256 as in pinned hactool `nca_process_ivfc_section`/`nca_section_check_external_hash_table`. Hashing uses a 64 KiB scratch buffer, not a full RomFS copy. The root is authenticated through the signed NCA's section-header hash, not trusted from a caller. The final RomFS header must have the standard 80-byte header size; tree structure validation belongs to the JS reader. Full verification is synchronous and can be slow for large images; cancellation during it requires terminating the Worker.

All BKTR, sparse, compressed, newer metadata-hash/skip-layer-hash extensions, unsupported IVFC layouts, ambiguous sections, and selected XTS encryption are rejected. This is not patch/base merging. Only the selected RomFS hierarchy is verified; opening RomFS does not verify the separate ExeFS payload. Exact executable compatibility checks remain necessary; the browser skips full base/update NCA hashing.

Format evidence: pinned [hactool ivfc.h](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/ivfc.h) and [nca.c](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/nca.c). No additional upstream code or license dependency is introduced.

## Authenticated legacy BKTR boundary

`openPatchedRomfs(baseIndex,patchIndex)` now has a native implementation using simultaneous authenticated base/patch contexts, bounded relocation/subsection parsing, split CTR-Ex reads and mandatory patch-root IVFC verification over the merged virtual section. It returns the same bounded, generation-guarded final-RomFS reader. Modern/unknown variants remain rejected. See [BKTR_SCOPE.md](BKTR_SCOPE.md) for supported layouts and source mapping.

The browser uses fast content checks: it skips full base/update NCA hashing and the full RomFS integrity scan while retaining signed-header and package-structure checks. The small known Warlock add-on NCAs are always hashed and checked against their content IDs and CNMT data digest. Its Meta and PublicData headers may lack retail signatures; this exception never applies to executable base/update content and does not establish retail provenance. Full base/update hashing has no browser option or URL override. The strict API and its IVFC fixture remain available for independent callers.

## Extraction worker integration

`extraction-worker.mjs` and `extraction-engine.mjs` connect production NSP cataloging, NCA SHA256 measurement, CNMT parsing and internal base/patch selection to token-bound ExeFS and RomFS reads. Selection requires the exact known D2R base/update/Warlock package evidence through the expansion policy. The known Warlock add-on gets full NCA hashes and CNMT consistency checks even in fast mode; its Meta opener has a narrow unsigned-header exception. Unknown DLC and multi-program layouts reject. Known unlock-only DLC is not a Program RomFS overlay or an ownership claim. See [EXTRACTION_ENGINE_SCOPE.md](EXTRACTION_ENGINE_SCOPE.md) for the narrow protocol and streaming-lifetime requirements.

## Implemented batch and public interface

- `build-wasm.sh`: obtains exact hactool commit, applies `prepare-source.py`, builds bundled mbedTLS and a modularized 256 MiB-maximum WASM module. No CLI `main` is linked. Distribution includes source-embedded notices and checksums.
- `prepare-source.py`: fail-closed, exact-source transformations for static parser-line wiping, title-key realloc wiping, title-key stack temporary wiping, the critical wasm32 `fseek` to `fseeko` correction, early unsupported-header rejection, and initialized NCA2 section-header detection. `quiet.h` removes upstream formatted diagnostic calls at compile time before their arguments are formatted.
- `boundary.c`: explicit `/secret/prod.keys` and `/secret/title.keys` only; no HOME/XDG search. Exposes header inspection, raw PFS0 fixture reading, and Meta-NCA PFS0 access. Base/update Meta access requires a valid fixed header signature, section-header hash and complete bounded PFS0 hash hierarchy. The separate Warlock Meta entrypoint accepts the known title's unsigned header while retaining section and PFS0 hash checks.
- `browser-boundary.mjs`: `createBoundary(factory)` must execute in a fresh dedicated Worker. `mount(blobs)` creates read-only WORKERFS views, `loadKeys(prodBytes,titleBytes)` takes mutable arrays and wipes them plus memory-only files, `inspect(index)` returns public header fields with signature validity, `open(index,"meta")` opens verified metadata, `entry(index)` describes one member, `read(index,bigintOffset,count)` returns at most 64 KiB, and `streamEntry(index,sink,signal)` applies awaited backpressure. `dispose()` wipes native state and linear memory; terminate the Worker afterward. No complete output file is accumulated in MEMFS or a Blob. Use sliced NCA Blobs from the production NSP input catalog, not this spike's JS PFS0 parser.
- `smoke-worker.mjs`: synthetic crypto, explicit mutable key staging/cleanup, real Blob/WORKERFS PFS0 reading, 64 KiB output backpressure, cancellation, path rejection and a sparse synthetic FS node exercising actual WASM seeks beyond 4 GiB. The sparse test is not a 5 GiB real-Blob/platform performance test. No package or real key fixture is used.

The Meta API caps its PFS0 and hash metadata at 16 MiB and accepts one supported CTR or plaintext section. `synthetic-pfs0` is a test-only raw-container mode, not the production catalog validator. On a WASM abort, terminate the worker rather than reuse it.

## Key lifetime and logging requirements

Use a fresh Worker/module per conversion. Read key files as mutable byte buffers, never File.text()/TextDecoder into long-lived JS strings or CLI `--titlekey` arguments. Transfer ArrayBuffers to the Worker (detaching sender ownership), parse into bounded mutable buffers, and wipe raw input promptly after parsing. Explicitly wire both selected files into the parser, bypassing ambient HOME/XDG lookup. A temporary memory-only file wrapper may ease initial integration but must be wiped and unlinked; it must never be synchronized to persistent storage.

Patch parser diagnostics before any real user input is accepted. `extkeys.c` contains warning paths that print raw key/value strings, and upstream options alone are not a comprehensive confidentiality boundary. Suppress all raw stdout/stderr at the bridge; return only typed error codes with public descriptions. Never report buffer contents or dump a WASM memory image. Disable telemetry/error-report payloads and network operations in the extraction Worker after its static code loads.

Add explicit compiler-resistant zeroization for parser line buffers, temporary key bytes, keysets, known title-key arrays and cryptographic contexts before free on success/failure/cancel. Audit realloc and stack temporaries. On cleanup, destroy the fresh module and terminate Worker. JavaScript/browser garbage collection and process memory cannot guarantee forensic erasure; promise no intentional uploads/logging/persistence, not impossible memory secrecy. Run a canary-key test that asserts no bytes reach network, console, storage, crash messages, or final artifacts.

## Licensing / release gate

hactool root LICENSE is ISC. Its bundled mbedTLS LICENSE points to Apache-2.0; keep that notice and license. A whole-CLI build additionally carries embedded notices including LZ4 BSD-2-Clause, cJSON MIT, and ConvertUTF Unicode terms. Inventory each linked source and ship its notices before distribution; a root ISC badge is not the entire dependency license inventory. No Nintendo keys, firmware, packages, executable code, or extracted game resources may enter the shipped static assets or fixtures.
