# Reviewed v2.0.0 shell profiles

These records describe the two public, content-free iOS shells in the
[official v2.0.0 release](https://github.com/jhaizhou-ops/d2r-mobile/releases/tag/v2.0.0).
The production default is the matched v2 iOS 26/iOS 18 pair, bound to the
reviewed b811 art and overlay recipes. Only these two archives are bundled;
explicit legacy v1 profiles retain separate paths and are not downloaded by
default. Compiler selection is unchanged. No shell executable, compiler, game,
browser, device or certificate-signing operation was run for this integration.

The release target is `b811b90172f4eb40ec1bc89d903308e0c5ab88d0`, not the later
upstream `e3756f8942b40eba6c851e881828a5b1bda17fd6`. Both complete downloads
matched GitHub's release-asset digest and the publisher's `SHA256SUMS.txt`.
No independent publisher signature or binary build attestation was verified.

| Profile      | ZIP bytes | ZIP SHA-256                                                        |
| ------------ | --------: | ------------------------------------------------------------------ |
| v2.0.0-ios26 | 4,856,775 | `bc1152694d9a00eef680dd07f8ea31419be5ff4d0437d8298d3772e57cc92c94` |
| v2.0.0-ios18 | 4,852,823 | `b2d1e3b48c0b15f773b4ea94290fde08039fd123c21be98c55b00da8df55ada5` |

Exact URLs and per-member sizes, modes and hashes are in `v2.0.0.json` and
`v2.0.0-ios18.json`. Neither ZIP nor any executable is committed here.
Each archive has 15 entries. Plist and Mach-O minima agree on 26.0 and 18.0,
respectively. Both report SDK 27.1 and Xcode 27.1. The iOS 18 symbol table has
no MTL4/Metal4-named symbols; this is not an exhaustive API compatibility test.
The handwritten Guest wrapper's existing SDK field 26.0.0 remains separate
from the observed host SDK and is not an Apple build claim.

## Exact executable and content-mode binding

| Profile | DmIOS bytes | Original SHA-256                                                   | `_aoc_owned.v` file offset |
| ------- | ----------: | ------------------------------------------------------------------ | -------------------------- |
| ios26   |   2,119,120 | `ee65b6c36bfb362af4fcf5661429e34b6097f14af5b73d8cd7e72016f12c68ce` | `0x1a71e8`                 |
| ios18   |   2,100,168 | `1ab0bcacc8cde2a691ec17d70f7ca6da7e45bee563c10cf0c7ee50c67fac32c4` | `0x1a3058`                 |

The unique non-debug definition lies in file-backed `__DATA,__data`, at virtual
address `0x100000000 + offset`, initialized to `ffffffff`. Source
`dm/host/hle_misc.c` is byte-identical to the v1.0.18 release. Replacing only
these four bytes with zero, in memory, yielded:

- ios26: `f25e60982514ce34d0603ba8d1e7e6412947baf27ef553f11bcb08f2ae4f615a`
- ios18: `6056f821d90b2553a00bb0148220aabede4f082891a17a53deaebb86b5ae38f4`

This is the same content-mode derivation contract as v1, with new independently
bound addresses and hashes. It is not a base-only gameplay result. Any eventual
packaging mutation invalidates existing signatures and requires user signing.

## Independently reviewed capacities

Both hosts encode EXP 100 scalar values, VTPART 11 rows, VTROW 562 rows,
VTSET 35 rows and TAROW 429 rows. The capacity JSON files retain exact symbol
locations, LC_FUNCTION_STARTS boundaries, function hashes and instruction
windows. An independent read-only parser rechecked the ZIPs, executable bytes,
sections, symbols, function ranges, instruction windows and derived content-mode
hashes. Its result is `v2.0.0-independent-native-review.json`.

The review additionally traced `_vt_load`'s tag string and callback addresses
and context frame slots: VTPART uses `_vt_part_cb`/w19, VTROW uses
`_vt_row_cb`/w8, and VTSET uses `_vt_set_cb`/w20. Callback guards reject indices
above 10, 561 and 34; the final success comparisons require 11, 562 and 35.
TAROW rejects indices above 428 and requires final count 429. EXP bounds writes
at 100 and now includes an exact final-count comparison. No count was inferred
from array spacing, BSS alignment, generated game inputs or synthetic fixtures.

## CHAIN: accepted source-equivalence gate, not reproducibility

Both v2 shells require `CHAIN=420aeb7c8bc6`, whereas v1 used `f2bc055e8f1e`.
PRODUCT remains `3.3.94012-r44`, SHADER_SRC remains `be59c864f087b377`, and
SPIRV_CROSS remains `1.4.363.0`. The required manifest paths are unchanged
except the shader directory becomes `msl/b-420aeb7c8bc6/`.

The eleven committed chain inputs are byte-identical across v1 release source,
v2 release source and current upstream. They compute `c675d3fa7c90`, and all
carry committed header `15cf7ca29eaf`. Neither value reproduces either published
shell. The committed lock includes native DLL/Cross fingerprints and Apple Metal
version strings. Actual local tool fingerprints are deliberately allowed to
differ: the unchanged upstream `dm/tools/d2rm_pack.py:188-223` regenerates local
lock/header metadata, then requires complete translated-source equivalence
before accepting the shell's chain label. The exact publisher build-time lock
and header are not available here, so the origin of `420aeb7c8bc6` is not
independently reconstructed. A local tool difference is an expected mechanism,
not proof that it alone explains these exact publisher bytes.

This gap is not itself an ABI incompatibility or a reason to weaken checks.
The actual loader consumes CHAIN as three coherence labels:

1. `nvn_mtl.m:2194` selects the `b-<CHAIN>` directory.
2. `nvn_mtl.m:2353` rejects per-shader JSON with a different chain.
3. `nvn_mtl.m:2199` checks the c1 index prefix. A mismatch uses conservative
   64 KiB c1 allocation rather than accepting the optimized index.

The reflection parser, Guest packer, shader mapping/facts and readable-tile
transformation are byte-identical to v1 source. The actual `shader_load` and
`lib_from_file` function bodies are also byte-identical. Source hashes are in
`v2.0.0-native-loader-comparison.json`; the ZIP shader map and PSO manifest also
match the exact v2 source files.

The current accepted browser v1 path already uses the upstream accommodation,
but applies labels only after its stricter gate:

- `shader-pipeline.mjs:402-426`: every trusted shader key must complete, and
  SHA-256 over sorted filename bytes plus each normalized MSL's raw SHA-256,
  truncated to the protocol's 16 hex digits, must equal SHADER_SRC.
- `production-shaders.mjs:323-355`: require all 6,927 results and the source
  digest before applying the shell chain to directories, JSON and the c1 index.
- Existing reflection, readable-tile derivation, compiled-library validation,
  genuine compiler receipts and complete output sealing remain mandatory.

Therefore exact reproduction of the publisher's native tool fingerprints is
not an additional requirement for consuming this release. A tag string or
matching compiler version alone is never enough. Do not rewrite any compiler
receipt or source provenance to imitate the publisher's native build.

## Production binding and remaining validation

`../../shell-v2-evidence.mjs` retains the exact independently reviewed metadata.
`../../shell-profiles.mjs` binds the closed v2 profiles to the b811 recipes.
The two existing target choices select this pair; no additional user-controlled
recipe or source revision is accepted. The integration preserves all of the
following:

1. Exact reviewed ZIP, executable, minimum OS, capacities and content-mode sites
   in these records. Never reuse old offsets or substitute caller-owned pins.
2. The b811 release's art and overlay recipe revision, not later e375 behavior.
   The separately prepared `RELEASE_ART_REVISION` and `RELEASE_OVERLAY_REVISION`
   both equal the full b811 commit. Its normalized native overlay source
   fingerprint is `243ab3eec668192415561f806ebbf2e670ea5a8a83aee8b72f92021a23989763`.
   The authored browser implementation has its own source closure; do not
   relabel that as native-source identity.
3. The unchanged complete per-conversion shader-source, reflection, compiled
   library, program-content, asset and final-package checks. Missing or
   mismatched evidence must still stop packaging before output publication.

The optional ASTC output inventory remains exact: 11 files for explicit legacy
profiles, or 15 for b811, including both Xbox markers and both bounded overlay
manifests. Missing/extra files, later-source revisions, and PlayStation markers
are rejected. These structural checks do not claim opaque archive hash
authentication or rendered parity.

Static loading of both public ZIPs passed the actual production-profile loader,
including target metadata and the complete 6,927-key catalog. Synthetic tests
cover recipe propagation, mixed-profile rejection and package boundaries. No
v2 conversion, browser execution, gameplay or real-device success is claimed.

The b811 shell supports the release-era Korean/Xbox UI recipe, not the later
PlayStation glyph or optional iOS VP8 additions. No VP8/FFmpeg symbols or strings
were observed in these binaries; source/release chronology independently
places those iOS additions later. The Android-only embedded overlay fingerprint
validator is not an iOS-host capability: the public iOS loader does not consume
`overlay.manifest`. D2R's own source and output integrity gates still apply.

Fresh fork-compiler release acceptance is a separate boundary requiring its
authenticated release/source/receipt and the strict D2R canary. Neither these
static shell results nor the earlier unspecified user-reported IPA device
success validates that new compiler or v2 shell execution.

## Recheck downloaded public bytes without execution

```sh
python3 web/toolchain/shell-release-evidence/verify-v2-shell-evidence.py \
  --profile v2.0.0 --archive /path/to/D2RMobile-shell-build-input.zip
python3 web/toolchain/shell-release-evidence/verify-v2-shell-evidence.py \
  --profile v2.0.0-ios18 --archive /path/to/D2RMobile-shell-ios18-build-input.zip
```

The helper reads the authenticated ZIP, verifies all members and selected
Mach-O evidence, and hashes the four-byte-only derivation in memory. It never
writes or executes an executable. Its byte checks complement, not replace, the
independent control-flow review and later device validation.
