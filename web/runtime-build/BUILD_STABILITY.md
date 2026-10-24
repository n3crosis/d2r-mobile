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

These controls remove revision-dependent metadata, not every possible nondeterministic build input. Keep source provenance and validate clean comparative builds when changing toolchains.
