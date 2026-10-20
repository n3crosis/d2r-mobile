# Resource export options

[简体中文](RESOURCE_EXPORT_OPTIONS.zh-CN.md)

Full game-resource export remains the default. After choosing your input folder, you may explicitly select **Skip resource export (already on device)** only if the device already has resources for the same game, update and DLC. The browser does not inspect or verify those existing device files. Selecting another folder or changing the selected packages resets this choice to full export.

Skipping suppresses only the original game-resource folder export. Input authentication, extraction and generated IPA assets still run. When the older-GPU option is enabled, its separate Legacy Device Pack still exports and must be copied to the device. The existing input folder remains the export destination; no extra folder picker is introduced.

The result explicitly says resource export was skipped, not completed or verified. That skipped outcome remains separate from IPA success or failure.

The space advisory estimates available browser-managed staging storage, not free space on the export destination disk. It does not reserve storage or promise that generation will fit. Unavailable, invalid or timed-out estimates are nonblocking. A production size cap or input package size is not treated as a known staging requirement. Private files and keys are not sent to obtain an estimate.

Source-contract and synthetic tests do not establish browser, game-input or device success.
