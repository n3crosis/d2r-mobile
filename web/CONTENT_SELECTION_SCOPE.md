# Decrypted content-metadata selection boundary

This module is **not an NSP decryptor, supported-game detector, patch applicator,
or IPA exporter**. It has no user keys, copyrighted fixtures, browser persistence,
network calls, external packages, or dependency changes. All tests are synthetic.

## Format references

- [Atmosphère packaged CNMT header and extended headers](https://github.com/Atmosphere-NX/Atmosphere/blob/master/libraries/libstratosphere/include/stratosphere/ncm/ncm_content_meta.hpp):
  packaged header is 0x20 bytes; application extension is 0x10; patch extension
  is 0x18; add-on extensions are 0x10 legacy / 0x18 current. Application holds
  patch ID; patch and DLC hold application ID. Table address calculations and
  packaged size include a trailing digest. Patch extended-data size is at 0x2c.
- [ContentInfo](https://github.com/Atmosphere-NX/Atmosphere/blob/master/libraries/libstratosphere/include/stratosphere/ncm/ncm_content_info.hpp)
  and [PackagedContentInfo](https://github.com/Atmosphere-NX/Atmosphere/blob/master/libraries/libstratosphere/include/stratosphere/ncm/ncm_content_info_data.hpp):
  0x20 digest followed by 0x18 content info. Current layout has a 40-bit size
  followed by an attribute byte, not an unconditional 48-bit size.
- [Metadata types](https://github.com/Atmosphere-NX/Atmosphere/blob/master/libraries/libstratosphere/include/stratosphere/ncm/ncm_content_meta_type.hpp)
  and [content types](https://github.com/Atmosphere-NX/Atmosphere/blob/master/libraries/libstratosphere/include/stratosphere/ncm/ncm_content_type.hpp)
  distinguish full Patch metadata from Delta and distinguish DeltaFragment from
  Program/Data content. This implementation rejects unsupported types.
- Local `dm/tools/extract_game.sh` uses Program title ID
  `0100726014352000`, detects BKTR, then checks extracted main/sdk/subsdk0 hashes
  for the native project's supported build. It does not parse CNMT. Its loop's
  last-match behavior must not become the browser selection algorithm.

The external source links describe format evidence, not imported implementation
code. This is a separately implemented bounded JS parser. Links reference upstream
master as inspected; future layout extensions must be reviewed, not auto-accepted.

## API and trust boundary

`parseCnmt(Uint8Array)` accepts **already decrypted packaged CNMT bytes** from the
Meta NCA's PFS0, never an encrypted NCA, NSP or filename. The upstream decryptor
and archive reader are separate. It returns exact BigInt title/application IDs,
32-bit versions, content IDs, full expected SHA-256, 40-bit sizes, content type and
ID offset, required versions, and application/patch association.

Bounds are 16 MiB per CNMT and 4096 contents/meta records. Every table, opaque
patch extended-data region, and 32-byte trailing digest must fit exactly. A
trailing CNMT digest is exposed with `digestVerified: false`: **reading a digest
is not verifying it**. This parser neither validates NCA signatures nor authenticates
CNMT. The upstream core must establish metadata integrity. Opaque patch extended
data is bounded but not interpreted or applied. Nonzero dependency tables,
non-default modern DLC accessibility, data patches, partial installs, unknown
platforms/types, and delta fragments fail closed. Old 48-bit-size interpretations
are not supported as a separate format mode.

`resolveContentSelection(records, inventory, options?)` accepts explicit records
with `type` (`Application`, `Patch`, `AddOnContent`), `titleId`, `applicationId`,
`version`, and nonempty `contents`. Applications additionally require `patchId`.
DLC can declare `requiredApplicationVersion`; nonzero `dataPatchId` is rejected.
Integers must be BigInt or safe integral numbers in their field's unsigned range;
strings and lossy Numbers are rejected. Content entries contain `contentId`
(32 hex), `sha256` (64 hex), `size`, `type`, `idOffset`, optional `attributes`.

Inventory entries must contain unique `contentId` values and measured `size`.
Every required selected content is matched by ID and size, without claiming
whole-content integrity. Full base/update NCA hashing and its browser/API option
have been removed. The extraction engine still hashes the small known Warlock
add-on and matches its digest against the content ID and CNMT digest.
NCA-header identity, sections and signatures remain upstream responsibilities.
No content ID is inferred from the filename and no NCA is chosen by array order.

Only one application target is permitted. Patches must link to that application
and to its explicit patch ID; DLC must link to the same application and meet its
required application version. Missing base, orphan, duplicate content IDs/slots,
conflicting same-version metadata and conflicting inventory identities fail.
Exact duplicate metadata/inventory is idempotent. A supplied CNMT digest also
participates in same-version conflict checks (it is still not authenticated here).

Multiple versions require explicit `baseVersion`, `patchVersion`, or
`dlcVersions` keyed by zero-padded 16-character lowercase hexadecimal DLC title
ID. Error messages list versions numerically, not lexically. No implicit newest
selection is made. Every included DLC title is selected separately; DLC is never
silently overlaid on the base or patch. Unselected version payloads need not be
present, but conflicting inventory identities still fail globally.

The returned `base`, optional `patch`, separate `dlc` array and deduplicated
`requiredContents` are metadata plans only. `gameCompatibility: "unknown"`,
`requiresExecutableAllowlist: true`, and `patchApplied: false` are deliberate.
The mapping of the native supported display version to CNMT integer versions is
not established. Never replace the native executable hash allowlist with an ID,
CNMT version, or “newest available” check.
