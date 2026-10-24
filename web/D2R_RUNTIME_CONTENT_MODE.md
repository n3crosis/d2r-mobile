# Optional expansion and pinned runtime data policy

Current first-run input policy: put base NSP, update NSP(s), `prod.keys`, and optional
`title.keys` in one folder. The known Warlock DLC is optional; if present it must
pass the same authenticated metadata and independently measured content checks.
No DLC metadata is synthesized. No legal ownership claim follows from package
authentication.

Production uses `contentMode: "optional-warlock"` in the trusted profile/adapter.
`d2r-expansion-policy.mjs` also retains explicit `base-update-only` (rejects DLC)
and `warlock` (requires it) modes. The selection shape is unchanged. The worker
accepts the mode option and reruns policy against retained authenticated records.
The client already forwards selection options without filtering this field.
Base/update IDs, version association, NCA signatures, hashes, and exact supported
executable checks remain in force. Absence of DLC does not relax any of them.

## Native source and exact pinned derivation

`dm/host/hle_misc.c:18` uses `static int v = -1` in `aoc_owned()`. Only when
`v < 0` does it consult `DM_AOC_OWNED`; Count/List use the cached result. The
existing process-environment value `DM_AOC_OWNED=0` reports zero add-ons, but the
ordinary iOS shell has no bundled configuration hook to set that value.

The exact v1.0.18 content-free `DmIOS` executable has a non-STAB `N_SECT`
`_aoc_owned.v` symbol in file-backed `__DATA,__data`. Read-only inspection found:

- Original size: 2327536 bytes.
- Original SHA-256:
  `2d4b0299ff5d4856e12e14948da369ca35c27d2d0afd78dfed44cf4f6442b9ba`.
- Symbol virtual address: `0x10018ef78`; derived file offset: `0x18ef78`.
- Original four-byte initializer: `ff ff ff ff`.
- No-DLC initializer: `00 00 00 00`.
- Deterministic resulting SHA-256:
  `0d6bae055ea5ee0571ff592ece73b90e9f3e7399fa8c59216f70a8f3707988fa`.

`deriveD2rRuntimeContentMode` in `d2r-runtime-content-mode.mjs` clones the original
bytes, verifies exact whole-file identity, parses load commands and symbols,
requires a unique real definition in the expected file-backed section, derives
and checks the address/offset, and requires the exact initializer. It changes
only those four data bytes for effective `base-update-only`, forcing the existing
source-defined cache to return zero without enabling or fabricating ownership.
Effective `warlock` preserves the original bytes. Unsupported binaries reject.
No instructions are patched.

The caller must derive effective mode from the authenticated selection, after
original shell validation and before writing derived output. It must register
the returned explicit derivation receipt and update only this executable's
expected output identity. It must not bypass unrelated shell hashes or mutate
shared original shell entries. The receipt is descriptive provenance, not a
standalone trust token for arbitrary caller data.

Changing the initializer invalidates existing code signatures. Output remains
unsigned and requires user signing after all packaging modifications. Base-only
gameplay remains unverified; this source-backed change establishes truthful
no-DLC service responses, not device-playability evidence.
