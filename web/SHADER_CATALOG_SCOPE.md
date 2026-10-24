# Source-pinned shader catalog adapter

`shader-catalog-adapter.mjs` maps the committed native catalog into browser
translator jobs. It performs no fetch, translation, output packaging or release
attestation. Supply exact UTF-8 bytes of `dm/gfx/nvn/shader_map.tsv`,
`shader_facts.tsv` and `shader_map.tsv.conflicts.tsv` to
`await loadShaderCatalog({map, facts, conflicts})`. SHA-256 pins are exported in
`SHADER_CATALOG_SOURCES`; altered tables fail before parsing. This is a source
catalog, **not an authenticated release recipe**.

The result exposes all 6,927 `keys`, `describe(key)` copies, an `unsupported`
list and `prepare(key, {packBytes, mainImage, debug, reduced, allowUnverifiedTessellation?})`. Feed the returned
`{job, code}` to the existing shader pipeline. Resolve the needed local pack
using `describe(key).name`; no caller-provided path is opened. `mainImage` must
already have native `nsoimg.load` decompressed memory-image layout, not raw NSO.
The catalog has four embedded-main entries; it does not implement NSO extraction.

Mapping preserves native `loc`/`pc_of` first occurrence and conflict override
semantics. Pack records use non-overlapping `BTCDBTCD` delimiters. Embedded
records use the last `78563412` code marker in the preceding 0x1000 bytes and
0x880-byte control segment. Job code/c1 slicing follows `dmsh_build.py job_for`
exactly, including stripping the 0x30-byte prefix only for graphics. Source facts
are copied unchanged, and debug/reduced must be explicit. Source name/index and
resolved PC pairing are returned separately for eventual replay metadata.

Bounds and control hashes are checked for both packed and embedded records
(native only explicitly checks the embedded control hash at this location).
Graphics SPH must match vs/ps; truncated data, invalid c1 ranges, absent facts,
missing records and unsupported stages throw. Input record bytes are snapshotted
before asynchronous hashing. Caps are 8 MiB per catalog source, 256 MiB per pack,
512 MiB decompressed main, 2 MiB record, and 1 MiB translated code. These bounds
have not been validated against private game inputs.

## Domain/hull blocker, not an omitted subset

Map lines 26–27 contain domain `14b6f7ad94a21328` (`ds_terrain_d.bin`) and hull
`5221043a88afa381` (`hs_terrain_h.bin`). Both remain in `keys` and `unsupported`;
`prepare` refuses them by default. Explicit `allowUnverifiedTessellation: true`
enables the source-ported path, not verified support. The full source set therefore cannot pass by translating
only supported stages. The caller must retain all keys in any independently
trusted full release catalog; this adapter does not redefine completeness.

Source inspection proves native `dmsh_build.py` iterates both records and sends
the filename's ds/hs stage through non-compute graphics decoding. Original
`dmsh_xlate/Program.cs` does not validate those stage strings: it sets the compute
flag only for cs; Ryujinx `Translation/ShaderHeader.cs` reads actual stage from
SPH bits 10..13. The native accessor supplies fixed triangle patch/equal spacing
state. Native reflection explicitly says hs/ds storage-buffer bases are unmeasured
and leaves such bindings unresolved. This establishes native routing, **not**
successful translation, correct MSL tessellation configuration or runtime replay.
The implementation validates SPH2/SPH3, requires nonzero hs control-point count,
and propagates the explicit opt-in through the worker and C# bridge. The linked
adapter checks tesc/tese modes, kernel/vertex MSL kinds and the ds triangle patch
attribute. It reports `stageSupport: source-ported-unverified` and no verified
stage linkage. Actual emitted outputs and replay still need native parity proof.

## Production integration

`production-shaders.mjs` supplies authenticated pack/main-image inputs, replay metadata and the final source-digest gate. This adapter alone retains `productionEquivalent: false`; its job preparation is not a release attestation.

### Source-ported bridge changes, explicitly gated

The source enum defines hs=SPH2 and ds=SPH3. The gated source port validates
those values, reads hs OutputVertices from SPH word2 bits24..31, expects upstream
SPIR-V modes `tesc`/`tese`, and expects MSL `kernel`/`vertex` respectively (domain
also has a patch attribute). Existing accessor query semantics and Cross options
must remain unchanged. These source-derived guards do not prove native parity or runtime support.

A further source-level condition needs explicit resolution: Ryujinx
`CodeGen/Spirv/SpirvGenerator.cs` emits OutputVertices only for hs and triangle/
spacing/winding modes only for ds. Official Cross 1.4.363.0 `spirv_msl.cpp` derives
tessellation-factor shape from the Triangles mode and, with the native default
platform, emits the domain patch control-point count from `output_vertices`.
The native CLI flags do not provide stage-linkage overrides. Supplying new
triangle/count flags or new metadata would change native source output and cannot
be inferred from the empty hs/ds fact maps. Private record/native output or a
release-authoritative correction is needed to establish these two jobs' actual
behavior. This is a specific unverified linkage condition, not evidence that the
native release is broken or permission to omit these keys.
