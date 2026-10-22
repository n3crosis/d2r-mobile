# Corpus-driven compiler source corrections

`patches/0106-a2flo-corpus-compiler-fixes.patch` follows the five unchanged
`0101` through `0105` migration patches. The a2flo repository, commit and
archive SHA256 are unchanged, as is the complete historical
`manifest.json` `rebaseProvenance` record. This is an incremental source patch,
not a new upstream rebase, ABI version or receipt format. The separate
`0107-a2flo-typed-constant-pointer-slots.patch` adds the reviewed pointer-slot
correction without changing any byte of `0101` through `0106`. The additive
`0108-a2flo-exact-inverse-pointer-merges.patch` retains all seven previous patches
and extends only proven inverse-pointer merge handling. It does not change the
MSL API, fixed 31-call canary, zlib fixes or runtime integrity checks.

## Changed source files

- `clang/lib/AST/Decl.cpp`: include Metal tessellation-evaluation entries in
  the existing source-name language-linkage rule. Sema changes a
  `[[patch(...)]] vertex` entry to this attribute before symbol generation.
  Ordinary C++ helper overloads and non-Metal graphics linkage are unchanged.
  The entry is not renamed in the writer or accepted under a substituted name.
- `llvm/lib/Transforms/LibFloor/MetalFinal.cpp`: preserve the `dso_local` bit
  when LLVM requires it for local linkage or applicable non-default visibility,
  instead of producing invalid in-memory IR before the verifier. Also lower
  optimizer-generated scalar `llvm.bitreverse.i32` calls to
  `air.reverse_bits.i32`, preserving the existing call in place. Other widths,
  vectors, conflicting AIR declarations and unsupported intrinsics still fail
  closed.
- `llvm/lib/Transforms/LibFloor/PointerBCFixup.cpp`: handle narrow read-only
  constant-address-space pointer graphs seeded by a struct-to-vector cast.
  Validate connected scalar/vector GEPs, PHIs, selects, ordinary loads and all
  merge inputs before changing IR. Each root must prove compatible original
  storage; matching pointer types alone do not authorize an unknown input.
  Equal lane counts, scalar/vector store sizes and allocation strides are
  required. Rebuild typed storage pointers and bitcast loaded values, never
  substitute another buffer's address. Preserve indices, address spaces,
  alignment, bit patterns, select conditions and PHI incoming blocks/edges,
  including loop backedges. PHI placeholders and a dependency order permit
  cyclic components without moving or speculating loads. Pointer escapes,
  writes, volatile/atomic loads, unknown roots, vector regrouping and unsupported
  layouts are excluded from the new lowering; legacy validation and acceptance
  are unchanged. Final rejection diagnostics contain bounded built-in opcode
  names and fixed compiler-authored reason labels, not source names, types,
  values, paths or IR excerpts. Diagnostics do not expand accepted inputs.
  The separate `0107` delta admits ordinary pointer-valued loads only from a
  demonstrably typed slot, including zero-offset first fields of sized records
  and nonempty arrays. It preserves both address spaces, pointer width, explicit
  alignment, metadata and load position. It does not guess types from equal
  pointer widths. An inverse vector-to-record cast must restore the exact type
  of that recovered slot load; existing native aggregate GEPs, indices and merge
  edges remain unchanged. The full forward native-use closure must be read-only.
  Unknown/raw-byte/nonzero-field slots, volatile/atomic loads, shifted or inexact
  inverse casts, escapes and writes remain outside that direct-slot lowering.
  `0108` separately proves each inverse PHI/select input's exact original
  aggregate type. Every visited input must reach a matching root or typed slot;
  equal layouts are insufficient, and a valid surrounding arm cannot justify a
  rootless subcycle. New native merges preserve conditions, metadata, duplicate
  edges and original insertion sites. Native GEP indices/strides and load sites
  remain unchanged. GEP/scalar inverse inputs, mismatched nominal types,
  null/undef/poison roots, unknown arms and hidden dependencies on the rewritten
  graph are rejected before mutation. The existing direct-slot behavior and
  native read-only closure remain intact. Rejection subreasons are fixed strings
  plus bounded opcode names, never user identifiers or IR excerpts.
- `clang/lib/CodeGen/CodeGenModule.cpp`: do not mistake annotations on an
  explicitly bound resource's pointed-to record for a second stage interface.
  Exempt only non-stage-input pointers/references with a sole `buffer` attribute
  in device/constant address space, or a validated `threadgroup` binding in
  local address space on a compute kernel. Existing binding, address-space,
  stage and conflicting-attribute validation still applies; real `stage_in`
  records retain full interface checks. Unbound and by-value decorated records
  remain rejected. This is the project's explicit-binding subset, not a general
  MSL or Apple ABI compatibility claim. Separately, ordinary data-buffer
  reflection uses AST member offsets, allocated member/array-element sizes and
  source alignment, retaining the existing 16-byte alignment cap. Indirect
  buffers, stage/payload packing and member-offset handling for bases,
  polymorphism, unions and bitfields retain their prior paths. This correction
  changes metadata, not LLVM storage types, GEPs or loads/stores.
- `clang/lib/Basic/Targets/SPIR.h`: initialize AIR64 with the same vector storage
  DataLayout already used by final AIR output. Previously, byte-aligned vectors
  caused record lowering and optimization to use smaller allocation sizes and
  array strides before finalization increased alignment. The change is confined
  to AIR64 vector alignment clauses; other targets, scalar/pointer layouts and
  final AIR layout are unchanged. Unlike the reflection repair, this changes
  early storage layout and can affect aggregate shapes and optimization.
- `llvm/lib/Bitcode/MetalLib/MetalLibReflection.cpp`: accept the zero-operand
  `air.arg_unused` marker only in the existing fragment-input and position
  handlers. Set their existing optional `unused` field so binary reflection
  preserves the marker; reject duplicates through the existing error path.
  No metadata is stripped, unknown attributes remain errors, and other handlers,
  schemas, signatures, bindings and container/integrity rules are unchanged.

The AST, finalization, CodeGen and reflection-writer files already appear in `patchedFiles`; their
final SHA256s change. The pointer pass and AIR64 target header are the new source
paths beyond the first five patches.
Every source file changed by any active patch remains covered, and
each incremental patch has its own SHA256 in the ordered `patches` list.

The project-owned `api/air_compiler.cpp` separately finalizes fragment-input
liveness after the completed frontend optimization and before verification and
either serialization. It adds a terminal `air.arg_unused` only for unused
`air.fragment_input`/`air.position` arguments, with bounds-checked original
indices. Cloned metadata preserves every existing operand and order; existing
markers are not duplicated. Other stages, resource/output descriptors, signatures,
bodies, bindings and attributes are unchanged. Malformed input metadata fails
closed. This API source is authenticated by the existing runtime source identity.
The writer has later clone-only optimization; the hook is not a general claim
about last uses disappearing only in that writer. Read-only evidence confirms
all 47 observed omissions are already unused before the writer.

## Authored LLVM regressions

Six public pass-level fixtures are retained under `fixtures/`, separately
from the production-source patch:

- `metal-final-dso-local.ll`: verify required in-memory locality immediately
  after cleanup, including private/internal functions, visibility cases and a
  static initializer.
- `metal-final-bitreverse.ll`: check the optimizer-generated idiom, scalar i32
  retargeting and call properties; reject other widths, vectors and a conflicting
  AIR declaration.
- `metal-constant-vector-loads.ll`: check typed constant-buffer reads and exact
  index/alignment handling; reject padding, regrouping, pointer escapes, stores,
  volatile/atomic access and nonconstant address spaces.
- `metal-constant-vector-merges.ll`: cover read-only selects, diamond and
  loop-carried PHIs, mutually recursive PHIs, earlier scalar/vector roots and
  preserved indices/metadata. Nine unsupported graph categories reach unchanged
  legacy rejection through direct select users, including unknown roots,
  escape/write access and unmapped null/undef/poison arms.
- `pointer-unsupported-user-diagnostics.ll`: preserve unknown-arm select/PHI
  rejection and check bounded reason labels, the four-opcode cap, overflow
  marker and absence of an appended instruction dump.

- `metal-constant-pointer-slots.ll`: seventeen positive functions and twenty-seven
  isolated rejection modules. The original ten positives and fourteen negative
  bodies remain unchanged. Seven added positives describe exact root round-trips,
  branch-local root/slot diamonds, slot-only select seeding, loop and duplicate-edge
  PHIs, local exact provenance within mixed nominal components and direct-slot
  compatibility. Thirteen new negatives cover nominal mismatches, zero/shifted
  GEP and scalar inverse inputs, rootless subcycles, hidden native dependencies,
  invalid native constants, unknown arms, escapes and writes. All retain users
  reaching the unchanged legacy rejection path. Source hashes, preserved bodies,
  split-module inventory and RUN targets are checked, not compiler behavior.

Their `RUN` lines require `opt`, `FileCheck` and, for split fixtures,
`split-file` from the matching patched toolchain. They have not been executed
by this source-only integration. The JavaScript provenance tests and WASM
canary do not execute these LLVM pass-level fixtures.

## Real-WASM CI canaries

The fixed production CI canary now contains nineteen authored MSL fixtures across
three stages, plus four supplemental fragment-input liveness combinations. Fourteen
additions to the original list cover these source corrections:

- `msl-internal-helper-function-constant.metal`: a retained internal helper and
  function-constant initializer exercise required `dso_local` handling.
- `msl-optimizer-bit-reversal.metal`: runtime shifts and masks exercise the
  optimizer-generated scalar bit-reversal lowering, not the direct header API.
- `msl-patch-entry-name.metal`: the expected vertex entry is exactly
  `patch_linkage_probe`, while overloaded C++ helpers retain normal linkage.
- `direct-buffer-vector-pointer.metal`: direct constant-buffer struct-to-vector
  pointer reads exercise the demonstrated pointer-fixup failure, with the exact
  fragment entry `direct_buffer_vector_pointer`.
- `constant-vector-pointer-reads.metal`: argument-buffer pointer reads retain
  positive coverage, with fragment entry `constant_vector_pointer_reads`.
- `conditional-distinct-buffer-rows.metal`: runtime branch selection across
  unlike original buffer-pointer shapes, with fragment entry
  `conditional_distinct_buffer_rows`.
- `loop-carried-buffer-pointer.metal`: a live loop-carried buffer pointer with
  runtime iteration/branch inputs, with fragment entry
  `loop_carried_buffer_pointer`.
- `retyped-buffer-pointer-load.metal`: a demonstrated pointer-producing-load
  failure on the existing e97 and 74e5e62 artifacts, with fragment entry
  `retyped_buffer_pointer_load`. The exact public source is authenticated before
  real-WASM compilation. It now passes the existing 31-call CI baseline, but
  its earlier failure diagnostic alone does not expose its incoming LLVM graph.
  Inverse-recast cases are covered only by the unexecuted native matrix; a
  separate MSL candidate already passes the old compiler and is not included
  or represented as a reproducer of that branch.
- `msl-stage-record-threadgroup.metal` and `msl-stage-record-buffers.metal`:
  a by-value stage input shares its decorated record type with separately bound
  storage, using exact kernel entries `stage_record_threadgroup` and
  `stage_record_buffers`.
- `msl-buffer-reflection-{mixed,array,float3,nested}.metal`: four ordinary-buffer
  compilation probes with exact kernel entries `reflection_mixed`,
  `reflection_array`, `reflection_float3` and `reflection_nested`. The same
  canary also requests LLVM text through the real WASM API and checks exact
  reflection for all four, plus actual type allocation and source GEP offsets
  for the float3 probe. Container success alone is insufficient.

The first four independently authored inputs reproduced their corresponding
failures against the earlier pre-correction artifact. The argument-buffer input
was positive coverage, not a demonstrated failure. A retained, authenticated
artifact for `956566f486a95a5ac85b2ce88e3346979ad70f7e` passed nine of the
existing ten canaries; the scalar-operations case still failed its half-language
gate. The two new, unchanged inputs fail that artifact with bounded unsupported
`select` and `phi` diagnostics respectively. Their exact public source hashes
are checked by the source-only fixture wiring test. The two storage/interface
inputs independently reproduce the missing-stage-in diagnostic on the
verified e97e74c artifact; all 15 authored storage/interface negative cases
remain rejected by that baseline. This is baseline evidence, not execution of
the updated compiler. All four reflection probes compiled and passed strict
container inspection on e97e74c, while their emitted metadata reproduced the
layout defects. All copies preserve their original comments and any license notices; none contains private shader source
or reference-library bytes.

The rebuilt compiler must compile every case and pass strict expected-name,
stage, platform/version and container/bitcode-integrity inspection. A fixture's
explicit entry overrides only the default `main0`; rejected entry names are not
renamed or accepted under aliases. The bounded compilation budget includes
19 fixed metallib cases, four reflection LLVM-text checks, and both formats for
the four liveness variants: 31 API calls total. Each added shader is source-only, excluded from the public runtime
payload, and included by the existing tracked compiler-directory source copy.
Source-only tests check fixture wiring and copy closure but do not execute the
compiler. The green 144d3f2 CI baseline retains the 62a0097 compiler bytes and
passes these existing canary checks. The new `0108` inverse-merge path has no
new demonstrated MSL reproducer; its added native coverage remains static-only.

## Authored storage/interface regressions

`fixtures/stage-storage.json` indexes the two byte-preserved public positives
and 15 negative inputs under `fixtures/stage-storage-negative/`. The existing
`run-msl-fixtures.mjs` runner checks positive entry names and distinct
storage/interface metadata, plus expected rejection diagnostics for missing or
duplicate bindings, wrong address spaces/stages, conflicting annotations,
unbound pointers and by-value records. No extra workflow or runner is needed.

This native runner has not been executed for these corrections. Source-only
checks authenticate the localized guard delta and fixture inventory; they do
not establish compilation, metadata correctness or GPU execution. The two
positives additionally use the existing strict real-WASM CI canary path.

## Authored ordinary-buffer reflection regressions

`fixtures/buffer-reflection.json` indexes four unchanged MIT-licensed probes
and expected metadata: a mixed scalar/vector/array record, a vector-only array,
a float3 record and a nested-record array. The existing native MSL runner uses
`check-buffer-reflection.mjs` to check buffer size, alignment, binding, address
space, field offsets, allocated strides/counts and recursive field descriptors.
The real-WASM canary uses the same checker after the shared API's optimization.
Its float3 storage check derives allocation from the emitted type and DataLayout,
requires size 80/alignment 16, array base 32/stride 16, and actual source GEP
offsets 0/16/48/64. This deliberately bounded parser is not a general LLVM reader.
Source-only tests use hand-authored metadata/type syntax to exercise assertions,
not compiler output or compiler correctness. Read-only replay rejects the known
e97 reflection defects and its 112-byte float3 storage type.

The baseline float3 probe also has a distinct storage mismatch: its final LLVM
type occupies 112 bytes, versus its 80-byte source ABI. Reflection alone cannot
repair that. The separate AIR64 DataLayout correction addresses the traced
cause before record lowering and optimization, rather than rewriting metadata
or deleting padding late. Fresh compiler output must still establish size 80,
alignment 16, field offsets 0/16/32/64 and a 16-byte array stride. Neither successful
compilation nor corrected reflection proves these memory semantics.

The DataLayout change removes an inherited low-alignment AIR optimization
assumption, so the next artifact needs a broader regression sweep: stage and
argument-buffer paths, scalar/vector operations, nested aggregates, arrays,
matrices, helper calls, three-lane vectors and two/four-lane controls, plus the
unchanged corpus. No compiled reference or private corpus source is included.

## Authored fragment-input liveness regression

`msl-fragment-input-liveness.metal` retains its five-argument interface and sparse
buffer bindings 9/13. Independent varying/position macros cover both live, both
dead, varying-only dead and position-only dead. The same real-WASM canary compiles
all four combinations to strict-checked metallibs and LLVM text.
`check-fragment-input-liveness.mjs` resolves the entry's actual input descriptors,
checks exact operand order, interpolation, retained signature/indices and final
argument uses, and requires terminal markers only on each dead stage input.
Even the unused resource remains unmarked.

`check-fragment-input-reflection.mjs` additionally follows the actual metallib's
AIRR nodes and requires serialized `unused=true` for each dead varying/position,
with absent fields for live and out-of-scope arguments. It preserves the existing
strict container/hash gate, rather than replacing it. This fixture-specific
bounded reader is not a general reflection decoder. Both checks and the four
combinations prevent fixing serialization by silently stripping or ignoring flags.
The checker and fixture remain source-only, excluded from the public runtime.

The e97 baseline lacked the two dead-input flags. The 74e5e62 diagnostic artifact
correctly emits those flags in API LLVM text, but its strict writer rejects them:
`create_fragment_input` fails first, hiding the same missing case in
`create_position`. The narrow consumer correction handles both. This actual
failure shows why source review and LLVM-text checks did not prove serialization.
That writer correction is included in the later green CI baseline, whose existing
canary checks actual live/dead serialized AIRR flags. Synthetic parser tests alone
would not establish writer execution.

Source-only checker tests do not execute the API; standalone `clang -cc1` cannot
exercise the wrapper hook. The existing real-WASM canary covers all four liveness
combinations and their binary reflection; broader embedded-AIR/corpus equivalence
and stage-linkage or device effects are separate, unestablished claims.

## Evidence and verification boundary

These corrections respond to authenticated CI artifacts. The 62a0097 compiler,
retained unchanged by the green 144d3f2 CI baseline, includes `0106`/`0107` and
passes the existing strict canary. A remaining original kernel reports an
unsupported inverse pointer cast. Its diagnostic identifies the rejected user,
not that user's input opcode or complete pre-error graph. No usable pre-error IR
establishes that the new PHI/select case occurs in that kernel; this integration
does not claim actual kernel recovery.

`0108` is a statically reviewed correction for the precisely defined symbolic
cases above, pending a fresh matching artifact and unchanged-source checks. Its
native matrix has not run here or in current CI, which does not build
`opt`/FileCheck. No new natural-MSL probe, raw-IR API mode, extra job or native-tool
build is added. Other pointer graph shapes remain unsupported. The conservative
maximum diagnostic length is 278 characters, including the invalid-opcode
fallback; subreasons cannot reveal source names, values, paths or IR.

The source-only verification procedure is:

```sh
node toolchain.mjs check
node toolchain.mjs prepare --archive /path/to/pinned-archive.tar.gz --work /path/to/new-empty-work
node --test ../../tests/air-compiler-source-provenance.test.mjs
```

`prepare` verifies the archive hash, checks and applies every patch in order,
then checks every final modified-source SHA256 and verifies that AIR64's initial
and final DataLayout strings match in the prepared source. The provenance regression
checks exact patch inventory, patch digests, modified-source path coverage and
runtime source identity. None of these steps builds or invokes LLVM, Clang or
WASM, and no private corpus source is included in this package.

A new CI-built artifact and execution of authored regressions plus the
unchanged corpus are still required to validate `0108`.
Existing artifacts cannot contain that new inverse-merge correction. The complete manifest hash
and all patch hashes already participate in runtime source identity, so old
receipts must become stale rather than being relabeled or bypassed. No source
identity, metallib entry/stage, container-integrity or bitcode-hash check is
weakened. No Apple runtime acceptance or rendering equivalence is established.
