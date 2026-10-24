# Desktop browser verification

This directory supplies manifest and transfer checks used by the optional local desktop recipes. See the `desktop-build` and `desktop` profiles in [TESTING.md](../../TESTING.md). The default Verify workflow does not run a platform matrix.

Build public texture assets on the compiler host, then verify the transferred file tree against the producer's SHA-256 manifest before running the browser harness on Windows or macOS. Transfer checks reject changed, missing or additional files and mismatched manifest digests.

The harnesses use pinned Playwright Chromium and synthetic OPFS/worker inputs, not real game files, keys or a save picker. Record the actual browser and platform with each result. Preserve licenses with transferred public runtime artifacts; do not include private inputs or browser profiles.
