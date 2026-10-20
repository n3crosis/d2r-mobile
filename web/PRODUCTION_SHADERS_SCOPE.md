# Production shader source adapter

`createProductionShaderAdapter({runtime, catalog, trustedShell})` in
`production-shaders.mjs` supplies `generateShaders({extracted, selection, signal})`
and `dispose()`. It returns `OutputEntry[]` for the packaging flow, not a claim
that an IPA can run. The shell argument must come from the application-pinned
shell loader, not user-edited metadata. It is snapshotted on construction.

The runtime must carry the sealed-session private brand; the catalog must carry
the SHA-pinned loader's private brand. Extraction assets and main/sdk bytes are
obtained only through the extraction adapter's private provenance registry,
bound to the same selection. There is no fetch, external process, injected
worker implementation, synthetic shader or reduced-catalog fallback.

## Implemented source chain

- Require all 6,927 pinned keys, exactly matching the trusted shell recipe.
- Read authenticated logical `data:data/hd/shaders/<pack>.bin` sources, one pack
  at a time; decode main NSO segments with existing bounded/hash-checking code
  and assemble the original `nsoimg.load` memory layout for embedded records.
- Produce exact native-style jobs with debug/reduced both true (original default),
  including c1/facts and explicitly gated hs/ds. Run the real sealed translator
  and Cross pipeline. No record is skipped or replaced.
- Port native `dmsh_fetch.variant` rules for readable-tile variants, preserving
  calls, mixed texture slots, output mapping and function constants. The committed
  `bf_want.tsv` is an empty generated list; optional runtime bytes must match its
  exact pinned hash. The identical empty bytes are the loader's default, not an
  inferred omission. Any changed policy needs an explicit source-pin migration.
- Assemble the original `dmsh_build.finish/write_refl` replay fields and iOS
  `chain_metal` command record. In noMetal mode these command records describe the
  intercepted native route: `.metallib` bytes are LF source, not Apple-compiled
  libraries. Generate `_bf.metallib` and `fetch` metadata exactly when the native
  variant rules produce a source.
- Port `c1_guard.py` definition traversal (eight links), numeric-index and bound
  recognizers. Emit sorted keys in `dm/c1_full.tsv`, with native local-time header
  format. This examines only base sources, as native removes temporary bf sources.
- Verify full sorted filename/raw-source-hash aggregate against
  `be59c864f087b377`. Only after all keys succeed and this equality holds, apply
  the shell chain to the directory, every replay record and c1 header. A local
  source/header chain differing from the shell is not rejected just for its label.
  No blind relabeling, changed source digest or partial completion is accepted.

Outputs are `msl/b-<shell-chain>/<key>_b.metallib`, matching `_b.json`, optional
`_bf.metallib`, and `dm/c1_full.tsv`. The native build marker is not fabricated;
full in-memory completion and source-digest checks gate the returned entries.
The existing package recipe remains responsible for final output validation.

## Bounds and lifecycle

One generation per adapter; bounded existing translator jobs, one active pack,
one main image, 256 MiB base source cap and 512 MiB combined source/replay cap.
Jobs yield between records and accept cancellation. Failure returns no partial
entry set. `dispose()` cancels work and erases retained mutable output buffers;
call it only after output consumption. Entry readers return copies, not retained
internal buffers. No outputs are retained persistently by this adapter.

Syntax, formatting and lint only were run for this integration, as requested.
No new tests, compiler builds or CI jobs were added. Real catalog translation,
tessellation/native replay equivalence, readable-tile execution and full private
source digest have not been demonstrated. In particular the documented hs/ds
native linkage and storage-base uncertainties remain; actual input may fail
closed. Source implementation is not evidence of full production compatibility.
