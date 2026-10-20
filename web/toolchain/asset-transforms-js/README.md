# JavaScript asset table transforms

Four production asset operations now run as standalone JavaScript, without Python,
Pillow, npm dependencies, filesystem access, or network access:

- `experience-table`: the original TSV/CSV selection and generated `dm_hud_exp.h` bytes.
- `overlay-paths`: the original controller layout/button/cursor remapping and ASCII JSON bytes.
- `vault-table`: all seven original item tables, all three icon JSON tables, manifest existence checks, inheritance, icon fallback, ordering and generated `dm_vault_tab.h` bytes.
- `derived-tables`: all five runtime record families, complete source hash/count checks, integer ranges, unique skills, control-character rejection, line/output limits and receipt metadata.

The dispatcher has no Python fallback. It preserves the worker `files` result contract.
`offline-runtime-spike/pyodide-worker.mjs` dispatches these operations before touching
Python; this is the worker copied into the production runtime. The developer worker
uses the same module. Its four pure operations do not initialize Pyodide at all.
The production worker still initializes Pyodide for the remaining image/recipe work.
The sealed preparer no longer packages `derived.py`, `vault.py` or `vault_original.py`.

`source-provenance.json` locks both the native implementations and the old bounded
adapters. `scripts/verify-source.mjs` fails the runtime build on any source drift.
The JavaScript source is included in the existing SHA-256 runtime inventory.
The native Python files remain in the repository as reference and build-time source.

## Focused verification

From the repository root:

    node web/toolchain/asset-transforms-js/scripts/verify-source.mjs
    node web/toolchain/asset-transforms-js/test/parity.mjs
    node web/toolchain/asset-transforms-js/test/worker-routing.mjs

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

## Remaining Python map

- `image-default-frame`: Pillow crop, native default-frame pixels, PNG encoding.
- `native-art`: native atlas PNG output and skill-index source generation.
- `hud-v4`: Pillow composition, resize, font/layout work, PNG outputs.
- `map-goal`: original icon composition and image encoding.
- `mercenary-art`: original panel/slot image composition and metadata.
- `remaining-art`: pouch, stash, vault/trove and remaining UI composition.
- `overlay-recipe`: large original layout/string recipes plus image conversion.
- `casc-overlay`: pure binary TVFS/CFT/BLTE rewrite, MD5 and zlib. This does not
  require Pillow and is the next separate non-image migration candidate.

Moving these four operations does not remove the Pyodide/Pillow download or prove
real-game parity, image parity, browser startup, full packaging or device launch.
.NET remains unchanged.
