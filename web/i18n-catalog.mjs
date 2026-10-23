// 生成文件，勿手改：python3 web/scripts/generate-i18n.py；来源 dm/i18n/ui_text.tsv。
// Generated; do not edit: python3 web/scripts/generate-i18n.py; source dm/i18n/ui_text.tsv.
export const catalog = Object.freeze({
  "dmWebReasonsProdKeysMissing": [
    "prod.keys is missing.",
    "缺少 prod.keys。"
  ],
  "dmWebReasonsProdKeysUnreadable": [
    "prod.keys could not be read. Check local file access.",
    "无法读取 prod.keys。请检查本地文件访问权限。"
  ],
  "dmWebReasonsProdKeysTooLarge": [
    "prod.keys exceeds the 1 MiB limit.",
    "prod.keys 超过 1 MiB 限制。"
  ],
  "dmWebReasonsProdKeysEmpty": [
    "prod.keys contains no key entries.",
    "prod.keys 不包含密钥条目。"
  ],
  "dmWebReasonsProdKeysMalformed": [
    "prod.keys has an unsupported or malformed key line.",
    "prod.keys 中存在不支持或格式错误的密钥行。"
  ],
  "dmWebReasonsTitleKeyRequired": [
    "No matching title key was available from supported NSP tickets or title.keys. Add your own matching title.keys to the selected folder.",
    "支持的 NSP 票据及 title.keys 中均无匹配的标题密钥。请将你自己的匹配 title.keys 放入所选文件夹。"
  ],
  "dmWebReasonsTitleKeysMissing": [
    "title.keys is missing. An empty file is allowed when no title keys are needed.",
    "缺少 title.keys。不需要标题密钥时允许使用空文件。"
  ],
  "dmWebReasonsTitleKeysUnreadable": [
    "title.keys could not be read. Check local file access.",
    "无法读取 title.keys。请检查本地文件访问权限。"
  ],
  "dmWebReasonsTitleKeysTooLarge": [
    "title.keys exceeds the 1 MiB limit.",
    "title.keys 超过 1 MiB 限制。"
  ],
  "dmWebReasonsTitleKeysMalformed": [
    "title.keys has an unsupported or malformed key line.",
    "title.keys 中存在不支持或格式错误的密钥行。"
  ],
  "dmWebReasonsKeysRuntimeFailed": [
    "The isolated package reader could not load the key files.",
    "隔离的软件包读取器无法载入密钥文件。"
  ],
  "dmWebReasonsPackageIndexInvalid": [
    "An NSP index is unreadable, damaged, or unsupported.",
    "NSP 索引无法读取、已损坏或不受支持。"
  ],
  "dmWebReasonsTicketUnsupported": [
    "An embedded ticket format cannot be read. A matching title.keys entry can be used only when the ticket rights ID can be verified.",
    "无法读取内嵌票据格式。只有验证票据的权限 ID 后才能使用匹配的 title.keys 条目。"
  ],
  "dmWebReasonsTicketInvalid": [
    "An embedded ticket is malformed, truncated, or unreadable.",
    "内嵌票据格式错误、被截断或无法读取。"
  ],
  "dmWebReasonsTicketRightsIdMismatch": [
    "An embedded ticket name does not match its rights ID.",
    "内嵌票据名称与其权限 ID 不匹配。"
  ],
  "dmWebReasonsTicketKeyConflict": [
    "Embedded tickets contain conflicting keys for the same rights ID.",
    "内嵌票据为同一权限 ID 提供了冲突的密钥。"
  ],
  "dmWebReasonsTicketLimitExceeded": [
    "The selected packages exceed the embedded-ticket limit.",
    "所选软件包超出内嵌票据数量限制。"
  ],
  "dmWebReasonsContentReadFailed": [
    "Package content could not be read completely.",
    "无法完整读取软件包内容。"
  ],
  "dmWebReasonsContentAuthenticationFailed": [
    "Content verification failed. The keys may not match the packages, or a package may be damaged or unsupported.",
    "内容验证失败。密钥可能与软件包不匹配，或软件包已损坏或不受支持。"
  ],
  "dmWebReasonsContentMetadataInvalid": [
    "Package metadata is invalid or inconsistent.",
    "软件包元数据无效或不一致。"
  ],
  "dmWebReasonsExtractionWorkerUnavailable": [
    "The isolated package reader is unavailable.",
    "隔离的软件包读取器不可用。"
  ],
  "dmWebReasonsExtractionTransportFailed": [
    "The browser could not pass local inputs to the package reader.",
    "浏览器无法将本地输入传递给软件包读取器。"
  ],
  "dmWebReasonsExtractionProtocolFailed": [
    "The package reader returned an unexpected response.",
    "软件包读取器返回了意外响应。"
  ],
  "dmWebReasonsExtractionWorkerFailed": [
    "The isolated package reader stopped unexpectedly.",
    "隔离的软件包读取器意外停止。"
  ],
  "dmWebReasonsExtractionTimeout": [
    "Package verification exceeded its time limit.",
    "软件包验证超时。"
  ],
  "dmWebReasonsExtractionFailed": [
    "Local package verification did not complete.",
    "本地软件包验证未完成。"
  ],
  "dmWebStagesCapabilities": [
    "Checking capabilities",
    "检查功能支持"
  ],
  "dmWebStagesDiscovery": [
    "Finding local inputs",
    "查找本地输入"
  ],
  "dmWebStagesSecrets": [
    "Verifying local keys and packages",
    "验证本地密钥和软件包"
  ],
  "dmWebStagesInspection": [
    "Inspecting package identities",
    "检查软件包标识"
  ],
  "dmWebStagesSelection": [
    "Selecting package content",
    "选择软件包内容"
  ],
  "dmWebStagesExtraction": [
    "Extracting selected content",
    "提取所选内容"
  ],
  "dmWebStagesDisposal": [
    "Closing the isolated key session",
    "关闭隔离的密钥会话"
  ],
  "dmWebStagesProgram": [
    "Generating the application",
    "生成应用程序"
  ],
  "dmWebStagesAssets": [
    "Generating assets",
    "生成资源"
  ],
  "dmWebStagesShaders": [
    "Generating shaders",
    "生成着色器"
  ],
  "dmWebStagesShell": [
    "Validating the application shell",
    "验证应用程序外壳"
  ],
  "dmWebStagesValidation": [
    "Validating generated content",
    "验证生成的内容"
  ],
  "dmWebStagesAssembly": [
    "Checking the assembly",
    "检查组装结果"
  ],
  "dmWebStagesOutput": [
    "Writing the archive",
    "写入归档"
  ],
  "dmWebStagesResources": [
    "Saving game resources locally",
    "在本地保存游戏资源"
  ],
  "dmWebStagesArchive": [
    "Validating the archive",
    "验证归档"
  ],
  "dmWebStagesCleanup": [
    "Releasing temporary resources",
    "释放临时资源"
  ],
  "dmWebStagesCommit": [
    "Finalizing the archive",
    "完成归档"
  ],
  "dmWebProgresslabelsProdKeysRead": [
    "Reading prod.keys locally",
    "在本地读取 prod.keys"
  ],
  "dmWebProgresslabelsTitleKeysRead": [
    "Reading title.keys locally",
    "在本地读取 title.keys"
  ],
  "dmWebProgresslabelsKeysLoad": [
    "Loading keys into the isolated reader",
    "将密钥载入隔离的读取器"
  ],
  "dmWebProgresslabelsPackageIndex": [
    "Reading NSP indexes",
    "读取 NSP 索引"
  ],
  "dmWebProgresslabelsTicketFound": [
    "Embedded tickets found",
    "找到内嵌票据"
  ],
  "dmWebProgresslabelsTicketKeyAdded": [
    "Title keys added from tickets",
    "已从票据添加标题密钥"
  ],
  "dmWebProgresslabelsTicketKeyReused": [
    "Existing title keys reused",
    "已复用现有标题密钥"
  ],
  "dmWebProgresslabelsContentHash": [
    "Hashing package content",
    "计算软件包内容哈希"
  ],
  "dmWebProgresslabelsContentHeader": [
    "Verifying encrypted content headers",
    "验证加密内容头"
  ],
  "dmWebProgresslabelsContentMetadata": [
    "Verifying package metadata",
    "验证软件包元数据"
  ],
  "dmWebProgresslabelsRomfsRead": [
    "Reading RomFS for verification",
    "读取 RomFS 以进行验证"
  ],
  "dmWebProgresslabelsRomfsBase": [
    "Verifying base RomFS",
    "验证基础 RomFS"
  ],
  "dmWebProgresslabelsRomfsMerged": [
    "Verifying merged update RomFS",
    "验证合并更新后的 RomFS"
  ],
  "dmWebStageState": [
    "%s: %s",
    "%s：%s"
  ],
  "dmWebRunning": [
    "running",
    "进行中"
  ],
  "dmWebComplete": [
    "complete",
    "完成"
  ],
  "dmWebFailed": [
    "failed",
    "失败"
  ],
  "dmWebCancelled": [
    "Cancelled.",
    "已取消。"
  ],
  "dmWebLocalPackaging": [
    "Local packaging",
    "本地打包"
  ],
  "dmWebFailureSummary": [
    "%s failed%s. %sNo completed IPA is available.",
    "%s失败%s。%s没有可用的完整 IPA。"
  ],
  "dmWebOutputPossible": [
    " Resources may have been saved in a D2R-resources subfolder inside the selected folder.",
    " 资源可能已保存到所选文件夹内的 D2R-resources 子文件夹。"
  ],
  "dmWebOutputNone": [
    " No resources were exported by this attempt.",
    " 本次尝试未导出资源。"
  ],
  "dmWebOutputComplete": [
    " Complete game resources remain in %s inside the selected folder, but no completed IPA is available.",
    " 完整游戏资源保留在所选文件夹内的 %s 中，但没有可用的完整 IPA。"
  ],
  "dmWebOutputRemoved": [
    " The incomplete resource export was removed; no resource folder from this attempt remains.",
    " 已删除未完成的资源导出；本次尝试未留下资源文件夹。"
  ],
  "dmWebOutputIncomplete": [
    " Incomplete resources may remain in %s inside the selected folder. Do not use this as a finished resource set. Check the folder before retrying.%s",
    " 未完成的资源可能保留在所选文件夹内的 %s 中。不要将其用作完整资源集。重试前请检查该文件夹。%s"
  ],
  "dmWebMarkerPresent": [
    " An incomplete-export warning marker remains.",
    " 未完成导出的警告标记仍然存在。"
  ],
  "dmWebMarkerUnknown": [
    " An incomplete-export warning marker could not be confirmed.",
    " 无法确认未完成导出的警告标记。"
  ],
  "dmWebFailureRetry": [
    " Reload to try again. Keep key files on this device; the activity log contains no keys or filenames.",
    " 请重新载入后重试。密钥文件应保留在本设备上；活动日志不包含密钥或文件名。"
  ],
  "dmWebRomfsVerified": [
    "%s: %s%% (%s MB verified)",
    "%s：%s%%（已验证 %s MB）"
  ],
  "dmWebLoading": [
    "Loading application files…",
    "正在载入应用文件…"
  ],
  "dmWebUnsupported": [
    "This build is not ready, or this browser is unsupported. Use desktop Chrome or Edge.",
    "此版本尚未就绪，或当前浏览器不受支持。请使用桌面版 Chrome 或 Edge。"
  ],
  "dmWebLoadingVerified": [
    "Loading verified application files",
    "正在载入已验证的应用文件"
  ],
  "dmWebDownloading": [
    "Downloading application files",
    "正在下载应用文件"
  ],
  "dmWebPreparing": [
    "Preparing isolated application runtimes",
    "正在准备隔离的应用运行时"
  ],
  "dmWebReady": [
    "Ready. Files stay on this device.",
    "已就绪。文件始终保留在本设备上。"
  ],
  "dmWebApplicationReady": [
    "Application ready",
    "应用已就绪"
  ],
  "dmWebSetupFailed": [
    "Application setup failed before local inputs were opened",
    "应用准备失败，尚未打开本地输入"
  ],
  "dmWebWaitingFolder": [
    "Waiting for folder selection…",
    "等待选择文件夹…"
  ],
  "dmWebCancelledReload": [
    "Cancelled. Reload to start again.",
    "已取消。请重新载入以再次开始。"
  ],
  "dmWebFolderFailed": [
    "Folder check failed; check the status message",
    "文件夹检查失败；请查看状态消息"
  ],
  "dmWebMissingInput": [
    "Put NSP/XCI packages and prod.keys directly inside this folder, not in a subfolder.",
    "请将 NSP/XCI 软件包和 prod.keys 直接放入此文件夹，而非子文件夹。"
  ],
  "dmWebFolderPermission": [
    "Choose the folder again and allow access to read inputs and save the resource subfolder.",
    "请重新选择文件夹，并允许读取输入及保存资源子文件夹。"
  ],
  "dmWebFolderUnreadable": [
    "The folder could not be read. Check access and choose it again.",
    "无法读取该文件夹。请检查访问权限并重新选择。"
  ],
  "dmWebStarting": [
    "Starting IPA generation…",
    "正在开始生成 IPA…"
  ],
  "dmWebGenerationStarted": [
    "Generation started; private inputs remain local",
    "已开始生成；私密输入仍保留在本地"
  ],
  "dmWebFastMode": [
    "Fast mode: full RomFS scan will be skipped after package hashes match",
    "快速模式：软件包哈希匹配后将跳过完整 RomFS 扫描"
  ],
  "dmWebVerifyHashOption": [
    "Verify full content hashes (slower)",
    "验证完整内容哈希（较慢）"
  ],
  "dmWebVerifyHashHelp": [
    "Off by default for faster generation; signed headers and package structure are still checked. Turn on to hash all package content.",
    "默认关闭以加快生成；仍会检查签名头部和软件包结构。开启后会读取并验证所有软件包内容。"
  ],
  "dmWebSkipHashActive": [
    "Fast mode: skipping full content hashes and RomFS scan; signed headers and structure are still checked",
    "快速模式：跳过完整内容哈希及 RomFS 扫描；仍会检查签名头部和结构"
  ],
  "dmWebProgresslabelsExefsOpen": [
    "Opening selected executable content",
    "打开选定的可执行内容"
  ],
  "dmWebProgresslabelsExefsRead": [
    "Reading executable modules",
    "读取可执行模块"
  ],
  "dmWebProgresslabelsRomfsOpen": [
    "Opening selected RomFS",
    "打开选定的 RomFS"
  ],
  "dmWebProgresslabelsRomfsIndex": [
    "Indexing RomFS files",
    "索引 RomFS 文件"
  ],
  "dmWebProgresslabelsLogicalIndex": [
    "Indexing game assets",
    "索引游戏资源"
  ],
  "dmWebUnsignedReady": [
    "Unsigned IPA ready; resources saved locally",
    "未签名 IPA 已就绪；资源已保存到本地"
  ],
  "dmWebGenerating": [
    "Generating IPA…",
    "正在生成 IPA…"
  ],
  "dmWebGenerate": [
    "Generate unsigned IPA",
    "生成未签名 IPA"
  ],
  "dmWebCancellingWait": [
    "Cancelling… Waiting for the current operation to stop.",
    "正在取消… 等待当前操作停止。"
  ],
  "dmWebCancellationRequested": [
    "Cancellation requested",
    "已请求取消"
  ],
  "dmWebCancelling": [
    "Cancelling…",
    "正在取消…"
  ],
  "dmWebCancel": [
    "Cancel",
    "取消"
  ],
  "dmWebStopping": [
    "Stopping generation",
    "正在停止生成"
  ],
  "dmWebInProgress": [
    "Generation in progress",
    "正在生成"
  ],
  "dmWebStoppingAria": [
    "Stopping IPA generation",
    "正在停止生成 IPA"
  ],
  "dmWebProgressAria": [
    "IPA generation in progress",
    "正在生成 IPA"
  ],
  "dmWebWaitCleanup": [
    "Waiting for cancellation and cleanup to finish.",
    "等待取消和清理完成。"
  ],
  "dmWebLargePackages": [
    "Large packages can take several minutes to verify, even when the activity log is quiet.",
    "大型软件包验证可能需要数分钟，即使活动日志暂时没有新内容也属正常。"
  ],
  "dmWebCopied": [
    "Log copied.",
    "已复制日志。"
  ],
  "dmWebCopiedNew": [
    "Log copied. New entries have arrived; copy again for the latest log.",
    "已复制日志。有新记录到达；请再次复制以获取最新日志。"
  ],
  "dmWebCopyFailed": [
    "Copy failed. Select the log text and copy it manually.",
    "复制失败。请选中日志文字并手动复制。"
  ],
  "dmWebReloadRetry": [
    "Reload and retry",
    "重新载入并重试"
  ],
  "dmWebReload": [
    "Reload to start again",
    "重新载入以再次开始"
  ],
  "dmWebTitle": [
    "D2R Mobile",
    "D2R Mobile"
  ],
  "dmWebChoose": [
    "Choose folder",
    "选择文件夹"
  ],
  "dmWebPackages": [
    "Packages to use",
    "要使用的软件包"
  ],
  "dmWebDownload": [
    "Download IPA",
    "下载 IPA"
  ],
  "dmWebCopy": [
    "Copy log",
    "复制日志"
  ],
  "dmWebInstructions": [
    "Put your NSP/XCI packages and prod.keys in one folder. Some packages also need title.keys.",
    "将 NSP/XCI 软件包和 prod.keys 放在同一文件夹。部分软件包还需要 title.keys。"
  ],
  "dmWebSelectionHelp": [
    "Base and updates are preselected when filenames identify one base and its updates; otherwise all packages are selected. Review your selection. Include DLC for Warlock content; excluded files stay untouched.",
    "当文件名能识别出一个基础包及其更新时，会预先选中这些文件；否则将选中全部软件包。请检查所选内容。要使用术士内容，请包含 DLC；未选中的文件不会被改动。"
  ],
  "dmWebDownloadHelp": [
    "Your browser controls where the IPA is saved. If the download did not start, use this button.",
    "IPA 的保存位置由浏览器决定。如果下载未开始，请使用此按钮。"
  ],
  "dmWebLogHelp": [
    "Stages, counts, error codes and filtered shader diagnostics. No key contents or selected filenames. Kept in this tab, not uploaded. Times use your browser's local time.",
    "记录阶段、计数、错误代码和已过滤的着色器诊断，不含密钥内容或所选文件名。日志保留在当前标签页，不会上传。时间采用浏览器本地时间。"
  ],
  "dmWebPrivacy": [
    "The IPA downloads normally. Large game resources stream to a new subfolder inside your selected folder. Existing NSPs and keys are not changed. Files never leave this device.",
    "IPA 将正常下载。大型游戏资源会流式写入所选文件夹内的新子文件夹。现有 NSP 和密钥不会被改动。文件不会离开本设备。"
  ],
  "dmWebFound": [
    "found",
    "已找到"
  ],
  "dmWebMissing": [
    "missing",
    "缺失"
  ],
  "dmWebFoundOptional": [
    "found (optional)",
    "已找到（可选）"
  ],
  "dmWebNotProvided": [
    "not provided (optional)",
    "未提供（可选）"
  ],
  "dmWebProvided": [
    "provided",
    "已提供"
  ],
  "dmWebFolderSummary": [
    "%s package(s); prod.keys %s; title.keys %s.",
    "%s 个软件包；prod.keys %s；title.keys %s。"
  ],
  "dmWebManifest": [
    "Runtime manifest: %s",
    "运行时清单：%s"
  ],
  "dmWebSetupError": [
    "Application setup failed: %s. Reload to retry. No game files have been opened.",
    "应用准备失败：%s。请重新载入后重试。尚未打开任何游戏文件。"
  ],
  "dmWebChecking": [
    "Checking %s…",
    "正在检查 %s…"
  ],
  "dmWebCheckingProgress": [
    "Checking %s… %s",
    "正在检查 %s… %s"
  ],
  "dmWebFolderChecked": [
    "Folder checked: %s packages; prod.keys found; title.keys %s",
    "文件夹检查完成：%s 个软件包；已找到 prod.keys；title.keys %s"
  ],
  "dmWebReviewSelection": [
    "%s: %s Review the package selection before generating.",
    "%s：%s 请在生成前检查所选软件包。"
  ],
  "dmWebDownloadReady": [
    "IPA ready to download. Resources saved in %s/%s. Copy that resource folder into the app’s Files folder after signing and installing the IPA. Game compatibility is not yet verified.",
    "IPA 已可下载。资源已保存到 %s/%s。签名并安装 IPA 后，请将该资源文件夹复制到应用的“文件”文件夹中。游戏兼容性尚未验证。"
  ],
  "dmWebSelectedCount": [
    "%s of %s package(s) selected.",
    "已选择 %s 个软件包，共 %s 个。"
  ],
  "dmWebSelectOne": [
    " Select at least one package to generate an IPA.",
    " 请至少选择一个软件包以生成 IPA。"
  ],
  "dmWebBase": [
    "Base",
    "基础"
  ],
  "dmWebMerged": [
    "Merged update",
    "合并更新"
  ],
  "dmWebVerification": [
    "%s RomFS verification",
    "%s RomFS 验证"
  ],
  "dmWebVerificationPercent": [
    "%s RomFS: %s%% verified.",
    "%s RomFS：已验证 %s%%。"
  ],
  "dmWebLogCount": [
    "Activity log (%s)",
    "活动日志（%s）"
  ],
  "dmWebLog": [
    "Activity log",
    "活动日志"
  ],
  "dmWebFilesLoaded": [
    "Application files loaded",
    "已载入应用文件"
  ],
  "dmWebFilesReady": [
    "%s / %s · %s / %s files ready",
    "%s / %s · %s / %s 个文件已就绪"
  ],
  "dmWebDownloaded": [
    "%s downloaded",
    "已下载 %s"
  ],
  "dmWebCached": [
    " · %s from cache",
    " · %s 来自缓存"
  ],
  "dmWebMegabytes": [
    "%s MB",
    "%s MB"
  ],
  "dmWebProgressCount": [
    ": %s",
    "：%s"
  ],
  "dmWebProgressFraction": [
    " (%s/%s)",
    "（%s/%s）"
  ],
  "dmWebProgressSize": [
    "; %s MB",
    "；%s MB"
  ],
  "dmWebResourceProgress": [
    "Saving game resources: %s/%s files; %s/%s MB",
    "正在保存游戏资源：%s/%s 个文件；%s/%s MB"
  ],
  "dmWebCompatibility": [
    "IPA target: iOS 26+. Default output requires BC texture support. Signing is separate.",
    "IPA 目标：iOS 26 或更新版本；默认需要 GPU 支持 BC 纹理。签名需另行完成。"
  ],
  "dmWebTarget": [
    "IPA target",
    "IPA 目标"
  ],
  "dmWebTarget26": [
    "iOS 26+",
    "iOS 26 或更新版本"
  ],
  "dmWebTarget18": [
    "iOS 18+",
    "iOS 18 或更新版本"
  ],
  "dmWebTargetReload": [
    "Changing target reloads the page. Choose before selecting a folder.",
    "切换目标会重新加载页面；请先选择目标，再选择文件夹。"
  ],
  "dmWebCompatibility18": [
    "IPA target: iOS 18+. Default output requires BC texture support. Not a guarantee for every device. Signing is separate.",
    "IPA 目标：iOS 18 或更新版本；默认需要 GPU 支持 BC 纹理。不代表所有设备均可运行；签名需另行完成。"
  ],
  "dmWebLegacyOption": [
    "Older-GPU option (experimental)",
    "较旧 GPU 选项（实验性）"
  ],
  "dmWebLegacyHelp": [
    "Changing this reloads the page. Also requires a separate Legacy Device Pack export. Device compatibility is not verified.",
    "切换会重新加载页面。还需单独导出 Legacy Device Pack（旧设备资源包）；尚未验证设备兼容性。"
  ],
  "dmWebLegacyPreparing": [
    "Legacy Device Pack: preparing; exported separately from the IPA.",
    "Legacy Device Pack：正在准备；与 IPA 分开导出。"
  ],
  "dmWebLegacySaving": [
    "Legacy Device Pack: saving %s / %s.",
    "Legacy Device Pack：正在保存 %s / %s。"
  ],
  "dmWebLegacyComplete": [
    "Legacy Device Pack saved to %s. Copy it alongside the game resources into the app’s Files folder; this does not mean the IPA is complete.",
    "Legacy Device Pack 已保存到 %s。请与游戏资源一同复制到应用的文件夹；这不代表 IPA 已完成。"
  ],
  "dmWebLegacyIncomplete": [
    "Legacy Device Pack is not complete. Do not use a partial folder; reload to retry.",
    "Legacy Device Pack 未完成。请勿使用不完整的文件夹；重新加载后重试。"
  ],
  "dmWebLegacyConverting": [
    "Legacy Device Pack: processed %d blocks; %s MB of work (multiple passes).",
    "Legacy Device Pack：已处理 %d 个块；处理工作量 %s MB（含多轮处理）。"
  ],
  "dmWebSkipResources": [
    "Skip resource export (already on device)",
    "跳过资源导出（设备上已有）"
  ],
  "dmWebSkipResourcesHelp": [
    "Only for the same game, update and DLC. Existing device files are not verified.",
    "仅适用于相同的游戏、更新和 DLC。不会验证设备上已有的文件。"
  ],
  "dmWebSkipKeepsLegacy": [
    "Legacy Device Pack still exports.",
    "仍会导出 Legacy Device Pack。"
  ],
  "dmWebResourcesSkipped": [
    "Game resource export skipped; device files were not checked.",
    "已跳过游戏资源导出；未检查设备上的文件。"
  ],
  "dmWebStorageEstimate": [
    "Estimated browser staging space available: %s. Not destination disk space or a reservation.",
    "浏览器暂存空间估计：可用 %s；不是目标磁盘空间，也不是预留空间。"
  ],
  "dmWebStorageUnknown": [
    "Browser staging space estimate unavailable; you can continue. Destination disk space was not checked.",
    "浏览器暂存空间估计不可用；仍可继续。目标磁盘空间未检查。"
  ],
  "dmWebAstcPreset": [
    "ASTC encoding preset",
    "ASTC 编码预设"
  ],
  "dmWebAstcThorough": [
    "Thorough (default)",
    "精细（默认）"
  ],
  "dmWebAstcFast": [
    "Fast",
    "快速"
  ],
  "dmWebAstcPresetHelp": [
    "Fast takes less processing time but may reduce image quality. Changing this reloads the page; choose before selecting a folder.",
    "快速模式处理时间较短，但图像质量可能较低。切换会重新加载页面；请在选择文件夹前设置。"
  ],
  "dmWebDownloadPreparationFailed": [
    "The IPA was generated, but its download link could not be prepared. Completed resource exports are unchanged; retry the download without converting again.",
    "IPA 已生成，但无法准备下载链接。已完成的资源导出不受影响；请重试下载，无需重新转换。"
  ],
  "dmWebRetryDownloadPreparation": [
    "Retry IPA download preparation",
    "重试准备 IPA 下载"
  ],
  "dmWebCommittedCleanupWarning": [
    "The unsigned IPA is complete and available to save, but cleanup failed. Save the IPA, then reload before another attempt.",
    "未签名 IPA 已完成并可保存，但清理失败。请先保存 IPA，再重新载入后进行下一次尝试。"
  ],
  "dmWebResourcesSaved": [
    "Game resources saved in %s inside the selected folder.",
    "游戏资源已保存到所选文件夹内的 %s 中。"
  ],
  "dmWebSigningOption": [
    "Optional: sign the IPA locally",
    "可选：在本地签名 IPA"
  ],
  "dmWebSigningHelp": [
    "Unsigned IPA is the default. Enable before choosing a folder; the page reloads and preloads signing tools. Credentials stay on this device and are not uploaded.",
    "默认生成未签名 IPA。请在选择文件夹前启用；页面将重载并预载签名工具。凭据仅在本设备使用，不上传。"
  ],
  "dmWebSigningCredentials": [
    "Local signing credentials",
    "本地签名凭据"
  ],
  "dmWebSigningIdentity": [
    "P12 / PFX identity (up to 4 MiB)",
    "P12 / PFX 证书（最多 4 MiB）"
  ],
  "dmWebSigningPassword": [
    "Identity password (may be empty)",
    "证书密码（可留空）"
  ],
  "dmWebSigningProfile": [
    "Provisioning profile (.mobileprovision, up to 4 MiB)",
    "描述文件（.mobileprovision，最多 4 MiB）"
  ],
  "dmWebSigningWorking": [
    "Unsigned IPA retained; signing and checking the archive locally.",
    "未签名 IPA 已保留；正在本地签名并检查归档。"
  ],
  "dmWebSigningComplete": [
    "Signed IPA created and ready to download; device installation or execution is not guaranteed.",
    "已签名 IPA 已创建并可下载；这不保证设备可安装或运行。"
  ],
  "dmWebSigningFailed": [
    "Signing failed. The unsigned IPA and exported resources remain available; select credentials again to retry signing without reconverting.",
    "签名失败。未签名 IPA 和已导出的资源仍可使用；可重新选择凭据后重试签名，无需重新转换。"
  ],
  "dmWebSigningCancelled": [
    "Signing cancelled. The unsigned IPA and exported resources remain available; select credentials again to retry signing.",
    "签名已取消。未签名 IPA 和已导出的资源仍可使用；可重新选择凭据后重试签名。"
  ],
  "dmWebSignedDownload": [
    "Download signed IPA",
    "下载已签名 IPA"
  ],
  "dmWebSignedHelp": [
    "Device eligibility, installation and game compatibility still require device checks.",
    "设备资格、安装和游戏兼容性仍需在设备上检查。"
  ],
  "dmWebCleanupWarning": [
    "Cleanup failed. Save any available IPA before reloading.",
    "清理失败。请保存可用的 IPA 后再重新载入。"
  ],
  "dmWebSigningProfileMismatch": [
    "The identity or profile is mismatched or expired, or this signing tool does not support the profile. Unsigned IPA retained; select compatible credentials to retry signing.",
    "证书或描述文件不匹配、已过期，或此签名工具不支持该描述文件。未签名 IPA 已保留；请选择兼容凭据后重试签名。"
  ],
  "dmWebRetrySigning": [
    "Retry signing",
    "重试签名"
  ],
  "dmWebShaderFailureContext": [
    "Shader details: %s",
    "着色器诊断：%s"
  ],
  "dmWebShaderSourceDigest": [
    "Source digest: %s",
    "源摘要：%s"
  ],
  "dmWebInputMode": [
    "Game input",
    "游戏输入"
  ],
  "dmWebInputPackages": [
    "NSP / XCI packages",
    "NSP / XCI 软件包"
  ],
  "dmWebInputExtracted": [
    "Extracted ExeFS / RomFS",
    "已提取的 ExeFS / RomFS"
  ],
  "dmWebExtractedInstructions": [
    "Choose a folder containing already-merged ExeFS and RomFS. No keys needed. Base/update only; expansion input is unsupported and DLC metadata is not authenticated.",
    "选择包含已合并 ExeFS 和 RomFS 的文件夹，无需密钥。仅支持基础游戏与更新，不支持扩展内容；DLC 元数据未经认证。"
  ],
  "dmWebExtractedSummary": [
    "%s extracted file(s) found; no keys needed.",
    "已找到 %s 个提取文件；无需密钥。"
  ],
  "dmWebExtractedChecked": [
    "Merged base/update folder selected; DLC metadata is not authenticated.",
    "已选择合并的基础游戏与更新文件夹；DLC 元数据未经认证。"
  ],
  "dmWebExtractedReady": [
    "%s: %s Ready.",
    "%s：%s 已就绪。"
  ],
  "dmWebExtractedMissingInput": [
    "Choose a folder containing ExeFS/main, ExeFS/sdk, and RomFS/data/build_manifest.psv.",
    "请选择包含 ExeFS/main、ExeFS/sdk 和 RomFS/data/build_manifest.psv 的文件夹。"
  ],
  "dmWebExtractedInvalidName": [
    "The extracted folder contains invalid or duplicate paths. Check the folder and try again.",
    "已提取文件夹包含无效或重复路径。请检查文件夹后重试。"
  ],
  "dmWebExtractedLimit": [
    "The extracted folder exceeds file-count or path-length limits.",
    "已提取文件夹超出文件数量或路径长度限制。"
  ],
  "dmWebSupportedVersions": [
    "Game version: %s only. Other versions are not supported.",
    "游戏版本：仅 %s。其他版本暂不支持。"
  ],
  "dmWebProgramUnsupportedVersion": [
    "This game executable version is not supported. Use a version listed above.",
    "此游戏程序版本尚不支持。请使用上方列出的版本。"
  ],
  "dmWebProgramModuleMismatch": [
    "The ExeFS modules are from different releases. Use a complete set from one release.",
    "ExeFS 模块来自不同游戏版本。请使用同一版本的完整文件。"
  ],
  "dmWebProgramShellMismatch": [
    "This game release is not compatible with the selected iOS target.",
    "此游戏版本与所选 iOS 目标不兼容。"
  ],
  "dmWebProgramInvalidModules": [
    "ExeFS is missing required modules or contains extra modules.",
    "ExeFS 缺少必需模块或包含额外模块。"
  ],
  "dmWebProgramDigestMismatch": [
    "The game executable does not match a supported release. Check the source files.",
    "游戏程序与支持版本不匹配。请检查源文件。"
  ],
  "dmWebProgramBuildIdMismatch": [
    "The game executable build ID does not match a supported release.",
    "游戏程序构建标识与支持版本不匹配。"
  ],
  "dmWebCustomizeApp": [
    "Customize app (optional)",
    "自定义应用（可选）"
  ],
  "dmWebCustomHelp": [
    "Leave fields blank to keep the defaults. Files and settings stay on this device and are not uploaded.",
    "留空以保留默认值。文件和设置仅在本设备使用，不上传。"
  ],
  "dmWebCustomName": [
    "App name",
    "应用名称"
  ],
  "dmWebCustomBundle": [
    "Bundle ID",
    "应用标识符"
  ],
  "dmWebCustomBundleHelp": [
    "Your signing profile must match the new bundle ID. Changing it creates a separate app identity.",
    "签名描述文件必须匹配新的应用标识符。更改标识符会被视为另一个应用。"
  ],
  "dmWebCustomVersion": [
    "Version (e.g. 1.0.0)",
    "版本号（如 1.0.0）"
  ],
  "dmWebCustomBuild": [
    "Build number (e.g. 1 or 1.0)",
    "构建号（如 1 或 1.0）"
  ],
  "dmWebCustomIcon": [
    "App icon (PNG)",
    "应用图标（PNG）"
  ],
  "dmWebCustomIconHelp": [
    "Opaque square PNG, 256–1024 px, up to 4 MiB; 8-bit RGB/RGBA, not interlaced. Custom icons may not appear in every iOS view; appearance is unverified.",
    "不透明正方形 PNG，256–1024 像素，最多 4 MiB；8 位 RGB/RGBA，非交错。自定义图标可能不会显示在所有 iOS 界面，实际效果尚未验证。"
  ],
  "dmWebCustomRemoveIcon": [
    "Remove custom icon",
    "移除自定义图标"
  ],
  "dmWebCustomNameInvalid": [
    "Use an app name of up to 80 characters without control characters or leading/trailing spaces.",
    "应用名称最多 80 个字符，不能包含控制字符或首尾空格。"
  ],
  "dmWebCustomBundleInvalid": [
    "Use a bundle ID of up to 255 characters with dot-separated letters, digits, or hyphens, such as com.example.game.",
    "应用标识符最多 255 个字符，仅使用由句点分隔的字母、数字或连字符，如 com.example.game。"
  ],
  "dmWebCustomVersionInvalid": [
    "Use three dot-separated version numbers, such as 1.0.0, without leading zeros.",
    "版本号必须是三个由句点分隔的数字，如 1.0.0，不能包含前导零。"
  ],
  "dmWebCustomBuildInvalid": [
    "Use a build number starting with 1–9999, optionally followed by up to two numbers from 0–99, without leading zeros.",
    "构建号首段为 1–9999，可再加最多两段 0–99 的数字，不能包含前导零。"
  ],
  "dmWebCustomIconInvalid": [
    "Choose a valid opaque square PNG, 256–1024 px, up to 4 MiB, with 8-bit RGB/RGBA and no interlacing.",
    "请选择有效的不透明正方形 PNG，256–1024 像素，最多 4 MiB，8 位 RGB/RGBA 且非交错。"
  ],
  "dmWebCustomInvalid": [
    "These app customizations could not be applied. Check the settings and try again.",
    "无法应用这些自定义设置。请检查设置后重试。"
  ],
  "dmWebCustomChecking": [
    "Checking app settings…",
    "正在检查应用设置…"
  ],
  "dmWebCustomCorrect": [
    "Correct the app customization and try again.",
    "请更正应用自定义设置后重试。"
  ],
  "dmWebCustomOriginalRetained": [
    "Customization was not applied. The retained unsigned IPA has the original app name, bundle ID, version, and icon; it was not automatically signed.",
    "自定义未应用。保留的未签名 IPA 使用原始应用名称、标识符、版本和图标；未自动签名。"
  ],
  "dmWebCustomOriginalDownload": [
    "Download original unsigned IPA",
    "下载原始未签名 IPA"
  ],
  "dmWebStagesCustomization": [
    "Customizing app",
    "自定义应用"
  ],
  "dmWebExtractedInputInvalid": [
    "The extracted input could not be validated. Check the merged ExeFS and RomFS folders.",
    "无法验证已提取的输入。请检查已合并的 ExeFS 和 RomFS 文件夹。"
  ],
  "dmWebExtractedDlcUnsupported": [
    "Expansion input is not supported for extracted folders. Use merged base/update files or switch to NSP/XCI input.",
    "已提取文件夹不支持扩展内容输入。请使用已合并的基础游戏与更新文件，或改选 NSP/XCI 输入。"
  ],
  "dmWebExtractedResourceLayout": [
    "The extracted resource layout is not supported. Use already-merged base/update resources.",
    "此提取文件夹的资源布局不受支持。请使用已合并的基础游戏与更新资源。"
  ],
  "dmWebExtractedSkipResourcesHelp": [
    "Skip only if the device already has resources from this exact merged folder. Existing device files are not verified.",
    "仅在设备上已有此合并文件夹对应的资源时跳过。不会验证设备上已有的文件。"
  ]
});
