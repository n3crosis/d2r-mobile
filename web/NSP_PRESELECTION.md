# NSP filename preselection

中文：[NSP_PRESELECTION.zh-CN.md](NSP_PRESELECTION.zh-CN.md)

When exactly one filename contains the canonical bracketed D2R base title ID and at least one contains its update ID, the folder picker preselects only those base and update files. The Warlock DLC remains in the folder but is unchecked until the user explicitly selects it. The title IDs are shared with `d2r-expansion-policy.mjs`. Multiple update candidates remain subject to authenticated version and ambiguity checks.

The existing fallback is unchanged: without that recognized base/update combination, all discovered NSP names are initially selected. Checkboxes remain editable. Changing folders or checkbox selections resets the original-resource reuse option.

Names are only selection hints, not authentication. Renaming an unrelated package does not bypass authenticated metadata, content digest, title, version, or executable checks. No DLC is required when absent.

Synthetic coverage: `node --test tests/nsp-default-selection.test.mjs` from `web`. No game or device validation is implied.
