# 运行时构建元数据稳定性

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

对公开产物 `c49368d` 与 `693c453` 的本地比较发现，SPIRV-Cross 的时钟字符串变化，
主 .NET 程序集也因包含不同应用修订而改变指纹文件名。程序集变化随后传播到
`dotnet.boot.js` 和其组件清单。只比较保留的逻辑路径会漏掉程序集的指纹重命名。
`693c453` 中这两个独立压缩 WASM 载荷合计 944,601 字节；新哈希使其无法复用先前的
公开缓存条目。较小的启动配置和清单变化还可能影响较大的传输包。
这是已观察到的缓存变化，并非对未来节省字节数的保证。

前两项控制应用后，产物 `a1b4afe` 和 `502fd5f` 的 SPIRV-Cross WASM 完全相同，
但主 .NET 程序集仍有 67 个 GUID、调试及 PDB 元数据字节不同。
[CI 运行 39502974763](https://github.com/n3crosis/d2r-mobile/actions/runs/39502974763)
随后报告生成的 SourceLink 包含一个带有当前应用修订的映射：158 字节，SHA-256 为
`3ac44e74cb0d4cae879ed28a5041713fdd3e0cc059da5cfd7b5afb4144762285`。
这确认了依赖修订的输入，并未证明它解释了每个不同的 PDB 字节。
上述观察之后才加入此项目级 SourceLink 禁用设置。

有界的构建诊断继续保留在 CI 日志中，不进入公开载荷。设置生效后的干净构建应报告
`status: "absent"`；旧的本地 `obj` 文件可能导致过时观察。日志不包含路径、URL、
PDB 内容或环境值。仍需后续干净产物比较，才能确认 .NET 字节是否稳定。

定向测试使用模拟 Git/CMake 工具执行构建脚本，并检查 .NET 配置与保留的来源信息，
不会实际编译。上述修改**尚未证明输出完全确定**：调试标识或其他构建输入
仍可能变化。仍需干净环境中的比较构建和现有编译器、运行时检查。
本次源码修改本身不代表已部署产物、浏览器或设备验证，也不证明游戏兼容性。
