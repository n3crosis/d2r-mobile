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
digest `be59c864f087b377`, and SPIRV-Cross `1.4.363.0`. The current browser spike
pins `1.4.357.0`; that mismatch is not silently relabeled or accepted. This JSON
is evidence only, **not an enabled trusted release catalog**. A matching source,
compiler, complete shader catalog, generated assets and actual runtime proof are
still needed before production use. The iOS 18 variant has not been inspected.
