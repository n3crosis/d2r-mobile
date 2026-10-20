# Isolated synthetic signed-NCA proof

This **test-root-only** proof authors a tiny NSP containing a signed Meta NCA and
Program NCA. It supplies no Nintendo keys, signatures, game content, executable
code, user uploads, or downloaded game data. RSA private material is generated
fresh in Node memory and never written. Only the synthetic public modulus is
persisted in disposable CI scratch space.

## Run

Lightweight fixture checks (no SDK/network):

```sh
node --test web/toolchain/synthetic-signed-nca/generate.test.mjs
```

Run the lightweight fixture check locally first. The full dual-WASM proof is an
explicit, heavier check, not required on every edit. With the pinned SDK already
active, its command is:

```sh
bash web/toolchain/synthetic-signed-nca/run-ci.sh
```

The dedicated `.github/workflows/synthetic-signed-nca.yml` workflow is available
for an explicitly requested CI proof. Do not add automatic runs to obtain another
copy of an unchanged result.

## Verified receipt

The full dual-WASM proof passed on 2026-10-20 at commit
`2996fec9f52e998e7b60c037733e31dfbedf8c57`:

- [Run 39405094585, job 118568975471](https://github.com/n3crosis/d2r-mobile/actions/runs/39405094585/job/118568975471)
  completed successfully at 10:03:39 UTC.
- The job log at 10:03:35 UTC confirms identical pinned dependency sources except
  for the single test public root, production rejection of the synthetic signer,
  successful synthetic NSP/Meta/CNMT/Program ExeFS/IVFC/RomFS authentication and
  extraction, and rejection of the tampering matrix below.
- This is a receipt for that exact revision, not proof that subsequent changes
  have been exercised. The log retains upstream compiler warnings; success does
  not claim warning-free upstream sources.

## Isolation and assertions

1. Build the normal pinned production boundary without any modification.
2. Copy its build scripts and boundary source into disposable CI storage.
3. In that copy only, extend dependency preparation to substitute exactly one
   retail RSA public modulus in pinned upstream `pki.c` with a generated public
   test modulus. Do not modify signature verification, content hashing,
   extraction code, or the production scripts. There is no runtime test-key API,
   environment switch in production, or unsigned-content bypass.
4. Compare every tracked prepared upstream file across builds. Only the exact
   expected public-root substitution may differ. Compare the boundary and build
   script byte-for-byte too.
5. Require the normal production build to reject the synthetic signer for Meta,
   ExeFS, and RomFS opening. Its trust roots remain unchanged.
6. Through the isolated build's real bounded WASM APIs, read the NSP members,
   authenticate/extract Meta CNMT, verify its Program size/digest binding,
   authenticate/extract Program ExeFS, and authenticate all IVFC levels before
   indexing/reading the authored RomFS greeting with the production JS indexer.
7. Independently alter the signature, signed header, filesystem header, PFS hash
   table, ExeFS payload, and RomFS payload. Each selected path must reject with
   the integrity error and retain no open PFS directory. Also corrupt Meta's
   PFS hash table and require rejection.

The workflow never uploads binaries or fixtures and removes its scratch tree on
exit. It neither writes into nor contributes files to production `dist/`.

## Exact limits

The successful dual-WASM run above proves synthetic authenticated container
extraction at its recorded revision. Local generator/static tests alone do not
establish that result for a later revision.
The fixture uses the existing plaintext-header/unencrypted-section format; it does
not prove AES-encrypted NCA handling, titlekey/key-area handling, or retail key
availability. ExeFS has deliberately tiny NSO0/META marker files, not complete
NSO/NPDM structures or runnable code. There is one synthetic base application,
not a BKTR update, DLC, CASC, rendering, or game-launch pipeline. A copied test root
cannot demonstrate Nintendo-signature acceptance or validate any real game.

No production source, production trust root, or release artifact is changed by
this proof. The test-root binary must never be published as a runtime asset.
