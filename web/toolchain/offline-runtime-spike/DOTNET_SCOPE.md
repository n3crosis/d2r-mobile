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

- [public Asset and loader-hook types](https://github.com/dotnet/runtime/blob/v10.0.10/src/mono/browser/runtime/types/index.ts)
- [.NET 10 configuration loader](https://github.com/dotnet/runtime/blob/v10.0.10/src/mono/browser/runtime/loader/config.ts)
- [resource loader and resolvedUrl](https://github.com/dotnet/runtime/blob/v10.0.10/src/mono/browser/runtime/loader/assets.ts)
- [builder configuration/resource hooks](https://github.com/dotnet/runtime/blob/v10.0.10/src/mono/browser/runtime/loader/run.ts)

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
