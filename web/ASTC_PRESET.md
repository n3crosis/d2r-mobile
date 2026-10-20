# ASTC preset selection

中文: [ASTC_PRESET.zh-CN.md](ASTC_PRESET.zh-CN.md)

The browser UI shows a small encoding preset selector only when the experimental
older-GPU option is enabled. Thorough is the default. Fast trades shorter
processing time for potentially lower image quality; no numeric speedup or device
compatibility is promised.

Only `astcPreset=fast` selects Fast. Missing or unknown URL values fall back to
Thorough. Choosing Thorough removes that query parameter. Changing the selector
reloads the page before private input selection, just like the experimental
option, and passes the fixed value to browser packager setup. The selector locks
once a folder has been selected, during processing/generation, or when output is
ready. Disabling the experimental option hides the selector; it does not enable
ASTC processing in normal mode.

All labels and explanatory text originate in `dm/i18n/ui_text.tsv`, with generated
browser and native catalogs. UI source provenance hashes change with that table;
annotation-data payload remains unchanged. This UI does not widen the backend's
closed preset validation or change conversion, payload, worker or export logic.

Scoped checks cover catalog/header consistency, literal policy, existing older-GPU
and resource-option source contracts, selector URL/default/locking assertions,
TypeScript and formatting/lint. These checks do not replace browser interaction,
quality comparisons or device tests.
