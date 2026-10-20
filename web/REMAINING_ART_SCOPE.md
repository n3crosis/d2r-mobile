# Source-derived stash, vault and pouch art

`generateRemainingArt` composes the remaining native `gen_assets.py` art steps
from authenticated logical assets. Inputs are discovered by the same native
controller-panel suffixes; ambiguous/missing paths fail. No source hashes or
pixels for a game release are invented. Runtime source packaging verifies the
six SHA-256 pins in `remaining-art-provenance.json`.

## Implemented order

1. MainPanelBG uses the original second frame and copies its BC3 blocks without
   re-encoding. The exact original geometry is display width 1440, storage width
   2888, height 881, two frames. Native NVN block addressing is preserved for this
   one geometry. Output storage width is 1640 and display width 1636.
2. The three stash backgrounds use the original `widen_bg` function; two advanced
   tabs receive transparent margins. The gems page uses unchanged
   `gen_trove_art.py` geometry, colour matching, resampling and composition.
3. The personal background is BC3-encoded and decoded again before the original
   vault-cover transform, just like native generation. The gold-box brightness
   guard remains mandatory; using pre-encoding pixels would change the result.
4. Pouch cropping and Pillow LANCZOS resize use the original statement body.
5. Encoding and swizzle call the existing source-pinned BC3 worker. Generated
   files retain the exact `NativeHUD/widestash/` and `NativeHUD/pouch/` names for
   the native overlay recipe's private generated-input map.

The Python packager extracts image operations only, rejecting I/O/codec globals.
It preserves the original source's vault guard and trove size assertions. Shared
runtime registration is owned by the asset worker, not this module. Input payloads
are capped at 20 MiB, source bytes at 32 MiB total, and output at 32 MiB. Dimensions
are constrained per original operation; individual image output cannot exceed
1640 by 1024. Buffers are wiped on failure, and owned intermediates are wiped when
complete. Returned output copies belong to the caller.

## Verification boundary

Minimal local smoke execution covered all five image operation variants on
patterned authored images. A synthetic main-panel fixture was swizzled with the
original native NVN library, cropped/spliced using the original native Python
block-copy expressions, and its 1,449,760 output BC3 bytes matched this JavaScript
implementation exactly. Scoped Python/JavaScript lint, formatting and packaging
checks pass.

This is not real game-data or complete browser parity evidence. Pillow versions
may affect resampling; full PNG/BC3 parity remains a later validation step. This
module does not enable the production UI, establish shell compatibility, or
change the pending choice of bulk-resource packaging layout.
