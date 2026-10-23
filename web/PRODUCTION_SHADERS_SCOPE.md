# Production compiled shader adapter

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

## Implemented source and compilation chain

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
- Assemble the original `dmsh_build.finish/write_refl` replay fields. Compile each
  base and readable-tile source through the authenticated AIR WASM Worker, with
  a fixed iOS 18 target and explicit fast-f32 profile. Emit genuine MTLB libraries,
  not source text under a binary extension. Missing or unsupported compiler
  paths fail explicitly; there is no source-only fallback.
- Validate each library's entry, stage, container bounds and embedded bitcode
  hashes. Bind its output digest to the original normalized source digest,
  compiler asset identity, target/profile and expected full source-set digest.
  Replay metadata records the actual WASM compiler and receipts, not an Xcode
  command that was never executed. Generate `_bf.metallib` and `fetch` metadata
  exactly when the original native variant rules produce a source.
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
one main image and a 512 MiB combined compiled-library/replay cap.
Jobs yield between records and accept cancellation. Failure returns no partial
entry set. `dispose()` cancels work and erases retained mutable output buffers;
call it only after output consumption. Entry readers return copies, not retained
internal buffers. No outputs are retained persistently by this adapter.

Compilation occurs while walking the source catalog, so the adapter retains
compiled libraries rather than the whole catalog's source text. It still returns
no entries until the complete original source-set proof passes. Compiler leases
are released after generation and aborts terminate in-flight worker work.

The authenticated 440eb1a compiler artifact compiled all 7,212 supplied original
shaders under Node WASM. Separately, on 2026-10-23 the maintainer reported that
the generated IPA works on a real iOS device. The exact tested build, device/iOS
version and gameplay coverage were not specified. These results do not establish
Xcode-equivalent numerical behavior or complete game/device coverage. The browser
compiler does not invoke a simulator, device or remote compiler, rewrite shader
sources, or weaken source-digest checks. Neither the historical corpus result nor
the unspecified IPA device report validates a fresh fork compiler release.

## 中文说明

生产路径现已接入真实 WASM 编译服务，基础与可读瓦片变体均输出 MTLB 库；没有编译器或遇到未支持源码时必须报错，不能把源代码当成编译结果。原有完整目录与源码摘要校验保持不变，全部证明通过前不发布输出。回放记录使用实际编译器和源码/输出收据，不伪装执行过 Xcode。440eb1a 的已认证编译器已在 Node WASM 下编译全部 7,212 个原始着色器。另于 2026-10-23，维护者确认生成的 IPA 已在真实 iOS 设备上运行成功；报告未注明具体构建、设备/iOS 版本或游戏覆盖范围。这不代表完整游戏/全设备验证或与 Xcode 的数值行为等效。历史目录编译结果和未指定构建的真机报告均不能验证新的 fork 编译器发布版本。
