# Frontend tooling

The frontend uses Bun **1.4.3**, Oxlint **1.89.0**, and Oxfmt **0.74.0**.
These exact non-prerelease versions were checked against the official npm registry
on 2026-10-20. Oxfmt remains a pre-1.0 package; its pin is intentional. Node
**22.12+** remains required for the Node compatibility tests and JavaScript tool
launchers. The unified Verify workflow uses one Node 24 Linux job; additional Node
versions and platform proofs are local developer checks, not CI jobs. The existing synthetic tests keep Node's test runner. See
[local-first testing](TESTING.md) for the everyday check command and targeted
local browser/native proofs.

```sh
cd web
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run format:docs:check
bun run format:workflows:check
bun run build
bun run build:bundle # rebuild static assets without repeating quality gates
bun run test
bun audit --audit-level=high
```

`bun.lock` is the authoritative frontend dependency lock. Commit it together with
`package.json`; do not restore a parallel frontend npm lock. Deliberate dependency
updates use `bun install` followed by a fresh frozen installation and CI checks.
`bunfig.toml` disables automatic peer installation: Bun itself is the pinned
external executable, not the `bun` npm peer requested by the Tailwind plugin.
Required React peers are explicit dependencies. Bun may retain peer metadata in
its lockfile, but a clean install does not install the npm Bun wrapper. Runtime
auto-install is also disabled so missing imports fail instead of fetching packages.
If migrating an existing installation, remove the old `node_modules` directory
before the first frozen install to avoid a stale `.bin/bun` wrapper. No additional
package lifecycle scripts need to be trusted.

The separate experimental toolchain packages retain their own npm manifests,
locks, and installation commands; they are not a Bun workspace.

## Lint migration and compatibility

`.oxlintrc.json` explicitly maps the previously enabled ESLint 9.36 recommended
rules and typescript-eslint 8.48 recommended rules, rather than relying on a
changing default category. The `correctness: off` category disables implicit
rules only; every supported legacy correctness rule is explicitly enabled below
it. Browser, worker, and Node globals remain scoped to the corresponding files.
The React source override enables native `react/rules-of-hooks` and
`react/exhaustive-deps`, with zero warnings allowed by the scripts.

The TypeScript extensions of `no-array-constructor`, `no-unused-expressions`, and
`no-unused-vars` map to Oxlint's TypeScript-aware core implementations. Two legacy
rule names, `no-dupe-args` and `no-octal`, are not exposed as Oxlint rules. Duplicate
parameters and legacy octal literals in this project's ES modules are rejected by
the parser instead; both cases were verified with negative fixtures. Rule engines
are not promised to produce identical diagnostics or fixes in every edge case.
There are no retained ESLint plugins or a second lint pass.

Type-aware lint was not enabled in the previous configuration and is not newly
claimed here. TypeScript's `tsc --noEmit` remains the type-checking gate; JavaScript
files still do not have TypeScript `checkJs` enabled. Oxlint is not a replacement
for runtime, browser, native parity, security, or game compatibility tests.

## Formatting boundary

Oxfmt handles authored JavaScript, TypeScript, JSX/TSX, JSON, YAML, TOML, CSS, HTML,
Markdown, and the other formats documented upstream. Its packaged implementation
can use upstream formatting components for non-JavaScript languages; there is no
separate direct Prettier dependency, configuration, or CLI gate in this project.
The prior semicolon, quote, trailing-comma, and 100-column preferences are retained.
Import and package-key sorting are explicitly disabled to keep this migration
format-only, not a source-order change.

`.oxfmtrc.json` preserves the precise vendor/generated/runtime exclusions. It also
excludes generated dependency locks and the verbatim upstream license/provenance
file. The web formatter is never run over `dm/` or other native/vendor trees.
Documentation and workflow scripts explicitly pass the web configuration when
checking files outside `web/`.

Python still uses Ruff; authored C bindings still use clang-format; Bash retains
its syntax checks; authored C# retains dotnet format/analyzers. Oxfmt does not
replace those language-specific checks. No broad native or generated directory
is added to the formatter's scope.

## Primary references

- [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html)
- [ESLint migration](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint.html)
- [Oxfmt language support](https://oxc.rs/docs/guide/usage/formatter/language-support.html)
- [Oxfmt configuration](https://oxc.rs/docs/guide/usage/formatter/config-file-reference.html)
- [Bun configuration](https://bun.sh/docs/runtime/bunfig)
- [Bun installation](https://bun.sh/docs/installation)
- [Bun lockfile and migration](https://bun.sh/docs/pm/lockfile)
