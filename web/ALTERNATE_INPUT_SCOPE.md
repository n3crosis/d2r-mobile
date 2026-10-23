# Alternate local game inputs

The browser automatically detects package or already-extracted input from the
selected folder. Root-level NSP/XCI files take precedence; missing or invalid keys
never cause a fallback to extracted input. Neither route uploads private game
files or keys. Real-game XCI and extracted-folder conversion have not been run;
this change is covered by authored synthetic input/provenance tests only.

## Packages: NSP and XCI

Select a folder with `prod.keys` and one or more `.nsp` or `.xci` files directly
inside it. `title.keys` remains optional. Every discovered package is included,
including an XCI base with an NSP update or DLC; there are no package checkboxes
or filename-based preselection. The existing authenticated NCA/CNMT policy still
associates and selects contents.
The legacy `nsps` / `selectedNspNames` API names now include both package types.
Both `discoverNspFolder` and `discoverNspFiles` discover NSP and XCI packages by
default. `discoverGameFolder` and `discoverGameFiles` automatically detect the
input route and return its concrete `inputMode`; internal callers may pin that
mode when rescanning a selection. Direct `generate()` calls also auto-detect when
no mode is supplied.

`inspectGamePackage` dispatches on PFS0/HEAD magic, not the filename extension.
The authored XCI parser reads the HEAD header and HFS0 indexes with at most 64 KiB
per Blob read. It verifies the declared global root hash and all declared
partition/member prefix hashes. Only NCA/ticket extents in `secure` enter the
existing extraction worker; `update` is a system-update partition, not a game
patch. Partition/name/range/overlap/reserved-field and aggregate budgets fail
closed. NCA slices are immutable Blob views, not whole-package buffers.

Limits: four recognized partitions, 65,536 aggregate HFS0 records, 16 MiB aggregate
indexes, 16 MiB per hash prefix, and 64 MiB aggregate hash work. BigInt offsets
support sparse extents beyond 4 GiB. Split/compressed XCI, NCZ, regional
hash-suffix variants, unknown partitions, and excessive prefixes are unsupported.
Cartridge certificate/RSA verification is not implemented. Prefix hashes prove
container consistency only; signed NCA headers, CNMT matching, full content
hashes (unless the existing explicit quick mode was selected), BKTR/ExeFS/RomFS
checks, exact executable hashes, and existing asset/shader catalogs are unchanged.
No new native/WASM parser build is required.

Format references were read as documentation; no hactool implementation was
copied: [HEAD layout](https://github.com/SciresM/hactool/blob/master/xci.h),
[HFS0 layout](https://github.com/SciresM/hactool/blob/master/hfs0.h),
[root hashing](https://github.com/SciresM/hactool/blob/master/xci.c), and
[prefix hashing](https://github.com/SciresM/hactool/blob/master/hfs0.c).

## Already-extracted ExeFS / RomFS

Choose the parent of these already-merged directories:

- `ExeFS/main`
- `ExeFS/sdk`
- `RomFS/data/build_manifest.psv`
- The original full-sized `RomFS/data/*.data` archives.

The top-level ExeFS/RomFS names are case-insensitive but aliases/collisions are
rejected. Inner resource and module names retain their exact native spelling.
Only these two directory trees are traversed. Key files and unrelated directories
are not opened. The FileList fallback applies the same path and layout checks.
The layout must already include the desired supported update; this route does
not merge extracted base/update folders, reconstruct BKTR, or accept decompressed
NSO modules. `.holes` files cannot replace the required full-sized `.data` archives.

No key file is required because the input is already plaintext. Before issuing
local-folder provenance, the adapter measures both complete `main` and `sdk`
files and selects a complete tuple from the repository-owned program catalog.
The program rewriter independently snapshots and rehashes those modules again.
Caller-supplied version strings, hashes, `verified` flags, CNMT rows or copied
extraction objects cannot register provenance. Unsupported/mixed executable
versions fail closed; no new game release is implied.

This is a distinct local-folder provenance route, not authenticated NCA
extraction. It cannot recover signed CNMT metadata or prove whole-RomFS integrity
once the NCA envelope is absent. Mandatory native archive sizes/layout, bounded
CASC parsing, per-record checksums, and existing trusted shader/resource catalogs
remain enforced. Archive inventory validation also runs when resource export is
skipped. Files are retained as immutable local Blob snapshots; lazy reads are
at most 64 KiB and revoked on cancellation/disposal. No game archive is loaded
whole into memory. Executables are staged within the existing module/aggregate
budgets and wiped on disposal.

Recognizable separate DLC/add-on folders and filenames carrying the known Warlock
title ID are rejected. Indistinguishably merged DLC data cannot be detected from
the folder layout: this route does not establish that DLC is absent.

DLC metadata is not authenticated. Extracted-folder mode is explicitly
base/update-only; expansion combinations are unsupported. The selection carries
`inputKind: "extracted"`, `dlcMetadata: "not-authenticated"` and
`contentMode: "base-update-only"`, with no fabricated base/patch CNMT records.
A mandatory-Warlock content mode rejects this route. To include supported DLC,
use the package route with authenticated package metadata instead. This is an
input-compatibility limitation, not an ownership or entitlement determination.

The output remains a separate unsigned IPA and, when requested, a new resource
folder. Original input files are never overwritten. Device/install validation,
real XCI validation, and real extracted-folder conversion are pending.

The emitted local-folder content-mode receipt also records `inputProvenance: "local-extracted"` and `dlcMetadata: "not-authenticated"`. Its base-only runtime mode is selected explicitly, not inferred as authenticated absence of DLC from an empty list. Package-derived receipts retain their existing shape.
