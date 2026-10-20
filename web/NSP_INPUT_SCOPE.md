# Local NSP input inspection scope

## Folder contract

Put all NSP packages and `prod.keys` directly inside one folder. `title.keys` is optional; include it if your package needs external title keys,
then select that folder locally. Do not send key files in chat, upload them to a
service, or commit them. Selection is read-only; this module performs no network,
telemetry, storage, extraction, or filesystem writes.

`discoverNspFolder(directoryHandle, { signal })` enumerates root entries only and
returns local File references `{ prodKeys, titleKeys, nsps }`. It calls `getFile`
for candidate metadata but does not read file contents. This is the API for the
initial folder-layout UI. Cancellation is checked around each asynchronous
metadata read; an in-flight browser read cannot be forcibly interrupted.

`discoverNspFiles(fileList)` supports a `webkitdirectory` fallback. It requires
one common selected root and ignores nested candidate files. The browser may
already have enumerated descendants before supplying that list; the native
folder-handle route avoids that work. Both paths enforce a bounded entry count.
Matching is case-insensitive, ambiguous duplicates are rejected, and names must
be normalized NFC safe single components. Unrelated files are not opened.

Limits: 4,096 directory entries, 128 NSP files, 1 MiB per key file. These are
frontend defensive limits, not asserted Nintendo format limits.

## Independent deeper inspection APIs

These APIs are available for synthetic tests and later integration. Folder
layout acceptance alone does not run them or establish a valid package/key set.

- `inspectNsp(file)` reads only the 16-byte PFS0 header and a bounded index. It
  validates counts, string bounds, NUL termination, UTF-8 names, duplicate names,
  reserved fields, file ranges, and nonempty extent overlap. Payloads are never
  read. Index limits are 65,536 entries, 16 MiB, and 255 bytes per name. Nonzero
  reserved fields and string references into the middle of another name are
  rejected conservatively. Offsets and sizes remain BigInt, including sparse
  extents above 4 GiB; browser file sizes must be safe JavaScript integers.
- `inspectKeyFile(file, 'prod' | 'title')` reads at most 1 MiB into an owned byte
  buffer and returns counts only. It accepts ASCII names, `=` or `,`, space/tab
  padding, LF/CRLF, and an optional final newline. Names are case-insensitive;
  duplicates, malformed/odd-length hex, and invalid known widths are errors.
  Error messages contain line numbers, never key names, rights IDs, or values.
- `preflightNspFolder(input)` combines discovery and deeper inspection, returning
  metadata only, with `stage: 'metadata-only'` and `canBuildIpa: false`. It reads
  key contents, unlike the layout-only discovery API. Do not silently replace
  layout-only checks with this API.

Missing or empty `title.keys` is allowed because no assertion about title-key requirements
can be made without inspecting NCA metadata. The Worker creates an empty memory-only input when the file is absent. Rights-free content can use `prod.keys` alone; a rights-managed encrypted section with no matching title key fails with the safe `TITLE_KEY_REQUIRED` diagnostic. This boundary does not import or derive keys from NSP ticket files. Empty production keys are rejected.
Full-line `#` comments are a deliberately documented frontend convenience:
hactool skips malformed lines rather than defining comment syntax. Inline
comments and non-ASCII files are unsupported. Lines are capped at 1,024 bytes;
this is an explicit frontend bound, not a recreation of hactool's truncation.

### Verified key subset

For title keys, exactly 16-byte hexadecimal rights IDs and 16-byte values are
validated. For production keys, verified widths cover `header_key` and
`header_key_source` (32 bytes), selected AES/header/title/master/key-area source
names (16 bytes), and `master_key`, `master_kek`, `titlekek`, and three key-area
families with hexadecimal suffixes `00` through `1f` (16 bytes). The source code's
`verifiedProdLength` function is the authoritative allowlist. Other syntactically
valid production key names are counted as unknown; their formats and lengths
are not supported or verified. No key is proven genuine, sufficient, derived,
or usable for decryption. `usableForDecryption` is always false.

Key bytes/values are never returned or logged. The owned read buffer is filled
with zeroes in a finally block and temporary identifier sets are cleared. JavaScript
strings, regex matches, engine copies, browser File backing data, and garbage
collection cannot be securely erased or have guaranteed lifetimes. This is
best-effort lifetime minimization, not a secure-erasure guarantee. All tests use
artificial keys, generated in the test code; no user keys or game data are needed.

## Evidence and remaining gap

Reviewed primary hactool sources:

- [PFS0 structures](https://github.com/SciresM/hactool/blob/master/pfs0.h)
- [PFS0 entry data-offset handling](https://github.com/SciresM/hactool/blob/master/pfs0.c)
- [Key-text parsing](https://github.com/SciresM/hactool/blob/master/extkeys.c)
- [Key-width declarations](https://github.com/SciresM/hactool/blob/master/settings.h)

The repository's `dm/tools/extract_game.sh` accepts one package and `prod.keys`,
then uses native hactool to identify base/update Program NCAs, overlay BKTR, and
verify extracted ExeFS hashes. It does not implement this folder contract or
explicitly pass a selected `title.keys`. The pinned hactool `main.c` separately calls `open_key_file("title")`; `utils.c` searches HOME/.switch and XDG/config locations. The two-argument script can therefore rely on ambient title keys and does not prove that every rights-managed package works from `prod.keys` alone. The script has no explicit ticket parsing. This module is an independent browser
input layer, not a port of that extraction pipeline.

Missing: NCA decryption/authentication, title/base/update association, CNMT
validation, BKTR reconstruction, RomFS/ExeFS extraction, version matching,
guest translation, and a real native iOS build pipeline. Successful inspection
does not mean a runnable unsigned IPA can be generated. No encrypted payload,
key validity, game version, ownership, or build feasibility is established.
