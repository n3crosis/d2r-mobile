# NSP extraction feasibility boundary

Status (2026-10-20): **implemented metadata-first WASM boundary; CI validation pending, not a working NSP-to-IPA extractor**. The first native crypto/container tests passed. A subsequent implementation batch adds the actual pinned upstream build, C entrypoints, browser Worker adapter and synthetic Chromium CI below. No user key or game package was accessed. Full WASM/browser execution is intentionally assigned to GitHub CI, not claimed from native syntax checks. Build WASM ahead of time and serve it as a static application asset; no end-user SDK is required.

## Implemented batch and public interface

- `build-wasm.sh`: obtains exact hactool commit, applies `prepare-source.py`, builds bundled mbedTLS and a modularized 256 MiB-maximum WASM module. No CLI `main` is linked. Distribution includes source-embedded notices and checksums.
- `prepare-source.py`: fail-closed, exact-source transformations for static parser-line wiping, title-key realloc wiping, title-key stack temporary wiping and the critical wasm32 `fseek` to `fseeko` correction. `quiet.h` removes upstream formatted diagnostic calls at compile time before their arguments are formatted.
- `boundary.c`: explicit `/secret/prod.keys` and `/secret/title.keys` only; no HOME/XDG search. Exposes header inspection, raw PFS0 fixture reading, and authenticated Meta-NCA PFS0 access. Meta access requires a valid fixed header signature, section-header hash and complete bounded PFS0 hash hierarchy. This code path is implemented but **not independently validated on NCA fixtures or game content**.
- `browser-boundary.mjs`: `createBoundary(factory)` must execute in a fresh dedicated Worker. `mount(blobs)` creates read-only WORKERFS views, `loadKeys(prodBytes,titleBytes)` takes mutable arrays and wipes them plus memory-only files, `inspect(index)` returns public header fields with signature validity, `open(index,"meta")` opens verified metadata, `entry(index)` describes one member, `read(index,bigintOffset,count)` returns at most 64 KiB, and `streamEntry(index,sink,signal)` applies awaited backpressure. `dispose()` wipes native state and linear memory; terminate the Worker afterward. No complete output file is accumulated in MEMFS or a Blob. Use sliced NCA Blobs from the production NSP input catalog, not this spike's JS PFS0 parser.
- `nsp-extraction-checks.yml`: pinned official Emscripten 4.0.20 plus exact SDK tag commit, synthetic JS tests, Chromium Worker smoke and public-binary-only artifact. CI is the acceptance authority; adding a workflow does not mean it passed.
- `smoke-worker.mjs`: synthetic crypto, explicit mutable key staging/cleanup, real Blob/WORKERFS PFS0 reading, 64 KiB output backpressure, cancellation, path rejection and a sparse synthetic FS node exercising actual WASM seeks beyond 4 GiB. The sparse test is not a 5 GiB real-Blob/platform performance test. No package or real key fixture is used.

The supported Meta path currently caps its entire PFS0 and hash metadata at 16 MiB, accepts only one PFS0 section using CTR or plaintext, and rejects unsupported structures. It deliberately does not call the unrestricted upstream `nca_process` parser or enable Program/BKTR extraction. Raw PFS0 mode is named `synthetic-pfs0`; its member reads are bounded but it is not the production multi-NSP catalog validator. Production integration still needs independent whole-NCA SHA256 verification for `content-selection.mjs` inventory records. A valid header alone is insufficient.

No request handler, OPFS output sink, production UI wiring, full resource extraction, or IPA generation is represented as complete. The bounded pull interface allows the downstream browser file bridge to supply a local sink without native output-directory writes. The synthetic smoke disables fetch after code loading and rejects console/external traffic; a production isolated Worker/CSP and broader canary persistence audit remain required. On a WASM abort, terminate the Worker rather than attempting reuse.

The findings below describe the initial feasibility inspection and outstanding full-extraction design.

## Reproducible observations

Official upstream: https://github.com/SciresM/hactool
Pinned inspected commit: `1d64a83450e025622f3468c28fc4164dad2c5ef6`.

A shallow official-source checkout at `/tmp/hactool-source-probe`, followed by copying `config.mk.template` to `config.mk` and `make -j2`, built successfully with the installed GCC. Build log is temporary `/tmp/hactool-probe-build.log`. No SDK was downloaded.

Run this spike's JS tests:

```
node --test web/toolchain/nsp-extract-spike/container-boundary.test.mjs
```

Three tests passed: sparse synthetic metadata with an NCA entry beyond 4 GiB; bounded Blob adapter; invalid names/truncated files/oversized metadata rejection. This parser reads **only the unencrypted PFS0 outer directory**, not the NCA header or contents. It intentionally does not infer base/update/DLC from filenames.

Run the public synthetic crypto fixture against a built upstream checkout:

```
cc -O2 -I/tmp/hactool-source-probe -I/tmp/hactool-source-probe/mbedtls/include \
  web/toolchain/nsp-extract-spike/crypto-fixture.c /tmp/hactool-source-probe/aes.c \
  -L/tmp/hactool-source-probe/mbedtls/library -lmbedcrypto -o /tmp/hactool-synthetic-crypto
/tmp/hactool-synthetic-crypto
```

Result: PASS, AES-128-CTR NIST known answer and a two-sector XTS roundtrip. The XTS check is not an independent known-answer validation; neither test validates a real NCA/BKTR stream. NIST source: https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38a.pdf (Appendix F.5.1).

## Source map and actual extraction work

All upstream file references below are relative to the pinned official repository, not third-party forks.

- `pfs0.h`, `pfs0.c`: outer package entry directory. Browser code can create `File.slice(offset, end)` views for individual NCAs and avoid writing an intermediate 9 GB unpacked NCA directory.
- `nca.c:nca_decrypt_header` (line 585): NCA header, XTS. `nca_decrypt_key_area` (683): section key handling. `aes.c` and bundled mbedTLS provide the implementation rather than a hand-written substitute.
- `nca.c:nca_section_fseek` (39), `nca_section_fread` (133): section-relative random access, CTR, XTS, and base/patch relocation routing. `nca_bktr_section_physical_fread` (77) handles patch subsection counter behavior.
- `bktr.c`, `bktr.h`, `nca.c:nca_process_bktr_section` (1147): relocation and subsection tables; `nca_save_bktr_section` (1796): patched RomFS output. Replacing this with copying update files over base files is incorrect.
- `nca.c:nca_process_pfs0_section` (988), `nca_save_pfs0_section` (1484): program ExeFS. `nca_visit_romfs_file` (1540), `nca_visit_romfs_dir` (1631): output traversal.
- `pki.c`, `extkeys.c`, `settings.h`: key derivation, key formats, rights-ID lookup. `main.c` loads title keys through `open_key_file("title")`; `utils.c:open_key_file` (262) searches HOME/.switch and XDG config, not the folder containing an explicit prod.keys argument.

The existing `dm/tools/extract_game.sh` is a useful extraction oracle, not a complete multi-package orchestrator: it takes one NSP/XCI, ignores CNMT, chooses the last matching Program NCA, tests for BKTR, then uses `--basenca` with ExeFS/RomFS directories. It finally verifies exact executable hashes for 3.3.94012 and the presence of `data/build_manifest.psv`. Keep these final gates; do not silently choose a newer incompatible update. Its key path behavior does not satisfy the requested sibling prod.keys + title.keys contract on a clean machine.

## Multi-package selection contract still to implement

1. The user places all their NSPs, prod.keys, and title.keys in one local folder. Pick that directory in local Chromium on Windows or macOS. Do not upload these files to Sites, the assistant, a build service, or analytics.
2. Require exactly one unambiguous prod.keys and title.keys in the selected folder. Index every NSP with bounded reads. Deduplicate identical content IDs only after verifying the referenced content identity/hash, not merely filename equality; conflicting candidates fail closed.
3. Decrypt each Meta NCA, parse its CNMT, and build a catalog of application ID, content-meta type, version, declared content IDs/types/sizes/hashes, and base/application association. Primary structural reference (not copied into this spike): https://github.com/Atmosphere-NX/Atmosphere/blob/master/libraries/libstratosphere/include/stratosphere/ncm/ncm_content_meta.hpp . It distinguishes application, patch, and add-on metadata and their extended headers. Any code reuse from Atmosphere requires a separate license review; the recommended extraction core here is hactool.
4. Resolve the requested game application `0100726014352000`, its full base Program NCA, and a compatible patch Program NCA. Do not treat DeltaFragment contents as a standalone full patch. Missing base content, incompatible patch, missing rights key, unsupported NCA generation, or conflicting versions must stop with a safe error.
5. Select by authenticated/validated content metadata, then enforce the project's exact executable hash gate. A CNMT numeric version is not automatically a human display version; the supported mapping is not established in this spike. When multiple patches exist, inspect candidate program metadata/ExeFS hashes with bounded output and select only the exact supported target, not blindly the maximum version.
6. Classify DLC explicitly and report whether each is used, irrelevant, or unsupported. Do not silently merge DLC Data NCAs into the Program RomFS; the runtime's DLC resource contract must first be specified. The current native script does not establish that contract.
7. Mount the selected base and patch NCA views, run the upstream BKTR reader against both, extract patched ExeFS and merged RomFS, verify integrity and required output hashes, then pass resources to the separate translation/packaging pipeline. Extraction itself cannot produce an IPA.

## Browser I/O and WASM boundary

Recommended first port: Emscripten **dedicated Worker**, single-threaded, explicit selected inputs only. A Worker isolates blocking extraction from UI. Standard WebCrypto includes AES-CTR but does not expose AES-XTS, so keep the upstream C crypto implementation; do not substitute CTR for header decryption.

- WORKERFS supplies read-only File/Blob access without copying the entire file into the WASM heap. Mount sliced NCA Blobs rather than extracting each outer-container payload. Primary references: https://emscripten.org/docs/api_reference/Filesystem-API.html#workerfs and https://github.com/emscripten-core/emscripten/blob/main/src/lib/libworkerfs.js .
- Preserve uint64 offsets in C and BigInt in JS. Only convert into Blob offsets after safe-integer and file-bounds checks. Test >2 GiB and >4 GiB actual seek behavior in the built WASM module; the JS fixture is not a substitute. WASM32 linear memory cannot hold a multi-gigabyte package/output wholesale.
- Upstream uses synchronous stdio. Output therefore needs a tested custom filesystem/stdio bridge: OPFS SyncAccessHandle in a Worker supports bounded synchronous writes, but is origin-private temporary storage, not the user-selected output file. Primary reference: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle . A streamed final copy can deliver the IPA to an authorized File System Access output handle; alternately implement asynchronous output suspension with Asyncify. Do not accumulate the complete IPA in a Blob or MEMFS.
- OPFS requires free origin quota, explicit error handling, cancellation cleanup, and a deliberate local-data retention policy. Preflight storage estimate, detect quota failures during writes, and remove temporary game resources after completion/cancel. Keys must never use OPFS, IndexedDB, localStorage, service-worker cache, or download artifacts.
- Treat filenames and archive metadata as untrusted: bounded allocations, checked table extents, traversal rejection, overlap/overflow rejection, verification failures, and deterministic cleanup. Upstream CLI error paths call exit and were not written as a reusable sandboxed library.

The implemented but **CI-unverified** build uses emmake with CC=emcc and AR=emar for both parent and bundled mbedTLS, then modularized Worker output, filesystem support and WORKERFS. Native Makefile flags cannot merely be relabeled a browser-ready artifact. Explicit I/O bridge, safe key ingress, error/result API, memory cleanup, and actual browser integration tests are still required. No CI-verified browser extraction artifact has been established yet. The official LibHac URL https://github.com/Thealexbarney/LibHac returned 404 during research; do not rely on unverified mirrors or claim hactoolnet is an available browser artifact.

## Key lifetime and logging requirements

Use a fresh Worker/module per conversion. Read key files as mutable byte buffers, never File.text()/TextDecoder into long-lived JS strings or CLI `--titlekey` arguments. Transfer ArrayBuffers to the Worker (detaching sender ownership), parse into bounded mutable buffers, and wipe raw input promptly after parsing. Explicitly wire both selected files into the parser, bypassing ambient HOME/XDG lookup. A temporary memory-only file wrapper may ease initial integration but must be wiped and unlinked; it must never be synchronized to persistent storage.

Patch parser diagnostics before any real user input is accepted. `extkeys.c` contains warning paths that print raw key/value strings, and upstream options alone are not a comprehensive confidentiality boundary. Suppress all raw stdout/stderr at the bridge; return only typed error codes with public descriptions. Never report buffer contents or dump a WASM memory image. Disable telemetry/error-report payloads and network operations in the extraction Worker after its static code loads.

Add explicit compiler-resistant zeroization for parser line buffers, temporary key bytes, keysets, known title-key arrays and cryptographic contexts before free on success/failure/cancel. Audit realloc and stack temporaries. On cleanup, destroy the fresh module and terminate Worker. JavaScript/browser garbage collection and process memory cannot guarantee forensic erasure; promise no intentional uploads/logging/persistence, not impossible memory secrecy. Run a canary-key test that asserts no bytes reach network, console, storage, crash messages, or final artifacts.

## Licensing / release gate

hactool root LICENSE is ISC. Its bundled mbedTLS LICENSE points to Apache-2.0; keep that notice and license. A whole-CLI build additionally carries embedded notices including LZ4 BSD-2-Clause, cJSON MIT, and ConvertUTF Unicode terms. Inventory each linked source and ship its notices before distribution; a root ISC badge is not the entire dependency license inventory. No Nintendo keys, firmware, packages, executable code, or extracted game resources may enter the shipped static assets or fixtures.

## Blocking acceptance gates

- Reproducible pinned WASM build and browser instantiation; native crypto success is only an early feasibility signal.
- Synthetic NCA header/section and BKTR overlay fixtures exercising base/patch boundary crossing, CTR subsection changes, integrity failure and cancellation. No guessed production layout.
- Multi-NSP CNMT catalog and exact supported version selection with conflict/missing-DLC behavior.
- Chromium Windows/macOS >4 GiB random access and bounded streaming output, permission-denial/quota handling, and cancellation cleanup.
- Canary secret lifecycle/no-network/no-persistence audit.
- An authorized local end-to-end user test of their own files, without us receiving or uploading them. The output must match the native oracle hashes before the browser route is called working.
