# Pinned shell inspection, not a compatibility recipe

`v1.0.18.json` records a read-only inspection of the publisher's public shell
archive. The downloaded bytes matched the SHA-256 digest returned by GitHub's
release API. No shell executable was run or installed, no game content or keys
were used, and the ZIP is not copied into this repository.

Source: <https://github.com/jhaizhou-ops/d2r-mobile/releases/tag/v1.0.18>

The current ZIP reader accepted its 16 entries and verified each decoded member's
length and CRC. Per-entry SHA-256 hashes are recorded for later release-registry
work. Publisher digest agreement is provenance, not an independently verified
publisher signature or proof of runtime compatibility.

Independent inspection of the binary Info.plist and main Mach-O LC_BUILD_VERSION
agreed on iOS 26.0. The thin arm64 Mach-O has 35 load commands and 5,272 command
bytes. `shell-target.mjs` supplies a bounded, fail-closed inspector for this class
of executable through the shell loader's verified reader. It does not execute
code, read a target version from a recipe, or support fat binaries/legacy version
commands. Executable identity must come from an authenticated release registry.

This release requires product `3.3.94012-r44`, chain `f2bc055e8f1e`, shader-source
digest `be59c864f087b377`, and SPIRV-Cross `1.4.363.0`. The initial browser
inspection used `1.4.357.0` and correctly rejected that version mismatch. The
browser/native candidate has now been aligned to official `1.4.363.0`, commit
`f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`; full CI evidence is pending. This
compiler alignment does not establish shell equivalence or authorize chain
relabeling. The complete shader-source digest and trusted-recipe gates remain
required. This JSON is evidence only, **not an enabled trusted release catalog**.
A matching source,
compiler, complete shader catalog, generated assets and actual runtime proof are
still needed before production use. The iOS 18 variant has not been inspected.

## Source/toolchain comparison

See [COMPATIBILITY_PLAN.md](COMPATIBILITY_PLAN.md) for the exact release-source,
compiler and private-input promotion boundary. The read-only
`compare-source.py` produces `v1.0.18-source-comparison.json`; its checks are
covered by `test-source-comparison.py`. Neither a successful diagnostic run nor
a matching compiler version enables a production recipe. In particular, the
release's committed source chain and header do not match its published shell,
and the release tag's deployment setting differs from the inspected binary.
