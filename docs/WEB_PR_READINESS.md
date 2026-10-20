# Browser change: PR-readiness checklist

中文: [WEB_PR_READINESS.zh-CN.md](WEB_PR_READINESS.zh-CN.md)

This supplements, and does not replace or relax, [CONTRIBUTING.md](../CONTRIBUTING.md)
and the [PR template](../.github/PULL_REQUEST_TEMPLATE.md). This is not a claim
that a PR is ready. Mark an item only after checking the exact change and recording
the revision, platform and actual output. Only the source checks explicitly recorded below are reported as run.
The full browser build and publication at 502fd5f passed; later edits require their
own checks. Game/device tests and screenshots remain pending. No PR has been opened.

## Published checkpoint versus pending work

Verified publication: `502fd5f95e3120859e41084f1b2e37060eb834be`, successful
[Verify 39501206192](https://github.com/n3crosis/d2r-mobile/actions/runs/39501206192),
artifact `12302035147`, owner-private Site deployment at 2026-10-20 21:39:47 UTC.
Exact ZIP/runtime digests, artifact size and inventory are recorded in
[the delivery receipt](WEB_DELIVERY_PROGRESS.md#publication-receipt-and-pending-source-changes).
The publication includes canonical Warlock preselection, removal of 48 unused
raw-source payload assets and a confirmed SDK cache hit, without a timing claim.

The published shader changes passed 23 targeted shader tests, frontend checks
and the full CI. Site source: `d0c84491a8b055e44de985d7069eeb1183e26dd7`.
These checks do not establish real-game/device acceptance or measured RAM savings.
The native fast/thorough option is live. Actual revised WASM tests passed 32
synthetic fixtures / 80 calls with opaque-URL execution verified, not browser,
decode, real-game or device proof. Cache metadata changes do not yet establish
deterministic builds.

Download-preparation retry and cleanup/cache cancellation fixes are now live.
Paired builds at a1b4afe and 502fd5f produced identical SPIRV WASM. The .NET main
assembly still differs in 67 GUID/debug/PDB metadata bytes; SourceLink has not
been established as the cause. This is not proof of full build determinism.
Batch suffix lookup remains uncommitted and unpublished, with synthetic
operation-count evidence only.

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

No game files needed:

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
