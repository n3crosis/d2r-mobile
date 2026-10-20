# Production runtime loading and local-data boundary

Audit date: 2026-10-20. **Design only; production integration is blocked.**
No CSP, production UI, dependency, or runtime-loading behavior is changed by this
document. Synthetic parity is not evidence of network isolation. Do not enable
real-input processing based on this audit.

## Requirement and present evidence

The required boundary is: download only application-owned assets before accepting
local inputs; thereafter, no network requests carrying local inputs, filenames,
keys, errors, or derived content. No account credentials, signing keys, remote
runtime/CDN fallback, uploads, or analytics. Target desktop Chromium on Windows
and macOS; check capabilities at runtime rather than infer them from the OS.

The current production shell is intentionally separate from the runtime spikes:

- `vite.config.ts` emits `connect-src 'none'`, but `default-src`, `script-src`,
  `style-src`, `img-src`, and `font-src` permit `'self'`. This blocks document
  fetch/XHR/WebSocket-style connections, not all same-origin resource requests.
  A script or image URL containing data is still an egress path to the host.
  This is not a claim that the current UI performs such requests.
- The production policy has no `'wasm-unsafe-eval'` and no explicit blob Worker
  permission. Directly importing the spikes into the shell is not a supported
  fix: loading and compilation need independent validation.
- `toolchain/asset-generation-spike/public/worker.mjs` initializes Pyodide only
  after receiving a payload. It loads Pillow/NumPy and fetches two Python files.
  Its HTML permits same-origin connections, but does not establish the policy
  of its separately served Worker script.
- `toolchain/program-rewrite-spike/worker.mjs` initializes native WASM and
  Pyodide and fetches fixture metadata and Python source after a request arrives.
  Its exact synthetic digest gate must remain intact.
- `toolchain/shader-spike/wwwroot/worker.mjs` starts `dotnet.create()` eagerly,
  but accepts messages while it starts. Waiting for `ready` does not keep the
  input out of a network-capable Worker during initialization.
- Texture and SPIRV-Cross workers instantiate Emscripten modules; their glue and
  binary dependency closure must be packaged before production can use them.
- The browser parity harnesses use Playwright request routing. Blocking external
  URLs in test infrastructure does not install a production browser policy, and
  does not prove that same-origin URLs cannot encode private data.
- Full generated runtime directories are absent from this checkout. Source-tree
  sizes are not deployed bundle sizes. No measured total transfer/peak memory or
  Windows/macOS sealed-runtime results are available here.

Worker policies require particular care. An HTTP(S) Worker gets its policy from
its response, not simply the document's meta tag. A blob Worker uses inherited
policy. A policy applied to the document after a Worker exists is not a mechanism
for retroactively sealing that Worker's global scope. See the
[HTML worker policy initialization algorithm](https://html.spec.whatwg.org/multipage/workers.html#initialize-worker-global-scope's-policy-container).

## Selected architecture to prototype, not yet approved for release

Use a two-phase bootstrap with **new blob Workers created only after sealing**.
This avoids requiring per-file Worker response headers from a static host. It
requires a deliberate, reviewed future bootstrap-CSP change; the present CSP is
not loosened here. A small lifecycle controller alone cannot implement or prove
this boundary, so no boolean “offline ready” shim is supplied.

### Phase A: public assets only

1. Disable and do not mount file/drop/paste input surfaces. Do not retrieve
   remembered file handles or read local job storage. No Worker receives user
   inputs. Load only immutable build-owned resources from the deployed origin.
2. Generate an exhaustive manifest in CI containing relative path, byte length,
   SHA-256, MIME, role, and runtime/build version for every runtime asset. Include
   dynamic imports, assemblies, ICU data, Python standard library, wheels and
   native dependency libraries, not only visible entry points. Include licenses.
3. A bootstrap loader accepts only these fixed paths. Reject redirects, path
   traversal, query/fragment variations, duplicate paths, missing files, wrong
   byte counts, HTML fallback responses, digest mismatches, and total-size
   overflow. Use no credentials where compatible with the hosting access model;
   if private hosting needs its own session cookie, document that separately.
   Never ask for an application credential or copy a session cookie.
4. Read with bounded concurrency and cancellation. Prefer raw binary assets over
   base64 JavaScript strings. Hash complete small assets with Web Crypto; large
   assets need a reviewed incremental hasher or a conservative per-file cap.
   Web Crypto digest is not a streaming API. Store public bootstrap bytes only;
   do not add private input caching as a side effect.
5. Bundle application UI chunks eagerly. Do not leave lazy React imports, fonts,
   CSS imports, preload hints, favicon requests, or runtime URLs to trigger after
   the seal. Destroy any temporary warm-up Workers and revoke their URLs.
6. Complete or abort every in-flight bootstrap request before proceeding. A CSP
   insertion does not prove that a previously dispatched request was cancelled.

### Phase B: browser-enforced network block before inputs

1. Append a **new** restrictive CSP meta element in the document head before
   enabling input. Do not mutate/remove the existing element. Multiple policies
   intersect; a later policy cannot undo an earlier prohibition. Changing the
   content of an already parsed CSP meta tag is not the sealing mechanism.
2. The proposed post-seal directive set is:

   ```text
   default-src 'none'; connect-src blob:; script-src blob: 'wasm-unsafe-eval';
   worker-src blob:; style-src 'none'; img-src blob: data:; font-src 'none';
   media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none';
   form-action 'none'; manifest-src 'none'
   ```

   This is a candidate, not a tested policy or replacement for the current CSP.
   `connect-src blob:` permits runtime loaders to read in-memory object URLs, not
   HTTP(S) URLs. If all loaders can consume bytes directly, prefer `connect-src
'none'` instead. Neither policy permits same-origin HTTP after sealing. The
   preceding bootstrap policy must explicitly permit only the capabilities
   required by both phases, including blob execution and WASM. Do not add general
   `'unsafe-eval'` merely to satisfy a runtime. Existing loaded CSS behavior,
   dynamic rendering and local download behavior must be browser-tested.

3. Construct new one-shot blob Workers from integrity-checked, build-owned code
   after the restrictive policy is active. They inherit the sealed policy.
   Supply immutable runtime bytes by transfer or bounded copying; never construct
   code from filenames, errors, local files, or package input. Nested Workers
   also need browser proof; avoid them in the initial single-threaded build.
4. Initialize every required runtime entirely from bytes/object URLs, then run
   bounded authored self-tests. Resolve imports through an exact build-generated
   map; any missing dependency fails closed rather than falling back to a URL.
   Keep object URLs alive while lazy initialization requires them, then revoke.
5. Only a successful initialized-runtime handshake enables local input. An early
   job message is rejected, not queued. A load failure requires terminating the
   Worker, clearing retained data, and restarting the public-asset phase without
   retaining sensitive inputs. Never “repair” by fetching another dependency
   after private inputs have been read.
6. Pass key arrays only to the dedicated extraction Worker with transfer lists;
   enforce bounded messages and sanitized errors. Terminate on cancellation or
   completion. Best-effort memory wiping is not guaranteed erasure from all
   browser/OS copies. No diagnostic text, key material, user paths, or outputs
   enters URL construction, telemetry, public runtime cache, or CSP reports.

The CSP mechanisms above are grounded in the
[CSP specification](https://www.w3.org/TR/CSP3/). They do not by themselves prove
that an arbitrary compromised application is fully sandboxed. Document navigation,
WebRTC implementation differences, already installed service workers, extensions,
and a compromised origin remain outside a simplistic `connect-src` claim.
Use a dedicated origin with no service worker, no third-party scripts, no opener,
and no network-navigation behavior in the trusted UI. Reject a controlling service
worker rather than unregistering unrelated registrations. Workers must never ask
the UI to open URLs or render arbitrary HTML. If the product requires protection
against malicious application code rather than accidental data egress, independently
review a stronger browser/container boundary before making that promise.

## Runtime-specific integration work

### Emscripten: extractor, textures, Capstone/LZ4, SPIRV-Cross

Audit the emitted version-pinned glue and all `locateFile` paths. Supply the WASM
bytes through its supported initialization hooks; never use the default network
fallback. Compile a minimal module under the actual final CSP as a capability
probe, not just a `typeof WebAssembly` test. Keep single-threaded builds initially;
SharedArrayBuffer/pthread support is not assumed. The official
[Emscripten Module API](https://emscripten.org/docs/api_reference/module.html)
documents custom instantiation and dependency-location hooks; the pinned emitted
4.0.20 glue must be inspected, not inferred from latest documentation.

### Pyodide 0.27.7: assets and program rewriting

The current native runtime, standard library, lock file, wheel dependencies,
Python source and generated source need a complete local manifest. Public runtime
bytes may be shared, but separate Python workers should not share job globals or
keys. The pinned
[Pyodide JavaScript API](https://pyodide.org/en/0.27.7/usage/api/js-api.html)
exposes initialization/package-loading options; it does not promise this project's
proposed all-blob packaging works automatically. Prototype the package name/URL
mapping, lock references, native dynamic libraries and all required Python imports
under the sealed policy. Do not use micropip, PyPI, `loadPackagesFromImports`, or
unknown URL fallback at job time. Replacing global fetch with a map is an adapter,
not a security boundary; CSP must independently reject all HTTP(S) requests.

### .NET 10: shader translator

The project is a standalone `Microsoft.NET.Sdk.WebAssembly` app, not a Blazor app.
Do not assume a Blazor `loadBootResource` example is directly applicable. Inventory
its complete published `_framework` output, actual runtime loader hooks, internal
module imports, assemblies and ICU resources. Build-generated blob module mapping
or a verified binary-resource callback is needed; simply fetching `_framework`
into HTTP cache leaves network-capable fallback and does not satisfy the design.
The official [.NET browser interop documentation](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app?view=aspnetcore-10.0)
describes the standalone initialization boundary. Test the exact pinned SDK output,
including deferred assembly/module initialization, before selecting its adapter.

## Static hosting and large-bundle release gates

A local static-server result cannot certify a deployed host's headers or limits.
The selected deployment still needs evidence for asset count/size limits, MIME,
cache behavior, compression, version consistency, private-site login redirects,
404 behavior, and any host-injected scripts or outer frame. Do not assume a
`_headers` file is honored. Static deployment cannot silently become a backend
proxy for runtime resources or private input. Keep downloads versioned and deploy
an atomic manifest/bundle. Never put local data into deployment artifacts.

Measure cold/warm bootstrap transfer and wall time, retained public bytes, runtime
heap, largest expected job buffers, and output storage together. Base64 adds size
and decoding copies; multiple Pyodide workers multiply runtime memory. Single-use
workers should start sequentially where possible and terminate promptly. Retain
only the public bytes needed for subsequent workers, with explicit caps. Browser
storage quota estimates are advisory, not a guaranteed allocation or a reason to
persist private keys. Build artifacts must first be generated on the pinned CI
host; no end-user .NET/Python/Xcode install or runtime CDN fallback is acceptable.

## Required browser evidence before an enablement decision

Use authored synthetic data only and a controlled same-origin sentinel server.
Test the actual production build, not Vite development/HMR or a weaker harness.

1. Record all bootstrap resource paths and verify exact manifest closure. Missing,
   wrong-hash, oversized, redirected and HTML-substituted assets must fail before
   any local input surface is enabled. Repeat from empty and warm browser caches.
2. In document and each final Worker, attempt same-origin and external fetch,
   XHR, WebSocket, EventSource, and network script imports. In the document also
   attempt image, font, stylesheet, frame and form requests. Require both browser
   rejection and zero sentinel receipts after seal. Request interception must
   observe, not itself block the requests that are intended to test CSP.
3. Exercise nested worker creation and imports to detect a policy escape. Test
   WebRTC separately in every context that exposes it; do not infer its behavior
   from fetch tests or an unsupported CSP directive. Do not use real private data
   as a canary. No CSP report endpoint may receive private document URLs.
4. Run every supported transform after sealing with delayed first use, repeated
   operations, cancellation and missing lazy resources. Require zero HTTP(S)
   requests, exact synthetic outputs, bounded memory and sanitized failures.
5. Verify API absence, denied file access, low quota, CSP compilation denial,
   blob URL failure and Worker startup failure remain fail-closed. Probe secure
   context, crypto, Worker, WASM, transfer semantics, required compression/file
   APIs and storage independently; support one capability at a time.
6. Repeat on supported Windows/macOS desktop Chromium versions and the deployed
   static origin. Record versions, policy, resource manifest digest, memory,
   timing and network traces. Linux CI remains useful, but is not those results.

No browser isolation tests, complete runtime packaging, host-limit checks, or
Windows/macOS probes were run for this design-only audit. The release blocker is
unverified runtime closure plus browser-enforced post-load isolation, not an
absence of a JavaScript “ready” flag. Keep production processing disabled until
that evidence exists and the explicitly reviewed CSP change is accepted.

## Narrow executable prototype added after the audit

`toolchain/offline-runtime-spike/` now implements the proposed two-phase boundary
for only the existing Emscripten texture converter: exact manifest/hash/byte caps,
new CSP, fresh blob Worker, transferred WASM bytes and custom instantiation,
known-red synthetic conversion, and same-/cross-origin network probes checked by
server receipts without request interception. Its separate CI workflow must run
before this is called browser-verified. Production CSP/UI and all broader runtime
release gates above remain unchanged; this prototype is not the missing
Pyodide/.NET integration or Windows/macOS proof.
