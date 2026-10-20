# Browser IPA packager: development foundation

Target: desktop Chromium on Windows/macOS. End users should not install Python,
.NET, Xcode, or a compiler. The intended output is an IPA requiring the user's
separate signing/install workflow. Bulk game resources stay separate.

**This directory does not build an IPA yet.** It contains dependency-free,
read-only preflight primitives and synthetic tests, not a playable demo.
No game files, credentials, downloads, uploads, or network requests are used.

Run development tests (Node 22+):

```sh
node --test web/tests/*.test.mjs
```

`preflight.mjs` provides safe relative-path indexing, bounded random-access reads,
a File/Blob adapter, and NSO header inspection. NSO inspection is not game-version
verification: module-ID allowlists, decompression, segment hash checks and exact
patch preimage verification are separate mandatory future gates. It never executes
input code or allocates decoded segments. Its read cap is a provisional 4 MiB
per request, not a claim about total pipeline memory.

See [the implementation plan](../docs/WEB_IPA_PACKAGER.md) for stages and acceptance
criteria. A static UI is provided in index.html with a synthetic demo and an optional
read-only executable-header check. Developer preview: serve web/ using an HTTP
server on localhost; end users will use a hosted HTTPS page. No browser interaction
has been verified yet. Production ZIP parsing, workers, conversion dependencies,
streaming output and browser end-to-end tests are not implemented yet.
