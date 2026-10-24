# Frontend tooling

Use Bun **1.4.3**, Node **22.12+**, Oxlint **1.89.0** and Oxfmt **0.74.0**. Package versions are pinned in `package.json` and `bun.lock`.

```sh
cd web
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run format:docs:check
bun run format:workflows:check
bun run build
bun run build:bundle # frontend only, without repeating checks
bun audit --audit-level=high
```

`bun run build` checks translations, lint, formatting and TypeScript before bundling. `bun run test` is a separate local suite. See [testing](TESTING.md) for shared verification and targeted checks, and [runtime assembly](runtime-build/README.md) for native runtime prerequisites.

## Dependencies

`bun.lock` is the frontend lockfile. Update it together with `package.json`, then verify a fresh frozen install. `bunfig.toml` disables automatic peer installation and runtime auto-install; required React peers are explicit dependencies. Missing imports must fail rather than download packages at runtime. Separate toolchain packages retain their own npm manifests and locks; they are not a Bun workspace.

## Lint and format scope

`.oxlintrc.json` explicitly configures JavaScript, TypeScript and React rules, with globals scoped to browser, worker and Node files. Warnings fail the check. TypeScript's `tsc --noEmit` is the type gate; JavaScript `checkJs` is not enabled.

`.oxfmtrc.json` defines authored-file formatting and vendor/generated/runtime exclusions. Import and package-key sorting are disabled. Docs and workflow commands explicitly use this configuration outside `web/`; the web formatter must not be run across native or vendor trees.

Python uses Ruff, authored C uses clang-format, Bash uses syntax checks, and authored C# uses dotnet format/analyzers. Keep those language-specific checks and third-party license text intact.
