# Shell profile records

Production bundles the public v2.0.0 iOS 26 and iOS 18 shells, selected through the closed registry in `../../shell-profiles.mjs`. See [v2 profiles](V2_PROFILES.md) for source, target, capacity and shader-chain requirements.

The JSON records bind exact release URLs, archive/member hashes, executable targets, generated-table capacities and content-mode derivations. Keep them synchronized with the registry; never accept pins supplied by an input package. Shell binaries are downloaded and verified during runtime assembly, not committed here.

Legacy v1.0.18 records remain for explicit legacy profiles and source comparison. [Derived capacities](DERIVED_CAPACITIES.md) and the [legacy iOS 18 profile](IOS18_PROFILE.md) explain those binary contracts. `compare-source.py` and `test-source-comparison.py` inspect the pinned source comparison without running a shell.

A chain label may be aligned only after the complete normalized shader-source digest matches the shell's `SHADER_SRC`. Matching a compiler version or label alone is insufficient. See [production flow](../../PRODUCTION_FLOW.md).
