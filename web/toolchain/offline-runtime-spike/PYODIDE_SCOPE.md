# Legacy Pyodide proof harness

This optional local parity harness is not the production asset runtime. Production uses [JavaScript/WASM](../asset-runtime-js/README.md). Run the `offline-pyodide` profile in [TESTING.md](../../TESTING.md) to exercise it.

All packaged Python modules are written and imported before any job is accepted.
The prepare script's hashed inventory is authoritative. Native metadata, decoded
images and fonts are explicit bounded job payloads, never fetched at import time.

## Operation routing

The bootstrap and self-contained worker share an explicit allowlist. BC3 encoding
accepts at most 16 MiB RGBA (4M pixels, dimensions at most 8192) and returns original
linear BC3 blocks for the sealed texture runtime to pack. Other input caps
are 20 MiB for frame, experience, paths, derived tables, native art, map-goal and
mercenary/remaining art; 64 MiB for HUD and CASC serialization; and 128 MiB for the native
overlay recipe. JSON options are limited to 4 KiB, except the already bounded
CASC segment plan (1 MiB for at most 4096 replacements). Unknown names, including
object-prototype property names, fail before payload copying or Python dispatch.
Production initialization omits synthetic probes entirely; supplied loopback-only
proof probes retain their original assertions. The pre-initialization job
rejection and original CSP/network seal are unchanged.

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
checks, installs the thirteen Python files from bytes, and imports the real core.
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
