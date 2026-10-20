# ZIP shell loader adapter

`createShellLoader({ source, releaseId, resolveTrustedRelease, inspectTargetOS })`
returns coordinator-compatible `loadShell({ signal })`. It is not registered in
the UI and supplies no other packaging capability.

## Required trust boundaries

Both callbacks are mandatory; neither has a fallback:

1. `resolveTrustedRelease(releaseId, { signal })` independently authenticates a
   release registry and returns `{ verified: true, releaseId, trustedRecipe,
files }`. Every file/directory has exact `path`, `size`, `mode` and lowercase
   decoded-content `sha256`. This is a trusted-host assertion, not a signature
   verifier. Never construct it from ZIP contents or treat untrusted JSON's
   `verified` boolean as evidence. No real registry, keys, release records,
   downloads or guessed supported releases are shipped.
2. `inspectTargetOS({ base, entries, readEntry, signal })` independently parses
   verified executable/plist bytes and returns `{ platform, minimumVersion }`.
   It receives no recipe or shell text from which to copy an expected answer.
   The host must cross-check relevant binaries and plist declarations with a
   real parser. Tests use explicitly synthetic text, not production Mach-O.

Complete ZIP metadata must exactly match the trusted release manifest. Reads
verify ZIP CRC, decoded length and Web Crypto SHA-256 before exposing any bytes.
SHA-256 binds decoded contents to the supplied manifest but does not authenticate
that manifest. No full-archive hash/signature is claimed. Sources must remain
immutable. Metadata acceptance does not independently prove content-free status;
that assurance depends on authenticated release review.

## Result and compatibility

Returns `contract`, `entries`, `releaseId`, `bytesVerifiedOnRead: true`,
`contentVerified: false` and `installable: false`. `contract` has the original
`validateShellContract` input shape and detached frozen metadata/recipe snapshots.
`entries` have `path`, `size`, `mode`, and `chunks()`. Every iterator freshly
verifies the complete bounded entry before yielding slices of at most 64 KiB.
There is no payload cache. Only one output iterator can be active; consumers must
close abandoned iterators.

Both shell text files come from the ZIP, are hash-verified, ASCII-decoded and
bounded by the contract's 256 KiB text limit. Independent target observations and
shell metadata/manifest must match the separate recipe via the existing contract.

The current ZIP32 coordinator writer rejects explicit directories. The adapter
validates the complete original inventory, omits only directory records, then
revalidates the returned file-only contract. No files are discarded. Only
0644/0755 file permission bits are accepted; unsupported modes fail rather than
being rewritten.

ZIP-reader limits apply, including 64 MiB decoded entries. Web Crypto may copy one
entry internally; memory is bounded by entry size rather than full archive size.
The host inspector must not retain unbounded buffers. Cancellation checks surround
I/O and hashing but cannot interrupt submitted Web Crypto or an uncooperative
source read. Callback errors and abort reasons are not copied into error text.

## Readiness

This is a concrete ZIP-to-contract/streaming adapter, not a usable real release
loader by itself. Authenticated release registry acquisition and genuine
Mach-O/plist inspection remain mandatory unsupplied dependencies. No game
conversion, UI controls, signing or installability is enabled.

Focused tests use Python-generated ZIPs with only synthetic public bytes and
exercise existing writer integration, inventory/hash binding, recipe/target
mismatch, detached metadata, cancellation and concurrent stream rejection.
Full project/browser/device validation remains CI work.
