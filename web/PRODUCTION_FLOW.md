# Browser production flow

`prepareBrowserPackager` verifies the complete manifest against the build-substituted
HTML digest. The browser UI uses `editableOptions: true` to preload both bundled
shell profiles and the closed optional capability bytes before folder selection.
Core runtimes initialize during bootstrap; optional ASTC and signing workers start
only when needed, using verified in-memory bytes without further downloads. Target,
hash-check, ASTC preset and signing choices can change without a reload or loss of
the selected folder. Generation snapshots the chosen options and binds the selected
profile locally. API callers without editable options retain selected-only preload.
The prototype
no longer imposes a CSP network lockdown; local processing and no-upload behavior
remain. Public shell bytes and metadata are included in the runtime inventory.
The selected shell ZIP
additionally matches the independently bundled release SHA-256 and per-entry
inventory; its actual Mach-O target is inspected.

One folder supplies all NSP files, prod.keys, and optional title.keys. Isolated extraction
owns keys through the last authenticated lazy read. The callable sequence is
program rewriting, native art, HUD, generated tables, frontend/remaining art and
[CASC overlays](toolchain/overlay-recipe-js/README.md), full shader conversion,
inventory checks, then local staged IPA writing. Private data is never uploaded.
Generation is single-use; cancellation closes the session and requires reload.

The shader chain label alone is **not** a compatibility blocker. Native
`d2rm_pack.py` explicitly relabels metadata and the c1 directory to the shell's
chain, provided the complete normalized shader-source digest matches SHADER_SRC.
The browser preserves that digest gate, pinned shell hash, and target checks.
Relabeling cannot accept differing shader sources.

Bulk RomFS is exported directly into a fresh `D2R-resources-<UUID>` child of the
selected input folder, streaming authenticated chunks while the isolated
extraction session is alive. The single folder picker requests read/write
permission; original NSPs and key files are never written. Root-only input
discovery ignores generated subtrees, and subsequent runs create new children.
Export runs
only after generated-content and assembly validation, and completes before IPA
commit. The validated IPA is published as a bounded Blob for a normal browser
download, not written to the input directory. Its destination follows browser
settings; a visible Download IPA link retains its object URL for retries until
the page is disposed or the URL is replaced. The resource exporter marks
incomplete transfers; a later IPA failure
does not invalidate an independently completed resource folder. Users copy the
resource folder into the installed app’s Files folder. This preserves the native
shell layout without requiring external extraction tools or bundling huge game
data into the IPA. Experimental older-GPU mode additionally generates a separate
Legacy Device Pack and matching ASTC overlays in the IPA; the bulk pack remains
outside the IPA. Copy both completed resource and Legacy Device Pack folders
alongside each other into the installed app’s Files folder when this option is used.
On 2026-10-23, the maintainer reported that the generated IPA works on a real iOS device. This is user-reported physical-device testing, not merely a build or synthetic check. The report did not specify the exact tested build, device/iOS version, input format or gameplay coverage. This report does not certify a new compiler release or broader device/GPU compatibility. ZIP32, in-memory stage budgets, OPFS quota and
adapter limits can reject a genuine large build rather than silently truncate it.
Production runtime compilation and initialization must still succeed in the
published artifact; a successful source bundle is not game-compatibility proof.

DLC is optional. The trusted production policy accepts base plus update packages,
and accepts only the authenticated known DLC when supplied. The effective runtime
mode comes from the authenticated selection, not a UI checkbox. For a no-DLC
selection the original pinned shell executable is reverified and its unique
source-identified ownership-cache initializer changes from -1 to 0. Exact SHA,
symbol, section, preimage and deterministic result checks remain mandatory. The
output records this bounded variant in `dm/content_mode.json`; all other shell
bytes stay unchanged. The existing executable signature becomes stale and the
IPA must be re-signed before installation, as with any unsigned output. This is
source-backed behavior, not proof of base-only gameplay or runtime loading.

## Adapter contracts

- [Packaging coordinator](packaging-job.mjs): required capabilities are checked
  before discovery, key reads or output creation. The browser uses serial
  generation and `secretLifetime: "archive"`, retaining the isolated extraction
  worker only for bounded authenticated lazy reads. Generators receive no keys
  or secret-session handles. Started work drains before disposal; secrets are
  disposed before archive validation, cleanup and the sole commit boundary,
  `output.close()`. Disposal/cleanup failures prevent commit. Close rejection
  does not prove rollback, and cancellation cannot undo a completed commit.
  Only `PackagingJobError.report` is safe to display; never display or log its
  original `.cause`.
- [Shell loader](shell-loader.mjs) and [inventory contract](shell-contract.mjs):
  [production profiles](production-profile.mjs) supply independently pinned
  release inventories and recipes, not assertions copied from the ZIP. Actual
  ZIP metadata must match; entry reads verify decoded size, CRC and SHA-256.
  [Target inspection](shell-target.mjs) reads verified Mach-O/plist bytes rather
  than copying expected values. Required paths, allowed generated paths, target
  versions, modes and collision checks bind the final assembly. Embedded ad-hoc
  signature metadata is structural, not signing authorization. Native format
  references remain [shell_build.sh](../dm/ios/tools/shell_build.sh) and
  [d2rm_pack.py](../dm/tools/d2rm_pack.py).
- Shell streams verify one bounded entry before yielding chunks of at most
  64 KiB; consumers must close abandoned iterators. Only redundant directory
  records are omitted, never files. The browser uses STORE ZIP32 with the
  existing 512 MiB archive / 256 MiB member ceilings. The coordinator's separate
  ZIP64 option requires an explicit output budget; it is not a browser default
  or evidence of iOS installer compatibility. Exact limits remain in
  [zip-reader.mjs](zip-reader.mjs), [zip-writer.mjs](zip-writer.mjs) and
  [zip64-writer.mjs](zip64-writer.mjs).
- [Raw-file staging](raw-file-stage.mjs) backs archive decoding and ASTC/CASC
  pack assembly in private OPFS. Callers supply an explicit total byte budget,
  serialize operations of at most 1 MiB, finalize before replay reads, and dispose
  after consumption. Cleanup drains in-flight I/O and removes only the owned
  directory; failures remain observable and retryable. Caller-held `File`
  snapshots cannot be revoked, and crashes may leave staging directories. There
  is no quota reservation or RAM fallback. [Synthetic tests](tests/raw-file-stage.test.mjs)
  cover these contracts, not browser quota or crash recovery.
- [RomFS indexing](romfs-tree.mjs) requires the same immutable, authenticated
  final IVFC data level throughout its lifetime; authentication and rejection of
  stale reads belong to the extraction boundary. It preserves BigInt offsets,
  bounds member reads to 64 KiB, metadata to 16 MiB, entries to 100,000 and depth
  to 64. Traversal, malformed names, collisions, overlapping or unreachable
  records fail. Consumers still own aggregate backpressure. Lookup hash tables
  do not authenticate content. Layout provenance is pinned hactool commit
  `1d64a83450e025622f3468c28fc4164dad2c5ef6`:
  [ivfc.h](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/ivfc.h)
  and [romfs.c](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/romfs.c).

These are implementation contracts, not additional browser or device acceptance
results. Cancellation cannot interrupt an in-flight synchronous native call;
JavaScript cleanup is not proof of secure erasure.
