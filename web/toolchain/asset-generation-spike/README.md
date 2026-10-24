# Source-pinned Python asset references

This directory retains the Python reference adapters, source provenance and pinned
packaging needed by current JavaScript parity oracles. It is not a production
browser runtime or a deployable standalone application. Production uses
[JavaScript/WASM](../asset-runtime-js/README.md).

## Retained build and reference contract

`scripts/package-core.py` extracts native AST functions without importing CLI side
effects. The remaining package scripts preserve native art, HUD, map-goal, CASC,
mercenary, overlay and vault source contracts. Their provenance hashes remain
build gates, including the native-art and HUD metadata consumed by production.
The `src/` adapters and their source pins must not be removed as unused Python.

Current JavaScript parity tests consume `public/generated/` and
`public/vendor/pyodide/`. Prepare those reference-only inputs with:

```sh
npm ci --ignore-scripts
npm run prepare:core
npm run prepare:runtime
```

The pinned Pyodide 0.27.7 distribution and its package lock remain unchanged.
`scripts/vendor-runtime.mjs` verifies package hashes and retains license metadata.
`test/casc-overlay-oracle.py` remains the independent native oracle used by current
CASC tests. Current JS parity checks live beside the JS recipes and transforms.

## Retired standalone browser proofs

The old Python browser UI/client/worker, browser test runners and their dedicated
native fixture generators have been retired together with the optional `assets`
and `offline-pyodide` profiles. The current JS runtime, parity oracles, source pins
and production build/release checks remain. This is a reduction in historical
Python-browser proof coverage, not a claim that every removed assertion is
repeated in a current test. In particular, the old matching-BASIC/RAQM and v61
cross-adapter browser runs are no longer available.

The sibling scope documents describe retained reference-adapter contracts and
historical findings, not a currently deployed Python application. The preserved
`HUD_BACKEND_EVIDENCE.json` records a historical backend incompatibility, not a
successful production-fidelity certification.

## Data and licensing

No proprietary game font or image is shipped or downloaded. User-supplied game
resources must remain local and their licenses must permit the intended use.
Pyodide and packaged dependencies keep their original licenses and metadata;
retiring a proof does not relicense or remove required notices. Native adaptation
retains this repository's licensing.
