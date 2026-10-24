# Browser IPA packager

Package your local game files into an iOS IPA using desktop Chromium on Windows or macOS. Game files, keys and signing credentials stay on your computer. End users do not need Xcode, Python, .NET, Bun or a compiler.

The maintainer has confirmed that the generated IPA runs on a real iOS device.

## Use the packager

See the [packaging and installation guide](../docs/WEB_IPA_PACKAGER.md) ([中文](../docs/WEB_IPA_PACKAGER.zh-CN.md)) for inputs, signing, resource transfer and limits.

## Develop

Requires Bun 1.4.3 and Node 22.12 or later:

```sh
cd web
bun install --frozen-lockfile
bun run dev
bun run build
bun run preview
bun run test
```

The React/TypeScript frontend uses Tailwind and shadcn/ui [source components](SHADCN_PROVENANCE.md). Bun emits static files to `dist/`. Frontend compilation alone does not build the native browser runtimes; follow [runtime assembly](runtime-build/README.md) for a complete deployment. Serve that output over HTTPS. The development server requires page refreshes after rebuilding and must not be deployed.

[Tooling](TOOLING.md) describes linting, formatting and dependency updates. [Testing](TESTING.md) covers the shared Verify command and optional local checks. GitHub Verify builds and validates `web-preview`; eligible trusted-branch pushes deploy the same output to Pages. Pull requests do not deploy.

## Local end-to-end run

Run against a complete local `web-preview` build and your own input folder. Inputs stay local; `--export-resources` additionally writes the resource folder beside them.

```sh
bun run test:e2e:bun -- \
  --preview-dir /path/to/web-preview \
  --input-dir /path/to/nsp-folder \
  --nsp base.nsp --nsp update.nsp \
  --output /path/to/unsigned.ipa
```

To use a pinned native SPIRV-Cross CLI, set `D2R_E2E_SPIRV_CROSS_MODE=native`, `D2R_E2E_SPIRV_CROSS_CLI` to the executable, and `D2R_E2E_SPIRV_CROSS_SOURCE` to its source checkout. The runner verifies the source commit. This tests IPA assembly under Bun; browser builds use the WASM converter.

## Architecture

[Production flow](PRODUCTION_FLOW.md) describes runtime authentication, conversion, output ownership and cancellation. Component documents cover their APIs and format limits. [Runtime assembly](runtime-build/README.md) covers pinned sources, build tools, licenses and deployment inventory.
