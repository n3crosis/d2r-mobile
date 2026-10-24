# v2.0.0 shell profiles

Production uses the public iOS 26 and iOS 18 shells from the [official v2.0.0 release](https://github.com/jhaizhou-ops/d2r-mobile/releases/tag/v2.0.0), bound to release source `b811b90172f4eb40ec1bc89d903308e0c5ab88d0`. Explicit legacy profiles retain separate paths.

## Exact profile binding

`v2.0.0.json` and `v2.0.0-ios18.json` record exact URLs, archive and member sizes, hashes and modes. `shell-v2-evidence.mjs` and `shell-profiles.mjs` bind those records to the source recipes. Both plist and Mach-O targets must match the profile. Do not reuse offsets or accept caller-provided pins.

The no-DLC derivation changes only the unique `_aoc_owned.v` initializer in file-backed `__DATA,__data` from -1 to zero. Original hash, symbol, section, offset, preimage and resulting hash are all checked. The modification invalidates the original executable signature; the IPA must be signed before installation.

Both hosts require EXP 100 values, VTPART 11 rows, VTROW 562 rows, VTSET 35 rows and TAROW 429 rows. Capacity records retain the function boundaries, hashes and instruction windows used to derive these counts. Never infer capacities from array spacing or generated inputs.

## Shader chain compatibility

The shells require `CHAIN=420aeb7c8bc6`, `PRODUCT=3.3.94012-r44`, `SHADER_SRC=be59c864f087b377` and SPIRV-Cross `1.4.363.0`.

The publisher's exact build-time tool fingerprints are not reproduced by the committed chain inputs. As in upstream `d2rm_pack.py`, the browser may align the directory, per-shader JSON and c1-index chain labels only after the complete normalized shader-source digest matches `SHADER_SRC`. Matching a label or compiler version alone is insufficient. Reflection, compiled-library checks, authentic compiler receipts and complete output validation remain mandatory; never rewrite provenance to imitate a native build.

## Recipe compatibility

The two production targets select matching b811 art and overlay revisions. No arbitrary source revision is exposed to users. Optional ASTC output inventory is exact: 15 files for b811, including both Xbox markers and both overlay manifests, versus 11 for explicit legacy profiles. Missing or extra files are rejected.

The b811 recipe contains Korean/Xbox UI, not later PlayStation glyphs or iOS VP8 additions. The public iOS loader does not consume Android's `overlay.manifest` validation path; browser source and output integrity checks still apply.

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
