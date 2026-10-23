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

## Optional browser-local IPA signing

The separate `ipa-signing` group contains the closed `signing-worker.mjs`,
`zsign.wasm`, zsign/port/OpenSSL licenses and notice, source pins, patch report,
compiler version, and native build report. The generated `zsign.mjs` factory is
statically bundled into that worker, not shipped as a second logical runtime
asset. Assembly checks its receipt too. Missing, partial, stale or mismatched
native outputs fail packaging; source-only integration is not a usable signer.
Existing manifests without this group remain valid for unsigned generation.

The browser UI uses `prepareBrowserPackager({ editableOptions: true })` to preload
the verified signing closure before private input, without starting a signer. The
user can enable signing until generation without reloading or reselecting the
folder. `signingReady` means its independent public-asset factory is available;
`prepareSigning()` initializes a worker before credential reads. The eager API
`prepareBrowserPackager({ signing: true })` still initializes zsign at bootstrap.
`session.takeIpaSigningFactory()` transfers ownership once. Eager callers reuse
the bootstrap worker for the first attempt; deferred first attempts and retries
create one-shot workers from the factory's retained verified worker Blob and
bounded WASM copy. No further asset downloads occur. Startup Blob URLs are revoked
after initialization, including failure and cancellation paths.

Before reading P12/profile files into credential buffers, await
`packager.prepareSigning({ signal })` to obtain an owned `{ sign, close }` attempt.
Only then call `attempt.sign({ ipa, credentials, signal, onProgress })`; always
call its synchronous, idempotent `close()` in a finally block, including when file
validation or reading fails before signing. An attempt is one-shot and only one
may be outstanding. Direct `packager.sign(...)` delegates only to an already
prepared attempt and never starts a worker or downloads anything implicitly.

Conversion cleanup releases the conversion runtime without closing the signing
factory. Signing failure/cancellation leaves the exact committed unsigned Blob
available for a retry with fresh credential inputs, without regenerating NSPs,
exporting resources again, retaining prior credentials, or keeping conversion
runtimes alive. Between completed attempts, only verified public worker/WASM
assets remain in the factory. Explicit `packager.close()` or unmount aborts any
pending initialization/signing, terminates its worker, clears the retained WASM
copy and drops the worker Blob. The UI also closes the factory after successful
signing or a nonretryable generation failure. The whole-packager cleanup promise
remains idempotent and rejection-observed; awaiting it still reports cleanup errors.

A successful attempt returns a separate signed Blob and filename. No account
login, upload, persistent credential storage, lazy runtime download or automatic
certificate lookup is part of this flow. JavaScript password strings cannot be
reliably zeroized; the UI clears its references and inputs after every attempt.

This is an architectural no-network-request boundary for the signing code, not
page-level CSP lockdown or a claim of universal browser network containment.
The prototype intentionally does not reintroduce page-level CSP sealing. Native
build/smoke receipts and synthetic lifecycle tests do not establish browser
signing, Apple profile acceptance, device installation or real-game parity.

Both optional groups can be selected independently or together. Identical bytes
shared only by optional groups use their own deterministic transport partition,
not either group's unique payload and not the default common partition. This
prevents selecting one group from downloading the other's unique bytes.
Identical content that also has a common owner still belongs to common storage.
The source-only policy now lists 55 audited logical copies, including the seven
signing client, contract, helper, worker-entry and generated-factory modules.
