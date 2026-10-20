# Browser delivery status and historical acceptance

中文: [WEB_DELIVERY_PROGRESS.zh-CN.md](WEB_DELIVERY_PROGRESS.zh-CN.md)

## Current source is not a verified deployment

The current source implements single-folder base/update/optional-DLC conversion,
optional `title.keys` with embedded common-ticket handling, a resource child
folder and a bounded Blob IPA download. The production browser path no longer
uses Python; .NET WASM remains for shader translation. Desktop Chromium on
Windows/macOS is the target. See [implementation and acceptance](WEB_IPA_PACKAGER.md).

These Python-free changes have not been compiled, built, tested or deployed in
this alignment pass. The earlier [Verify run at 158d6cf](https://github.com/n3crosis/d2r-mobile/actions/runs/39415236827)
was recorded as a successful full public-runtime build at that revision only.
It does not certify later edits, the currently hosted site or game compatibility.
Real game-input conversion, separately signed device execution and gameplay
remain unproven. No new percentage or test result is claimed here.

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
[PR-readiness checklist](WEB_PR_READINESS.md). New source needs its own checks,
Chinese/English text and comment review, and post-change screenshots. Release
acceptance additionally needs complete runtime assembly/initialization,
Windows/macOS browser validation, output/storage/network failure testing,
private real-input native comparison, and separately signed device/gameplay
results. No checks are marked complete merely because implementation exists.
