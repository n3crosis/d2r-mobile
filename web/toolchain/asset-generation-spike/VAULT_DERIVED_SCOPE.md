# Production vault and derived tables

Historical Python reference contract: the standalone browser proof was retired.
See [retained references and current verification](README.md). Statements below
describe that reference design and historical evidence, not current CI coverage.

`package-vault.py` pins `dm/ios/tools/gen_vault_table.py` and extracts its unchanged
functions and literal PARTS/PART_OF constants. No CLI imports or filesystem game
reads execute. `vault-table` accepts only the ten original logical TXT/JSON inputs
and an authenticated item-sprite manifest projection. The original inclusion,
item type traversal, icon existence, sorting, and set indexing logic emits
`dm_vault_tab.h`. The projection preserves the original sprite existence set;
archive locations and other unrelated manifest fields are not needed.

Limits: 20 MiB operation payload, 2 MiB per source, 12 MiB decoded source aggregate,
4 MiB projected manifest, 100,000 rows per table, 2 MiB output header. Inputs remain
local. The sealed runtime preloads `vault_original.py` and `vault.py` before jobs.

`generateProductionDerived` reads authenticated experience and vault inputs,
uses the native-art generated C header, hashes the actual three generated source
headers, and invokes `derived-tables` with `mode: generated`. The unchanged native
parser derives counts. Its original structural assertions and all existing
numeric, reference, unique-skill, output-byte, and runtime-line bounds remain.
Fixture mode still checks independent expected counts and source hashes.

The returned `receipt` identifies actual inputs and generated source hashes. It is
not an independent expected-output oracle, real-game parity result, or shell
compatibility claim. The returned `counts` must be compared to independently
trusted shell capacities: native `shell_stubs.py` embeds vault part/row/set and
native-art row counts in fixed arrays. Generating a header cannot establish that
an existing shell was compiled with matching capacities. No arbitrary values are
supplied for these capacities.

Integration is source-wired only. No new synthetic fixtures, test harnesses,
real-game execution, or browser parity checks were run for this addition.
