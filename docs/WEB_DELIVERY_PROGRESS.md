# Browser delivery status and historical acceptance

中文: [WEB_DELIVERY_PROGRESS.zh-CN.md](WEB_DELIVERY_PROGRESS.zh-CN.md)

## Current validation (2026-10-23)

The maintainer reports that the generated IPA works on a real iOS device. The report does not specify an exact tested build, device/iOS version, input format or gameplay matrix, so broader compatibility and Xcode numerical equivalence are not implied.

The latest verified downloadable build is [7d45b17, Verify 39916614716](https://github.com/n3crosis/d2r-mobile/actions/runs/39916614716), with its [web preview artifact](https://github.com/n3crosis/d2r-mobile/actions/runs/39916614716/artifacts/12484754768). This does not identify which artifact the maintainer tested and is not a new Site deployment. The publication receipts and weighted scoring below are historical records, not the current overall completion score.

## Historical preview publication

[Commit 155fd76](https://github.com/n3crosis/d2r-mobile/commit/155fd764add607adf9070fafd5fdf58e40296408)
is published to the existing private [preview Site](https://d2r-ipa-packager.nicekrill34.chatgpt.site).
Desktop Chromium on Windows/macOS is the target: single-folder required base and update with optional
DLC, optional `title.keys` and embedded common tickets, a resource child
folder and bounded Blob IPA download. iOS 26 and iOS 18 shell targets are available;
the default path still requires BC textures. The experimental older-GPU option,
selected before private inputs, generates ASTC overlays and a separate Legacy
Device Pack. Skipping original resource export neither skips that pack nor verifies
existing device files. Each selection loads only its shell, common assets and
explicitly enabled closed optional groups.

The default output remains unsigned. Optional local zsign WASM signing accepts
P12/PFX identities and provisioning profiles without uploading credentials. Its
compatibility checks do not establish certificate trust, revocation status or
device eligibility. After signing failure or cancellation, fresh credentials can
retry against the retained unsigned Blob without repeating NSP conversion or
resource export. Completed unsigned downloads and resource outcomes remain available.

The publication includes early signing-heap/mutable-filesystem release and source
Blob reuse, plus the user's extraction-progress and Pillow-compatible BC3 fixes.
These are implementation changes, not measured browser RAM/speed savings. The
browser runtime retains .NET but contains no Python runtime, packages or scripts;
Python build/reference tooling is separate. Build and synthetic checks do not
establish real-game conversion, real-credential signing, installation or execution.

Download-preparation retry, committed IPA recovery after cleanup failure, stream
cancellation, stable log IDs, bounded archive reads and art/shader buffer-lifetime
improvements are published. Cleanup failures remain visible. Later source edits
still need their own build/publication; no acceptance score is increased here.
See [implementation and acceptance](WEB_IPA_PACKAGER.md).

## Publication receipt and pending source changes

Verified publication: `155fd764add607adf9070fafd5fdf58e40296408`, successful
[Verify 39549460300](https://github.com/n3crosis/d2r-mobile/actions/runs/39549460300)
(job `119055083277`). Artifact `12322049463` is 22,879,860 bytes; ZIP SHA-256:
`2b4e4fe43bee64c80b854f26c622ff363010ebc99092635a9d5cfd94a97bddb2`.
Runtime manifest SHA-256:
`ffcfb1b32290ab09cc294d2043c3b271059d73983e789264cc26faaa61db2dd2`.
The archive inventory contains 307 logical assets and 36 physical runtime payloads,
excluding frontend files. These are whole-artifact counts, not a selected browser download total.
Site source: `8af7951e0f42187521006a1c0850eb88e3601a63`.
Owner-private deployment `appgdep_6ad84e4742748191a8d36aa5aa7c2884`
succeeded on 2026-10-21 at 05:32:00 UTC.

Historical paired-build evidence remains limited to `e93a15a` / `32e9717`:
all 297 logical assets and 33 runtime payloads in that pair were identical,
including .NET boot/main and SPIRV; only outer `build.sourceRevision` changed.
That observed pair does not establish universal determinism or certify later builds.

## Historical baseline: 42 / 100

The retired ledger was reviewed on 2026-10-20 through
[`664790f0b4d3cbe1082f174f0f1196164828d7f4`](https://github.com/n3crosis/d2r-mobile/commit/664790f0b4d3cbe1082f174f0f1196164828d7f4).
Its 42 points were planning weights, not a percentage of working features, time
remaining or probability of success. The ledger is summarized below to preserve
its evidence without presenting superseded failures as current build blockers.

| Historical gate                                  | Weight | Historical result | Earned |
| ------------------------------------------------ | -----: | ----------------- | -----: |
| I1 Metadata, selection and CASC primitives       |      3 | PASS              |      3 |
| I2 Extraction boundary and lifecycle             |      5 | PASS              |      5 |
| I3 Full authenticated base/update/DLC extraction |      4 | OPEN              |      0 |
| P1 Synthetic program/Guest parity                |      6 | PASS              |      6 |
| P2 Real program rewrite/provenance               |      4 | OPEN              |      0 |
| A1 Native art and derived tables                 |      4 | PASS              |      4 |
| A2 Texture/atlas/PNG composition                 |      3 | PASS              |      3 |
| A3 Complete archive-font HUD parity              |      4 | BLOCKED           |      0 |
| A4 Remaining assets/overlays and inventory       |      5 | OPEN              |      0 |
| S1 Linked synthetic shader parity                |      5 | PASS              |      5 |
| S2 Complete game shader catalog/digest           |      7 | OPEN              |      0 |
| R1 Shell parser and target inspection            |      3 | PASS              |      3 |
| R2 Authenticated source-aligned shell/catalog    |      5 | BLOCKED           |      0 |
| O1 Staged output and cancellation                |      5 | PASS              |      5 |
| O2 Production-size output/storage endurance      |      3 | OPEN              |      0 |
| J1 Fail-closed synthetic coordinator             |      3 | PASS              |      3 |
| J2 Complete UI-to-export integration             |      9 | OPEN              |      0 |
| N1 Sealed texture/Python component proofs        |      3 | PASS              |      3 |
| N2 Sealed .NET/extraction runtime closure        |      5 | OPEN              |      0 |
| V1 Real-input native/browser comparison          |      6 | OPEN              |      0 |
| V2 Signed device/gameplay acceptance             |      4 | OPEN              |      0 |
| D1 Narrow Windows/macOS Chromium probes          |      2 | PASS              |      2 |
| D2 Hosted release/browser acceptance             |      2 | OPEN              |      0 |
| Total                                            |    100 | Historical only   |     42 |

Rows were binary: PASS earned the full weight; OPEN/BLOCKED earned zero. Synthetic
proofs did not earn real-input/device points. N1's Python proof is historical,
not evidence for the replacement Python-free runtime. Later implementation does
not retroactively change these weights or grant unverified acceptance points.

## Historical evidence register

These outcomes are carried forward from the earlier ledger, not re-run or
independently reverified in this documentation pass. Every link concerns its
own revision and narrow scope.

| Code | Run                                                                            | Revision | Recorded outcome and limits                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W    | [39401602236](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602236) | ad20d13  | PASS: earlier web, Node 22/24 and C# checks                                                                                                                               |
| W2   | [39403162062](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162062) | 664790f0 | FAIL: frontend JSON formatting; 284 Node passes and one skip did not make the workflow green                                                                              |
| P    | [39403162102](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162102) | 664790f0 | PASS: synthetic main/sdk and Guest parity                                                                                                                                 |
| H    | [39403162408](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162408) | 664790f0 | FAIL: 32 MiB download cap truncated Pillow source before parity; earlier [39401602167](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602167) failed HUD parity |
| Y    | [39403161920](https://github.com/n3crosis/d2r-mobile/actions/runs/39403161920) | 664790f0 | PASS: sealed Pyodide/Pillow/NumPy subset, not HUD jobs                                                                                                                    |
| E    | [39403162222](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162222) | 664790f0 | PASS: sealed texture subset                                                                                                                                               |
| D    | [39403162155](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162155) | 664790f0 | PASS: narrow Windows/macOS Chromium probes                                                                                                                                |
| X    | [39403162100](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162100) | 664790f0 | PASS: extraction boundary and known DLC integration, not signed real-game inputs                                                                                          |
| A    | [39400065001](https://github.com/n3crosis/d2r-mobile/actions/runs/39400065001) | ff42f2f  | PASS: pre-HUD assets; [39399152831](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152831) at b90743b also covered native art/atlas                             |
| C    | [39403162096](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162096) | 664790f0 | PASS: SPIRV-Cross 1.4.363.0 native/browser parity, not full shell compatibility                                                                                           |
| S    | [39403162064](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162064) | 664790f0 | PASS: synthetic linked shaders, not full game catalog/digest                                                                                                              |
| O    | [39399152890](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152890) | b90743b  | PASS: staged-output integrity                                                                                                                                             |
| N    | [39403162461](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162461) | 664790f0 | FAIL: .NET publish/native oracle passed; bundle preparation expected separate rather than inline boot configuration                                                       |
| T    | [39403162332](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162332) | 664790f0 | PASS: authored-toolchain style checks, no extra milestone credit                                                                                                          |

## Evidence needed next

Use the unchanged [PR template](../.github/PULL_REQUEST_TEMPLATE.md) and
[contribution rules](../CONTRIBUTING.md). New source needs its own checks,
Chinese/English text and comment review, and post-change screenshots. Release
acceptance additionally needs complete runtime assembly/initialization,
Windows/macOS browser validation, output/storage/network failure testing,
private real-input native comparison, and separately signed device/gameplay
results. No checks are marked complete merely because implementation exists.
