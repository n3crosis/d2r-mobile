# JavaScript asset table transforms

Four production asset operations now run as standalone JavaScript, without Python,
Pillow, npm dependencies, filesystem access, or network access:

- `experience-table`: the original TSV/CSV selection and generated `dm_hud_exp.h` bytes.
- `overlay-paths`: the original controller layout/button/cursor remapping and ASCII JSON bytes.
- `vault-table`: all seven original item tables, all three icon JSON tables, manifest existence checks, inheritance, icon fallback, ordering and generated `dm_vault_tab.h` bytes.
- `derived-tables`: all five runtime record families, complete source hash/count checks, integer ranges, unique skills, control-character rejection, line/output limits and receipt metadata.

The dispatcher has no Python fallback and preserves the worker `files` result
contract. Production routing and assembly are documented in the
[JavaScript/WASM asset runtime](../asset-runtime-js/README.md). The legacy Pyodide
proof and developer workers also use this module; these four operations do not
initialize Python.

`source-provenance.json` locks both the native implementations and the old bounded
adapters. `scripts/verify-source.mjs` fails the runtime build on any source drift.
The JavaScript source is included in the existing SHA-256 runtime inventory.
The native Python files remain in the repository as reference and build-time source.

## Focused verification

From the repository root:

    node web/toolchain/asset-transforms-js/scripts/verify-source.mjs
    node web/toolchain/asset-transforms-js/test/parity.mjs

The parity oracle extracts only original functions into stdlib-only namespaces.
It runs authored, synthetic inputs and compares every output byte and receipt field.
No game data, browser, native application, image libraries or full build is used.
The dispatcher tests mock Python with a throwing sentinel to ensure pure requests
cannot accidentally fall through to it.

Compatibility targets the actual native-generator output and game-table formats,
not arbitrary Python programs. In particular, generated C strings support UTF-8,
backslash/quote, hex, octal and byte-valued Unicode escapes; `\N{...}` named Unicode
escapes are rejected because the source generators never produce them. This is a
fail-closed parser, not a C compiler. JavaScript/CPython Unicode database revisions
can differ for newly added characters; production table keys and numeric fields
are the existing source format.
