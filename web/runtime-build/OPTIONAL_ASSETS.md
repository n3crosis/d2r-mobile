# Optional public codec assets

This is inventory/transport groundwork only. Runtime assembly does not yet include
the optional codecs, `prepareSealedRuntime` does not expose an opt-in, and no
producer or UI feature is enabled by this change.

## Closed inventory contract

`web/runtime-asset-groups.mjs` defines the exact `legacy-astc` codec group:

- Arm ASTC factory JS and WASM, license, source commit and compiler receipt.
- Standalone streaming SHA-256 WASM, both mbedTLS license files and build report.

Every group asset carries `optionalGroup: "legacy-astc"`. A group is either absent
or complete; unknown groups, unknown paths, missing tags and partial groups fail
validation. Common dependencies and shell archives cannot be marked optional.
The existing `toolchain/asset-runtime-js/dist/png-codec.wasm` remains common and
must be reused, not copied into the optional group. SHA's build report already
contains its source pins; ASTC's existing source/compiler receipts are retained.

## Transport and selection

Future assembly calls `createRuntimeTransport(contents, { assets })` with the
complete tagged logical inventory. Common ownership wins when an optional
license has exactly the same digest and byte count as an existing common asset.
Remaining optional-only bytes are packed separately. Physical payloads must not
mix effective ownership groups, including packs that the current selection omits.
No additional transport schema fields are required. Without optional assets,
transport format and bytes remain unchanged.

`validateRuntimeProfileSelection(manifest, profileId, { optionalGroups: [] })`
defaults to omitting all optional groups while retaining the existing exact-shell
selection and integrity checks. Explicitly selecting `["legacy-astc"]` requires
the complete group. Both packed and old unpacked manifests remain supported;
download progress counts only selected physical bytes.

## Producer integration gate

Do not add codec assets to assembly or expose a feature until the dedicated
producer exists. Its closed worker entry and any new receipts must be deliberately
added to the registry and tests. Before accepting private input, bootstrap must
select the group, verify every public asset, initialize the producer from verified
ASTC JS/WASM, SHA WASM and the existing PNG WASM, and finish the existing worker
startup checks. No network dependency loads may occur afterward. A late request
for an unprepared producer must fail, not fetch assets on demand.

Focused tests use synthetic records/bytes only. They establish inventory closure,
default-download isolation, deduplication, transport integrity and unchanged
shell selection, not compiler, producer, browser or device parity.
