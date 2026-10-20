# Offline texture runtime: sealed-worker proof

This standalone synthetic harness implements a narrow part of
`../../OFFLINE_RUNTIME_LOADING_SCOPE.md`. It does not change the production UI or
CSP, support real inputs, integrate Pyodide/.NET, or certify the entire browser as
a security sandbox. **The scoped Linux Chromium proof passed CI; production integration remains disabled.**

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

`.github/workflows/offline-runtime-checks.yml` rebuilds the official pinned SDK
output and runs this proof using Playwright 1.64.1 on Ubuntu. It neither deploys
nor uploads runtime binaries. A green result proves only this exact texture
path on that Chromium build; it does not cover Windows/macOS, other runtime
loaders, WebRTC, navigations, compromised code, extensions, or hosting headers.
The production app's existing CSP is unchanged. The broader release gates remain
in the scope document.

## Verified execution (2026-10-20)

[Run 39396778404](https://github.com/n3crosis/d2r-mobile/actions/runs/39396778404),
job `118541350842`, passed on commit
`fe5abb21b5527c6d230f86c94a4a7a42c6982036` using Chromium `156.0.8078.4`
on Ubuntu 24.04. All five preload failures created zero Workers; the valid case
created one Worker and passed every network-receipt, conversion, transfer and
custom-instantiation assertion described above. No test interception supplied the
network block.

The four hashed runtime assets totaled 48,520 bytes (texture JavaScript 8,086;
WASM 32,418; adapter 4,702; proof Worker 3,314). This excludes bootstrap, manifest,
HTML and notices, and is not a complete production transfer/memory measurement.
Manifest SHA-256:
`d86630081004748cc0ff845b1752f9bb02132b0cbd17bc3af9e2305d9a7b42ba`.

This result does not extend to Pyodide/.NET, Windows/macOS or deployed hosting.
No production policy or input gate was changed.
