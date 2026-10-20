# Browser IPA packager: development foundation

Target: desktop Chromium on Windows/macOS. End users should not install Python,
.NET, Xcode, or a compiler. The intended output is an IPA requiring the user's
separate signing/install workflow. Bulk game resources stay separate.

**This directory does not build an IPA yet.** The preview is React + TypeScript,
Vite, Tailwind CSS 4, and genuine shadcn/ui Button, Card and Alert source components.
See [component provenance and registry hashes](SHADCN_PROVENANCE.md).
Layout is Tailwind utility composition, not bespoke component CSS. No Vue is used.

## Developer commands

Node 22.12+ is for development only, not an end-user requirement:

```sh
cd web
npm install
npm run dev
npm test
npm run build
npm run preview
```

Commit the generated lockfile after successful dependency resolution, then use
`npm ci` for reproducible installs. No lockfile is included at this checkpoint.

Open the localhost URL printed by Vite. For deployment, serve the built `dist/`
assets over HTTPS, not the source directory. Production CSP blocks fetch/WebSocket
connections and permits only same-origin assets; no CDN or remote fonts are used.
The development-only CSP permits local Vite HMR and injected styles/React Refresh.
Never deploy the development server. Folder selection needs a secure context and
File System Access support; unsupported browsers can still run the synthetic demo.

## Current behavior and limits

The synthetic demo generates a 256-byte header and describes a virtual 6 GiB input
without allocating that input. The optional local folder check reads only the first
256 bytes of `ExeFS/main`, `ExeFS/sdk`, and `ExeFS/subsdk0` (768 bytes total).
No game content is bundled/downloaded, no inputs are uploaded and no files are written.
Close the browser's native folder picker to cancel selection; the Cancel button
aborts subsequent work. Errors remain visible in the local results panel.

`preflight.mjs` and its Node tests remain dependency-free and independent of React:

```sh
node --test web/tests/*.test.mjs
```

NSO inspection is not game-version verification: module-ID allowlists,
decompression, segment hash checks and patch preimage verification remain future
gates. Inputs are never executed or decoded by this preview. The provisional
4 MiB per-read cap is not a claim about total future pipeline memory.

See [the implementation plan](../docs/WEB_IPA_PACKAGER.md). Production ZIP parsing,
workers, conversion dependencies, streaming output and browser end-to-end tests
are not implemented yet. Actual browser interaction has not yet been verified.

## Verification at this checkpoint

All 11 dependency-free Node tests pass (six preflight and five guest-framework
writer tests). React typechecking, production build, and browser interaction have
**not** been verified. Dependency resolution could not complete in the available
scratch space, and no lockfile was generated. A `vite@undefined` / `ERESOLVE`
result during that attempt does not establish a real peer-version incompatibility.
Re-run dependency resolution, typecheck/build and browser QA in an environment
with adequate capacity before deployment.
