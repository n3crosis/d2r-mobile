# Windows/macOS Chromium proof matrix

The `desktop-browser-checks.yml` workflow runs the existing synthetic OPFS and
sealed Emscripten Worker browser harnesses on standard GitHub-hosted
`windows-2022` and `macos-14` runners. It builds the public texture runtime once on
Linux, then checks the exact downloaded file tree against a SHA-256 manifest
whose digest is passed directly from the producing job. Negative transfer tests
reject changed, missing, additional files and a changed manifest or digest.

The existing browser harnesses retain their assertions. The matrix uses pinned
Playwright Chromium, not installed branded Chrome or Edge. It does not request a
save picker, read real game files or keys, or upload user content. Browser version
and scenarios are in each proof's log; host OS/architecture are in the job summary.
A summary existing does not imply the earlier proof steps passed.

## Cost and provenance boundaries

Repository visibility was checked through GitHub on 2026-10-20: public. A
public-only job condition prevents this workflow running after a transition to
private visibility. All runner labels are standard hosted labels, never larger,
custom or self-hosted runners. GitHub documents free runner minutes for public
repositories using standard runners, but artifact storage still has an allowance:
https://docs.github.com/en/billing/concepts/product-billing/github-actions

The sole transferred artifact contains generated public runtime and required
license files, is capped at 32 MiB, and expires after one day. There are no caches,
secrets or deployment steps. Action SHAs were checked against official tags and
all four action definitions use Node 24 internally. The download action is
`actions/download-artifact` v7.0.0, commit
`37930b1c2abaa49bbe596cd826c3c89aef350131`.

## Evidence limits

The workflow definition alone is not Windows/macOS execution evidence. A passing
run establishes only the specific runner/browser combinations in its logs,
small OPFS commit/reread and cancellation behavior, estimated quota rejection,
sealed texture conversion, and negative preload cases. It does not establish
real OS save-picker behavior, large-file disk endurance, every consumer desktop
configuration, full application integration, game compatibility, IPA installation
or device behavior. Pyodide has its separate proof and is not included here.
