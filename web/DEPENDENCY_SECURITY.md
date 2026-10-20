# Dependency security scope

Reviewed 2026-10-20 against the committed dependency lockfile and upstream
advisories. The pre-remediation lock-only npm audit reported 10 high-severity
package entries, all marked development-only, with no production dependency
entries reported. This is not a claim that the application is vulnerability-free.

## Targeted remediation

- **Vite 7.1.7 → 7.3.7:** fixes development-server file disclosure and path-check
  bypasses, including the October 2026 fixes. This remains compatible with the
  pinned React and Tailwind Vite plugins and Node 22.12 or newer.
- **typescript-eslint 8.44.1 → 8.48.0:** replaces the affected fast-glob dependency
  path with tinyglobby. Nine audit entries inherited the same unpatched braces
  stack-exhaustion vulnerability through micromatch and fast-glob; they were not
  nine independent defects. Version 8.48.0 retains compatibility with the pinned
  ESLint 9 and TypeScript 5.9.2.
- All other direct dependency pins remain unchanged. Regenerate the lockfile and
  run the checks below before treating this remediation as verified.

## Exposure and boundaries

The braces issue affects Node-based lint tooling when it processes maliciously
nested glob patterns, not browser-side archive input. Vite findings concern its
running development server, not the static production bundle. The application
binds development and preview servers to loopback; keep that restriction and do
not expose the development server to an untrusted network. Loopback binding is
not a substitute for updating vulnerable tooling.

The custom-middleware cross-origin issue requires a configuration not used here:
this project uses the standard SPA flow. The separate October Vite WASM-prefix
advisory affects Vite 8, not this Vite 7 dependency.

ESLint 9.36.0 is unsupported, and the latest 9.x release is also deprecated.
Removing that warning requires a separate ESLint 10 migration with compatible
React Hooks and TypeScript ESLint plugins, not an unrelated automatic major
upgrade in this security patch.

## Verification

In a runner with sufficient space, regenerate the lockfile from the exact pins:

```sh
npm install --package-lock-only --ignore-scripts
npm ci
npm audit --package-lock-only
npm audit --package-lock-only --omit=dev
npm run build
npm test
npm run format:docs:check
```

Commit the matching package manifest and generated lockfile together. The first
command updates dependency metadata only; a successful fresh install and all
subsequent checks are still required. Do not use `npm audit fix --force` or edit
transitive lockfile entries manually.

## Primary sources

- [braces stack-exhaustion DoS, no patched release](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- [typescript-eslint 8.48.0 release](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.48.0)
- [Vite Windows backslash bypass](https://github.com/advisories/GHSA-93m4-6634-74q7)
- [Vite optimized dependency map traversal](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)
- [Vite query-based deny bypass](https://github.com/advisories/GHSA-v2wj-q39q-566r)
- [Vite WebSocket arbitrary file read](https://github.com/advisories/GHSA-p9ff-h696-f583)
- [Windows UNC NTLM disclosure](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)
- [Vite Windows alternate-path bypass](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)
- [Vite host-path collision, fixed in 7.3.7](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)
- [Vite custom-middleware cross-origin execution, fixed in 7.3.7](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw)
- [Vite WASM-prefix disclosure, Vite 8 only](https://github.com/vitejs/vite/security/advisories/GHSA-vfpm-58rq-9qcg)
- [ESLint version support](https://eslint.org/version-support/)

## Verified remediation

GitHub Actions run [39387602517](https://github.com/n3crosis/d2r-mobile/actions/runs/39387602517) regenerated the reviewed lock and reported **0 vulnerabilities**, including development dependencies. The checksum-verified lock artifact was adopted into the source tree; CI now uses strict `npm ci` with no automatic lock repair. Frontend tests, lint, formatting, TypeScript and production build passed in that run. This records the audit at that time, not a guarantee against future advisories. The separate ESLint support-lifecycle migration remains open.
