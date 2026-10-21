# Browser change: PR-readiness checklist

中文: [WEB_PR_READINESS.zh-CN.md](WEB_PR_READINESS.zh-CN.md)

This supplements, and does not replace or relax, [CONTRIBUTING.md](../CONTRIBUTING.md)
and the [PR template](../.github/PULL_REQUEST_TEMPLATE.md). This is not a claim
that a PR is ready. Mark an item only after checking the exact change and recording
the revision, platform and actual output. Only the source checks explicitly recorded below are reported as run.
The full browser build and publication at 155fd76 passed; later edits require their
own checks. Game/device tests and screenshots remain pending. No PR has been opened.

## Published checkpoint versus pending work

Published `155fd764add607adf9070fafd5fdf58e40296408` passed
[Verify 39549460300](https://github.com/n3crosis/d2r-mobile/actions/runs/39549460300).
Artifact, digests and the 2026-10-21 05:32:00 UTC deployment receipt are recorded in
[delivery status](WEB_DELIVERY_PROGRESS.md#publication-receipt-and-pending-source-changes).

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

Historical paired-build evidence remains limited to `e93a15a` / `32e9717`:
all 297 logical assets and 33 runtime payloads in that pair were identical,
including .NET boot/main and SPIRV; only outer `build.sourceRevision` changed.
That observed pair does not establish universal determinism or certify later builds.

## What changed / why

Browser text is being aligned with the canonical Chinese/English string-table
contract; browser docs now have matching Simplified Chinese versions. Current
browser Python removal, retained .NET shaders, optional title keys/tickets and
single-folder/resource-child/Blob-IPA behavior are distinguished from deployment
and real-game proof.

Browser-only keys use the `dmWeb*` prefix in `dm/i18n/ui_text.tsv`. The browser
supports English and Simplified Chinese, with Chinese selected for `zh*` browser
language and English otherwise. Required Spanish/Russian TSV fields explicitly
fall back to English; this is not Spanish/Russian browser localization. Browser
keys are excluded from native overlay generation to avoid changing game text.
After editing the canonical table, regenerate both derived outputs:

```sh
python3 web/scripts/generate-i18n.py
python3 dm/ios/tools/dm_i18n.py --header > dm/host/dm_i18n_tab.h
```

Generation is not compilation and does not establish that the checks below pass.
Review generated diffs before committing. The work does not establish bilingual
coverage for every historical browser spike, comment or document.

## Checks from the unchanged PR template

The checked source results below are historical records from 2026-10-20, including
the then-current 553-string count; they are not the current catalog inventory.

No game files needed (historical recorded outputs below, not rerun in this documentation update):

- [x] `python3 dm/i18n/scan_literals.py` — `I18N OK：中文字面量 459 条全在白名单（105 行），其余走中英表`
- [x] `python3 dm/ios/tools/dm_i18n.py --check` — `dm_i18n OK 553 条`

Game files and a workspace prepared by `./setup.sh` needed:

- [ ] `make -C dm/host/tests run`
- [ ] `make -C dm/gfx/tests run`
- [ ] `make -C dm/ios/tests test`
- [ ] `dm/verify/regress.sh` (`--fresh` if `dm/tools/patch_nso.py` changed)
- [ ] `cd dm/ios && ./run.sh build`
- [ ] `dm/ios/tools/smoke_mac.sh 1`
- [ ] `dm/ios/tools/check_hud_gen.sh`

Additional source-only check executed for this working tree: `python3 web/scripts/generate-i18n.py --check` — `Browser i18n catalog is current`. These source checks passed on 2026-10-20; they are not game or build acceptance.

Record other checks separately with exact commands and results, including source
style checks, browser tests and runtime verification. Do not infer these results
from text generation or static inspection.

## Visible changes, content and comments

- [ ] Attach screenshots taken after the visible browser changes in both languages.
- [ ] Confirm new/changed visible text is registered in `dm/i18n/ui_text.tsv` and both generated catalogs match it; review remaining hard-coded text, including errors.
- [ ] Confirm no game files, game-derived output, keys or built package are included.
- [ ] Confirm no local `./setup.sh` rewrites to `dm/gfx/tools/dmsh_chain.lock`, `dm/gfx/nvn/dmsh_chain.h` or `dm/gfx/nvn/c1_full.tsv` are included.
- [ ] Review all new/changed comments and source headers for matching Chinese/English content, including purpose and implementation basis.
- [ ] Review matching documentation and cross-language links; inventory any historical files still missing Chinese equivalents before claiming complete compliance.

The “Nothing on screen changes” checkbox is not applicable to this visible UI
change. Do not use it instead of screenshots. Full acceptance still requires
real inputs, private native/browser comparison, storage/network failure testing
and separately signed device/gameplay verification, as described in
[implementation and acceptance](WEB_IPA_PACKAGER.md). Never attach private inputs,
keys or generated packages as proof.
