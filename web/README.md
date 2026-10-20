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

## Linting and formatting

Run `npm run lint` for ESLint (JavaScript, TypeScript, and React Hooks),
`npm run lint:fix` for automatic lint fixes, `npm run format:check` for Prettier
verification, and `npm run format` to apply formatting. The production build
runs the lint and formatting gates before typechecking and bundling.

Coverage includes the new browser source, pure JavaScript modules and tests,
configuration, CSS, HTML, JSON, and browser documentation. ESLint separates browser
code from Node tests/build configuration. Prettier skips generated output,
dependencies, lockfiles, and the verbatim shadcn license. These checks do not
blanket-reformat unrelated upstream native C, Python, or historical documentation.
C# shader-spike formatting is a separate .NET SDK check, not a Prettier capability.
Tool versions are pinned in package.json and verified against the official npm registry.
Use `npm run format:docs` or `npm run format:docs:check` separately for the sibling
implementation-plan document in a full repository checkout. Hosted builds contain
only this workspace, so that document and the native Python oracle tests are not
required by `npm run build`; run `npm test` in the full checkout.

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
256 bytes of `ExeFS/main` and `ExeFS/sdk` (512 bytes total), matching the native IPA packager.
No game content is bundled/downloaded and no inputs are uploaded. Header checks do not write files.
The separate synthetic export generates a tiny Guest framework and streams a test ZIP
to a user-selected file, with cancellation and 64 KiB output chunks. The ZIP contains
no game data, app shell, or installable IPA; its filename and README say so explicitly.
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
workers, conversion dependencies and browser end-to-end tests
are not implemented yet. Bounded STORE ZIP32 streaming output is implemented for
synthetic fixtures, not real game packaging. Actual browser interaction has not yet been verified.

## Verification at this checkpoint

All 29 dependency-free Node tests pass, including preflight, Guest framework parity,
streaming ZIP writer, and synthetic-export integration tests. Independent Python
parsers/oracles verify generated binary structures and ZIP contents. Prettier 3.6.2
has formatted the web workspace and its check passes. The latest ESLint gate,
React typechecking, production build, and actual browser interaction await remote
verification. The earlier React/shadcn preview did build successfully as noted below.
Local dependency installation remains capacity-limited; no lockfile was generated.

## Hosted preview build

The React/shadcn preview completed a private Sites remote build and deployment
on 2026-10-20. This supersedes the earlier local-build blocker for that preview;
no old project files were deleted. Independent browser interaction testing remains
unverified because the browser runtime was unavailable. No real IPA was produced.
