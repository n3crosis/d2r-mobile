# Corpus-driven compiler source corrections

`patches/0106-a2flo-corpus-compiler-fixes.patch` follows the five unchanged
`0101` through `0105` migration patches. The a2flo repository, commit and
archive SHA256 are unchanged, as is the complete historical
`manifest.json` `rebaseProvenance` record. This is an incremental source patch,
not a new upstream rebase, ABI version or receipt format.

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
- `llvm/lib/Transforms/LibFloor/PointerBCFixup.cpp`: handle a narrow read-only
  constant-address-space struct-to-vector pointer cast with scalar/vector GEPs
  and ordinary loads. Validate the whole use tree first, address original
  storage with typed GEPs, and bitcast loaded values rather than pointers.
  Equal lane counts, scalar/vector store sizes and allocation strides are
  required. Indices, address space, alignment and bit patterns are retained.
  Pointer escapes, stores, volatile/atomic loads, vector regrouping and
  unsupported layouts are excluded from the new lowering; legacy validation
  and acceptance are unchanged. Unsupported-user diagnostics add only a bounded
  list of built-in LLVM opcode names, not source text or IR excerpts; the
  diagnostic does not expand the accepted instruction set.

The first two files already appear in `patchedFiles`; their final SHA256s
change. The pointer pass is the only new source path in that set. Every source
file changed by any active patch remains covered, and the incremental patch
has its own SHA256 in the ordered `patches` list.

## Authored LLVM regressions

Four public pass-level fixtures are retained under `fixtures/`, separately
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
- `pointer-unsupported-user-diagnostics.ll`: preserve select/PHI rejection and
  verify the four-opcode diagnostic cap, overflow marker and absence of an
  appended instruction dump.

Their `RUN` lines require `opt`, `FileCheck` and, for split fixtures,
`split-file` from the matching patched toolchain. They have not been executed
by this source-only integration. The JavaScript provenance tests and WASM
canary do not execute these LLVM pass-level fixtures.

## Real-WASM CI canaries

The fixed production CI canary now contains ten authored MSL fixtures across
three stages. Five additions cover these source corrections:

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

The first four independently authored inputs reproduce the corresponding
failure against the prior verified CI artifact. The last already passes that
artifact and is not claimed as a demonstrated regression trigger. All copies
preserve their original comments and any license notices; none contains private
shader source or reference-library bytes.

The rebuilt compiler must compile every case and pass strict expected-name,
stage, platform/version and container/bitcode-integrity inspection. A fixture's
explicit entry overrides only the default `main0`; rejected entry names are not
renamed or accepted under aliases. The compilation budget follows the fixed
case count. Each added shader is source-only, excluded from the public runtime
payload, and included by the existing tracked compiler-directory source copy.
Source-only tests check fixture wiring and copy closure but do not execute the
compiler. These new success expectations remain pending a rebuilt CI artifact.

## Evidence and verification boundary

These corrections respond to diagnostics from an existing verified CI artifact.
The pointer-use shape is a source-based inference: the failing artifact did not
emit a pre-failure IR body for the specific input. Source review and address
models do not establish that the private corpus now compiles.

The source-only verification procedure is:

```sh
node toolchain.mjs check
node toolchain.mjs prepare --archive /path/to/pinned-archive.tar.gz --work /path/to/new-empty-work
node --test ../../tests/air-compiler-source-provenance.test.mjs
```

`prepare` verifies the archive hash, checks and applies every patch in order,
then checks every final modified-source SHA256. The provenance regression
checks exact patch inventory, patch digests, modified-source path coverage and
runtime source identity. None of these steps builds or invokes LLVM, Clang or
WASM, and no private corpus source is included in this package.

A new CI-built artifact and execution of authored regressions plus the
unchanged corpus are still required to validate the compiler corrections.
Existing artifacts cannot contain these changes. The complete manifest hash
and all patch hashes already participate in runtime source identity, so old
receipts must become stale rather than being relabeled or bypassed. No source
identity, metallib entry/stage, container-integrity or bitcode-hash check is
weakened. No Apple runtime acceptance or rendering equivalence is established.
