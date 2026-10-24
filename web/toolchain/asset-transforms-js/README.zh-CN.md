# JavaScript 资源表格变换

四个生产资源操作现改用独立 JavaScript，无 Python、Pillow、npm 依赖、文件系统或网络访问：

- `experience-table`：原始 TSV/CSV 筛选规则与 `dm_hud_exp.h` 字节。
- `overlay-paths`：原始手柄布局、按键、光标路径映射与 ASCII JSON 字节。
- `vault-table`：完整的七张物品表、三张图标 JSON 表、清单存在性校验、类型继承、图标回退、排序与 `dm_vault_tab.h` 字节。
- `derived-tables`：全部五类运行时记录、完整来源哈希/数量校验、整数范围、技能唯一性、控制字符拒绝、单行/总输出限制与回执。

分派器不回退至 Python，保留现有 worker 的 `files` 返回契约。
生产路由与组装见 [JavaScript/WASM 资产运行时](../asset-runtime-js/README.zh-CN.md)。
旧 Pyodide 证明 worker 与开发 worker 也使用本模块；这四个操作不初始化 Python。

`source-provenance.json` 同时锁定原生实现和旧边界适配器。
`scripts/verify-source.mjs` 在来源变化时拒绝运行时构建。
JavaScript 源码纳入现有 SHA-256 运行时清单。
原生 Python 文件保留在仓库作为参考和构建时来源。

## 聚焦验证

在仓库根目录运行：

    node web/toolchain/asset-transforms-js/scripts/verify-source.mjs
    node web/toolchain/asset-transforms-js/test/parity.mjs

对照程序仅提取原始函数到纯标准库命名空间，使用人工合成输入，逐字节比较所有输出和回执字段。
不会使用游戏数据、浏览器、原生应用、图片库或完整构建。
分派测试以抛错哨兵代替 Python，证明纯操作不会意外进入它。

兼容目标是原生生成器的实际产物和游戏表格式，不是任意 Python 程序。
生成 C 字符串支持 UTF-8、反斜杠/引号、十六进制、八进制与字节值 Unicode 转义；
原生生成器不会产生 `\N{...}` Unicode 名称转义，故拒绝它。
这是遇到未知内容即拒绝的解析器，不是 C 编译器。
JavaScript 与 CPython 的 Unicode 数据版本对新增字符可能不同；生产表的键和数字采用已有来源格式。
