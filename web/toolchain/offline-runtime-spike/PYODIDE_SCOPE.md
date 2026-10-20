# Sealed Pyodide asset-worker proof (Linux CI verified)

This isolated prototype keeps the production UI, production CSP and original
asset worker unchanged. It uses the actual generated Python core, Pillow and
NumPy from the asset-generation spike, including the current complete packaged
Python module set (`native_functions.py`, `core.py`, `derived.py`, `native_art_original.py`,
`native_art.py`, `hud_original.py`, `hud_design_original.py`,
`hud_support_original.py`, `hud.py`). The tested
operations are image-default-frame, experience-table and overlay-paths. Derived-table, native-art, HUD and v61 operation parity remain separate proofs.
The sealed initialization explicitly imports all nine modules, including derived, native_art and hud, so their
Python import closure must be present before any operation is accepted. This
does not claim their output operations passed here. Native-art JSON metadata is
consumed from explicit operation payloads, not fetched at import time, and is not
part of this proof's supported operation set.

## Why a pinned loader adaptation is necessary

Inspection of the exact Pyodide 0.27.7 source and npm distribution found:

- `loadPyodide` exposes URL-based stdlib/lock configuration but no public WASM
  bytes or general resource-read callback.
- `createSettings` eagerly constructs the fixed indexURL WASM request. Merely
  wrapping `_createPyodideModule` after that point does not stop it.
- The bundled package loader has another binary reader in pyodide.asm.js.
  Fetch prewarming or HTTP cache cannot remove its network fallback capability.

Primary source:
[loader](https://github.com/pyodide/pyodide/blob/0.27.7/src/js/pyodide.ts),
[WASM/bootstrap settings](https://github.com/pyodide/pyodide/blob/0.27.7/src/js/emscripten-settings.ts),
[compatibility reads](https://github.com/pyodide/pyodide/blob/0.27.7/src/js/compat.ts),
[package loader](https://github.com/pyodide/pyodide/blob/0.27.7/src/js/load-package.ts).

`pyodide-prepare.mjs` therefore makes **three exact, source-hash-locked internal
call-site substitutions** in two distribution files. It does not claim the result
is an unmodified upstream runtime or a supported new Pyodide public API. Source
drift, a missing needle, or multiple matches fail the build. Original hashes,
exact before/after strings, upstream source link and generated manifest digest
are retained in loader-provenance.json. The modified-file notice and upstream MPL
license accompany the output. Upgrading Pyodide requires explicit source review.

The substitutions redirect only the outer binary reader, outer lock reader and
inner package binary reader to a bounded in-memory Response provider. Global
fetch is not patched. Neither are XHR, imports, Worker constructors or CSP. The
provider accepts only exact names from verified public bytes at a fixed inert
origin, rejects queries/fragments/missing resources, and validates every provided
SHA-256 subresource-integrity value before returning bytes. That inert HTTPS URL
is never requested: browser CSP would block it if any unadapted path tried.

## Proof boundary

The bootstrap verifies an embedded manifest digest and every expected asset hash
and byte count before execution. Each asset is capped at 32 MiB; aggregate assets
at 96 MiB. All public bytes transfer to a fresh blob Worker created only after a
new connect-src none / blob-only script CSP is appended. No general unsafe-eval
permission is added. The original loader's unused dynamic-evaluation paths are
not excused or weakened; any required path that violates CSP must fail the proof.

The Worker imports the verified adapted runtime from blob URLs, initializes
Python, loads both packages through the bounded reader with package integrity
checks, installs the nine Python files from bytes, and imports the real core.
Only then does it report initialized and accept bounded operation messages.
Normal global fetch and imports attempt both local and second-origin sentinels
before and after runtime initialization. These are actual browser requests, not
stubbed APIs. No service worker or request interception supplies the block.

The browser harness then demands exact independently generated native bytes for
RGBA, v31 sprite, experience header and overlay paths, malformed-input rejection,
and recovery. All server receipts after the seal must remain empty through
package loading and conversions; successful preload paths must exactly match the
manifest plus entry HTML/bootstrap/manifest. Five modified/missing/redirected
preload cases must fail before any Worker executes. The existing whole-runtime
CSP is not assumed sufficient for arbitrary hostile JavaScript, extensions,
WebRTC or top-level navigations.

## Verification status

- Exact pinned npm source inspection, dependency packaging, three patch matches,
  bundle generation, focused ESLint and formatting checks passed locally.
- Local Chromium execution was attempted but the process sandbox prevents its
  required local socket; the supported escalation wrapper also failed before
  execution. This is an environment limitation, not a passing browser result.
- `.github/workflows/offline-pyodide-checks.yml` rebuilds pinned public dependencies
  and native references, prepares this bundle, and runs the browser proof on CI.
  The scoped Linux browser proof passed as recorded below. Other operations,
  Windows/macOS and production integration remain unverified by this workflow.
- No private files, key material, user inputs, generated game data, production
  deployment or production enablement are part of this work.

### First CI result and harness correction

[Run 39399152923](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152923)
on `b90743b5b70fdf9ffa895dfd1d54a0201ad270c7` completed runtime packaging and
source-lock verification, then failed before runtime initialization because the
test server's filename regex rejected underscores in the official wheel names.
The server now admits only the exact generated manifest paths plus the three
entry files, rather than a narrower inconsistent filename regex. CSP and receipt
assertions are unchanged. The later successful run below supersedes this harness failure.

### Package readiness diagnostic correction

[Run 39400665142](https://github.com/n3crosis/d2r-mobile/actions/runs/39400665142)
reached package initialization under the unchanged sealed policy, but the proof
incorrectly checked `loadedPackages.pillow`. Pyodide 0.27.7 registers packages
under the exact lock metadata name (`Pillow`), not the normalized lookup key
(`pillow`). The proof now checks the exact allowlisted `Pillow` and `numpy` keys
before importing Python modules, retaining bounded initialization-only error
callbacks and separate import diagnostics. A resolved loadPackage Promise alone
is not accepted as success. This failed run does not establish conversion parity
or completed network-isolation proof; the corrected CI result is recorded below.

HUD metadata and archive font bytes are not public preload assets. The HUD
modules are imported to verify code closure only; the sealed worker does not
accept HUD jobs, increase its 20 MiB operation input cap, or claim HUD rendering
parity. The existing native parity corpus is unchanged.

### Successful sealed runtime proof

[Run 39401602080](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602080),
job 118557385440, passed on commit
`ad20d131d4558c155e0929681959040cb38ae9e3` with Linux Chromium
`156.0.8078.4`. Its generated manifest SHA-256 was
`c4631ebf955c831e054dca01a6bfe47d49e79b64885e04ace8b3ad93cd392df5`.

The five bad-preload scenarios created zero workers. The valid scenario created
one fresh sealed worker, initialized Pyodide 0.27.7 and both package statuses,
imported all nine modules, and matched native bytes for frame.rgba, frame.sprite,
dm_hud_exp.h and overlay-paths.json. It rejected malformed input and unsupported
operations, then recovered on a valid image operation. Five internal resource
reads were supplied entirely from preloaded bytes. All twelve document/worker
network probes were blocked, the server recorded zero HTTP receipts after the
seal through initialization and conversion, and the public preload request set
exactly matched the manifest plus entry assets. No general unsafe-eval permission
was necessary for this corpus.

This verifies only the listed synthetic operations and imported code closure,
not sealed HUD/native-art rendering, Windows/macOS, real game archives, the
program rewriter, or production integration. Production UI and CSP are unchanged.
