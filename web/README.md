# Browser IPA packager: development foundation

Target: desktop Chromium on Windows/macOS. End users should not install Python,
.NET, Xcode, or a compiler. The intended output is an IPA requiring the user's
separate signing/install workflow. Bulk game resources stay separate.

**This directory does not build an IPA yet.** The preview is React + TypeScript,
Bun’s browser bundler, Tailwind CSS 4, and genuine shadcn/ui Button, Card and Alert source components.
See [component provenance and registry hashes](SHADCN_PROVENANCE.md).
Layout is Tailwind utility composition, not bespoke component CSS. No Vue is used.

## Developer commands

Bun 1.4.3 and Node 22.12+ are development tools, not end-user requirements:

```sh
cd web
bun install --frozen-lockfile
bun run dev
bun run test
bun run build
bun run preview
```

## Linting and formatting

Run `bun run lint` for Oxlint (JavaScript, TypeScript, and React Hooks),
`bun run lint:fix` for automatic lint fixes, `bun run format:check` for Oxfmt
verification, and `bun run format` to apply formatting. The production build
runs the lint and formatting gates before typechecking and bundling.

Coverage includes the new browser source, pure JavaScript modules and tests,
configuration, CSS, HTML, JSON, and browser documentation. Oxlint separates browser
code from Node tests/build configuration. Oxfmt skips generated output,
dependencies, lockfiles, and the verbatim shadcn license. These checks do not
blanket-reformat unrelated upstream native C, Python, or historical documentation.
C# shader-spike formatting is a separate .NET SDK check, not an Oxfmt capability.
Tool versions are pinned in package.json and verified against the official npm registry.
Use `bun run format:docs` or `bun run format:docs:check` separately for the sibling
implementation-plan document in a full repository checkout. Hosted builds contain
only this workspace, so that document and the native Python oracle tests are not
required by `bun run build`; run `bun run test` in the full checkout.

The frontend `bun.lock` is committed. Use `bun install --frozen-lockfile` for
reproducible installs; dependency security review remains a separate gate. See
[tooling versions, rule compatibility and exclusions](TOOLING.md).
Workflow YAML is checked with `bun run format:workflows:check`.

`bun run build:bundle` uses Bun’s HTML bundler and the official Tailwind plugin,
not Vite running under Bun. It emits browser-only JavaScript, compiled CSS and HTML
to `dist/`; Bun is never required on the end user’s machine. The build disables
environment-variable inlining and validates the emitted asset/CSP contract.

Open the localhost URL printed by Bun. For deployment, serve the built `dist/`
assets over HTTPS, not the source directory. Production CSP blocks fetch/WebSocket
connections and permits only same-origin assets; no CDN or remote fonts are used.
Development rebuilds on source edits; refresh the page after each rebuild.
It uses the same strict CSP as production, without HMR or injected scripts/styles.
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

The hosted synthetic-export preview subsequently passed ESLint, Prettier,
TypeScript and the Vite production build. Its save-picker interaction still needs
independent desktop Chromium testing. The experimental shader compile job is
separate and has not yet established browser translation parity.

## Current input flow

Put all NSP inputs, `prod.keys`, and `title.keys` in the same folder. The primary
folder picker currently checks layout and file metadata only; it does not read key
contents or decrypt packages. Separate core inspection APIs perform bounded NSP
index and key-syntax checks. The IPA action remains disabled until the complete
conversion pipeline is implemented. Synthetic export and extracted ExeFS checks
remain secondary developer tools, not the promised final workflow.
