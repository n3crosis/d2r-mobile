# Sealed .NET shader proof (CI pending)

This isolated developer proof packages the existing ShaderSpike browser build
from SDK/workload 10.0.402. Production UI and CSP are unchanged. No local browser
execution is attempted. A successful build alone is not evidence of isolation or
shader parity.

## Resource boundary

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

## Required actual browser evidence

The separate offline-dotnet-checks workflow builds the actual published runtime
and independent original native CLI. It uses the existing authored 16-byte EXIT
fixture, original source-hash check, exact SPIR-V bytes and complete JSON sidecar
comparison, plus both Vulkan 1.1 validators. The fresh worker must obtain the real
ShaderBridge.Translate export before accepting a bounded job (1 MiB code, 64 KiB
metadata). It rejects an unsupported stage then repeats valid translation.

The browser test preserves five failed-preload cases with zero workers, positive
same/cross-origin network controls, actual fetch/import rejection probes before
and after runtime initialization, exact public preload request closure, and zero
HTTP server receipts after seal through conversion. No request interception or
service worker supplies the block. This is not a sandbox claim for arbitrary
hostile JS, browser extensions, WebRTC or navigation.

Until CI passes, no browser success is claimed. Even green proves only the tiny
synthetic compute case on that runner, not sealed graphics/Cross/MSL, real game
shaders, Windows/macOS, GPU execution, production integration or IPA output.

## First CI failure and supported packaging correction

[Run 39403162461](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162461)
on `664790f0b4d3cbe1082f174f0f1196164828d7f4` passed runtime publishing
and the independent native oracle, then stopped before browser launch because
the expected separate dotnet.boot.js was absent. SDK/workload 10.0.402 supplied
runtime 10.0.13; its default WasmInlineBootConfig=true embeds config in dotnet.js.
The isolated proof workflow now builds/publishes with the supported
`-p:WasmInlineBootConfig=false` property, producing external config without
rewriting generated JavaScript or changing translator source. The packager logs
a bounded public filename inventory for further diagnosis. Corrected browser
evidence remains pending.

Official property implementation: [WebAssembly Browser build targets](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/nuget/Microsoft.NET.Sdk.WebAssembly.Pack/build/Microsoft.NET.Sdk.WebAssembly.Browser.targets).

### Second CI outcome: initialization timeout, cause unresolved

[Run 39404536379](https://github.com/n3crosis/d2r-mobile/actions/runs/39404536379)
on `d6d934aa77bb378775463daa2f60a5dec988e7fa` passed publish, original native
translation and full runtime packaging. The valid browser scenario then timed
out after 60 seconds during initialization; native/browser parity and validators
were not reached. This does not establish a CSP/eval incompatibility or prove
network isolation. The next focused proof adds bounded public initialization
phase, uncaught-error and console diagnostics, without changing the timeout,
CSP or success assertions. Diagnostics stop before any operation payload is sent.

### Source-established sidecar classification deadlock and local regression

Inspection of the actual runtime version from the CI publish log, .NET 10.0.13,
identified a deterministic startup defect in this harness. The original loader
sets `dotnetSidecar` only when running in a Web Worker with no `globalThis.onmessage`
handler. Our dynamic bootstrap had already assigned `self.onmessage`. That makes
`ENVIRONMENT_IS_WORKER` true instead of marking the independent main runtime as a
sidecar. The asset loader then skips resolving `coreAssetsInMemory`, while
`onRuntimeInitializedAsync` awaits that promise. This is an initialization
control-flow deadlock, not evidence that CSP must permit JavaScript eval.

The sealed worker now registers its immediate message handler with
`addEventListener("message", ...)`, matching the existing shader worker. This
leaves the loader's detection slot unset without patching runtime globals,
modifying generated runtime JS, accepting early jobs, or changing any network
policy. The hook runs immediately, so early messages are still rejected rather
than lost or deferred until after initialization.

Pinned original implementation:

- [sidecar classification](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/browser/runtime/loader/globals.ts)
- [conditional core readiness completion](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/browser/runtime/loader/assets.ts)
- [unconditional startup readiness await](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/browser/runtime/startup.ts)

`node --test toolchain/offline-runtime-spike/test/dotnet-worker-startup.test.mjs`
passes three deterministic local regressions: original onmessage wiring selects
the non-completing branch; the actual repaired worker selects sidecar/completion;
and a pre-initialization operation still rejects immediately. Tests use exact
source excerpts with full-file SHA-256 provenance and upstream MIT license, and
execute the actual worker's top-level listener registration in a VM. They do not
execute the .NET runtime or substitute for the pending real browser/native parity
and zero-server-receipt proof.

The old CI output contains only a timeout, so it does not prove there are no
additional startup failures after this defect. Fresh runtime observation is still
required. Local browser execution remains unavailable under the sandbox, and the
heavy CI proof is manual-only; no dispatch-capable route was available at the
time this fix was prepared. The focused workflow must run the corrected revision
before claiming browser success or enabling production.
