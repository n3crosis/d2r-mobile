# Browser ARM64 rewriting and multi-module Guest assembly

Program rewriting uses dependency-free JavaScript orchestration and the existing
real Capstone ARM64/LZ4 WASM engine. It no longer loads Pyodide or executes Python
in the browser. Build-time Python audits retain exact upstream source provenance;
manual reference comparisons can still execute the original Python tools.

There are no real game inputs in this repository. No iOS execution, successful
real-game conversion, production memory qualification or playable-build claim is
made.

## Repository-registered release route

`web/program-release-catalog.mjs` records exact repository metadata from
`extract_game.sh`, `d2rm_pack.py` and `patch_nso.py`:

- Complete SHA-256 input hashes for main and sdk of version 3.3.94012.
- Main build ID `db0507f36b84200ac05f75d76ed5026f` and `touch-run-v4` rules.
- No invented SDK build ID or real-output hash.

Input hashes, build IDs, rules, module names and source pins remain fail-closed.
The JS port preserves source CUTS/OBS/PARAMS byte assertions, exclusive-window
checks, jump-table relocation and source output records. Results remain marked
`repository-registered-unverified` and `realGameVerified:false`.

`web/program-rewriter-adapter.mjs` still validates authenticated extraction
provenance, snapshots both module buffers, runs main then sdk, validates required
outputs, and passes images to the existing Guest.framework writer. Distribution
signing is not performed. A caller's claimed build ID cannot bypass admission.

## Source and runtime closure

- `js/binary.mjs`, `arm64.mjs`, `relocations.mjs`: NSO parsing, native bindings,
  encoders and instruction relocation.
- `js/rewrite.mjs`, `rules.mjs`, `outputs.mjs`: scanning, rule application and
  exact output formatting.
- `js/rule-data.mjs`: literal source-derived rule tables.
- `audit-apple-source.py`: statically specializes the reviewed v2 target helpers to Apple,
  checks their exact AST hashes, and compares the entire remaining script to the
  pre-v2 AST. It neither imports nor executes the upstream program.
- `audit-js-source.py`: checks the complete original source SHA-256 and compares
  every generated rule table against its Python AST. `--write` regenerates tables.
- `audit-source.py`: retains the input-hash, source-surface and native-rule audit.

Builds run all source audits before dependency downloads or compilation. Worker admission also checks the
compiled source hash against the registered catalog. The sealed production worker
accepts only the native WASM bytes at initialization: no Python runtime, adapters,
source files, fixture fetch or synthetic input route is required there.

Native dependencies remain pinned Capstone 5.0.3, LZ4 1.10.0 and Emscripten 4.0.20.
Capstone supplies actual decoding and register access, not a handwritten decoder.
64-bit immediate operands cross JSON as decimal strings and retain BigInt when
needed. LZ4 crosses the JS/WASM boundary as bytes, without Python hex conversion.
Capstone and LZ4 notices remain in `dist/licenses`.

## Bounds and validation

Admission ceilings remain 32 MiB input per module, 64 MiB combined input, 64 MiB
per decoded segment, 96 MiB image and 128 MiB combined outputs. These are rejection
ceilings, not measured device-memory guarantees. Work is serial and the worker
can be terminated to reclaim memory.

A minimal generated instruction probe compared all eight output files to the
pinned Python source. Ten focused relocation comparisons also matched instruction
bytes, fixups and gates using actual Capstone WASM. These are not real-game tests.
The existing manual `make-fixtures.py` / `verify-parity.mjs` harness remains
available for later expanded checks; this migration adds no broad test suite or
additional CI job.

Shared art generation still needs Pyodide/Pillow. Removing program-specific
Python files does not remove those shared dependencies from the whole app.

## Upstream v2 Apple scope

The browser route remains Apple-only. Upstream's Android/HarmonyOS TLS and
stack-rewrite paths are not ported or selectable. The reviewed Apple paths retain
the prior relocation instructions, rule tables, input hashes and limits. One pure
temporary-register assignment moved before an emit; the static proof explicitly
normalizes only this reviewed motion. `apple-source-baseline.json` records the
old complete AST hash and the exact reviewed new target-helper nodes.

New fixups start with `# TARGET\t0x0`. The adapter accepts absent TARGET for
legacy Apple records, but rejects explicit nonzero or duplicate targets. The
manual Python oracle is explicitly pinned to `DM_TARGET=apple` regardless of its
parent environment. This update adds source-only and synthetic JS checks, not a
new native/WASM execution result, v2 shell qualification, or game/device claim.
