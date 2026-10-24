# Exact v1.0.18 shell derived-table capacities

The registry `v1.0.18-derived-capacities.mjs` exports immutable
`SHELL_DERIVED_CAPACITIES`, bound to this exact archive:

- Shell ZIP SHA-256: `a383552871851ddb5923033639358e2a3c205ae411676e6538cd098743bbe37b`
- `Payload/DmIOS.app/DmIOS` SHA-256: `2d4b0299ff5d4856e12e14948da369ca35c27d2d0afd78dfed44cf4f6442b9ba`
- EXP: **100 scalar values**, not 100 lines (native emits ten values per EXP line).
- VTPART: **11 rows**.
- VTROW: **562 rows**.
- VTSET: **35 rows**.
- TAROW: **429 rows**.

These numbers come from the actual compiled bounds/equality checks in the
publisher's public Mach-O, not from input-derived counts, adjacent symbol
spacing, BSS extent/alignment, fixture expectations, or an assumed source tag.
The binary was read from the already downloaded public ZIP, never executed or
installed. No game inputs were inspected. ARM64 instructions were disassembled
with official-registry Capstone 5.0.6; exact instruction bytes, file offsets,
virtual addresses, symbol locations, function hashes and source hash are
included in the JS record so the conclusions can be independently reviewed.

## Binary-to-source mapping

The Mach-O's LC_SYMTAB retains `_vt_part_cb`, `_vt_row_cb`, `_vt_set_cb`,
`_vt_load`, `_ta_load`, `_k_exp_load`, and the backing arrays. Named callback
functions and their actual write guards match the public release source
`dm/ios/tools/shell_stubs.py`. The latter is cited and hashed in the registry;
variable table sizes in its templates are **not** treated as independently known
until recovered from the binary.

For this thin arm64 executable, these instructions are in `__TEXT,__text`,
whose mapping makes each reported virtual address equal to file offset plus
`0x100000000`. Data/BSS symbol spacing is not used to determine any capacity.

### VTPART = 11

`_vt_part_cb` starts at `0x1000d8c04`. It reads the index from callback context,
then at file offset `0xd8c20` bytes `9f2a0071` compare w20 with 10.
`0xd8c24`, bytes `0c010054`, branches signed-greater to the return epilogue.
Only indices 0 through 10 reach the indexed pointer write at `0xd8c40`.
The independent `_vt_load` completion comparison at `0xd89d8`
(`7f2e0071`) compares the final row count with 11 and branches to the incomplete
count diagnostic on inequality. The callback is passed the `VTPART` string by
`_vt_load` at virtual address `0x100162584`.

### VTROW = 562

`_vt_row_cb` starts at `0x1000d8c50`. At `0xd8c5c`, `1fc50871` compares the
index with `0x231` (561); `0xd8c60` branches signed-greater to return.
Thus indices 0 through 561 can be written. Its address computation at `0xd8c94`
uses a 32-byte element stride, but the capacity is determined by the guard,
not the stride or allocation distance. `_vt_load` compares final row count
with `0x232` (562) at `0xd89e0`, branching on inequality at `0xd89e4`.
The callback's tag string is `VTROW` at virtual address `0x10016258b`.

### VTSET = 35

`_vt_set_cb` starts at `0x1000d8d38`. At `0xd8d54`, `9f8a0071` compares the
index with `0x22` (34); the next instruction branches signed-greater to the
return epilogue. `_vt_load` independently compares final count with `0x23`
(35) at `0xd89e8`, with the inequality diagnostic branch at `0xd89ec`.
The callback's tag string is `VTSET` at virtual address `0x100162591`.

### TAROW = 429

The row callback is inlined into `_ta_load` at `0x10001c854`. The code compares
the line prefix with `TAROW` and requires at least three fields. At `0x1ca60`,
`ffb20671` compares the running row index w23 against `0x1ac` (428).
The next instruction `ec010054` skips the write for signed-greater indices.
Accepted rows write three 32-bit fields and increment the index at `0x1ca9c`.
The final comparison at `0x1cabc` (`ffb60671`) uses `0x1ad` (429), followed by
less-than handling for missing rows and a not-equal diagnostic branch. The
missing-row fill loop and diagnostic constant also independently contain 429.
No array spacing is needed to infer this capacity.

### EXP = 100

The callback is inlined into `_k_exp_load` at `0x1000705e0`. The line prefix
match is `EXP`; w27 starts at zero. At `0x70788`, bytes `ff9201f1` compare the
running index x23 with `0x64` (100), followed by loading literal 100 into w8.
The conditional select at `0x70790` chooses the existing index if already
above 100, otherwise 100. The equality branch at `0x7079c` bypasses further
writes once the limit is reached. The write at `0x707b4` is an indexed 32-bit
store into `_k_exp`, and each accepted scalar increments the index. This is the
compiled form of the public stub's explicit `k_exp[100]` / `*i < 100` contract.

## Integration boundary

Use these counts only after the selected shell's complete ZIP hash equals
`SHELL_DERIVED_CAPACITIES.shellSha256`, with its expected executable hash also
verified by the shell reader. Compare the production generator's actual
EXP/VTPART/VTROW/VTSET/TAROW counts for exact equality before returning asset
entries. Reject missing counts, unknown shell hashes or mismatch; never use
input-derived counts as a substitute shell-capacity declaration.

This proves capacities for this exact executable only. It does not prove that
individual table values are correct, validate shader-source equivalence, certify
game runtime behavior, or authorize changing any native shell/chain/header.
Supplementary `_vt_load` instructions appear alongside each callback's evidence;
the callback function hash covers only its explicitly recorded function range.
