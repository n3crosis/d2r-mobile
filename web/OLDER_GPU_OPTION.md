# Optional older-GPU export

[简体中文](OLDER_GPU_OPTION.zh-CN.md)

The **Older-GPU option (experimental)** is off by default and is independent of the iOS target. iOS 18 does not imply that a device needs it. Neither option guarantees device compatibility; no real-device result is claimed.

Change this option any time before generation, without reloading or losing the selected folder. The URL reflects the choice (`legacyAstc=1` when enabled). Verified public capability bytes preload before private files are selected; the optional producer starts locally only when generation needs it. Options lock during active operations and after generation. Private files and keys stay local, with no conversion-time network dependency.

With the option enabled, generation also saves a separate `Legacy Device Pack-<UUID>` folder inside your selected input folder. Its progress and completion appear separately from the IPA. Copy the complete Legacy Device Pack folder alongside your game resources into the installed app's Files folder. The IPA download alone is not enough; signing and installation remain separate steps.

A completed pack does not imply a completed IPA. If generation later fails, the pack can be reported complete while the IPA is unavailable. An incomplete or cancelled pack must not be used; cleanup may leave an incomplete marker. Reload and retry rather than renaming partial output into place. The normal, unchecked flow is unchanged.

UI/source checks and synthetic export tests are not game-input, browser end-to-end or device compatibility evidence.
