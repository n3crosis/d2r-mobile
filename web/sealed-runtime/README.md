# Callable sealed runtime integration

This is application wiring, not another synthetic proof page. It does not enable
the production UI or claim the complete game conversion is verified.

## Bootstrap contract

Import `prepareSealedRuntime` and the generated `runtimeManifestSha256` from the
trusted application build. The digest must not come from a user file, query
parameter, or the same unverified manifest download. Before asking for any private
file or key, await:

```js
const runtime = await prepareSealedRuntime({
  baseUrl: new URL("./runtime/", location.href).href,
  manifestSha256: runtimeManifestSha256,
  signal,
});
```

The one-shot bootstrap verifies the top manifest digest, every inventory entry's
exact path/hash/length, component submanifests, and aggregate caps. No worker
executes before the entire public inventory is verified. It rejects cross-origin
bases, redirects, duplicate/colliding paths, missing files, unexpected byte
counts, service-worker-controlled pages and unavailable browser capabilities.

It appends a restrictive CSP with `connect-src 'none'`, blob-only script/worker
sources, and WASM compilation permission without general JavaScript eval. It
then creates fresh blob workers and transfers owned copies of verified bytes.
It resolves only after each requested real runtime returns completed
initialization. It returns no URL loader, fetch callback, source-code input, or
network fallback. The existing production CSP is unchanged: if it prohibits
public preload or blob workers, bootstrap fails instead of relaxing that policy.
Any future initial CSP integration needs explicit review.

A failure after seal is terminal for this page session. Reload the page to retry
public preload. Cancellation terminates all live workers; no runtime recycling
across partially failed private jobs is attempted.

## Existing adapter interfaces

- `createAssetWorker()` implements `run(operation, bytes, options)` / `close()`
  using the byte-preloaded Pyodide worker. Its owner controls the exact operation
  allowlist and limits, including the real generation operations. CASC metadata
  is capped at 1 MiB, other operation options at 4096 bytes.
- `createTextureClient()` implements `decodeAtlas`, `decodeV61`, `decode`,
  `layout` and `packLinearBC3`. The new worker instantiates the existing native
  WASM exactly once from supplied bytes. The encoder adapter's sole relative
  decoder import is linked to a verified decoder blob with an exact single-match
  check; other runtime source is not rewritten.
- `createTextureEncoder()` implements existing `encodeAndPack`/`packLinearBC3`
  requests. It validates v61 template/geometry first, invokes the initialized
  Python `encode-linear-bc3` operation, then passes the result to the initialized
  native texture packer. It never starts the old lazy encoder worker.
- `createProgramWorker()` implements `run({bytes,moduleName,releaseId})` / `close()`.
  It rejects synthetic case selection and forwards bounded registered-release
  requests to the separately owned sealed program worker.
- `createExtractionWorker()` returns the actual preinitialized NSP worker once,
  compatible with the strict existing extraction transport. The extraction
  transport retains its operation-specific deadlines and terminal-error rules.
- `createShaderWorkerFactory()` returns an exact-URL router for
  `workerUrls.translator` and `workerUrls.spirvCross`, compatible with the existing
  shader pipeline's Worker-like event API. Both routes reuse real initialized
  runtimes, never HTTP worker URLs. Direct translator/Cross factories also exist.

Pass these factories into the existing adapters rather than using their default
network-loading worker constructors. Multiple lightweight clients may share a
component, but each component permits only one in-flight request; concurrent
work rejects instead of building an unbounded queue. Closing an idle client
releases that client; closing one during its own request terminates the session.
Call `runtime.close()` on completion, cancellation or disposal to terminate all
workers and revoke bootstrap blob URLs.

The optional `components` array selects a strict subset of assets, texture,
translator, extraction, program and spirvCross. The default requires all six.
Subset selection is not a full-chain readiness assertion, and all top-level
public assets are still verified before sealing.

## Packaging contract and unresolved evidence

The assembly inventory preserves `web`-relative paths under `runtime/`. These
integration sources and `native-art-texture.mjs` must be inventoried alongside
existing texture adapters. NSP, program and Cross are supplied by the remaining
runtime worker owner as `sealed-workers/{nsp,program,cross}-worker.mjs`. Their init
uses `{id:0,type:'initialize',assets:[[name,ArrayBuffer],...]}` and returns a real
`{id:0,ok:true,result:{initialized:true}}` after initialization. Missing bundles
or dependencies fail before seal; there are no substitute implementations.

Program uses the adapted, verified offline Pyodide runtime bytes plus
capstone-lz4.wasm, patch_nso.py and python-adapters.py. Its fixture-only manifest
must not be loaded after seal. NSP/Cross use their explicitly supplied WASM
bytes. The exact complete-title catalog, shell recipe and shader metadata remain
separate authenticated inputs; these factories do not fabricate them.

The earlier texture/Pyodide isolation proofs do not verify this unified factory.
The .NET sidecar fix and new NSP/program/Cross bridges still need corrected
runtime observation and game-input validation. No new CI workflow, synthetic
suite, production CSP change or real-input success claim is included here.

Verified public profile access: `session.readPublicAsset(path)` returns a fresh
`Uint8Array` copy for an exact runtime-relative inventory path. All such bytes
were fetched and SHA-256 verified during public preload; this accessor performs
no network request. The inventory stays in memory until `close()`, which clears
it and revokes the session's identity. Private job bytes are never added to this
inventory.

Adapters can import `assertSealedRuntime(value)` from `clients.mjs`. Its private
WeakSet accepts only live sessions returned after successful initialization by
this module, not lookalike objects or readiness booleans. This is an application
provenance guard, not a sandbox against other trusted JavaScript in the page.
