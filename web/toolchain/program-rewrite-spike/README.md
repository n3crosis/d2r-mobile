# Browser ARM64 program rewriting: synthetic-only executable proof

This is an implementation, not a replacement disassembler or an assertion that a
real game can already be packaged. `worker.mjs` runs the repository's **unchanged**
`dm/tools/patch_nso.py` in Pyodide, with its source digest checked at build and run
time. The script's CUTS, OBS, build-ID, original-byte assertions, trampoline
encoders, register substitution, and output generation are not patched out.

## Actual dependency boundary

- Python: official Pyodide **0.27.7**, deployed same-origin from its exact npm
  package and integrity-locked dependency graph. No Python source translation.
- Disassembly: official Capstone **5.0.3**, pinned git commit, compiled to WASM
  with ARM64 and detail/register-access support. `bridge.c` calls `cs_disasm`,
  `cs_regs_access`, and `cs_reg_name`. The Python adapter supplies only the API
  surface used by the original rewriter: instruction bytes/address/size,
  mnemonic/operand text, immediate and register operands, register access/name.
  Signed immediates cross JSON as decimal strings to avoid JS precision loss.
- Compression: official LZ4 **1.10.0** `LZ4_decompress_safe`, in the same WASM
  module. No decompression/disassembly stubs and no downloaded game bytes.
- Build: official Emscripten **4.0.20**, exact SDK commit. All git commits are in
  `toolchain-lock.json`; CI verifies them before compiling. Capstone BSD-3-Clause,
  LZ4 library BSD-2-Clause, Pyodide MPL-2.0 notices ship in `dist/licenses`.

Official provenance: [Capstone](https://github.com/capstone-engine/capstone/tree/5.0.3),
[LZ4](https://github.com/lz4/lz4/tree/v1.10.0),
[Pyodide deployment](https://pyodide.org/en/0.27.7/usage/downloading-and-deploying.html),
[Emscripten SDK](https://github.com/emscripten-core/emsdk/tree/4.0.20).

## API and safety gate

Serve the generated `dist/` directory from one origin. Create a module Worker for
`worker.mjs` and send `{ id, caseName, bytes: Uint8Array }`. Successful replies are
`{ id, ok: true, status: 'synthetic-only', files: { filename: Uint8Array } }`.
Failures are `{ id, ok: false, error }`. Calls are serialized; failed runs cannot
return stale output. Terminate the worker to cancel or release runtime memory.

Only exact SHA-256 matches to the generated synthetic manifest are accepted.
Unknown or modified inputs fail closed, including real modules with otherwise
recognized build IDs. There is **no** production-enablement flag, network upload,
UI integration, output-to-IPA connection, or supported real-build claim here.
The negative registered-build fixture is intentionally too small to satisfy its
original-byte checks and must fail in the original script.

## Independent CI proof

`.github/workflows/program-rewrite-checks.yml` installs exact native Python
Capstone/LZ4 versions in a venv, creates synthetic NSOs, and invokes the original
native Python CLI in a separate process. It then builds the WASM dependencies and
runs a real Chromium module worker. Every generated file is compared byte for
byte, including patched images, fixups, gates, sites, cuts, params, observations,
and source hashes. Negative cases must reach the original assertions; changed
synthetic bytes must be rejected by the outer gate. Browser requests outside the
local proof server are blocked.

Fixtures cover SVC, TPIDR read/write, TPIDRRO, physical/virtual counter gates,
x18 arithmetic and load/store, x18 conditional branches and ADR relocation,
and compressed NSO segments. Wrong rule build IDs and registered CUTS preimage
mismatch must fail. Inputs are generated from documented instruction encodings
and synthetic NSO/MOD0/unwind metadata, not extracted from any title.

Run (prefer GitHub CI, no local SDK is required):

    npm ci --ignore-scripts
    python3 -m venv .venv
    .venv/bin/pip install capstone==5.0.3 lz4==4.4.4
    bash build-wasm.sh
    .venv/bin/python make-fixtures.py
    cp -r fixtures dist/
    npx playwright install --with-deps chromium
    npm run test:browser

The artifact contains runtime, license notices, synthetic native oracle, and
machine-readable parity result. A green workflow proves only the listed cases.

## Remaining production work

The official engine and original rewriter now have a real browser execution
boundary, but CI has to run before this is called verified. The per-instruction
JSON bridge and hex LZ4 handoff favor auditability over throughput; their current
1 MiB synthetic limit is not a real-title memory/performance design. Broader
synthetic coverage is still needed for exclusive windows, jump tables, and OBS
success paths. Existing exact OBS checks are retained, not separately proven by
these tiny fixtures. Real-build authorization/validation, segment hash checks,
resource limits, cancellation/progress UX, large-module memory measurement,
host-runtime compatibility, and integration with the production packaging
pipeline remain blockers. Do not relax the fixture gate to claim those done.
