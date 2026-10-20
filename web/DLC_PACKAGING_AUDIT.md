# D2R expansion input audit

Repository inspection: 2026-10-20. This is a requirements audit, not enabled DLC
support. No game packages, keys, tickets, or executable dumps were inspected.

## What the original project actually does

- `dm/host/hle_misc.c:8-18` identifies Reign of the Warlock as add-on title
  `0100726014353001`, index 1 of application `0100726014352000`. Its comments
  describe an approximately 100 KB unlock credential, with the expansion's assets
  already in the main RomFS and no `MountAddOnContent` import in the supported main.
  This is upstream source testimony, not independently measured package evidence.
  In particular, the approximate size is **not** a validated format or allowlist.
- The actual `aoc_owned()` implementation defaults to true. Count/list report
  one installed add-on, index 1. `DM_AOC_OWNED=0` is a test opt-out, not a check of
  a supplied package, ticket, or purchase. `hle_sdkinit.c:15` uses this HLE.
- `dm/tools/extract_game.sh:39-53` selects only Program NCAs with application ID
  `0100726014352000`, layers the BKTR update over the base, and extracts ExeFS and
  RomFS. It never reads add-on metadata or installs separate add-on content.
  Its final checks require the three exact executable hashes and
  `RomFS/data/build_manifest.psv`.
- `docs/GAME_FILES.md` requires ownership of the base, update, and expansion and
  calls the non-expansion configuration unsupported. Its output contract contains
  only the three executable files and updated RomFS data.
- `dm/ios/tools/shell_build.sh:55-74` has no separate add-on installation or
  ownership artifact in its shell manifest contract.

Consequently, a separate DLC RomFS overlay is not justified by this repository.
The documented supported expansion is an unlock-only input, not an asset tree to
merge into Program RomFS. That does **not** establish ownership or justify copying
the native default-owned assumption into a new browser workflow.

## Existing browser trust boundaries

`toolchain/nsp-extract-spike/extraction-engine.mjs` independently hashes whole
NCAs, checks their fixed header signatures, opens authenticated Meta sections, and
passes parsed CNMT records to `content-selection.mjs`. The resolver checks add-on
application association, required application version, and every selected content
ID/hash/size against measured inventory. It keeps add-ons separate and rejects
unsupported data patches and accessibilities.

Neither an authenticated content hash nor a signed NCA proves that the current
user bought it. Ordinary `.tik` and certificate NSP entries are ignored by this
engine; it has no purchase/license verification service. Possession of a supplied
`title.keys` file is likewise not a purchase proof.

Both engine selection and `extraction-job-adapter.mjs` currently reject selected
DLC. The adapter does not forward `dlcVersions`. Removing just one rejection is
therefore neither coherent support nor an ownership solution. With no DLC in the
folder, these particular rejection gates do not ensure expansion ownership.

## Scoped implementation requirements

1. Guide the user to put their own base NSP, supported update NSP, expansion NSP,
   `prod.keys`, and `title.keys` together. Do not call the expansion optional for
   this supported product. Keep keys and game inputs local and out of outputs.
2. Retain authenticated CNMT selection, independent full-content hashing, strict
   application association, explicit ambiguous-version choices, and executable
   hash allowlisting. Do not infer expansion identity from a filename, a small
   package size, a user-editable `owned` flag, or the HLE default.
3. Define a title-specific, reviewed classification for the known add-on ID:
   validated unlock-only content, retained as provenance and never overlaid into
   Program RomFS. Reject unknown add-ons or layouts explicitly. Do not discard
   them silently or claim generic DLC support.
4. Require the supported expansion to be present under this product contract.
   Decide and document the local ownership policy separately from content
   authentication. If owner attestation is used, describe it honestly as an
   attestation, not cryptographic license verification. Do not fabricate tickets,
   keys, receipts, or ownership evidence.
5. Coordinate the engine and adapter changes: forward explicit `dlcVersions`,
   rerun selection in the worker, preserve canonical selection comparison, and
   produce a bounded, non-secret classification report. The native/runtime owner
   must review how the content-free shell is permitted to report expansion
   availability; an unconditional default is not evidence of ownership.
6. Add synthetic regression coverage for missing expansion, wrong application,
   unknown add-on ID, unsupported content layout, incompatible required version,
   conflicting or missing content, ambiguous add-on versions, altered selections,
   and proof that add-on data never reaches the Program RomFS overlay. Synthetic
   passing tests must not be presented as real-game/license validation.

## Exact evidence still missing before enabling

- A non-secret, owner-authorized local inspection of the known add-on's
  authenticated CNMT and content layout: version(s), declared content types and
  slots, accessibility/data-patch fields, associated NCA header identities and
  required application version. No keys or game bytes need be uploaded.
- Independent confirmation that the exact supported executable has no separate
  add-on mount/resource dependency, beyond the upstream HLE comment.
- A reviewed ownership/availability policy and runtime-shell contract that does
  not infer a purchase from a title ID, hash, size, or existing default-owned HLE.
- End-to-end parity using an owner's legitimate local inputs. None was performed
  in this audit.

## Implemented local input policy

Following review, `d2r-expansion-policy.mjs` now provides the pure
`resolveD2rExpansionSelection(records, inventory, options)` gate. It reruns the
generic resolver and requires application `0100726014352000`, patch
`0100726014352800`, and exactly the known add-on `0100726014353001`. Missing or
unknown DLC rejects. Its conservative accepted add-on shape is exactly one
nonempty Data content at slot zero with default attributes. This shape is an
explicit implementation limit, **not measured evidence of a real package**.

The caller must provide its retained authenticated metadata and independently
measured complete content inventory. There is no new `authenticated` or `owned`
Boolean accepted as proof. The returned selection retains DLC in requiredContents
and keeps it separate from Program assets. The function establishes local package
input eligibility only, not legal ownership, ticket validity, actual executable
compatibility, or authority to enable native ownership.

Six synthetic tests cover the accepted shape, missing update/expansion, unknown
expansion/application, associations, version requirements, incomplete/unverified/
conflicting inventory, unsupported layout, and explicit DLC version choices.
They pass locally; file-scoped ESLint and Prettier also pass.

Engine and adapter owners have been given the API and caller trust contract.
They must integrate it together before removing their blanket DLC rejections.
The native default is unchanged. UI generation must remain disabled until its
broader release gates are satisfied. No engine, client, adapter, or native
entitlement behavior was changed by this audit or pure policy module.
