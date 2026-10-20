# Public iOS 18 host profile evidence

The closed registry in `../../shell-profiles.mjs` records two separately pinned
profiles. This does not establish device or gameplay compatibility. The default
profile and content-mode binding remain unchanged.

The [official v1.0.18 release](https://github.com/jhaizhou-ops/d2r-mobile/releases/tag/v1.0.18)
provides the public, content-free `D2RMobile-shell-ios18-build-input.zip`, asset 650503648. Its 4,880,624 bytes matched the publisher SHA-256
`e52c119ffacf8aaafd9457f92b8e57384ab04c7ce289eecd84972743d14570e4`.
No independent publisher signature was verified. The executable was not run or
installed, and no game files or keys were used or added to this repository.

Read-only ZIP inspection checked all 16 entries, CRCs, sizes, safe paths, modes,
and per-entry hashes. The plist minimum is 18.0 and Mach-O minimum is 18.0.0,
with SDK 26.5.0. No MTL4/Metal4-named undefined symbols were found; this is not
an exhaustive API compatibility proof. The recipe and required manifest match
the default shell exactly. Only DmIOS, Assets.car and Info.plist contents differ.
See `v1.0.18-ios18.json` for the complete inventory.

## Compiled capacities

`v1.0.18-ios18-derived-capacities.json` binds evidence to the legacy executable
hash, recording symbol/function hashes, exact instructions and control flow.
Already-installed Capstone 5.0.6 decoded the public host bytes without execution.
Counts were not inferred from array spacing or source template substitutions.

- EXP: 100 scalar values. The comparison at file offset 0x6f948, select and
  equality branch cap indexed writes. There is no final exact-count check in
  that native function; the browser must retain its exact generated-count gate.
- VTPART: the guard at 0xd7e10 rejects indices above 10; completion at 0xd7bc8
  compares the count with 11.
- VTROW: guard 0xd7e4c rejects indices above 561; completion 0xd7bd0 compares 562.
- VTSET: guard 0xd7f44 rejects indices above 34; completion 0xd7bd8 compares 35.
- TAROW: guard 0x1ca60 rejects indices above 428 before the three-field write;
  completion 0x1cabc compares 429, with missing-row and inequality handling.

## Content binding and Guest target

The unique non-debug `_aoc_owned.v` definition in file-backed `__DATA,__data`
is at address 0x10018ede8, file offset 0x18ede8, initialized to ffffffff.
The registry records original and four-byte-zero-derived hashes independently
from the default shell. The derivation verifies whole-file identity, the unique
symbol/section, exact offset and initializer, and the complete resulting hash.
It invalidates existing signatures and does not prove base-only gameplay.

The Guest wrapper target deliberately separates minimum OS from SDK metadata.
Legacy minimum 18.0.0 uses SDK field 26.0.0, preserving the existing handwritten
writer's declared SDK contract, not asserting an Apple SDK build. This differs
from the host's observed SDK 26.5.0. The wrapper emits no Apple API glue and
only declares libSystem; supplied instructions and host loading still require
separate acceptance. Do not lower an unknown binary's minimum or relax its hash.

The existing source/build provenance gap, complete shader digest gates and
private-input/device acceptance boundary remain unchanged. No game data,
private keys, shell archive or executable is checked in with these records.

## Candidate integration status

The loader, content-mode derivation, Guest writer and generated-output validator
accept the closed profile identity consistently. Default Guest executable and
plist bytes still match the native Python fixture. Inspection checks the SDK,
minimum target, exact canonical plist and unambiguous Mach-O command layout.
Focused synthetic checks passed. Both content modes were also derived in memory
from the pinned public iOS 18 executable with matching complete output hashes;
that check did not execute the binary or use game inputs.

The live UI and runtime archive assembly remain default-only. The second archive
is not downloaded for everybody, and no iOS 18 option is exposed yet. Profile
selection and efficient optional payload delivery are still required. This OS
profile does not implement the separate older-GPU ASTC texture-pack pipeline.
