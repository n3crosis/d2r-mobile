# v1.0.18 source/toolchain compatibility decision

This is a diagnostic plan, not an enabled release registry or permission to
relabel chain IDs. This diagnostic work does not change runtime pins, native
headers, locks, or acceptance gates. A separate candidate migration now aligns
the browser/native Cross build to official 1.4.363.0; full CI evidence is pending.
No game inputs are required for the comparisons below, and none were used.
Production equivalence cannot be established from these comparisons.

## Verified observations

- Publisher release tag `v1.0.18` resolves to
  `120fe55c02a5633476998a44f8c3c3c809fa48b0` through the official connected GitHub
  endpoint: <https://api.github.com/repos/jhaizhou-ops/d2r-mobile/git/ref/tags/v1.0.18>.
- The inspected ZIP's publisher-pinned SHA-256 is
  `a383552871851ddb5923033639358e2a3c205ae411676e6538cd098743bbe37b`.
  It advertises PRODUCT `3.3.94012-r44`, CHAIN `f2bc055e8f1e`,
  SHADER_SRC `be59c864f087b377`, and SPIRV_CROSS `1.4.363.0`.
- All 11 committed chain inputs are byte-identical between that release target
  and synced main `53e7c5bb9ca3ea53e2160005be8fbe920cd9cb53`. Both compute
  `c675d3fa7c90` under default `debug=True reduced=True`; both carry header
  `15cf7ca29eaf`. Neither matches the shell. The header does not even match the
  committed chain inputs. This is a provenance gap, not proof of bad output.
- The native chain includes byte fingerprints of native translator DLLs,
  native SPIRV-Cross, and Apple Metal version strings. A browser/WASM compiler
  cannot honestly claim those native executable fingerprints. Merely changing
  a version string or regenerating a native lock does not solve this.
- Khronos's official `vulkan-sdk-1.4.363.0` tag resolves to
  `f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`:
  <https://api.github.com/repos/KhronosGroup/SPIRV-Cross/git/ref/tags/vulkan-sdk-1.4.363.0>.
  This is an exact candidate build pin. The shell's version string alone does
  not establish the source commit/build options of its publisher's Homebrew
  executable. The initial browser `1.4.357.0` build was incompatible with the
  advertised version and remains historical evidence, not a usable build for
  this shell. The browser/native candidate now pins the verified `1.4.363.0`
  commit above; full CI validation is pending. Matching the advertised compiler
  version does not satisfy the full catalog digest or trusted-recipe gates.
- `dm/gfx/`, `dm/tools/d2rm_pack.py`, `dm/ios/tools/shell_build.sh`,
  `dm/ios/tools/shell_stubs.py`, and vendored Ryujinx have no release-to-main
  differences. There are 71 changed paths under `dm/`, enumerated in the JSON.
  Notably HUD/map generators, localization/touch tooling, and native UI/runtime
  changed. Pin the entire release generator dependency closure for a release
  recipe, not just shader scripts or current PRODUCT text.
- `dm/ios/project.yml` at the release target specifies minimum iOS 26.4;
  synced main specifies 26.0. The actual release archive's plist and Mach-O
  report 26.0. Thus the tag is demonstrably not sufficient evidence for exact
  final build settings. The archive's inspected deployment requirement wins.

## Exact relevant compiler contracts

Native SPIRV-Cross flags are unchanged:

```
--msl --msl-version 20300 --msl-argument-buffers
--msl-texture-buffer-native --msl-pad-fragment-output
```

The translation defaults are debug=true, reduced=true. The native translator
project targets net10.0 and references vendored Ryujinx shader/common projects.
Its source SHA is SHA-256 of Program.cs followed by csproj, truncated to 16 hex.
The committed lock values and full input hashes are in the comparison JSON.

The existing browser compiler uses official Emscripten 4.0.20, CMake Release,
SPIRV_CROSS_CLI=ON, ENABLE_TESTS=OFF, ENABLE_C_API=OFF, C++ exceptions and
exception-enabled modular ES6 WASM. The candidate migration retains those
settings while aligning the browser build and native oracle to the identical
1.4.363.0 source commit. This pin alignment is not production promotion: review
the pending CI evidence and satisfy the private-input boundary before accepting
a shell recipe. Historical 1.4.357.0 artifacts are not 1.4.363.0 evidence.

Native offline iOS compilation uses `xcrun -sdk iphoneos metal -c
-mios-version-min=18.0`, then `xcrun -sdk iphoneos metallib`. No-Metal mode
instead normalizes CRLF to LF and copies MSL into the `.metallib` payload.
The shell's DM_SHELL source path compiles on-device using
`newLibraryWithSource:options:nil:error:`. Browser users therefore need not
build Apple tools, but native acceptance still requires successful device-side
compilation. Synthetic MSL generation cannot prove that.

## What can be completed without game inputs

1. Record official refs, public source closure, compiler settings and exact
   artifact hashes. This report and `compare-source.py` do the source/archive
   diagnostic part, never production acceptance.
2. Validate the aligned Cross 1.4.363.0 WASM/native candidate in CI (pending),
   with verified commit,
   pinned Emsdk, license notices and immutable artifact checksums. Run all
   synthetic native/browser differential tests, including linked vertex,
   fragment, compute, readable-tile and reflection cases. Matching the compiler
   version removes only that specific mismatch; retain full SHADER_SRC, catalog,
   trusted-recipe and native compatibility gates until promotion is explicitly
   evidence-based. Never relabel the chain or header to make a candidate pass.
3. Package the exact release generator dependency closure in a separate
   candidate build; test its outputs against original release functions using
   authored fixtures. Record original and browser-stage hashes separately.
4. Obtain publisher build provenance if available: actual source revision and
   local source/lock/header diffs, Cross source/build recipe, tool fingerprints,
   build settings, derived-table sizes, shell executable hash, full shader count
   and non-content output digest manifest. Do not assume these from a tag.

These steps can prove reproducibility of our public compiler candidate, not
that it produces the publisher's full game shader catalog.

## Required private-input promotion boundary

The existing upstream packer permits different local tool chains but requires
full source equivalence. Its source digest is precisely:

- sort every filename ending `_b.metal` in the base cache directory;
- append each UTF-8 filename and SHA-256(raw bytes with CRLF replaced by LF);
- SHA-256 of that stream, first 16 hex characters.

The complete locally generated catalog must equal `be59c864f087b377`. A full
catalog/completion check is separately necessary: an aggregate digest is not a
substitute for proving all expected jobs were scheduled and succeeded. Tile
variants (`_bf`) are not covered by that base-source digest, so verify their
original-native derivation, reflection and index contracts separately. Also
validate PRODUCT, exact shell archive/executable identity, generated assets,
Guest/fixups/cuts/gates, derived-table shape and required manifest paths.

Only after these checks may a separately reviewed recipe consider the same
chain-label accommodation as upstream, with explicit provenance binding from
original browser output to the publisher shell's chain. Do not alter labels
while evaluating or let a generic option authorize this. The current runtime
must remain fail-closed. Exact source digest equality establishes the upstream
source-equivalence condition, not a native binary-tool identity or full runtime
compatibility claim; on-device Metal compilation and launch/game checks remain.

The user can supply their legally obtained inputs locally in-browser for this
validation; nothing here requires uploading or downloading game content. A
verified packaged browser toolchain can still meet their no-local-tool-build
requirement once those boundaries are implemented.

## Decision and fallback

**A release source pin plus a 1.4.363.0 port is a plausible candidate, not enough
to declare compatibility without game inputs.** It does not presently force an
own-shell build: the publisher shell may accept fully equivalent local output.
First pursue the candidate and exact local digest validation, without weakening
gates. If it cannot reproduce that digest, obtain the publisher's actual source
and tool recipe before deciding whether the mismatch is recoverable.

An own matched shell is the alternative only when provenance/output cannot be
reconciled or a deliberate native change is needed. It is not a game-input-free
escape: upstream `shell_build.sh` explicitly requires a Mac/full native build
environment and real generated game data to determine table sizes, manifest and
reference shader digest, then strips that data from the public shell. A clean
publisher-side build with authorized private inputs and independently recorded
provenance could produce a redistributable matched shell; this user would still
consume prebuilt browser tools rather than build them. No such build is
currently available or proven, and no deployment requirement should be lowered
by editing metadata.

## Reproduce diagnostics

```
python3 web/toolchain/shell-release-evidence/compare-source.py
python3 web/toolchain/shell-release-evidence/compare-source.py --archive /path/to/D2RMobile-shell-build-input.zip
python3 web/toolchain/shell-release-evidence/test-source-comparison.py
```

The script reads committed Git blobs with AST literal extraction, never imports
or executes native chain scripts, never changes the working tree, and always
reports `productionCompatibilityEstablished: false`. A successful exit means
only that diagnostic inspection completed. Optional archive verification fails
on a different hash or shell info. The stored comparison JSON includes archive
verification from the already downloaded public ZIP.
