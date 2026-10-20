# Optional public codec assets

Runtime assembly includes the complete optional producer closure, but the default
setup does not download its codecs or create its worker. This internal setup
option does not enable UI or establish browser, device or full-game parity.

## Closed inventory contract

`web/runtime-asset-groups.mjs` defines the exact `legacy-astc` producer group:

- One closed, bundled producer worker.
- Arm ASTC factory JS and WASM, license, source commit and compiler receipt.
- Standalone streaming SHA-256 WASM, both mbedTLS license files and build report.

Every group asset carries `optionalGroup: "legacy-astc"`. A group is either absent
or complete; unknown groups, unknown paths, missing tags and partial groups fail
validation. Common dependencies and shell archives cannot be marked optional.
The existing `toolchain/asset-runtime-js/dist/png-codec.wasm` remains common and
must be reused, not copied into the optional group. SHA's build report already
contains its source pins; ASTC's existing source/compiler receipts are retained.

## Transport and selection

Assembly calls `createRuntimeTransport(contents, { assets })` with the
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

## Producer setup and lifetime

The trusted caller opts in with
`prepareSealedRuntime({ ..., optionalGroups: ["legacy-astc"] })`. Before accepting
private input, bootstrap snapshots the selection, verifies every selected public
asset, initializes the producer from transferred ASTC JS/WASM, SHA WASM and the
existing PNG WASM, and finishes all requested worker startup checks. The ASTC
factory receives verified `wasmBinary`, an exact `locateFile` Blob URL and an
explicit byte-instantiation hook. Network fallback is forbidden in the producer.

Only then can `session.createAstcProducerClient()` acquire the prepared producer
once. An unprepared, already-acquired or closed session fails without fetching.
The client exposes `produce(extracted, selection, options)` and `close()`. Keep
its File lease alive until packaging and final output commit finish. Await client
and session cleanup; `session.close()` invalidates the session and terminates
workers immediately, while returning an observable cleanup promise.

The producer client and its authentication dependencies share the common
frontend bundle, preserving one set of private provenance registries. Their raw
source copies are not runtime byte dependencies and are omitted from transport;
the source modules remain in the repository. Only the isolated worker is bundled
into the optional group. Assembly validates compiler/source receipts and SHA
local source hashes before including the complete group.

Focused tests use synthetic records/bytes and isolated bootstrap mocks. They
establish inventory closure, default-download isolation, deduplication,
transport integrity, startup ordering, cleanup and unchanged shell selection.
A real Bun bundle closes the producer worker's static imports. These checks do
not establish actual compiler output, browser execution or device parity.

## Local source-build size snapshot

Measured with Bun 1.4.3 on 2026-10-20 during this integration, not from a deployed
payload: the optional producer worker is 88,216 minified bytes, or 30,767 bytes
with gzip level 9, with zero remaining literal imports. Its dynamic factory
import is the verified initialization Blob described above.

Two isolated frontend builds differed only by substituting a measurement-only
stub for the producer client. The real client adds 15,880 minified bytes and
5,318 gzip bytes to the common frontend. Both builds emit one JavaScript bundle;
ASTC/WASM codecs remain outside it. This measures shared client/ownership logic,
not optional binary transfer size or a deployed release total. The earlier raw
`clients.mjs` import-closure audit established dependency completeness, not a
production consumer for those transported sources. Production imports that
client at frontend build time; its runtime plans consume only verified worker,
codec and data bytes. The current assembly omits 48 audited source-only copies,
while retaining every component-submanifest asset, license, WASM and provenance
record. See `runtime-build/payload-policy.mjs` for the exact build-only policy.
