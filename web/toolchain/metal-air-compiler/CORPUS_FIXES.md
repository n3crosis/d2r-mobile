> Historical D2R integration evidence. Compiler implementation now lives in the [reusable fork](https://github.com/n3crosis/floor_llvm); local API/patch/build paths in this record are historical. These results do not certify a fresh release. [Current integration](README.md).

# Corpus-driven compiler source corrections

## Real-device update (2026-10-23) / 真机测试更新

The maintainer reported that the generated IPA works on a real iOS device. This
user-reported result is separate from the compiler-only evidence below; no exact
build, device/iOS version or gameplay coverage was specified. Historical statements
about what a source, Node or ABI check proves remain scoped to that check.

维护者确认生成的 IPA 已在真实 iOS 设备上运行成功。此用户报告与下方仅限编译器的
证据分开记录；报告未注明具体构建、设备/iOS 版本或游戏覆盖范围。历史源码、Node
或 ABI 检查的证明范围不因该报告而扩大。

`patches/0106-a2flo-corpus-compiler-fixes.patch` follows the five unchanged
`0101` through `0105` migration patches. The a2flo repository, commit and
archive SHA256 are unchanged, as is the complete historical
`manifest.json` `rebaseProvenance` record. This is an incremental source patch,
not a new upstream rebase, ABI version or receipt format. The separate
`0107-a2flo-typed-constant-pointer-slots.patch` adds the reviewed pointer-slot
correction without changing any byte of `0101` through `0106`. The additive
`0108-a2flo-exact-inverse-pointer-merges.patch` retains all seven previous patches
and extends only proven inverse-pointer merge handling. The additive
`0109-a2flo-canonical-gep-recasts.patch` preserves those eight patches and restores
only the exact canonical scalar/vector storage pointer after a validated GEP.
Neither extension changes the MSL API, fixed 31-call canary, zlib fixes or runtime
integrity checks. The separate `0110-a2flo-scalar-i1-conversions.patch`
preserves all nine patches and hardens only scalar i1-to-floating conversion
lowering; it is not evidence of an invalid AIR intrinsic or a rendering fix.

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
  remain unchanged. Aggregate recovery through GEP/scalar inverse inputs, mismatched nominal types,
  null/undef/poison roots, unknown arms and hidden dependencies on the rewritten
  graph are rejected before mutation. The existing direct-slot behavior and
  native read-only closure remain intact. Rejection subreasons are fixed strings
  plus bounded opcode names, never user identifiers or IR excerpts.
  `0109` separately accepts a GEP inverse cast only when its destination exactly
  matches that node's canonical scalar/vector storage pointer. It reuses the
  existing typed GEP replacement, retaining arbitrary signed/dynamic indices,
  index widths, inbounds, metadata and native load sites. It does not reconstruct
  aggregate objects through GEPs, infer types from equal widths, or add/move loads.
  The entire component and native read-only closure validate before mutation;
  cached root aliases are updated before subsequent load reconstruction.
  Non-GEP canonical inverses (apart from the existing direct-slot path), wrong
  layouts/types/address spaces, writes, escapes and volatile/atomic loads remain
  outside this path. Refined rejection labels expose only fixed destination
  categories, not source types, values or indices.
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

Seven public pass-level fixtures are retained under `fixtures/`, separately
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
  `0109` changes only the scalar-to-aggregate rejection expectation; all 17/27
  bodies and every other check remain byte-identical.
- `metal-canonical-gep-recasts.ll`: nine symbolic positives and eighteen isolated
  negative modules. Positives cover scalar/vector storage, mixed-width dynamic
  and signed negative indices, chained GEPs, native PHI/select users, root-alias
  loops, native GEP crosslinks, shared inverses, existing direct-slot recovery
  and integer canonical storage. Negatives cover noncanonical destinations,
  vector/scalar/aggregate/pointer category mismatches, unknown roots, padded
  layouts, non-GEP inputs, writes/escapes, volatile/atomic loads and address-space
  changes. Exact hashes, RUN/module inventory and source-only payload exclusion
  are checked. These are not executed native or real-WASM regression results.

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
compiler. The authenticated 440eb1a artifact includes `0110` and passes all
31 calls: 23 metallib outputs and eight LLVM-text outputs. Neither `0108` nor `0109` adds a demonstrated natural-MSL
reproducer for its narrow inverse case; their native fixtures remain unexecuted.

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
positives additionally use the existing strict real-WASM CI canary path. The
sealed 440eb1a validation also confirms all 15 expected rejections through the
actual WASM API; that does not execute the separate native runner.

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
or deleting padding late. The authenticated 440eb1a canary verifies emitted size
80, alignment 16, field bases 0/16/32/64 and a 16-byte array stride; its actual
accessed GEP offsets are 0/16/48/64. These bounded IR checks do not establish GPU
memory behavior; successful compilation or reflection alone would not suffice.

The DataLayout change removes an inherited low-alignment AIR optimization
assumption, requiring broader regression checks beyond metadata. The sealed
440eb1a targeted checks and unchanged-input corpus sweep provide compiler-only
evidence, not exhaustive coverage of stage/argument-buffer paths, aggregates,
arrays, matrices, helpers or every vector shape. No compiled reference or private
corpus source is included.

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
combinations and their binary reflection. The sealed corpus and ABI checks below
do not establish numerical equivalence, stage-linkage or device effects.

## Evidence and verification boundary

These corrections respond to authenticated CI artifacts. The sealed compiler-only
acceptance for revision `440eb1a7eedbde6f8c95e037260aed1006365d99`, including `0110`,
passes all 7,212 original shaders, 55 targeted original-corpus compile checks, the strict 31-call
canary (23 metallib and eight LLVM-text outputs), and all 15 expected
storage/interface rejections. Those 55 targets are included in the 7,212 original
inputs; authored canary and negative phases are separate. The emitted outputs
remove 417 signed and 469
unsigned i1 conversion calls. All 445 changed libraries passed the separate ABI
review. This establishes bounded compiler/output evidence, not Chrome, Apple/GPU
or device acceptance, numerical behavior, correct runtime memory accesses,
full-game equivalence or complete MSL support.

The earlier sealed `20475dad74fea1d29f066a06ffe13ff204de05e1` result, including
`0109`, already compiled all 7,212 originals while preserving the bitcode of the
7,211 previously accepted shaders. That historical result established the last
kernel's compilation recovery; it did not include `0110`.

The earlier 75e6bd1 rejection identified a GEP input but did not reveal its exact
type, destination, indices or inbounds flag. The new successful compilation does
not turn the authored symbolic fixtures into observed pre-error IR or executed
native regressions. The native matrices have not run here or in current CI, which
does not build `opt`/FileCheck. No raw-IR API mode, extra job or native-tool build
is added. Other pointer graph shapes remain unsupported. The conservative maximum
diagnostic length is 278 characters, including the invalid-opcode fallback;
subreasons cannot reveal source names, values, paths or IR.

The separate `0110` scalar-i1 hardening now has authenticated emitted-output and
unchanged-input corpus validation in 440eb1a, including the call-removal and ABI
results above. That actual artifact evidence is distinct from source-only checks
and does not turn authored symbolic fixtures into executed native regressions.

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

The sealed 440eb1a artifact supplies compiler-only validation for `0110`;
20475da remains its historical pre-correction baseline. Native authored
regressions remain unexecuted. The complete manifest hash
and all patch hashes already participate in runtime source identity, so old
receipts must become stale rather than being relabeled or bypassed. No source
identity, metallib entry/stage, container-integrity or bitcode-hash check is
weakened. No Apple runtime acceptance or rendering equivalence is established.

## Bounded CI object reuse

The existing single CI job retains its exact-source finished-output/receipt
cache. Only a miss enables a separate public AIR object cache using Ubuntu's
ccache, scoped to the AIR build subprocess. Configuration is outside restored
cache data: compiler-content checking, preprocessing mode, no sloppiness or
remote storage, a 2 GiB per-snapshot bound and cleanup before saving. Compatible
object snapshots are keyed by runner/toolchain/upstream archive/build profile and
ccache binary identity, then the exact source fingerprint. Finished outputs
never use the compatibility-prefix restore path.

Fresh source preparation, receipt authentication and the unchanged real-WASM
canary remain mandatory. Saving objects requires successful AIR verification and
either runtime success or successful failure reauthentication; cancellation and
failed compiler/canary steps cannot publish an object snapshot. Inert shell tests
check failure gating and that the wrapper cannot leak into later Rust/.NET work.
No ccache installation, cache round-trip, CI launch or speedup was measured here.
The next already-required cold compiler build must seed this cache; later hit/miss
statistics are needed to establish benefit. The 2 GiB limit is per snapshot, not
an overall repository cache quota.

## Scalar i1 conversion hardening

The additive `0110` delta changes only
`llvm/lib/Transforms/LibFloor/MetalFinal.cpp`'s conversion helper. Scalar `SIToFP`
and `UIToFP` from i1 to half, float or double become respectively
`select(condition, -1.0, +0.0)` and `select(condition, +1.0, +0.0)`. Signed i1 true
is -1, not +1. The helper accepts a folded LLVM `Value`; it copies a debug location
only when the replacement is an instruction, then replaces every use before
erasing the cast. No memory access, branch, freeze, extra flag or assumption is
introduced. All vectors, other integer widths, reverse conversions and unsupported
floating destinations retain the existing conversion/failure path.

This removes a dependency on `air.convert.*.i1` at that helper. The absence of
`air.convert.f.f32.s.i1` from the inspected reference libraries is not proof that
the symbol is invalid or that the existing emitted code is a miscompile. This
hardening does not establish frontend cast correctness, device acceptance or
rendering equivalence. Later compiler passes may simplify or restructure the
result. The authenticated 440eb1a outputs establish the observed call removal and
bounded ABI review, not general numerical or full-game equivalence.

`fixtures/scalar-i1-conversions.ll`, its `.expected.ll` counterpart and
`scalar-i1-conversions.json` contain 25 authored symbolic input/expected-shape
cases. They cover all six signed/unsigned destination combinations, constant,
poison and undef folding, a shared freeze, adjacent casts, debug locations,
repeated uses and excluded controls. Expected text describes immediate helper
shapes modulo SSA naming; it is not captured compiler output. There are no RUN
lines, and no LLVM parser, verifier or pass has executed these cases. Exact
fixture identities, case inventory and runtime-payload exclusion are tested.

This source-only addition does not alter the existing 31-call real-WASM canary,
API, object-cache workflow or acceptance gates, and adds no natural-MSL probe.
The sealed 440eb1a artifact removes all 417 signed and 469 unsigned i1 calls
observed in the historical baseline, passes the complete unchanged-input corpus,
and passes ABI review for all 445 changed libraries. These compiler-only results
do not establish Chrome, Apple/GPU/device behavior, numerical or full-game
equivalence, and do not execute the 25 symbolic cases.
