# 公共 SDK 下载缓存

[English](SDK_CACHE.md)

唯一的 Verify 作业只缓存 `$RUNNER_TEMP/browser-emsdk/downloads`，其中仅包含公共
Emscripten SDK 压缩包。每次运行首先重新克隆 SDK 4.0.20 并检查提交
`e4fe26ef59168ff44f4c23c466e497bf60b3411e`，再使用包含运行器操作系统/架构、Ubuntu
镜像、SDK 版本及源码提交的准确键恢复下载文件。不配置后备恢复键。

`EMSDK_KEEP_DOWNLOADS=1` 保留下载压缩包以供复用。固定的
[SDK 实现](https://github.com/emscripten-core/emsdk/blob/e4fe26ef59168ff44f4c23c466e497bf60b3411e/emsdk.py)
默认会在成功安装后删除它们。缓存命中时仍执行安装、激活、显式编译器版本检查，以及所有
项目源码/构建/回执检查。缓存未命中时继续使用原有官方 SDK 下载路径。

Action 固定为
[`actions/cache` v6.1.0](https://github.com/actions/cache/releases/tag/v6.1.0)，提交
`55cc8345863c7cc4c66a329aec7e433d2d1c52a9`；其
[Action 定义](https://github.com/actions/cache/blob/55cc8345863c7cc4c66a329aec7e433d2d1c52a9/action.yml)
使用 Node 24。缓存不含 SDK 脚本、已安装工具、Rust/.NET 缓存、项目构建目录、运行时载荷、
私有输入或凭据。不新增作业、矩阵或跳过构建的路径。每个运行时仍重新构建。

这可减少重复的上游下载，不减少编译或压缩包解压工作。没有实测或保证耗时改善。仓库接线
不证明 CI 已成功恢复/保存缓存；应检查具体运行的缓存日志。缓存不是来源认证或构建证明，
绝不替代现有编译器/源码检查或经过清单验证的暂存步骤。

本地检查：工作流格式、YAML 解析、每个 `run` 块的 Bash 语法，以及
`node --test web/tests/ci-policy.test.mjs`。这些检查不会执行托管缓存服务、安装 SDK，
也不证明浏览器或设备行为。

托管证据：[运行 39492925067](https://github.com/n3crosis/d2r-mobile/actions/runs/39492925067)
于 2026-10-20 通过。准确的 SDK 下载缓存键首次未命中，构建后成功保存。
该首次运行尚不能证明后续缓存命中或耗时收益。
