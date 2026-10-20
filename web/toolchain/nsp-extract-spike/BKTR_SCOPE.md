# BKTR next boundary

Production BKTR is still rejected. The bounded relocation parser/planner is an independently usable **untrusted routing primitive**, not a decryption or authentication API. Its tests await GitHub CI. No user content, keys, valid signed NCA, or real update fixture has been accessed.

## Exact upstream mapping

All references are to official hactool commit `1d64a83450e025622f3468c28fc4164dad2c5ef6`:

- [bktr.h](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/bktr.h): 32-byte BKTR descriptors (offset, size, magic, version, entry count, reserved); 16 KiB root and bucket nodes. A root has 16-byte header then 64-bit bucket boundaries. Relocation buckets have 16-byte header then packed 20-byte `{virtual_offset,physical_offset,is_patch}` records. Subsection buckets have packed 16-byte `{offset,reserved,ctr_value}` records.
- [nca.c](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/nca.c), `nca_process_bktr_section`: relocation table immediately precedes subsection table, whose end is section end. Upstream reads both with ordinary CTR before installing them as virtual routing state, adds synthetic sentinels in memory, then verifies IVFC over the merged address space.
- `nca_section_fseek` and `nca_section_fread`: base relocation physical offsets address the **complete decrypted base section**, not the final RomFS file-data layer. Patch relocation offsets address patch physical section storage. Reads split at relocation boundaries, and patch reads also split at encryption-subsection boundaries. The existing `openRomfs` reader deliberately exposes only the final level and is therefore not a valid base-section adapter.
- `nca_update_bktr_ctr`: the low 64 counter bits encode the absolute file offset divided by 16, big endian; bytes 4–7 encode the subsection's 32-bit generation value big endian. Bytes 0–3 retain the section secure value. Unaligned AES reads need block-aligned decryption and slicing. Metadata table reads use the ordinary section counter generation.

The legacy upstream parser allocates caller-sized tables, relocates buckets in place, inserts sentinels, and may terminate on malformed lookups. The browser must not call that unrestricted path. Table indices, ordering, extents, counts and read splits require independent bounds validation first.

## Implemented safe primitive

`parseRelocations(bytes,{entryCount,baseSize,patchDataSize})` accepts an already-decrypted legacy relocation table capped at 16 MiB. It validates a single root with contiguous 16 KiB bucket nodes, exact node lengths, bucket ranges, first virtual offset zero, strict entry ordering, source flag 0/1, descriptor entry count, and every mapped physical extent against its source limit. It snapshots records into frozen metadata so later changes to input bytes do not change the plan. Unsupported tree layouts fail rather than guessing.

`planRelocationRead(table,offset,count)` returns frozen base/patch physical read spans, splitting across virtual relocation boundaries, capped at 64 KiB total. All offsets remain BigInt. Synthetic tests cover base/patch/base crossing, physical offsets above 4 GiB, EOF, malformed counts/order/source flags and out-of-range mappings. This primitive does not read or decrypt source content and does not assert that the table is authenticated. It must remain internal to a future verifier, never a public unchecked extraction path.

## Remaining coherent production implementation

1. Open and authenticate both selected base and patch Program NCA headers with separate native contexts and key lifetimes. Enforce CNMT application/patch association and independently measured whole-NCA hashes before choosing them. No filename inference.
2. Authenticate each section header and validate all physical ranges. Bound and decrypt patch table metadata without activating upstream virtual reads. Validate descriptors, the relocation tree and the separate subsection tree, including metadata/data boundaries and encryption generation values.
3. Implement a bounded merged section reader using separate base/patch contexts. Use relocation splits and, for patch spans, subsection splits and CTR-Ex. Do not expose this reader as authenticated yet.
4. Run the existing bounded IVFC verifier over the **merged virtual section**, with the master hash from the signed patch header. Only after all levels pass, return the merged final RomFS level to the existing tree indexer. A base/patch mismatch must fail integrity, not fall back to partial files or synthetic base bytes.
5. Add synthetic crypto/routing/integrity fixtures covering relocation and subsection crossings, counter byte order, unaligned reads, malformed buckets, wrong base and tampered patch. Preserve production RSA policy; signed real-content positive coverage remains a separate unavailable proof requirement.

No production enabling flag, signature bypass, optional integrity verification, unchecked output callback, or guessed patch fallback is added by this slice.
