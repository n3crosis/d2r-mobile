# Browser shader translator spike (not built or validated)

This is isolated developer scaffolding, **not a working translator release**.
No .NET SDK is installed in the current workspace and its temporary disk is
nearly full. No SDK/workload install, C# compilation, native oracle run,
SPIR-V validation, browser runtime test, or game compatibility test was done.
The React/shadcn preview does not load this directory. It does not unblock IPA
assembly by itself. There are no game bytes, keys, or generated binaries here.

## Chosen boundary

Compile the existing managed translator for `browser-wasm` with .NET 10.
A module worker calls a `JSExport` taking job JSON and shader bytes, returning
SPIR-V as base64 and the existing resource sidecar. File paths and CLI filesystem
operations stay out of the bridge. First scope is a synthetic **compute-only**
program; graphics headers are rejected until separately validated. Size caps
(1 MiB shader, 64 KiB metadata) and terminating the worker bound this test;
they are not a complete hostile-input validator. The worker is single-threaded,
not a shared-memory/pthread build. Do not expose this harness as a production API.

`ShaderBridge.cs` adapts the native CLI's Accessor and output construction without
editing upstream. `upstream-source.sha256` records the source it was copied from.
The parity utility rejects source drift. It does not mechanically prove the copy
is equivalent; review and parity tests remain required. Preserve c1 jump-table
reads, resource binding allocation, debug/reduced flags and graphics-state defaults
when extending it. The bridge currently accepts compute only, not all native jobs.

### Dependency closure

`ShaderSpike.csproj` source-links:

- All `Ryujinx.Graphics.Shader` sources, with GLSL helper resources retained.
- All `Spv.Generator` sources.
- Five original Common files: `Memory/IArray.cs`, `Memory/StructArrayHelpers.cs`,
  `Utilities/BitUtils.cs`, `Utilities/BitfieldExtensions.cs`, and
  `Pools/ObjectPool.cs`.
- A local `EmbeddedResources.ReadAllText` shim that reads the explicitly named
  resources from this combined assembly. The only linked caller is the GLSL
  generator; no other Common resource APIs are promised.

Static inspection found the initial Common dependencies in the linked shader sources.
The first CI compiler pass identified `ObjectPool<T>` in SPIR-V generation; its
original Common source is now linked too.
The original Common resource helper drags in `StreamUtils` and recyclable streams;
its project also references MsgPack, Humanizer and Gommon and includes unrelated
platform code. Source-linking avoids those dependencies rather than hoping the
browser linker removes them. This closure is **not yet compiler-confirmed**.
Generic integer operations, span layout, thread-static caches, unsafe code and
all browser runtime behavior still require tests. The single-assembly arrangement
is deliberate; named GLSL resources retain their original logical names.

Keep `dm/third_party/ryujinx/LICENSE.txt` and the vendored provenance README with
redistributed artifacts. Linked upstream source remains upstream-licensed;
this experiment does not alter those licenses or certify redistribution compliance.

## Build on developer infrastructure, not end-user machines

Use a clean, adequately sized developer/CI host with the official .NET 10 SDK
and `wasm-tools` workload. Pin the exact SDK and workload versions before recording
results. No custom vendor download scripts are needed. The end user eventually
receives static runtime assets and uses Chromium on Windows or macOS, without
installing Python, .NET or Xcode. A developer compiler is compatible with that goal.

Microsoft documents the WebAssembly SDK, `JSExport`, `dotnet.create()` and deploying
runtime assets into an existing JavaScript application:
[Browser interop](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app?view=aspnetcore-10.0).
The worker approach avoids blocking React:
[.NET on Web Workers](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-on-webworkers?view=aspnetcore-10.0).
Use the .NET 10 manual-worker path, not the .NET 11 template shown alongside it.
Start with interpretation, no trimming and no AOT; measure before optimizing.

Developer commands, **not executed here** (run from repository root):

```sh
dotnet workload install wasm-tools
dotnet restore web/toolchain/shader-spike/ShaderSpike.csproj
dotnet format web/toolchain/shader-spike/ShaderSpike.csproj --verify-no-changes --include web/toolchain/shader-spike/ShaderBridge.cs web/toolchain/shader-spike/EmbeddedResources.cs
dotnet build web/toolchain/shader-spike/ShaderSpike.csproj -c Release -p:EnableNETAnalyzers=true -p:AnalysisLevel=latest
dotnet publish web/toolchain/shader-spike/ShaderSpike.csproj -c Release
```

Resolve compiler/platform analyzer findings rather than suppressing them wholesale.
`dotnet format` may initially fail because C# formatting has not been run here.
Prettier/ESLint checks cover only their supported web files, not C# compatibility.
Do not include linked vendored sources in formatting changes. Keep build products
under the spike's ignored `bin/`, `obj/` or `artifacts/` directories.

Inspect the SDK's reported publish output; host the complete static bundle over
HTTP(S), retaining `_framework`. Ensure `index.html`, `worker.mjs` and
`synthetic-fixture.mjs` are siblings of `_framework` (the extra-file deploy items
are intended to do this but have not been tested). Do not open via `file://`.
Use an already-approved static host/server with correct Wasm MIME type, no SPA
fallback for missing assets, and a CSP permitting the .NET Wasm runtime. No COOP/
COEP requirement is assumed for this single-threaded worker; verify actual hosting.

An adequately provisioned remote developer build is the next practical step.
A successful Sites npm build does **not** establish that the .NET SDK/workload is
available there. Keep Sites deployment unchanged until a verified bundle exists.
Do not put SDK installation in the public browser startup or ordinary preview build.

## Synthetic fixture and oracle gate

`synthetic-fixture.mjs` constructs 16 bytes: a scheduling word at byte 0, then
little-endian `0xe30000000007000f` at byte 8. This is derived from this repository's
`InstTable` EXIT pattern, `InstExit` predicate/condition fields (`PT=7`, `Ccc.T=15`),
and `Decoder.FillBlock` skipping a control word each 32 bytes. It is an intentionally
minimal valid-encoding candidate, **not yet confirmed by a native translation**.
No shader header is needed for compute. This is not a GPU execution correctness test.

1. Prepare generated fixture files outside tracked source:

   ```sh
   node web/toolchain/shader-spike/verify-parity.mjs prepare web/toolchain/shader-spike/artifacts/fixture
   ```

2. Build/run the **unmodified native** CLI on the same pinned commit using its
   original Common project as the independent oracle (developer host only):

   ```sh
   dotnet run --project dm/gfx/tools/dmsh_xlate/dmsh_xlate.csproj -c Release -- web/toolchain/shader-spike/artifacts/fixture/jobs.json web/toolchain/shader-spike/artifacts/native
   ```

   Require exit code zero and both output files. Record native `--source-sha`,
   full input SHA-256, repository commit and SDK/workload version. Do not replace
   this independent oracle with the browser bridge compiled for desktop.

3. Open the built test harness in Chromium; click the synthetic fixture button.
   Save `browser-result.json`. A response is merely a translation candidate.

4. Require exact SPIR-V bytes and JSON resource metadata parity:

   ```sh
   node web/toolchain/shader-spike/verify-parity.mjs compare web/toolchain/shader-spike/artifacts/native /absolute/path/to/browser-result.json
   spirv-val --target-env vulkan1.1 web/toolchain/shader-spike/artifacts/native/synthetic-exit.spv
   ```

   Use an official SPIRV-Tools build already installed on the developer host.
   Exact binary parity means validation of that native file validates the browser
   bytes too. The initial Vulkan 1.1 target matches the source's SPIR-V 1.3
   header. The validator target must also match emitted capabilities;
   investigate and document target mismatches rather than silently relaxing it.

5. Repeat on Windows and macOS Chromium. Record browser version, startup time,
   translation time, peak memory and downloads. Add nontrivial authored fixtures
   for arithmetic, branches, resources, c1 indirect branches and graphics SPH, with
   explicit expected behavior; validate both debug/reduced modes before broad claims.
   Evaluate deterministic repeated runs and larger batches, not only this no-op shader.

Stop on a build, runtime, parity or validation failure and diagnose it. No passing
C# build, EXIT fixture or SPIR-V validation alone proves game compatibility, Metal
conversion, metallib availability, correct rendering or a working unsigned IPA.
