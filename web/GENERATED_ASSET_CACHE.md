# Repeat-run generated art cache

The production asset adapter can reuse encoded results of the native-art, HUD
and map-goal generators through the optional local output cache. This includes
rendered HUD glyphs and map labels. It does not cache raw fonts, source textures,
decoded pixel buffers, extraction state, keys or signing credentials.

Each run still opens the current authenticated/local-input capability and reads
and validates the generator's current sources. The cache key includes SHA-256 of
the exact worker payload, operation options, verified runtime manifest digest,
shell profile and art/overlay recipe revisions. The payload covers source images,
fonts, text, layout and preceding generated dependencies. Changed source bytes,
recipes or runtime identity cannot inherit an older entry solely because the game
version or filename matches. Missing runtime identity disables asset reuse.

This deliberately caches after source decoding and before rendering. A hit skips
the corresponding generator worker operation, not input authentication, decoding,
the whole asset stage or resource export. Texture encoding, derived tables, CASC
overlays and optional ASTC packs still run. No repeat-run timing is claimed.

`asset-output-cache.mjs` stores each encoded output separately, with a bounded
result index committed last. Each file is at most 16 MiB; native-art/HUD cached
result sets are at most 64 MiB and map-goal sets at most 16 MiB. These are cache
budgets, not measured output sizes or browser process-memory guarantees. Reads
and writes are serial and do not create a combined output archive or base64 copy.
The adapter retains only the output set already needed by one generator.

The independent origin-owned ledger in `local-output-cache.mjs` verifies both
index and file snapshots. A folder receipt alone is not authority. Both a cache
hit and fresh computation pass the same generator output checks. Missing,
corrupt, oversized or rejected cached results fall back to computation. Fresh
outputs are cached only after those checks, and partial writes never publish a
complete result index. Cancellation stays fatal and wipes owned returned bytes.

Ignore-cache mode bypasses reads in the shared local cache; successful fresh
generation may refresh its entries. Public runtime download caching is separate.
Deleting the selected folder's `.d2r-cache` rebuilds generated outputs next time;
it must not delete original input, `D2R-resources-*`, `Legacy Device Pack-*` or IPA
outputs. Completed resource markers currently lack source-bound per-file digest
proof, so this feature does not silently reuse or certify those folders, nor
does it establish which resources are already installed on a phone.

Focused synthetic tests cover hits, source/context invalidation, denied or corrupt
storage, output revalidation, cancellation, incomplete writes and cache bounds.
They use no game inputs, compiler or browser and do not establish real-device
performance or conversion compatibility.
