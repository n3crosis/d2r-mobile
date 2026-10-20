# Browser ARM64 rewriting and multi-module Guest assembly

The worker executes unchanged `dm/tools/patch_nso.py` in Pyodide with real
Capstone ARM64 and LZ4 C/WASM bindings. CI proves generated synthetic inputs,
including main+sdk Guest assembly, against the original native Python tools.
There are no real game inputs in CI. No iOS execution, successful real-game
conversion, production memory qualification or playable-build claim is made.

## Repository-registered release route

`web/program-release-catalog.mjs` now records actual repository metadata:

- `dm/tools/extract_game.sh:SUMS` publishes complete SHA-256 hashes for main,
  sdk and subsdk0 of Switch version 3.3.94012. This adapter uses main and sdk,
  matching `d2rm_pack.py:MODS`, rather than inventing a missing-hash blocker.
- Native packaging runs both modules with `DM_RULESET=touch-run-v4`.
- `patch_nso.py` registers main build ID
  `db0507f36b84200ac05f75d76ed5026f` in CUTS, OBS, PARAMS and RULE_BUILD.
- The SDK is matched by its complete file hash. No SDK build ID or real output
  digest is invented. Synthetic oracle output hashes are not real-build hashes.

The registered route accepts only these exact full-file input hashes, the fixed
module names/order, pinned original source and original ruleset. All original
CUTS/OBS/PARAMS preimage checks still execute. Unknown, changed, swapped or
incomplete module sets fail closed. Original rules manifests are checked against
the resulting main image. Outputs report `repository-registered-unverified` and
`realGameVerified:false`; the route is implemented but not real-input tested.
There is no UI enablement or fallback that trusts a caller's build-ID claim.

## Trusted extraction and coordinator adapter

`web/program-rewriter-adapter.mjs` implements
`generateProgram({extracted, selection, signal}) -> OutputEntry[]`.
For the repository route it requires an injected `verifyProvenance` function.
Trusted application wiring supplies `readAuthenticatedProgramModules` from
`extraction-job-adapter.mjs`, whose private WeakMap verifies the original result
object, full selection and live extraction session. A plain object claiming to
be authenticated is insufficient. Both returned borrowed module buffers are
snapshotted synchronously, then individually whole-file hashed before any rewrite.

The adapter runs main then sdk, validates source/fixup bounds and required files,
passes the ordered images to the existing Guest writer, and emits Guest.framework
plus `dm/main.fixups.tsv`, `dm/main.gates.tsv`, `dm/main.cuts.tsv`,
`dm/sdk.fixups.tsv`, and `dm/sdk.gates.tsv`, matching native packaging. Structural
ad-hoc signature metadata is included; distribution signing is not performed.
The adapter is single-use, cancellable, bounded, and disposable; errors never
include local file names, secret values or raw worker diagnostics.

Bounds are explicit in PROGRAM_REWRITE_LIMITS: 32 MiB input per module, 64 MiB
combined input, 64 MiB decoded segment, 96 MiB input image, 128 MiB combined
rewriter outputs. The existing Guest writer also caps aggregate padded images at
128 MiB. These are rejection ceilings, not measured device-memory guarantees.
Pyodide and the JSON/hex binding still require performance/memory qualification
on real inputs; the worker must be terminated to reclaim its runtime heap.

## Actual engine and provenance

- Python: official Pyodide **0.27.7**, npm integrity-locked and same-origin.
- Disassembly: official Capstone **5.0.3**, exact git commit, compiled to WASM
  with ARM64 detail support. The bridge calls `cs_disasm`, `cs_regs_access`, and
  `cs_reg_name`; it does not implement or stub an instruction decoder.
- LZ4: official **1.10.0** `LZ4_decompress_safe` in the same WASM module.
- SDK: official Emscripten **4.0.20**, exact SDK commit, checked at build time.
- Source hash: unchanged original patch_nso.py checked during build and runtime.

The Python adapter implements every instruction field currently consumed by the
source: bytes, address, mnemonic, operand string, operands' register/immediate,
register-name lookup and register access. The bridge also supplies size. Signed
immediates cross JSON as strings to preserve precision. `audit-source.py` checks
this surface, original rule-table keys, exact input hashes and native module
order/ruleset without executing or rewriting the source. It emits a CI audit.

Official provenance: [Capstone](https://github.com/capstone-engine/capstone/tree/5.0.3),
[LZ4](https://github.com/lz4/lz4/tree/v1.10.0),
[Pyodide](https://pyodide.org/en/0.27.7/usage/downloading-and-deploying.html),
[Emscripten](https://github.com/emscripten-core/emsdk/tree/4.0.20).
Capstone BSD-3-Clause, LZ4 library BSD-2-Clause and Pyodide MPL-2.0 notices ship
under dist/licenses. Pyodide's notice is retained from its official tagged source.

## Worker API and CI proof

Serve generated dist from one origin and create a module Worker for worker.mjs.
Synthetic requests: `{id, caseName, moduleName, bytes: Uint8Array}`.
Registered requests: `{id, releaseId, moduleName, bytes: Uint8Array}`.
Only one route can be selected; a request never supplies rules or patch tables.
Success returns `{id,ok:true,status,realGameVerified:false,files}` with transferred
byte arrays. Failure returns `{id,ok:false,error}` for trusted diagnostics only.
Requests are serialized and prior results are cleared before each original CLI run.

`.github/workflows/program-rewrite-checks.yml` builds the actual engines, creates
synthetic NSOs and invokes unchanged native patch_nso.py and guest_dylib.py in
independent subprocesses. Real Chromium compares every rewrite file and Guest
byte. Synthetic coverage includes SVC, TLS registers, counters, x18 arithmetic,
load/store, conditional branch, ADR and LZ4 segments, plus ordered main+sdk.
Rejections cover original build/preimage checks, altered inputs/output, incomplete
or swapped module sets, missing provenance and trying synthetic bytes on the
registered release route. No real file hash is forged to force a positive test.
Browser external requests are blocked. Runtime/source audit and parity evidence
are uploaded together, without game data or keys.

Run on GitHub CI, or explicitly install these pinned dependencies yourself:

    npm ci --ignore-scripts
    python3 -m venv .venv
    .venv/bin/pip install capstone==5.0.3 lz4==4.4.4
    bash build-wasm.sh
    .venv/bin/python audit-source.py
    .venv/bin/python make-fixtures.py
    cp -r fixtures dist/
    npx playwright install --with-deps chromium
    npm run test:browser

Remaining evidence gaps: real-input conversion/runtime testing; broader exclusive
window, jump-table and OBS-success fixtures; throughput and peak memory on target
browsers; complete extraction-to-archive integration and host-version validation.
