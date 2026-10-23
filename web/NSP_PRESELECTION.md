# Game package inclusion

中文：[NSP_PRESELECTION.zh-CN.md](NSP_PRESELECTION.zh-CN.md)

Choose a folder, then generate the IPA. The folder picker detects NSP/XCI packages or a complete, already-merged ExeFS/RomFS layout. Packages take precedence whenever present; missing or invalid keys never trigger an extracted-input fallback.

Every discovered package is included, including any supplied DLC. There are no package checkboxes or filename-based preselection rules. To leave out a package, remove it from the chosen input folder. Changing folders resets the resource-reuse option.

Filenames are not authentication. Authenticated package metadata still determines accepted titles, versions, updates and DLC. Unrelated or ambiguous packages fail validation rather than being silently ignored. DLC is not required when absent. Extracted input remains limited to merged base/update content and does not authenticate DLC metadata.

Inert UI/state coverage: `node --test tests/packager-features-ui.test.mjs tests/simple-packager-flow.test.mjs` from `web`. No browser, game or device validation is implied.
