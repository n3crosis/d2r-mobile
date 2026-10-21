# Local browser IPA packager: implementation and acceptance

中文: [WEB_IPA_PACKAGER.zh-CN.md](WEB_IPA_PACKAGER.zh-CN.md)

## Status and boundaries

The current source implements a local-input packaging flow for desktop Chromium
on Windows and macOS. The Python-free browser runtime changes are source changes,
not a newly built or deployed release. The historical
[Verify run at 158d6cf](https://github.com/n3crosis/d2r-mobile/actions/runs/39415236827)
is evidence only for that revision, not these changes. No compilation, build,
tests, screenshots, real-game conversion or device verification were performed
for this documentation alignment. See [delivery status](WEB_DELIVERY_PROGRESS.md).

This is not a browser port of the game. The output runs natively on a compatible
Apple device after separate signing and installation. End users do not install
Python, .NET, a compiler, Xcode or Bun. Python has been removed from the current
production browser runtime path; .NET WASM remains for shader translation.
Developer/native-reference tooling can still require Python and .NET.

## Inputs and outputs

1. Put the base NSP, compatible update NSP(s) and `prod.keys` directly in one
   folder. Compatible known DLC and `title.keys` are optional. Embedded common
   tickets can supply title keys; rights-managed inputs without a usable ticket
   or matching key still fail. Optional does not mean every package works without
   `title.keys`. No game files or keys are distributed by this repository.
2. In a secure context, use the single directory picker and grant read/write
   access. Root-only discovery ignores generated resource subfolders. The
   application must not overwrite original NSPs or key files.
3. The flow verifies and preloads the pinned same-origin public runtime and app
   template before private input selection, then authenticates content and
   chooses compatible base/update/optional DLC from metadata, not filenames.
4. Conversion performs extraction, program rewriting, Guest.framework generation,
   native art/HUD and table generation, overlays and shader translation. The app
   template is prebuilt iOS build input, not a command-line shell or ready IPA.
5. Bulk resources stream to a new `D2R-resources-<UUID>` child of the input folder.
   The validated IPA is offered as a bounded Blob browser download, not saved
   directly into that folder. A visible download link supports retry; the browser
   controls the download destination. The IPA does not contain all resources.
6. Sign and install the IPA separately, then copy the completed
   `D2R-resources-<UUID>` folder into **On My iPhone / D2R Mobile** (or the
   corresponding app folder on iPad) in Files, keeping its `data` child intact.
   The experimental **Older-GPU option** also generates a separate
   `Legacy Device Pack-<UUID>` folder. When enabled, copy that completed folder
   alongside the game-resource folder, keeping its `data` child and
   `manifest.json` intact; it must match the IPA generated in the same run.
   Neither resource set is bundled into the IPA. Do not copy incomplete outputs.
   If you explicitly skipped original-resource export, keep the existing resources
   for the same game, update and DLC; they have not been verified by the browser.
   The newly generated Legacy Device Pack still needs copying when that option is
   enabled. Real game and device compatibility remain unverified.

## Source-backed architecture

| Concern              | Current source / contract                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI and folder access | [`web/src/App.tsx`](../web/src/App.tsx), [`web/nsp-input.mjs`](../web/nsp-input.mjs): one read/write picker, optional title keys, root discovery                                               |
| Orchestration        | [`web/browser-packager.mjs`](../web/browser-packager.mjs): authenticated stages, validation, resource export and IPA commit                                                                    |
| Program conversion   | [`web/runtime-sealing/program-worker.mjs`](../web/runtime-sealing/program-worker.mjs): JavaScript rewriter with Capstone/LZ4 WASM, not browser Python                                          |
| Art and tables       | [`web/production-assets.mjs`](../web/production-assets.mjs), [`web/production-derived.mjs`](../web/production-derived.mjs): authenticated local assets and browser transforms                  |
| Shaders              | [`web/production-shaders.mjs`](../web/production-shaders.mjs), [`web/sealed-runtime/dotnet-worker.mjs`](../web/sealed-runtime/dotnet-worker.mjs): retained .NET shader runtime and SPIRV-Cross |
| Resources            | [`web/resource-folder-export.mjs`](../web/resource-folder-export.mjs): fresh child directory, streamed chunks and incomplete markers                                                           |
| IPA                  | [`web/browser-blob-output.mjs`](../web/browser-blob-output.mjs), [`web/browser-staged-output.mjs`](../web/browser-staged-output.mjs): staged validation and bounded final Blob                 |
| Public runtime build | [`web/runtime-build/README.md`](../web/runtime-build/README.md): developer assembly, pinned inventory and deployment artifacts                                                                 |

The complete normalized shader-source digest must match the template's
`SHADER_SRC`. Chain-label substitution alone cannot accept incompatible sources.
The pinned template hash, inventory and actual Mach-O target remain validation
gates. Guest.framework may carry a linker-style ad-hoc structural signature; this
is not the user's signing identity or installation authorization. The bounded
no-DLC executable variant also requires re-signing; see
[content mode](../web/D2R_RUNTIME_CONTENT_MODE.md).

## Privacy, limits and failure handling

Private game content and keys stay local; there is no remote conversion service
or runtime CDN fallback. Public asset downloads are not private-input uploads.
The prototype does not impose a CSP network lockdown. No-upload behavior and
failure/cancel network traffic still need verification on the built release;
source intent is not a measured network audit. Do not put key contents in logs,
URLs or persistent caches. JavaScript memory cleanup is best effort, not secure
erasure.

Bounds, checksums, archive paths, input authenticity and output inventory must be
validated before success. ZIP32, stage-memory limits, OPFS quota and output Blob
limits can reject a large genuine input. Bulk resources stream separately, but
the final IPA is not a streaming file-picker export. Do not claim unlimited size
or production-size endurance. Cancellation closes the single-use session and
requires a reload. Incomplete resources are marked; a later IPA failure does not
invalidate an independently completed resource folder.

Chromium on Windows/macOS is the intended desktop target, not proof of every
browser/version combination. Capability detection and real destination/quota
behavior need platform validation. Do not silently substitute upload processing
or describe synthetic outputs as ready to play.

## Remaining acceptance gates

- Build the current Python-free source and validate complete runtime inventory,
  licenses, pinned hashes and worker initialization before deployment.
- Run repository and browser checks with exact revision, platform and outcomes;
  historical green runs cannot certify new changes.
- Capture post-change UI screenshots, verify matching Chinese/English text and
  comments, and satisfy the canonical string-table requirement.
- Test full Windows/macOS Chromium flows, cancellation, memory/quota/disk limits,
  browser downloads and private-data network behavior.
- Privately compare real authenticated base/update/optional-DLC outputs against
  the matching native reference, including complete shader digest and resources.
- Separately sign, install and exercise supported devices, gameplay and save/load.
  Never upload game inputs, keys or generated packages as PR evidence.

Pending acceptance does not replace or weaken [CONTRIBUTING.md](../CONTRIBUTING.md)
or the [PR template](../.github/PULL_REQUEST_TEMPLATE.md). Operational detail remains in
[frontend overview](../web/README.md), [production flow](../web/PRODUCTION_FLOW.md)
and [testing](../web/TESTING.md).
