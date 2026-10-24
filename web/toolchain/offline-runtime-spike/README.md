# Offline texture runtime: sealed-worker proof

This standalone synthetic harness preserves the narrow texture isolation proof
below. Its `prepare-bundle.mjs` also supplies production texture assets. The
[current production flow](../../PRODUCTION_FLOW.md) preloads public dependencies
before private inputs but does not enforce a CSP network lockdown. No-upload
behavior is not browser-enforced isolation, and this historical proof does not
establish isolation of the current production application.

See the [.NET](README.md#sealed-net-shader-harness) harness contract.

## Concrete boundary

`prepare-bundle.mjs` consumes the existing Emscripten 4.0.20 texture build. It
copies four exact public assets (texture module, WASM, adapter, proof Worker),
records SHA-256 and byte count for each, and embeds the manifest SHA-256 in the
bootstrap. The bootstrap/index remain trusted application entry points, not an
independent signature or defense against a compromised origin serving all code.
Required notices are copied alongside the bundle.

Before executing any runtime code, the bootstrap verifies the manifest digest,
exact ordered asset names/count, safe sizes, aggregate cap, actual byte counts,
and every asset digest. Streaming reads stop at their per-file cap; redirects,
HTML fallback responses, absent assets and integrity drift fail closed. Downloads
are sequential, same-origin, credential-free, and finish before sealing. Bounds
are 16 MiB per asset and 32 MiB aggregate; this proof is not a large-bundle solution.
There is no private-input or local-file interface.

The bootstrap appends a new CSP with connect-src none and blob-only script and
Worker sources. It then creates a new blob module Worker from verified code,
which inherits the restrictive policy. Verified module/adapter bytes become blob
URLs; the WASM buffer transfers to the Worker. The existing texture adapter receives
wasmBinary and a synchronous instantiateWasm hook. The hook compiles and instantiates
the supplied bytes and must run exactly once. No global fetch monkey-patch,
service worker, cache fallback, or URL runtime loader substitutes for CSP.

The Worker checks bounded initialization before importing either runtime module.
It decodes a 4×4 BC1 known-red synthetic block and checks all 64 expected RGBA
bytes, rejects a truncated source, and attempts same-origin/cross-origin fetch
and module-import probes before and after conversion. Document probes run too.
All probes must reject. A one-shot timeout terminates the Worker; URLs are revoked
on every outcome. The harness intentionally supports only loopback sentinel URLs,
so it cannot become an arbitrary-destination test interface on a deployed site.

## Independent browser enforcement test

`browser-proof.mjs` hosts the prepared bundle and a second-origin sentinel on
loopback. Positive controls first prove both servers are reachable by Chromium.
No Playwright route interception is installed. Server-side receipts, not only
rejected JavaScript promises, must show **zero HTTP requests after the seal**.
The test-only Playwright binding marks that transition without a network call.
The valid case requires exactly one Worker, exactly one custom byte instantiation,
buffer detachment, the red oracle and the exact seven-request bootstrap closure.

Five separate fresh-page negative cases alter the manifest, corrupt Worker code,
append one WASM byte, remove WASM, or redirect the manifest. They must fail before
sealing and before any Worker is created. Synthetic browser errors contain no
private data. No real keys, filenames or game bytes are used.

Run on a pinned compiler/browser host:

```sh
bash web/toolchain/texture-spike/build-wasm.sh
node web/toolchain/offline-runtime-spike/prepare-bundle.mjs
PLAYWRIGHT_ENTRY=/absolute/path/to/playwright/index.mjs \
  node web/toolchain/offline-runtime-spike/browser-proof.mjs
```

The explicit local `offline-wasm` profile in [TESTING.md](../../TESTING.md)
retains this proof; the current Verify workflow does not run it. A passing result
proves only this texture path on the recorded Chromium build, not other runtimes,
Windows/macOS, WebRTC, navigation, compromised code, extensions or hosting headers.
The harness's strict CSP is separate from the production application's policy.

## Retired Pyodide browser proof

The optional Pyodide browser bootstrap, packager and proof runner have been retired.
Production uses [JavaScript/WASM](../asset-runtime-js/README.md), not that harness.
`pyodide-worker.mjs` remains an exact, hash-checked protocol source for the current
asset runtime; it is not removed or rewritten. Python source packaging and current
JavaScript parity oracles remain available. The retired proof's CSP/network and
native/browser assertions are no longer runnable through an `offline-pyodide` profile.

## Sealed .NET shader harness

This isolated developer proof packages the existing ShaderSpike browser build
from SDK/workload 10.0.402. Production UI and CSP are unchanged. A successful build alone is not evidence of isolation or
shader parity.

### Resource boundary

The packager enumerates the actual `_framework` output, rejecting unexpected or
nested filenames. It includes every uncompressed JS, JSON, WASM, DLL, PDB, DAT and symbols
file in the exact SHA-256/length manifest, including ICU and all assemblies.
Compressed alternate representations and source maps are not runtime inputs.
Each asset is capped at 64 MiB, aggregate at 256 MiB, manifest at 128 KiB.
Generated artifacts remain ignored and are not uploaded or deployed.

The bootstrap verifies every public asset before sealing. It then appends the
same strict CSP used by the proven texture/Pyodide prototypes, creates a fresh
blob module Worker, and transfers verified bytes. No general unsafe-eval is
permitted. Global fetch and import are untouched.

The Worker imports the original published dotnet.boot.js configuration and
passes it through the official `withConfig` hook, avoiding configuration fetch.
It rejects remote sources, appsettings, library initializers and satellite
resources rather than guessing their lazy closure. It explicitly resolves every
config resource to its verified module blob or inert public identifier before
startup: the upstream loader otherwise attempts URL(relative, blob:) before
calling the resource hook. The official `withResourceLoader` hook supplies new
in-memory Responses for binaries and validates the upstream integrity argument.
Symbols bypass that hook in the official loader, so their public Asset.pendingDownload
field receives an in-memory Response directly. Unknown requested names fail closed. Modules use only URLs made from verified
bytes; runtime JS is not rewritten. All lazy assembly declarations must also
name included bytes, even if this corpus never uses them.

Source inspection informing these hooks:

- [public Asset and loader-hook types](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/browser/runtime/types/index.ts)
- [.NET 10 configuration loader](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/browser/runtime/loader/config.ts)
- [resource loader and resolvedUrl](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/browser/runtime/loader/assets.ts)
- [builder configuration/resource hooks](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/browser/runtime/loader/run.ts)

These sources describe the intended API path; actual SDK output compatibility,
including any required dynamic JS evaluation, must be established by the pinned
CI build, not assumed. If strict CSP blocks a required code path, the proof fails;
no broad eval permission is silently added.

### Startup and local verification

Publish with `-p:WasmInlineBootConfig=false` to provide the external boot configuration. Register the worker handler with `addEventListener("message", ...)`, not `onmessage`: .NET 10.0.13 uses the latter slot to classify workers, and occupying it can prevent sidecar startup. Reject jobs until initialization finishes.

Run the explicit `offline-dotnet` profile in [TESTING.md](../../TESTING.md). The harness compares the authored EXIT fixture with the original native translator and checks network isolation; it does not test gameplay or GPU execution.
