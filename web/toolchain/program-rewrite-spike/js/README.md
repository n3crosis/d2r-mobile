# Python-free program rewriting

These modules port the numerical/relocation core of the source-pinned
`dm/tools/patch_nso.py`. They use the existing real Capstone/LZ4 WASM binding;
there is no substitute ARM64 decoder and no Python runtime requirement.

- `binary.mjs`: bounded NSO segment loading, little-endian image operations,
  exact byte preimage assertions, native Capstone/LZ4 access.
- `arm64.mjs`: instruction encoders, register parsing/substitution, SP writeback
  interpretation, and branch range assertions.
- `relocations.mjs`: all rewrite block types, including exclusive windows and
  jump-table landing pads. Patch allocation is bounded by the output budget.
- The separate orchestration/rule layer owns source hash gating, registered input
  eligibility, function-boundary scans, rule preimages, and final output files.

Decoded immediate operands remain BigInt when they exceed JS's exact integer
range. Relocation addresses must be exact safe integers. Instruction words are
normalized to unsigned 32-bit values before crossing the native boundary.
Capstone's stop-on-invalid-instruction behavior is preserved. Scratch register
substitution is accepted only if re-decoding matches both mnemonic and operands.

A small local source comparison exercised ten relocation calls using the actual
Capstone WASM from an existing CI artifact. Emitted bytes, key fixups and service
records matched the upstream Python functions. It does not establish real-game
or device validation. The orchestration/output layer is now integrated into the JS worker; runtime
source and input eligibility checks remain mandatory.

## Remaining Python removal boundaries

Program rewriting is only one consumer of Pyodide. The asset worker still runs:

1. `core.py`, `derived.py`, `vault.py` and `vault_original.py`: operation dispatch,
   table/text parsing and generated header/TSV outputs.
2. `overlay_recipe.py`, `overlay_recipe_sources.py`, `casc_overlay.py` and its
   original module: JSON/TSV overlay edits and content recipes.
3. `native_art.py`, `hud.py`, `map_goal.py`, `mercenary.py`, `remaining_art.py` and
   their source-pinned original modules: image composition, font layout and PNG.
4. `art_pixels.py`: now only a bridge to dependency-free typed-array kernels.
   NumPy has already been removed from the production closure.

The first two groups can move to bounded JS transforms without introducing a
runtime library. The third requires a deliberate Pillow replacement for exact
font metrics, rasterization, resize/composite behavior and PNG I/O. Removing the
program's Python loader alone does not remove a deduplicated Pyodide payload while
the asset worker still requires it. .NET shader translation is unchanged.
