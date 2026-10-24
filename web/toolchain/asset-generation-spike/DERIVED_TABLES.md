# Complete runtime derived-table boundary

The `derived-tables` worker operation implements the actual shell packaging boundary from `dm/tools/d2rm_pack.py`: the three generated C texts are parsed by the unchanged `dm/ios/tools/shell_stubs.py` functions and emitted as one complete runtime `derived.tsv`. No C is executed or compiled, and no header is placed into the application.

## Provenance and contract

`source-provenance.json` pins the original `shell_stubs.py` SHA-256. `package-core.py` extracts only its original `unq`, `paths`, `parse`, `data` functions and `CSTR` constant without importing the CLI. The parser/emitter bodies are not translated or approximated. A narrowly scoped module-local in-memory `open` adapter supplies the three inputs and captures the output; it cannot reach arbitrary filesystem paths, and it is removed in `finally`. The existing worker serial queue prevents concurrent mutation of that module-local boundary.

Input payload is UTF-8 JSON containing exactly:

- `dm_hud_exp.h`: genuine experience-generator output.
- `dm_vault_tab.h`: genuine vault-generator output.
- `dm_touch_native_art.c`: genuine skill-index-generator output.

Required worker options, supplied separately by trusted host configuration:

```js
{
  expectedCounts: { EXP: 100, VTPART: partCount, VTROW: rowCount, VTSET: setCount, TAROW: skillCount },
  expectedSourceSha256: {
    'dm_hud_exp.h': experienceHash,
    'dm_vault_tab.h': vaultHash,
    'dm_touch_native_art.c': skillIndexHash,
  },
}
```

There are no production default counts or fabricated fallback tables. Counts/hashes placed inside the payload do not authorize themselves. The caller must obtain expected counts from verified shell-release build metadata and hashes from trusted generation provenance or a verified source manifest. The current native `shell_info.txt` emits PRODUCT/CHAIN/KIND/SHADER_SRC/SPIRV_CROSS, **not derived row counts**. Until release metadata exposes or independently proves those counts, this is not a ready default production capability.

The operation returns:

```js
{
  files: { 'derived.tsv': ArrayBuffer },
  counts: { EXP, VTPART, VTROW, VTSET, TAROW },
  sourceSha256: { /* exact accepted input hashes */ },
}
```

A complete packaging implementation must map that output to the shell-required `dm/derived.tsv`, alongside all other required assets. The image-only `asset-generator-adapter.mjs` deliberately does not misroute it through image recipes. A caller may compose this actual output through a distinct table-generation stage after supplying all real source artifacts and verified count metadata.

## Complete sets and runtime safety

All three source files and all five record-family counts must be present. The original parser validates 100 experience values, vault part declarations/row extraction, a nonempty set/row list and the full skill-index row block. Additional checks require:

- Exact counts equal trusted expectations; no partial/empty-family substitute.
- Experience values and skill IDs fit uint32; vault kind/part/tier/row/level/set fields fit runtime target ranges; atlas/frame values fit the signed runtime range.
- Unique skill IDs.
- No tabs, newlines, carriage returns, NULs or other ASCII controls in parsed string fields.
- At most 8 MiB JSON payload, 2 MiB per source, 100,000 rows per expected family, 256 vault parts and 32,768 sets.
- At most 8 MiB output and 8,190 bytes per line, matching the runtime reader's 8,192-byte fgets buffer including newline/NUL room.

After checking, the unchanged native `data()` emitter writes the full EXP/VTPART/VTROW/VTSET/TAROW sequence. Its returned counts are checked again. No Python/Xcode/install is required by the end user; the prepared same-origin Pyodide worker executes this transform locally.

## Verification and remaining gaps

`test/native-derived.py` authors tiny synthetic source texts (including Unicode, unique/set rows, valid and absent skill atlas coordinates) and executes the **original** native `shell_stubs.data()` against real temporary input files. Browser CI invokes the worker and requires exact derived.tsv byte equality. Negative cases require rejection for missing source sets, absent expectations, count mismatch and source-hash mismatch. These new derived checks are pending their first pushed CI run.

This boundary does not implement the missing full vault/skill generators, real-game source-manifest verification, production shell-count metadata, HUD recipes, font handling or CASC overlay packing. It emits genuine parser-derived output only when complete real inputs are provided; the committed fixtures are explicitly synthetic and never used as production fallback data.
