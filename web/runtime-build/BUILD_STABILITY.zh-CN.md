# 运行时构建元数据稳定性

English: [BUILD_STABILITY.md](BUILD_STABILITY.md)

公开运行时继续在 `runtime-manifest.json` 中保留源码与编译器来源信息：
`build.sourceRevision`、`sourceDirty`、`crossCommit`、`emscripten` 和 `dotnet`。
资源哈希、组件清单、传输哈希和页面完整性锚点仍按原流程生成并验证。

三项局部控制针对已确认的可避免输入：

- SPIRV-Cross 构建脚本先验证固定的上游提交，再将 `SOURCE_DATE_EPOCH` 设置为该提交的
  committer 时间戳，并为原生和 WASM 构建设置 `TZ=UTC`。内嵌的 `Timestamp` 现在表示
  可复现的上游源码时间，而非实际构建时钟。继承的时间戳会被明确覆盖。
  上游源码、编译器固定版本、许可证和比较门槛不变。
  [CMake 文档说明了该时间戳输入](https://cmake.org/cmake/help/latest/command/string.html#timestamp)。
- `ShaderSpike.csproj` 设置 `IncludeSourceRevisionInInformationalVersion=false`，
  使无关应用提交不再进入程序集的信息版本与产品版本。单独这一开关不删除调试元数据，也不禁用 SourceLink。
  [Microsoft 文档说明了此开关](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/8.0/source-link)。
- 同一隔离项目现设置 `EnableSourceLink=false`，同时明确保留 `DebugType=portable`
  和 `DebugSymbols=true`。本地调试符号仍然存在；调试时需要匹配的本地源码，不再自动获取远程源码。
  不使用全仓库 SCM 开关、虚假修订、符号剥离或二进制补丁。外层清单继续记录真实应用修订。
  [SourceLink 文档说明了此项目级开关](https://github.com/dotnet/sourcelink/blob/main/docs/README.md#enablesourcelink)。

这些控制去除了依赖应用修订的元数据，但不保证所有构建输入都完全确定。更改工具链时，应保留来源记录并在干净环境中比较构建结果。
