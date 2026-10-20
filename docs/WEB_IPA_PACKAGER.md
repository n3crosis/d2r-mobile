# Local browser IPA packager: implementation and validation plan

## Outcome and boundaries

Build a guided website for desktop Chromium-based browsers on Windows and macOS. The user selects their own extracted Switch game folder and a compatible prebuilt application shell; the browser processes the files locally and saves an IPA for subsequent signing and installation. The user should not install Python, .NET, a C compiler, SPIRV-Cross, Xcode, or use a terminal.

This is **not** a browser port of the game. The resulting program still runs natively on a supported Apple device. WebGPU, a browser ARM64 game emulator, and replacement of the native Metal rendering backend are not prerequisites for this packaging task.

“Unsigned IPA” means no user's Apple/developer certificate, provisioning profile, or installation authorization is applied by the website. A linker-style **ad-hoc structural signature** on Guest.framework may be required for compatibility with later re-signers. Do not strip it merely to claim the file contains no signatures. Signing credentials, signing, installation, and device trust are outside this project.

No game files are required for the initial implementation. Synthetic tests can establish parsing, transformations, archive correctness and failure handling; they cannot establish that a real generated IPA launches or plays correctly. Never label an unfinished or synthetic package “ready to play.”

## Source baseline and scope changes

Initial inspection was against fork origin/main `7ff4e36710724867f8655ac979b49d6303e91937`. Upstream main was 20 commits ahead at `53e7c5bb9ca3ea53e2160005be8fbe920cd9cb53`. The user subsequently requested synchronizing the fork, so the intended implementation baseline is the synchronized `53e7c5b` revision, not an unreviewed mixture of those versions. Record the actual feature-branch base and source hash in build metadata. The feature branch is `feature/web-ipa-packager`. The fork main sync was subsequently verified at `53e7c5b`, and the feature worktree was advanced to that same base.

Two material differences matter:

- Old release input was named `D2RMobile-shell.ipa`; newer shell builds produce `D2RMobile-shell-build-input.zip`. This is deliberately non-installable build input, not the final IPA. Validate its contents rather than relying on the filename extension.
- New `dm/tools/guest_dylib.py` adds `adhoc_sig()` and `LC_CODE_SIGNATURE`. The old baseline did not. Browser output should match the chosen current reference, not accidentally reintroduce the older re-signing incompatibility.

AnyPS5 was examined only as an architectural reference for local conversion into a native output, not browser gameplay. The inspected reference revision is `e9cc4a8efb346205f909759dfff18e5501fe3f13`. Do not copy its GPL-2.0-only code into this MIT project. Implement independently and audit every distributed dependency separately.

## Existing pipeline: code-backed mapping

The principal reference is `dm/tools/d2rm_pack.py`, with release instructions in `docs/NO_XCODE.md`. Existing scripts are reference implementations, not browser-ready modules.

| Stage | Existing code and contract | Browser treatment |
|---|---|---|
| Shell validation | `read_shell()` requires exactly one Payload/*.app, `dm/shell_manifest.txt`, and `dm/shell_info.txt`; `main()` checks PRODUCT and CHAIN | Independent strict ZIP/manifest parser; pin supported shell hashes and matching recipe versions |
| Input discovery | `check_env()` requires ExeFS/main, ExeFS/sdk, RomFS/data/build_manifest.psv | Directory picker, required-file report, safe relative paths; no upload |
| Program rewrite | `patch_nso.py` reads NSO, LZ4-decompresses segments, rewrites ARM64 sites using Capstone, validates build-specific original bytes | Worker-based Python/WASM or isolated JS/WASM implementation; preserve exact instructions and validation |
| Archive extraction | `dmx.py`: `index`, `lookup`, `read_row`; `casc_overlay.py` reads archives by EKey offset | Local random-access File slices; bounded decode; never ingest all RomFS into a memory filesystem |
| UI and data | `ios/tools/gen_assets.py` invokes eight generation steps; `gen_vault_table.py`, `gen_hud_exp.py`, `shell_stubs.data()` generate runtime data | Port pure transforms; ship image/font/texture dependencies as browser-ready modules |
| Overlay | `gen_romfs_overlay.py` and `casc_overlay.py` | Deterministic archive/manifest writer over local storage; preserve format/checksums |
| Shader extraction | `d2rm_pack.py:get_packs()` enumerates shader resources via dmx; reference expects 162 packs | Incremental extraction, progress and bounded worker queue |
| Shader translation | `gfx/tools/dmsh_xlate` maps Maxwell machine code to SPIR-V; `dmsh_build.py` uses SPIRV-Cross and postprocessing | Most important feasibility spike; prebuilt browser-compatible translator and pinned SPIRV-Cross, no user toolchain |
| No-Metal packaging | `nometal_run.py` substitutes source bytes for Metal compilation output; shell recognizes source and compiles on device | Produce the same supported source format directly; do not emulate subprocess monkey-patching |
| Guest framework | `guest_dylib.py:build`, `write`, `segment`, `adhoc_sig` | Deterministic JS/DataView or portable Python implementation; no Apple linker required |
| Completion checks | `shaders_done()`, source digest, chain metadata, c1 list and shell manifest | Fail closed on any missing output or mismatch |
| IPA assembly | Python ZIP writer copies shell and inserts manifest outputs | Streaming ZIP export to a user-selected writable file, atomic completion semantics where available |

### Input and output are different sizes

`NO_XCODE.md` describes approximately 4 MB of shell input, approximately 130 MB of completed IPA, approximately 12 GB of native working/cache storage, and 18 resource `.data` archives totaling roughly 5 GB. These are upstream documented figures, not measurements of our browser implementation and not fixed limits.

The large resource archives do **not** belong inside the IPA. Packaging reads selected content from them. After signing/installing, the user separately copies the required resource archives to the app. The UI must explain this distinction before export and provide a resource-transfer checklist. Do not duplicate all source archives into browser storage just to follow the native script's directory layout.

Older A16-and-earlier devices additionally require an ASTC texture pack and matching overlay. The native pipeline accepts an already-prepared `D2RM_ASTC_PACK` with `pack_index.tsv` and `pack.json`; the pack payload remains separate from the IPA. First milestone should explicitly exclude generating that expensive pack. Offer an existing-pack import only after manifest/hash validation is implemented, and state supported device targets clearly. Full in-browser ASTC generation is a separate measured capability gate, not an implied feature.

## Browser architecture

### User experience

1. Explain local processing, output/signing separation, supported device/shell combinations, and estimated storage requirements.
2. Select the matching shell build input and extracted game directory. Do not require account login or upload.
3. Perform a read-only preflight: browser capabilities, file presence, ZIP structure, build identity, recipe compatibility, and available working storage.
4. Show a stage checklist with real counts, elapsed time, cancellation and recoverable failure messages. Do not report completion from a marker file alone.
5. Save the finished IPA only after all validators pass. Include a local report with tool versions, output hash, stage status and limitations. Keep game-derived content and personal filesystem paths out of telemetry.
6. Explain that the IPA still needs signing/installing and that resources must be copied separately.

### Modules

- Main UI: user gestures, directory/output pickers, status, cancellation, and capability errors.
- Coordinator worker: content-addressed job graph, cache validity, resource budget, stage transitions.
- Random-access input provider: `(file handle, offset, length)` reads with range checks and backpressure.
- Transformation workers: narrowly-scoped binary rewrite, archive extraction, image conversion, shader translation and framework generation.
- Temporary store: OPFS or explicitly selected working directory, with per-job namespace and cleanup. Persist only with disclosure and consent; source files remain read-only.
- Export writer: stream archive entries with deterministic order/metadata and incremental checksums. Never build the full output plus every intermediate as one Blob.

Use feature detection on both Windows and macOS Chromium. File System Access, OPFS, worker support, storage availability and potential WASM threading requirements need actual browser tests. Do not silently fall back to uploading data. If a required capability is unavailable, report the exact requirement or offer an explicitly bounded local fallback. Browser/version support must be backed by tests, not assumed from Chromium branding.

### Privacy and failure semantics

Host pinned, reviewed application assets and tool modules. Fetching these public assets is distinct from uploading game data. Once loaded, conversion must use local files only. Disable third-party analytics, remote error-reporting payloads containing filenames/bytes, and arbitrary dependency CDN URLs. Apply a restrictive CSP. Validate the actual request log during conversion, including failure/cancel paths; “local only” must be an observed property.

Reject absolute paths, traversal, duplicate/conflicting archive entries, symlink escapes, unexpected encryption, expansion bombs, nonsensical sizes and corrupt checksums. Treat the shell and all selected files as untrusted binary inputs. Enforce bounds before allocation or decompression.

On cancellation or disk-full conditions, do not leave a final-looking successful IPA. Keep resumable intermediate state separately with an explicit incomplete marker. Export reports must distinguish failed validation, canceled work and successful assembly. Never modify the source game directory.

## Dependency and portability gates

### Python is a migration option, not a magic compatibility layer

`d2rm_pack.py` uses subprocesses, mutable filesystem trees and imports native Python packages. A Python-in-WASM runtime cannot run the desktop script unchanged. Evaluate keeping pure Python transforms in a bundled runtime versus porting small binary utilities to JS/WASM. Prefer reusing semantic logic with differential tests over a wholesale rewrite without an oracle.

- LZ4 and Capstone require usable browser builds or replacements. Pin versions; identical disassembly assumptions matter to ARM64 patching.
- `check_env()` lists Unicorn, but `patch_nso.py` itself imports LZ4 and Capstone, not Unicorn. Repository uses Unicorn in verification scripts. Trace transitive generation calls before deciding whether production packaging actually requires it. Do not promise a Unicorn port merely because the environment check lists it.
- Pillow/NumPy and font layout need compatibility experiments. Native documentation already reports small platform-dependent HUD/text image differences. Browser Canvas is not automatically a byte-identical substitute. Ship/pin the needed font and rendering stack where licensing permits, and define exact versus pixel-tolerance acceptance per asset.
- `romfs_art.py:lib()` compiles `gfx/tex/nvn_deswizzle.c` and `gfx/nvn/nvn_tex.c` at runtime, then loads them with ctypes. Replace that operation with a prebuilt WASM export for layout/swizzle/deswizzle. No compiler runs on the user's desktop.
- Replace subprocess orchestration with direct function/module calls. Replace PID-lock assumptions with worker/job coordination.

### Shader translation: first high-risk experiment

`dmsh_xlate.csproj` targets `net10.0`, enables unsafe blocks, and references repository Ryujinx.Graphics.Shader and Ryujinx.Common. Shader also references Spv.Generator; Common includes NuGet dependencies. Inspect transitive dependencies for unsupported native APIs, reflection/AOT assumptions, unsafe memory access and runtime footprint. Desktop .NET success does not prove a browser-WASM target works.

Build a minimal browser-callable translation entry point in developer CI, not on the user's computer. Test a tiny synthetic shader job first, then graphics/compute/resource-binding cases. Compare SPIR-V and reflection output with the pinned native translator. If this cannot work within practical resource limits, stop and report the pure-browser blocker. A local native helper or remote build service would change the promised product and requires an explicit scope decision.

SPIRV-Cross should be precompiled to WASM using the exact supported release and options. Existing documentation specifies `vulkan-sdk-1.4.357.0` and reports 231 shader-source differences versus another version. Preserve final source digest validation, not just a human-readable version string.

`nometal_run.py` places LF-normalized Metal source inside files named `*_b.metallib`/`*_bf.metallib`. This is intentional: the shell distinguishes compiled libraries from source. Emit the exact contract expected by the selected shell. No browser Metal compiler is needed. This route defers actual Metal compilation validity to the device.

The native `shaders_done()` demands a nonempty per-shader result set, every status `ok`, and every corresponding library file. Additionally check chain directory, every JSON description, c1 index header, and `SHADER_SRC` digest. Chain-name substitution is safe only within the existing verified source-equivalence contract; never rename incompatible outputs to bypass compatibility checks.

### Packaging and Mach-O

`guest_dylib.py` uses only Python standard-library binary assembly. Required invariants include arm64 Mach-O headers, 16 KiB sections/pages, `__TEXT` executable segments, writable `__DM<name>W` segments, `__LINKEDIT` at the end, `/usr/lib/libSystem.B.dylib` dependency, and deterministic content-derived UUID.

Current upstream adds a 16-byte-aligned reserved code-signature region. `adhoc_sig()` uses a CodeDirectory version 0x20400, SHA-256 hashes for 4 KiB code pages, and linker-style flags. Reserved space allows later re-signing tools to replace the signature. This addresses re-signers that cannot insert a new command because Guest has no conventional `__text` section. Test this structure against the current Python oracle; do not conflate it with user-authorized signing.

The existing shell builder uses Xcode with signing disabled, removes provisioning and code-signature directories, removes irrelevant extensions, and audits excluded game content. Building that shell remains a publisher/developer task. It currently needs real generation inputs to establish table sizes and the omission manifest. Without game files we cannot independently rebuild and validate a production shell; use an exact trusted release shell later, or synthetic shells for tests now. Do not ship a pretend shell as installable.

The current Guest writer declares iOS 26.0. Older-system shell support must be treated as a separate compatibility matrix and checked against the release-specific transform; do not assume changing the shell filename changes every embedded minimum-OS field.

### Reproducibility and licensing

Maintain a machine-readable toolchain lock: source revision, upstream references, runtime versions, compiler settings, artifact SHA-256 hashes, licenses and build recipe identifiers. CI produces browser binaries and a software bill of materials. Validate downloaded tool assets before use. Review all bundled third-party licenses, including their redistribution/source/notice requirements; repository MIT licensing alone does not settle every dependency's obligations.

Cache keys must incorporate source input identity, transform version, tool hashes, shell PRODUCT/CHAIN and relevant options. Native file-existence shortcuts and a directory count of 162 are insufficient for secure resumability. Store manifests and per-artifact hashes; never reuse partial outputs from a different source set.

## Milestones and acceptance gates

### M0: dependency-free local preflight foundation

Deliver a small static UI and pure validation modules in `web/`, plus Node-compatible tests. Accept selected directory metadata and a shell contract without executing the real transforms. Display supported/missing/unsupported clearly. Provide synthetic fixtures only. Passing preflight does not enable a fake “build IPA” success button.

Acceptance: deterministic tests cover valid fixtures, missing files, multiple app bundles, malformed manifests, path traversal, mismatch of PRODUCT/CHAIN, unknown build and duplicate entries. No game data or toolchain download is needed for these tests.

### M1: binary/storage core and synthetic package

Implement random-access reads, streaming ZIP output, bounded decompression, content hashing, cancellation, and Guest framework writer. Extract portable functions from native references only where needed and compare with an independent parser.

Acceptance: synthetic .data/BLTE extraction matches the native reference; synthetic Guest bytes match `guest_dylib.py` including structural signature; archive re-open verifies entries, CRCs, permissions and framework layout. Exercise offsets above 4 GiB using sparse/mock readers without allocating a 4 GiB buffer. Output is unmistakably a test fixture, not a real installable game.

### M2: prove difficult dependencies before full UI polish

Prototype Capstone/LZ4 rewrite path, texture WASM helpers, image generation runtime and .NET shader translator/SPIRV-Cross chain. Record download size, peak memory, execution duration and failure cases on Windows and macOS Chromium.

Acceptance: synthetic instruction and shader fixtures match pinned native oracles. Every missing browser dependency is an explicit blocker, not silently stubbed. Select the production runtime architecture only after this gate.

### M3: integrate local job graph

Connect real transformation interfaces, manifests, progress, cancellation, retry and cache validation. Prevent UI freezes and unbounded parallel image/shader jobs. Produce an audit report without secrets or game bytes.

Acceptance: end-to-end synthetic pipeline recovers from interrupted jobs, rejects changed input/tool versions, and completes within declared memory/storage budgets. Network audit proves no input content leaves the browser.

### M4: private local real-data verification, only when available

The owner selects their own files locally. Generate native reference outputs with the same pinned release in an authorized development environment, compare browser outputs stage-by-stage, and investigate any divergence. Do not ask for uploads of the bulk game archives.

Acceptance: patch outputs, tables, overlays, shader source digest, c1 index and framework match expected contracts; all required shell-manifest paths exist; no source resource archives accidentally appear in the IPA. Record justified image tolerance separately from binary exactness.

### M5: real signing/device acceptance

User separately signs and installs. Check first launch, all shaders, resource import, menu, character creation, entering gameplay, audio, save/load, scene changes and a relaunch. Check relevant device/OS and re-signer combinations, including Guest signature compatibility.

Acceptance: actual signed-device smoke results are recorded. Until then the accurate claim is “archive assembly verified,” not “playable IPA verified.” Do not quote native upstream timings as browser performance guarantees.

## Synthetic test inventory

- ZIP: one/multiple/no app, missing shell metadata, duplicate paths, traversal, symlinks, CRC corruption, truncated central directory, unsupported compression/encryption and expansion limits.
- Shell: conflicting PRODUCT/CHAIN, invalid manifest entries, missing generated directories, unexpected existing entry collisions, unsupported KIND or minimum OS.
- NSO: minimum header, truncated ranges, oversized segment claims, compressed/uncompressed tiny segments, BSS/key-page alignment, wrong build ID and expected-original-byte mismatch.
- ARM64 rewriting: x18 read/write, TLS-register access, SVC and counter reads, branch relocation limits and unchanged ordinary instructions; synthetic fixtures are not a bypass for production build-ID checks.
- RomFS: raw `n`, zlib `z`, BLTE N/Z blocks, correct CSize and MD5, malformed offsets/sizes, case-normalized lookup, missing archive and decoded-size limits. EKey holds a 40-bit big-endian offset in bytes 11–15; preserve safe integer arithmetic.
- Textures: tiny linear/block-linear round trips, mip/edge dimensions, invalid descriptors and allocation limits; image pixel comparison with pinned dependencies.
- Shader metadata: empty result list, one failed shader, missing output, mismatched per-file CHAIN, c1 header mismatch and source hash mismatch. Test LF/CRLF canonicalization.
- Mach-O: 16 KiB boundaries, permissions, link commands, UUID stability, segment offsets, LINKEDIT extent, signature region bounds and every ad-hoc page hash.
- Job lifecycle: cancel mid-read/decode/write, worker crash, quota exceeded, permission revoked, input changed, stale cache, app refresh and repeated clean run.
- Privacy: no request contains input bytes, private file names or derived game content; failure logs stay local; dependencies are pinned and not dynamically fetched from arbitrary third-party URLs.

## Implemented checkpoint

The current checkpoint contains `web/preflight.mjs`, six passing Node synthetic tests, and `web/README.md`. Implemented primitives cover local path validation/conflict detection, bounded random reads (4 MiB per request), cancellation, a Blob input adapter, and a 256-byte NSO header reader. This header reader does **not** verify the supported game build/version. A static preview UI now offers a synthetic demo and an optional read-only ExeFS header check. Its scripts pass Node syntax checks; actual browser interaction has not yet been verified. Real conversion, browser-compiled dependency stacks, shell ZIP validation and IPA generation are not implemented at this checkpoint. M0 above describes the fuller intended milestone, not a claim that it is already finished.

## Evidence and current limits

This plan is based on reading the actual packager, framework writer, shell builder, shader wrapper/project, archive reader and asset-generation code. No game data was read, uploaded or downloaded for this investigation, and no dependency installation or real IPA build is implied. Upstream documentation's device verification describes upstream's native pipeline, not this browser implementation.

The immediate deliverable is the plan plus an honest synthetic preflight foundation. The largest unknown is the practical browser deployment of the shader translation and asset-generation dependencies. Resolve that early, preserve the local-only/no-toolchain user experience, and refuse a completed-package claim until all relevant validation gates pass.
