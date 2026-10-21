# Browser IPA packager

A local-input packager for desktop Chromium on Windows/macOS. Select one folder
containing the base NSP, compatible update NSP(s), `prod.keys`, and optional `title.keys`.
Compatible known DLC is optional and accepted when present. Grant read/write
access to this one folder, then generate a downloadable unsigned IPA and a fresh
game-resource subfolder inside the selected folder. End users do not install a
compiler, Python, .NET, Xcode or Bun.

The production conversion flow is implemented and the complete public runtime
build passed [Verify at 158d6cf](https://github.com/n3crosis/d2r-mobile/actions/runs/39415236827).
**A real game-input-to-IPA run and device execution have not been demonstrated.**
A successful build is not proof that a particular game input completes or plays.

## Implemented flow

- Check secure-context/browser APIs, validate the complete public runtime manifest,
  and preload the selected shell profile and required same-origin runtime assets
  with exact hashes before accepting private inputs. Experimental older-GPU ASTC
  support is selected during this public bootstrap and loads its optional assets
  only when enabled.
- Initialize isolated workers, discover the single input folder, and
  authenticate/select compatible base, update and optional DLC content.
- Keep game files and keys local. The prototype does not impose a CSP network
  lockdown; public assets are loaded before private processing.
- Decrypt/extract bounded ranges, merge RomFS, rewrite the program and generate
  Guest.framework, native art/HUD, tables, overlays and the full shader catalog.
- Validate the pinned prebuilt iOS app template, output inventory and complete
  normalized shader-source digest. The template is not a command-line shell.
- Stream bulk game resources to a fresh `D2R-resources-<UUID>` child of the input
  folder, then offer the validated unsigned IPA as a normal browser download.
  A visible Download IPA link supports retry if automatic download is blocked.
  Progress, cancellation and incomplete-resource markers are included.

No game content or keys are bundled or uploaded. Public dependencies load before
private data is read; there is no remote conversion service or runtime CDN fallback.
Generation is single-use: cancellation closes the session and requires a reload.
Signing and installation are separate user steps. The IPA alone does not contain
all game resources; copy the completed resource folder into the installed app's
Files folder as described in the native instructions.

See [production flow](PRODUCTION_FLOW.md), [resource export](RESOURCE_EXPORT_SCOPE.md)
and [optional DLC behavior](D2R_RUNTIME_CONTENT_MODE.md) for the detailed contracts.

## Developer commands

Bun 1.4.3 and Node 22.12+ are development tools, not end-user requirements:

```sh
cd web
bun install --frozen-lockfile
bun run dev
bun run build
bun run preview
```

The Bun end-to-end command runs the same packager against a complete local
`web-preview` build and a local NSP folder. It verifies the public runtime,
generates an unsigned IPA, and checks the ZIP payload. Pass the selected package
filenames explicitly; private inputs stay on the machine. Add
`--export-resources` to write a new resource folder beside the inputs.

```sh
bun run test:e2e:bun -- \
  --preview-dir /path/to/web-preview \
  --input-dir /path/to/nsp-folder \
  --nsp base.nsp --nsp update.nsp \
  --output /path/to/unsigned.ipa
```

For a local run with the pinned native SPIRV-Cross CLI, set
`D2R_E2E_SPIRV_CROSS_MODE=native`, `D2R_E2E_SPIRV_CROSS_CLI` to the built
executable, and `D2R_E2E_SPIRV_CROSS_SOURCE` to its source checkout. The runner
checks the source commit before converting shaders. This mode tests IPA assembly
under Bun; the browser build still uses its verified WASM converter.

The frontend uses React, TypeScript, Tailwind and shadcn/ui source components;
[component provenance and licenses](SHADCN_PROVENANCE.md) are retained.
Bun's HTML bundler emits static HTML, JavaScript and CSS to `dist/`. Frontend
compilation alone does not assemble the native browser runtimes. Follow
[runtime assembly](runtime-build/README.md) for the complete deployment inventory.
Serve the complete build over HTTPS, not `file://` or the source directory.
Development rebuilds require a page refresh; never deploy the development server.

## Quality tooling and CI

`bun run build` runs Oxlint, Oxfmt, TypeScript and frontend compilation.
Use `bun run lint:fix` and `bun run format` for authored frontend cleanup.
The authoritative dependency lock is `bun.lock`; there is no parallel frontend
npm lock, Vite, ESLint or direct Prettier gate. Native/toolchain style checks retain
their language-specific tools. See [tooling](TOOLING.md) for versions and exclusions.

The repository has one Linux Verify job. It builds the frontend and pinned public
runtimes, validates the deployment inventory and uploads `web-preview`. It does
not publish the hosted Site. Default builds do not run synthetic unit/regression
suites or desktop matrices. Existing tests are manual/local tools:

```sh
bun run test
```

See [local verification commands and artifact contents](TESTING.md). Do not
interpret old component test counts or the [historical acceptance ledger](../docs/WEB_DELIVERY_PROGRESS.md)
as a current implementation percentage.

## Current limits

- Real private game processing, resulting IPA installation and gameplay remain
  unproven. No real game files or keys were used for development.
- Required browser APIs are checked, not assumed from the Windows/macOS label.
- Staged IPA output uses ZIP32 and explicit memory/size limits, including a
  512 MiB archive cap. The completed IPA Blob may occupy memory up to that cap;
  its download destination is controlled by browser settings. Bulk resource
  export is separate and streamed; it is not
  subject to that IPA cap. Storage quota and other adapter limits can still reject
  a genuine build rather than truncate it.
- A completed resource folder may remain if the later IPA stage fails. An
  incomplete marker is not a successful export.
- Experimental older-GPU mode generates a separate Legacy Device Pack alongside
  the original resources and matching ASTC overlays in the IPA. It is optional,
  selected before private inputs, and remains unverified with real game inputs
  or devices.

The [original implementation plan](../docs/WEB_IPA_PACKAGER.md) retains architecture
and historical milestones; this overview and the production flow describe the
current source behavior.
