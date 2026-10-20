# NSP filename preselection

中文：[NSP_PRESELECTION.zh-CN.md](NSP_PRESELECTION.zh-CN.md)

When exactly one filename contains the canonical bracketed D2R base title ID and at least one contains its update ID, the folder picker preselects those files plus filenames with exactly one bracketed 16-hex title marker equal to the canonical Warlock DLC ID. Mixed or repeated title markers do not qualify for this added DLC hint. Other names remain unchecked in this branch. The title IDs are shared with `d2r-expansion-policy.mjs`. Multiple update or DLC candidates remain subject to authenticated version/ambiguity checks.

The existing fallback is unchanged: without that recognized base/update combination, all discovered NSP names are initially selected. Checkboxes remain editable. Changing folders or checkbox selections resets the original-resource reuse option.

Names are only selection hints, not authentication. Renaming an unrelated package does not bypass authenticated metadata, content digest, title, version, or executable checks. No DLC is required when absent.

Synthetic coverage: `node --test tests/nsp-default-selection.test.mjs` from `web`. No game or device validation is implied.
