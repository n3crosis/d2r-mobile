# Runtime build metadata stability

中文: [BUILD_STABILITY.zh-CN.md](BUILD_STABILITY.zh-CN.md)

The public runtime keeps its source/compiler provenance in
`runtime-manifest.json` (`build.sourceRevision`, `sourceDirty`, `crossCommit`,
`emscripten`, and `dotnet`). Asset hashes, component manifests, transport hashes
and the page integrity anchor are still generated and verified normally.

Three narrow controls target known avoidable inputs:

- The SPIRV-Cross wrapper verifies the pinned upstream commit, then sets
  `SOURCE_DATE_EPOCH` to that commit's committer epoch and `TZ=UTC` for both native
  and WASM builds. Its embedded `Timestamp` now means reproducible upstream
  source time, not wall-clock build time. An inherited epoch is deliberately
  replaced. Upstream source, compiler pins, licenses and comparison gates stay
  unchanged. [CMake documents this timestamp input](https://cmake.org/cmake/help/latest/command/string.html#timestamp).
- `ShaderSpike.csproj` sets `IncludeSourceRevisionInInformationalVersion=false`
  so unrelated app commits no longer enter the assembly's informational/product
  version. This control alone does not remove debug metadata or disable SourceLink.
  [Microsoft documents the opt-out](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/8.0/source-link).
- The same isolated project now sets `EnableSourceLink=false`, while explicitly
  retaining `DebugType=portable` and `DebugSymbols=true`. Local debug symbols
  remain; debugging requires matching local sources instead of automatic remote
  source retrieval. No repository-wide SCM switch, fake revision, symbol
  stripping or binary patch is used. The outer manifest still records the real
  app revision. [SourceLink documents this project switch](https://github.com/dotnet/sourcelink/blob/main/docs/README.md#enablesourcelink).

The local comparison of public artifacts `c49368d` and `693c453` found changing
SPIRV-Cross wall-clock strings and a renamed main .NET assembly containing each
app revision. The assembly change propagated to `dotnet.boot.js` and its nested
manifest. Comparing only unchanged logical paths misses fingerprinted assembly
renames. Those two standalone compressed WASM payloads in `693c453` total
944,601 bytes; their new hashes prevent reuse of their earlier public cache
entries. Small boot/manifest changes can also affect larger transport packs.
This is observed cache churn, not a guaranteed future byte saving.

After the first two controls, artifacts `a1b4afe` and `502fd5f` contained identical
SPIRV-Cross WASM, but the main .NET assembly still differed in 67 GUID/debug/PDB
metadata bytes. [CI run 39502974763](https://github.com/n3crosis/d2r-mobile/actions/runs/39502974763)
then reported one generated SourceLink mapping containing the current app
revision: 158 bytes, SHA-256
`3ac44e74cb0d4cae879ed28a5041713fdd3e0cc059da5cfd7b5afb4144762285`.
This confirms a revision-dependent input, not that it explains every differing
PDB byte. The project-only SourceLink opt-out follows that observation.

The bounded build-only diagnostic remains in CI logs, outside the public
payload. A fresh build should report `status: "absent"` after this opt-out;
an old local `obj` file may otherwise produce a stale observation. No paths,
URLs, PDB contents or environment values are logged.

The observed public artifact pair `e93a15a` / `32e9717` has identical bytes for
all 297 logical assets and all 33 runtime payloads, including .NET boot/main
assembly and SPIRV-Cross. Only the outer manifest's `build.sourceRevision`
changed. This pair demonstrates stability after the controls, not a guarantee
across all future source, compiler, environment or dependency changes.

The focused test runs the build wrapper with mock Git/CMake tools and checks the
.NET configuration and retained provenance. It does not compile anything.
These changes have **not yet demonstrated fully deterministic output**: debug
identifiers or other build inputs may still vary. Clean comparative
builds and existing compiler/runtime gates remain necessary. This source change
does not by itself establish a deployed payload, browser/device validation or
game compatibility.
