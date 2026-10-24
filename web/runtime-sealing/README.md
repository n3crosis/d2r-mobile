# Sealed NSP, program and SPIRV-Cross workers

These are build-owned worker entries, not arbitrary-module loaders. After the
existing pinned native builds, run `bun web/runtime-sealing/build-workers.mjs`
from the repository root. It emits standalone worker modules into
`web/runtime-build/.build/sealed-workers/`, deployed as `sealed-workers/*.mjs`.
The NSP/program/Cross workers use the protocol below; the optional ASTC producer
has its [own initialization protocol](../ASTC_PRODUCER.md).
The build rejects split outputs and remaining literal imports. Generated
Emscripten Node branches are compiled with `process` undefined; no Node shim or
server runtime is provided.

The application must hash-verify the complete public runtime manifest and bytes,
then apply its restrictive CSP **before** constructing these blob workers. Initial
page policy must permit public same-origin preloading and blob/WASM execution;
a later CSP cannot relax an earlier restrictive policy. No key or game input is
accepted by an initialization message. The public WASM bytes are transferred only
through this one-shot trusted bootstrap, not selectable through job RPC.

## Protocol

Each NSP/program/Cross worker accepts `{ id: 0, type: "initialize", assets }` once and replies with
`{ id: 0, ok: true, result: { initialized: true } }` only after initialization.
Clients must await that response before sending any private operation.

- NSP `nsp-worker.mjs`: exactly `hactool-boundary.wasm`. Original extraction
  engine, native trust roots, message IDs, bounded reads and terminal error
  cleanup remain unchanged. Engine initialization and blob mounting/key loading
  remain distinct stages. Native WASM instantiation uses supplied bytes, never a
  URL or fallback fetch.
- Cross `cross-worker.mjs`: exactly `spirv-cross.wasm`. Original conversion and
  replay reflection functions run with a fresh native instance per CLI call,
  using one compiled in-memory module. Existing convert/result RPC is preserved.
- Program `program-worker.mjs`: exactly `capstone-lz4.wasm`. Rewriting uses bundled
  JavaScript with the real Capstone/LZ4 WASM bindings, not Pyodide or Python
  adapters. Build-time Python audits retain the original patch source and rule
  provenance; runtime admission checks the bundled source pin against the
  registered release catalog.

Program rewrite logic and native decoder bindings are now shared in
`toolchain/program-rewrite-spike/rewrite-core.mjs`. The ordinary developer worker
retains its fixture loader. The sealed worker does not ship or fetch a fixture
manifest: only registered release/module inputs are accepted, with unchanged
input hash, NSO, build ID, memory and output gates. It rejects `caseName` and
missing `releaseId`; replies retain top-level status/files fields expected by
the existing program adapter.

Removing the unused legacy Python-to-JavaScript adapter is source cleanup only:
it was already absent from the public runtime payload, so this does not reduce
browser downloads or RAM. Native Python tools, supported proof/oracle inputs,
hash-gated sources, licenses and provenance metadata remain intact.

## Evidence boundary

Implementation, syntax, Oxlint and Oxfmt checks are complete. No new synthetic
suite or browser execution was run for this change. Native outputs were not
available locally to execute the final Bun bundling stage. The single browser
build must establish that the generated worker import graphs close successfully.
Actual sealed-worker runtime execution, full title transformation, original
native parity and production installation are still unverified. These files do
not enable the UI or establish complete release compatibility by themselves.
