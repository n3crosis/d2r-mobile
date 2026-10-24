# 已完成 IPA 的下载准备

English: [DOWNLOAD_PREPARATION.md](DOWNLOAD_PREPARATION.md)

即使浏览器无法创建 IPA 对象 URL，成功转换及其资源/Legacy Device Pack 导出
仍保持完成。界面保留成功的 Blob 与文件名，单独提示下载准备失败，并提供只重试
准备链接的按钮，不重新转换或导出，不显示原始浏览器错误。

`createDownloadPreparation()` 持有保留的 Blob 和准备好的 URL。retain 接收已
完成输出，prepare 返回 ready、retryable 或 unavailable，dispose 丢弃引用并
释放当前 URL。同一输出重复准备会复用已有 URL；替换时只有新 URL 创建成功才
释放旧 URL。卸载时释放保留输出。不增加文件/网络访问或持久存储。

自动点击只是便利功能：节点创建、插入、点击和移除失败都由
`attemptAutomaticDownload` 隔离，成功建立的可见链接仍可使用。界面将已完成
生成分支与转换失败报告分开，因此准备失败不会把已完成 Legacy Device Pack
改成未完成，也不会声称没有生成 IPA。

`node --test web/tests/download-preparation.test.mjs` 覆盖保留 Blob 重试、
URL 替换/复用/释放、自动点击失败和 UI 源码契约。合成 URL/DOM 替身不能代替
真实浏览器下载测试。
