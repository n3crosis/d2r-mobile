# Browser NSP-to-unsigned-IPA delivery checklist

## Baseline: 42 / 100 weighted milestone points (42%)

Evidence reviewed **2026-10-20**, through pushed commit
[`ad20d131d4558c155e0929681959040cb38ae9e3`](https://github.com/n3crosis/d2r-mobile/commit/ad20d131d4558c155e0929681959040cb38ae9e3).
This is a **planning-weighted delivery score**, not an objective percentage of
functionality, time remaining, probability of success, or game compatibility.
**Real-game end-to-end proof: 0%. Signed-device/gameplay proof: 0%.** The UI cannot
currently deliver a verified real-game IPA.

The target is the [local browser packaging plan](WEB_IPA_PACKAGER.md): a desktop
browser reads one local NSP/key folder, performs conversion without an installed
user toolchain or uploads, and saves a validated unsigned IPA using a matching
publisher shell. Signing remains outside the website; subsequent device testing
is an acceptance gate, not a promise that the website signs or installs anything.

### How the score works

- Weights below are fixed for this baseline and total **100**. They reflect the
  importance of delivery outcomes, not code size, test count or number of commits.
- Each row is binary: **PASS** earns its whole weight; **OPEN** or **BLOCKED** earns
  zero. No estimated fractional credit. PASS means only the narrow stated gate.
- Synthetic component proofs deliberately have their own rows. They never earn
  the real-input, complete-integration or device rows.
- Older green runs establish their tested component scope at their named commits,
  not a green current release. Relevant changed paths need new proof. The current
  asset and style failures below mean the latest revision is **not all-green**.
- Unpushed edits, a workflow definition, a queued run and a successful build
  without its required behavioral tests earn no new points.
- Keep these weights stable as work advances. If scope changes, publish a new
  baseline and explain the difference instead of silently moving the denominator.

## Detailed acceptance checklist

Evidence codes link to the run register below. “Synthetic” describes authored
inputs, even when the actual browser, WASM and native reference are executed.

| ID  | Delivery gate                                                                    |  Weight | Status  | Earned | Evidence or remaining acceptance                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------- | ------: | ------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Bounded folder/container metadata, selection and CASC read primitives            |       3 | PASS    |      3 | W: synthetic Node tests; [CASC scope](../web/CASC_LOGICAL_READER_SCOPE.md). Not a positive signed-game extraction proof.                                                         |
| I2  | Compiled extraction worker, authenticated-reader boundaries and client lifecycle |       5 | PASS    |      5 | X: synthetic WASM/Chromium, crypto/routing and rejection gates. No valid signed game fixture.                                                                                    |
| I3  | Complete base/update/DLC extraction connected to the production job              |       4 | OPEN    |      0 | Require supported selection policy, positive authenticated inputs and complete adapter integration; reject unsupported variants.                                                 |
| P1  | Native-oracle main+sdk rewriting and Guest assembly on synthetic inputs          |       6 | PASS    |      6 | P: actual Capstone/LZ4/Python browser engines and exact native outputs; registered route rejects wrong inputs.                                                                   |
| P2  | Registered real build rewrites verified through extraction provenance            |       4 | OPEN    |      0 | Registered path is implemented, but valid real main/sdk and production-size behavior have not passed.                                                                            |
| A1  | Native-art and derived-table component parity                                    |       4 | PASS    |      4 | A: prior green asset corpus, exact native PNG/C/table transforms. Trusted production table counts and all source generators remain separate.                                     |
| A2  | Texture decode, padded atlas and PNG worker composition                          |       3 | PASS    |      3 | A: real WASM/browser versus synthetic native pixel oracle; does not certify every sprite encoding/recipe.                                                                        |
| A3  | Complete archive-font HUD parity                                                 |       4 | BLOCKED |      0 | H fails exact-output parity: native RAQM versus browser BASIC/FreeType rendering. Implementation alone earns no credit.                                                          |
| A4  | Remaining map-goal/overlay generators and complete shell asset inventory         |       5 | OPEN    |      0 | Require actual native-equivalent outputs, full recipe coverage and inventory validation, not plans or headers substituted as assets.                                             |
| S1  | Linked native-to-browser shader translation component parity                     |       5 | PASS    |      5 | S: authored compute/graphics corpus through translator and SPIRV-Cross. Not all game shaders.                                                                                    |
| S2  | Complete game shader extraction, replay metadata, c1 and source digest           |       7 | OPEN    |      0 | Require full trusted shader catalog and shell-matching source set; no relabeling incompatible chains.                                                                            |
| R1  | Strict shell ZIP/contract and target-inspection primitives                       |       3 | PASS    |      3 | W and [shell evidence](../web/toolchain/shell-release-evidence/README.md): bounded parser/tests and read-only release inspection.                                                |
| R2  | Authenticated, source-aligned production shell/catalog                           |       5 | BLOCKED |      0 | Inspected v1.0.18 needs Cross 1.4.363.0; pushed spike pins 1.4.357.0. Release/source chain and target mismatches also need resolution. Inspection JSON is not an enabled recipe. |
| O1  | Bounded ZIP/Guest output, independent staged validation and commit/cancel        |       5 | PASS    |      5 | W, O and D: synthetic archive/oracle and real OPFS lifecycle proof. No installability claim.                                                                                     |
| O2  | Production-size output/storage endurance and real destination behavior           |       3 | OPEN    |      0 | Require declared budgets, real file-picker/disk/quota failure tests and supported output compatibility. Sparse arithmetic tests do not establish endurance.                      |
| J1  | Fail-closed packaging coordinator and bounded stage scheduling                   |       3 | PASS    |      3 | W: synthetic injected adapters verify ordering, cleanup, cancellation and validation-before-commit.                                                                              |
| J2  | Complete browser UI-to-all-stages-to-export job                                  |       9 | OPEN    |      0 | Wire actual supported adapters, progress/recovery and resource-transfer guidance; pass full synthetic end-to-end flow without fake stages.                                       |
| N1  | Sealed texture and Python runtime component proofs                               |       3 | PASS    |      3 | E, Y: actual post-seal work, exact synthetic parity and no HTTP receipts. Pyodide proof does not execute HUD jobs.                                                               |
| N2  | Sealed .NET/extraction and complete production runtime closure                   |       5 | OPEN    |      0 | Require all lazy resources, production CSP and failure/cancel network audit; no runtime CDN fallback.                                                                            |
| V1  | Private real-input browser/native whole-pipeline comparison                      |       6 | OPEN    |      0 | No complete conversion from valid signed game inputs; compare all outputs and final archive against matched native reference.                                                    |
| V2  | Separately signed device acceptance                                              |       4 | OPEN    |      0 | No generated real IPA signing/install/launch/gameplay/save-load results. Test supported device/OS/re-signer combinations.                                                        |
| D1  | Windows/macOS narrow desktop browser portability probes                          |       2 | PASS    |      2 | D: pinned Chromium OPFS and sealed texture proof on both OS runners, not the complete app or branded-browser matrix.                                                             |
| D2  | Final hosted release and supported-browser acceptance                            |       2 | OPEN    |      0 | Require actual deployment headers/resource closure, coherent pinned artifacts/notices, all release checks green and complete supported-browser flow.                             |
|     | **Total**                                                                        | **100** |         | **42** | **58 points remain unearned.**                                                                                                                                                   |

**Earned calculation:** I1 3 + I2 5 + P1 6 + A1 4 + A2 3 + S1 5 + R1 3 +
O1 5 + J1 3 + N1 3 + D1 2 = **42**. Every other row contributes zero.

## Verified run register

Run conclusions were checked through GitHub Actions on the review date. A green
run certifies its tested revision and scope only. Historical scope documents may
still say “pending”; this register distinguishes actual results from those plans.

| Code | Run                                                                            | Revision | Result and scope                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W    | [39401602236](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602236) | ad20d13  | PASS: web checks, Node 22/24 and C# checks.                                                                                                                                                   |
| P    | [39401602282](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602282) | ad20d13  | PASS: synthetic native/browser main+sdk and Guest parity.                                                                                                                                     |
| H    | [39401602167](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602167) | ad20d13  | FAIL: HUD exact-output parity; no HUD completion credit.                                                                                                                                      |
| Y    | [39401602080](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602080) | ad20d13  | PASS: sealed Pyodide/Pillow/NumPy subset.                                                                                                                                                     |
| E    | [39401602235](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602235) | ad20d13  | PASS: sealed Emscripten texture subset.                                                                                                                                                       |
| D    | [39401602142](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602142) | ad20d13  | PASS: Windows/macOS synthetic Chromium probes.                                                                                                                                                |
| X    | [39400665215](https://github.com/n3crosis/d2r-mobile/actions/runs/39400665215) | 29d10cd  | PASS: extraction WASM boundary. Earlier [39400064994](https://github.com/n3crosis/d2r-mobile/actions/runs/39400064994), ff42f2f, also passed.                                                 |
| A    | [39400065001](https://github.com/n3crosis/d2r-mobile/actions/runs/39400065001) | ff42f2f  | PASS: pre-HUD asset corpus; [39399152831](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152831), b90743b, also verifies native-art/atlas work. Not a current complete-assets pass. |
| S    | [39400064983](https://github.com/n3crosis/d2r-mobile/actions/runs/39400064983) | ff42f2f  | PASS: linked synthetic shader pipeline; earlier [39398141357](https://github.com/n3crosis/d2r-mobile/actions/runs/39398141357), 44b8e64, passed graphics coverage.                            |
| O    | [39399152890](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152890) | b90743b  | PASS: staged-output integrity, supplemented by current D.                                                                                                                                     |
| —    | [39401602210](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602210) | ad20d13  | FAIL: authored-toolchain style checks (E402). An unpushed fix is not a passed gate.                                                                                                           |

## Why a rough percentage can stay flat

The earlier rough 60% estimate had no fixed denominator and cannot be audited or
compared honestly with this checklist. **42% replaces that estimate; it is not a
claim that completed work was lost.** Component code and tests can improve while
an acceptance row remains open: for example, a complete HUD implementation still
earns zero until its required parity passes. Larger test counts do not themselves
increase the score. Future changes should name the newly passed row, its evidence
and its exact point delta. Fixing a regression in an already-earned row restores
confidence, not extra points.

The next visible gates are HUD parity (A3), shell/source/catalog alignment (R2),
remaining assets/overlays (A4), full shaders (S2), sealed runtime closure (N2), and
complete UI orchestration (J2). These are independent work tracks where possible,
not a claim that their dependencies or real-input/device gates are finished.
