# BKTR next boundary

The prior bounded JS relocation parser/planner passed [NSP CI run 39396778480](https://github.com/n3crosis/d2r-mobile/actions/runs/39396778480), commit `fe5abb21b5527c6d230f86c94a4a7a42c6982036`. It remains an independently usable **untrusted routing primitive**, not a decryption or authentication API. The new native authenticated legacy BKTR path below awaits its first full CI execution. No user content, keys, valid signed NCA, or real update fixture has been accessed.

## Exact upstream mapping

All references are to official hactool commit `1d64a83450e025622f3468c28fc4164dad2c5ef6`:

- [bktr.h](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/bktr.h): 32-byte BKTR descriptors (offset, size, magic, version, entry count, reserved); 16 KiB root and bucket nodes. A root has 16-byte header then 64-bit bucket boundaries. Relocation buckets have 16-byte header then packed 20-byte `{virtual_offset,physical_offset,is_patch}` records. Subsection buckets have packed 16-byte `{offset,reserved,ctr_value}` records.
- [nca.c](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/nca.c), `nca_process_bktr_section`: relocation table immediately precedes subsection table, whose end is section end. Upstream reads both with ordinary CTR before installing them as virtual routing state, adds synthetic sentinels in memory, then verifies IVFC over the merged address space.
- `nca_section_fseek` and `nca_section_fread`: base relocation physical offsets address the **complete decrypted base section**, not the final RomFS file-data layer. Patch relocation offsets address patch physical section storage. Reads split at relocation boundaries, and patch reads also split at encryption-subsection boundaries. The existing `openRomfs` reader deliberately exposes only the final level and is therefore not a valid base-section adapter.
- `nca_update_bktr_ctr`: the low 64 counter bits encode the absolute file offset divided by 16, big endian; bytes 4–7 encode the subsection's 32-bit generation value big endian. Bytes 0–3 retain the section secure value. Unaligned AES reads need block-aligned decryption and slicing. Metadata table reads use the ordinary section counter generation.

The modern encrypted/plaintext subsection discriminant is confirmed by official [Atmosphere AesCtrCounterExtendedStorage::Entry](https://github.com/Atmosphere-NX/Atmosphere/blob/master/libraries/libstratosphere/include/stratosphere/fssystem/fssystem_aes_ctr_counter_extended_storage.hpp); no Atmosphere implementation code is copied.

The legacy upstream parser allocates caller-sized tables, relocates buckets in place, inserts sentinels, and may terminate on malformed lookups. The browser must not call that unrestricted path. Table indices, ordering, extents, counts and read splits require independent bounds validation first.

## Implemented safe primitive

`parseRelocations(bytes,{entryCount,baseSize,patchDataSize})` accepts an already-decrypted legacy relocation table capped at 16 MiB. It validates a single root with contiguous 16 KiB bucket nodes, exact node lengths, bucket ranges, first virtual offset zero, strict entry ordering, source flag 0/1, descriptor entry count, and every mapped physical extent against its source limit. It snapshots records into frozen metadata so later changes to input bytes do not change the plan. Unsupported tree layouts fail rather than guessing.

`planRelocationRead(table,offset,count)` returns frozen base/patch physical read spans, splitting across virtual relocation boundaries, capped at 64 KiB total. All offsets remain BigInt. Synthetic tests cover base/patch/base crossing, physical offsets above 4 GiB, EOF, malformed counts/order/source flags and out-of-range mappings. This primitive does not read or decrypt source content and does not assert that the table is authenticated. It must remain internal to a future verifier, never a public unchecked extraction path.

## Native legacy patch path, pending CI

`openPatchedRomfs(baseIndex,patchIndex)` / `nsp_open_patched_romfs` now opens and verifies the base RomFS first, transfers that context into separate owned storage, authenticates the patch header, and selects its unique BKTR RomFS section. Both fixed retail RSA-PSS signature checks and section-header hash/range checks remain mandatory. The base and patch use separate file/AES contexts, wiped/freed together on close or failure.

`bktr-reader.h` bounds and validates native relocation and subsection tables without calling hactool's unrestricted BKTR parser. It supports version-1 descriptors, one-root legacy bucket tables capped at 16 MiB each, encrypted subsection entries with 16-byte aligned starts, and exact descriptor/count/physical layout consistency. Modern plaintext subsection flags, sparse/compressed storage, additional tree shapes and unknown formats remain unsupported. The final subsection data range ends at the relocation metadata start, following upstream's explicit sentinel rule; metadata itself is read under ordinary CTR before routing is activated.

The merged reader splits both virtual relocations and physical encryption subsections. CTR-Ex is constructed with the subsection generation, section secure value and absolute file block offset. Unaligned reads decrypt an aligned prefix and return only the requested bytes. All pulls are at most 64 KiB. The complete merged six-level IVFC tree is then checked against the master hash authenticated by the patch header. Only on success does the final RomFS reader become available, with the same generation-lifetime guard as the unpatched reader. Any error closes both contexts; no partial output or fallback base is returned.

`open(index,"program-exefs")` may now coexist with an unselected BKTR RomFS section. It still verifies only its selected PFS0 content and signed section headers, not the BKTR payload. This permits independently verifying the patch executable without falsely treating it as a merged filesystem. Selecting BKTR as PFS0 or using a patched base for the new merge remains unsupported.

A closed C fixture, exposed only as a no-argument synthetic self-test, constructs public in-memory fixture data and temporary memory-filesystem files, validates malformed table rejection, checks CTR-Ex ciphertext against an independently generated OpenSSL SHA256 digest, reads across base/patch and encryption-generation boundaries including unaligned offsets, and runs the same merged-IVFC verifier. Changed patch ciphertext and wrong base bytes must fail integrity. It always closes every synthetic context and never exposes a reader, accepts a caller root/key/path, or skips production RSA validation. Chromium additionally rejects an unsigned base through the new production patch API. Full execution is left to the next GitHub CI run.

## Still required before an end-to-end claim

- Production metadata selection must enforce CNMT application/patch association and independently measured whole-NCA hashes before calling this boundary. The low-level API does not infer association from filenames or assert game-version compatibility.
- Actual signed base/update fixtures have not been supplied or tested. Synthetic success cannot prove compatibility with real game formats or the selected title/version.
- The JS planner is a readable test oracle; production native parsing uses the same field mapping but is not wired through that JS module. Broader malformed-table fuzzing and native/browser parity fixtures remain useful follow-up coverage.
- Unsupported modern variants remain fail-closed. No signature bypass, optional verification, unchecked extraction callback or guessed patch fallback is provided.
