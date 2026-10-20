# NSP extraction feasibility boundary

Status (2026-10-20): **WASM build and synthetic Chromium Worker smoke passed; not a working NSP-to-IPA extractor**. [GitHub run 39395178238](https://github.com/n3crosis/d2r-mobile/actions/runs/39395178238), commit `1db2b64b8a6d8512fb9492369bde823419ab40a3`, completed successfully. It validates the crypto fixture, explicit mutable key staging/cleanup, real Blob/WORKERFS synthetic PFS0, bounded output/backpressure, sparse synthetic >4 GiB WASM seeking, unsigned Meta-header rejection, and bounds/traversal/cancellation. No user key or game package was accessed. Valid signed NCA metadata extraction and Program/BKTR resource extraction remain unproven.

The initial run 39392846501 compiled successfully but failed browser smoke; explicitly exporting HEAPU8 fixed the Emscripten 4.0.20 bridge defect. The passing run's public WASM/notices artifact is [12250239771](https://github.com/n3crosis/d2r-mobile/actions/runs/39394113986/artifacts/12250239771), ZIP SHA256 `7ea5a9e883dd1c9ac8b25f2f2661e13d7f4b95ff6451b99cb0cb7b625f268ea7`, expiring 2026-10-27. Build WASM ahead of time and serve it as a static application asset; no end-user SDK is required.

## Non-BKTR ExeFS boundary

The green run above builds this extension and validates its synthetic/rejection smoke, not positive signed-NCA extraction. The source adds `open(index,"program-exefs")` / `nsp_open_exefs` for a signed Program NCA with exactly one supported PFS0 ExeFS section. It verifies the fixed retail RSA-PSS signature, every present section-header hash, section extents/non-overlap, and the selected PFS0 hash hierarchy before exposing entries. It requires `main` with NSO0 magic and `main.npdm` with META magic. These markers identify ExeFS; they do not establish game-version compatibility, full NSO/NPDM validity, runtime permissions, or a bootable program.

Any BKTR section, unknown crypto, ambiguous PFS0 selection, unsupported selected-section encryption, or malformed directory is rejected. **RomFS contents are not extracted or authenticated by the ExeFS-only operation.** A standard unused RomFS section may coexist, but only its signed header/hash/range is checked. There is no base/update patch merge and no signature bypass for synthetic tests.

`hashInput(index)` returns an independently computed SHA256 hex digest of the entire selected raw Blob, supporting content inventory checks. It closes the current member directory, which must be reopened afterward. `hashEntry(index)` returns SHA256 of one open decrypted member for the existing exact `main`/`sdk`/`subsdk0` version gate. Both use the same bounded 64 KiB incremental hashing helper as section verification. The Program PFS0 payload is not limited to 16 MiB or copied into memory; hash tables and directory metadata remain limited to 16 MiB. Verification is synchronous within the Worker, so cancellation during a long hash/verification requires terminating the disposable Worker rather than waiting for another message to execute.

PFS0 directory handling now rejects duplicate names and overlapping nonempty members with sorted bounded metadata, and clears failed-open state. Expanded synthetic Chromium smoke compares input/member digests against independent WebCrypto, rejects duplicate/overlapping containers and unsigned Program headers, and retains existing tests. It does not supply a valid signed NCA or prove positive Program extraction. The linked GitHub run passed this expanded smoke.

## Non-BKTR RomFS boundary

`openRomfs(index)` returns a frozen `{size: bigint, readAt(offset: bigint,count: number)}` reader only after fixed retail RSA-PSS signature verification, all present section-header hashes and ranges, and the selected section's complete six-level IVFC hierarchy verification. Offsets are relative to the final IVFC data level, and reads are limited to 64 KiB. This synchronous dedicated-Worker reader can be passed to `indexRomfs` in `web/romfs-tree.mjs`, which awaits reads and validates the separate directory/file tree. A reader expires on another mount, inspect, open, key load, full-input hash or disposal. Do not mutate the mounted files or expose the underlying WASM module to other callers.

Supported layout is legacy IVFC `0x20000`, seven levels including the signed root, a 32-byte master hash, six nonoverlapping data/hash extents and block exponents 5–24. Each level is checked against its already-verified parent; final partial blocks are zero-padded for SHA256 as in pinned hactool `nca_process_ivfc_section`/`nca_section_check_external_hash_table`. Hashing uses a 64 KiB scratch buffer, not a full RomFS copy. The root is authenticated through the signed NCA's section-header hash, not trusted from a caller. The final RomFS header must have the standard 80-byte header size; tree structure validation belongs to the JS reader. Full verification is synchronous and can be slow for large images; cancellation during it requires terminating the Worker.

All BKTR, sparse, compressed, newer metadata-hash/skip-layer-hash extensions, unsupported IVFC layouts, ambiguous sections, and selected XTS encryption are rejected. This is not patch/base merging. Only the selected RomFS hierarchy is verified; opening RomFS does not verify the separate ExeFS payload. Normal CNMT whole-NCA inventory hashing and exact executable compatibility checks remain necessary.

The new closed synthetic C fixture exercises the same IVFC verifier with six levels, independent fixed SHA256 root, partial-block padding, payload tampering, overlapping levels and oversized block exponents. It takes no caller-controlled root and cannot activate a production reader. Chromium smoke also requires unsigned Program RomFS rejection, preserving production signature policy. These tests passed [GitHub run 39396249923](https://github.com/n3crosis/d2r-mobile/actions/runs/39396249923), commit `582d586945db659a89094a0e8a4971196f330600`, including official WASM build and Chromium smoke. No valid signed NCA positive fixture or actual game extraction has been tested, and this does not establish end-to-end NSP-to-IPA support.

Format evidence: pinned [hactool ivfc.h](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/ivfc.h) and [nca.c](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/nca.c). No additional upstream code or license dependency is introduced.

## Implemented batch and public interface

- `build-wasm.sh`: obtains exact hactool commit, applies `prepare-source.py`, builds bundled mbedTLS and a modularized 256 MiB-maximum WASM module. No CLI `main` is linked. Distribution includes source-embedded notices and checksums.
- `prepare-source.py`: fail-closed, exact-source transformations for static parser-line wiping, title-key realloc wiping, title-key stack temporary wiping and the critical wasm32 `fseek` to `fseeko` correction. `quiet.h` removes upstream formatted diagnostic calls at compile time before their arguments are formatted.
- `boundary.c`: explicit `/secret/prod.keys` and `/secret/title.keys` only; no HOME/XDG search. Exposes header inspection, raw PFS0 fixture reading, and authenticated Meta-NCA PFS0 access. Meta access requires a valid fixed header signature, section-header hash and complete bounded PFS0 hash hierarchy. This code path is implemented but **not independently validated on NCA fixtures or game content**.
- `browser-boundary.mjs`: `createBoundary(factory)` must execute in a fresh dedicated Worker. `mount(blobs)` creates read-only WORKERFS views, `loadKeys(prodBytes,titleBytes)` takes mutable arrays and wipes them plus memory-only files, `inspect(index)` returns public header fields with signature validity, `open(index,"meta")` opens verified metadata, `entry(index)` describes one member, `read(index,bigintOffset,count)` returns at most 64 KiB, and `streamEntry(index,sink,signal)` applies awaited backpressure. `dispose()` wipes native state and linear memory; terminate the Worker afterward. No complete output file is accumulated in MEMFS or a Blob. Use sliced NCA Blobs from the production NSP input catalog, not this spike's JS PFS0 parser.
- `nsp-extraction-checks.yml`: pinned official Emscripten 4.0.20 plus exact SDK tag commit, synthetic JS tests, Chromium Worker smoke and public-binary-only artifact, retained for failure diagnosis without a verified label. Artifact presence alone is not a passing smoke result. CI is the acceptance authority; adding a workflow does not mean it passed.
- `smoke-worker.mjs`: synthetic crypto, explicit mutable key staging/cleanup, real Blob/WORKERFS PFS0 reading, 64 KiB output backpressure, cancellation, path rejection and a sparse synthetic FS node exercising actual WASM seeks beyond 4 GiB. The sparse test is not a 5 GiB real-Blob/platform performance test. No package or real key fixture is used.

The supported Meta path currently caps its entire PFS0 and hash metadata at 16 MiB, accepts only one PFS0 section using CTR or plaintext, and rejects unsupported structures. It deliberately does not call the unrestricted upstream `nca_process` parser. Program ExeFS and the pending non-BKTR RomFS boundary are described above; BKTR extraction remains disabled. Raw PFS0 mode is named `synthetic-pfs0`; its member reads are bounded but it is not the production multi-NSP catalog validator. Production integration must use the new independently computed full-input digest (or an equivalent independent verifier) against CNMT whole-NCA hashes for `content-selection.mjs` inventory records. A valid header alone is insufficient.

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

The synthetic-CI-verified build uses emmake with CC=emcc and AR=emar for both parent and bundled mbedTLS, then modularized Worker output, filesystem support and WORKERFS. Native Makefile flags cannot merely be relabeled a browser-ready artifact. Explicit I/O bridge, safe key ingress, error/result API, memory cleanup, and actual browser integration tests are still required. A synthetic-smoke-verified browser boundary artifact is linked above; it is not a verified full extraction pipeline. The official LibHac URL https://github.com/Thealexbarney/LibHac returned 404 during research; do not rely on unverified mirrors or claim hactoolnet is an available browser artifact.

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
