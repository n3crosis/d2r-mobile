# Registered game and shell compatibility

中文: [PROGRAM_COMPATIBILITY.zh-CN.md](PROGRAM_COMPATIBILITY.zh-CN.md)

The browser currently registers one exact game executable set: Switch D2R
3.3.94012, with `main` and `sdk` full-file SHA-256 values recorded from native
extraction checks. Its two authenticated host profiles are v1.0.18 for iOS 26
and iOS 18. This change does not add another game release, a third shell, or
proof of device/gameplay compatibility.

## What is extensible now

`program-release-catalog.mjs` is the repository-owned release registry. The
program adapter snapshots both provenance-issued input buffers before hashing,
then selects a release from the complete ordered module digest tuple, rather
than assuming the singleton release. Known `main` plus unknown or mismatched
`sdk` is rejected as a module-release mismatch; wholly unknown inputs are
rejected as an unsupported version. Partial matches never authorize rewriting.

Each shell has an explicit immutable `programReleaseIds` allowlist. A registered
program not assigned to that shell is rejected before worker creation. Profile
IDs and read-only UI compatibility summaries are derived from the registry.
The worker independently looks up the same repository release and rechecks its
module digest, build ID and pinned rewriter source. The source digest and the
native version-specific rewrite rules have not changed.

These are repository extension points, not a runtime registration API. A caller
cannot provide a replacement catalog, a version string, a custom shell manifest,
a source hash or an offset to override the production gates. The synthetic test
catalog route remains isolated from the sealed application client.
`diagnoseRegisteredProgramDigests` compares digest claims only; it is not a
provenance authenticator. Only the adapter's measured owned snapshots and the
worker's independently checked bytes can enter rewriting.

`program-compatibility.mjs` publishes the registered inventory and fixed,
privacy-safe diagnostic codes. The summary explicitly states that arbitrary
game versions, custom shell imports, browser native-source rebuilding and real
game verification are not supported. Diagnostics do not expose private file
names, input hashes, raw exceptions or keys.

## Adding a real game release

A new catalog row alone is not sufficient. Native source remains tied to
3.3.94012: `patch_nso.py` rule addresses and build-ID checks, and the host's
function/data addresses and table layouts, are version-specific. A new release
requires all of the following before its entry can be enabled:

1. Independently established full `main`/`sdk` hashes, exact module order, title
   identity and build IDs where available. Do not substitute version labels or
   copied file names for identities.
2. A reviewed native rewrite ruleset and host ABI for those exact executable
   bytes, with a matching generated browser rule/source pin and reproducible
   synthetic parity evidence. A changed native source requires a new sealed
   runtime build; this patch does not run or supply one.
3. Matching shader catalogs, source/compiler contracts, generated-asset
   provenance and derived-table dimensions for the selected host.
4. A separately inspected and authenticated compatible shell profile whose
   explicit program allowlist names this release, followed by local private-input
   and device acceptance. Repository registration alone is not runtime proof.

## Adding a real shell or supporting a user-supplied shell

Arbitrary shell import is deliberately not enabled. A well-formed ZIP, plausible
Mach-O target or user-supplied self-hash cannot establish native ABI compatibility
or independently authenticate its contents. Supporting a new shell requires:

- A content-free public archive with independently established publisher/source
  provenance, archive size/hash, safe complete entry inventory and per-file
  hashes; observed plist/Mach-O deployment target and executable identity.
- Actual build/source/toolchain settings and dependency closure, not just a
  release tag. The existing recorded source-versus-published-shell provenance
  gap must not be obscured by accepting self-declared metadata.
- Independently inspected host capacities, Guest/fixup/gate ABI, product/chain,
  full shader digest, compiler version and required asset manifests. If the
  no-DLC derivation is retained, its unique symbol/section/offset, original bytes
  and independently pinned complete derived executable hash are also required.
- A reviewed `shell-profiles.mjs` record, explicit program bindings, independent
  `runtime-build/package.mjs` download/build pins and evidence paths. All remain
  cross-checked; adding a profile does not bypass archive integrity checks.
- Synthetic rejection/parity checks and separate private-input/device acceptance.

The supplied shell cannot define its own trust root. A future local shell route
would need an independently trusted registration/provenance process first.

## Source rebuilding is separate

Recompiling arbitrary iOS host source in Chrome would need an actual compatible
compiler/linker, Apple SDK/framework interfaces, Objective-C/native dependencies,
resource tooling and reproducible build/provenance pipeline. Importing a binary,
changing a deployment field or disabling a hash is not that toolchain. No native,
compiler, Xcode, simulator, GPU or browser build was run for this change.

Focused Node tests cover complete-tuple matching, malformed/partial rejection,
immutable registry/profile bindings, fixed-code privacy, pre-worker rejection,
independent build-ID checks, worker rejection and existing buffer cleanup. Any
substituted digest in a synthetic test is explicitly marked and is never real
game evidence.
