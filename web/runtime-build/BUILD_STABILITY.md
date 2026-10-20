# Runtime build metadata stability

The public runtime keeps its source/compiler provenance in
`runtime-manifest.json` (`build.sourceRevision`, `sourceDirty`, `crossCommit`,
`emscripten`, and `dotnet`). Asset hashes, component manifests, transport hashes
and the page integrity anchor are still generated and verified normally.

Two narrow changes remove known avoidable inputs:

- The SPIRV-Cross wrapper verifies the pinned upstream commit, then sets
  `SOURCE_DATE_EPOCH` to that commit's committer epoch and `TZ=UTC` for both native
  and WASM builds. Its embedded `Timestamp` now means reproducible upstream
  source time, not wall-clock build time. An inherited epoch is deliberately
  replaced. Upstream source, compiler pins, licenses and comparison gates stay
  unchanged. [CMake documents this timestamp input](https://cmake.org/cmake/help/latest/command/string.html#timestamp).
- `ShaderSpike.csproj` sets `IncludeSourceRevisionInInformationalVersion=false`
  so unrelated app commits no longer enter the assembly's informational/product
  version. This does not remove debug metadata or disable SourceLink.
  [Microsoft documents the opt-out](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/8.0/source-link).

The local comparison of public artifacts `c49368d` and `693c453` found changing
SPIRV-Cross wall-clock strings and a renamed main .NET assembly containing each
app revision. The assembly change propagated to `dotnet.boot.js` and its nested
manifest. Comparing only unchanged logical paths misses fingerprinted assembly
renames. Those two standalone compressed WASM payloads in `693c453` total
944,601 bytes; their new hashes prevent reuse of their earlier public cache
entries. Small boot/manifest changes can also affect larger transport packs.
This is observed cache churn, not a guaranteed future byte saving.

The focused test runs the build wrapper with mock Git/CMake tools and checks the
.NET configuration and retained provenance. It does not compile anything.
These changes have **not yet demonstrated fully deterministic output**: debug
identifiers, SourceLink or other build inputs may still vary. Clean comparative
builds and existing compiler/runtime gates remain necessary. This source change
does not by itself establish a deployed payload, browser/device validation or
game compatibility.
