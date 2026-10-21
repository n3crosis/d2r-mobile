# Browser-local zsign source build

[简体中文](README.zh-CN.md) | English

This optional toolchain reuses the browser portability design and bundle ABI of
[lbr77/zsign-wasm at the user-selected revision](https://github.com/lbr77/zsign-wasm/tree/0fb14887c61716508088e365447ffdedf7a1837d),
with the signing implementation from
[zhlynn/zsign v1.1.3](https://github.com/zhlynn/zsign/releases/tag/v1.1.3).
It is **not** a byte-for-byte rebuild of the older fork's committed WASM binary.
Every source and compiler revision is fixed in `pins.json`.

## Why source-derived reuse

The selected fork already contains a browser bridge and portable file mapping.
Its committed WASM is 2,425,871 bytes according to the GitHub tree metadata, but
its external precompiled OpenSSL dependency is not pinned. That is not a size
measurement of this new build. Its native signing base predates current upstream
fixes, including rejecting unreadable resources instead of sealing them as empty.

We preserve the fork's C bundle ABI, adapt it to current upstream, and replace
whole-file resource hashing with 64 KiB incremental OpenSSL EVP reads. Mutable
mapping uses checked, bounded `fopen`/`fread`/`fwrite` instead of `mmap`. The generated runtime explicitly disables dynamic execution. No JSZip
wrapper, `new Function`, downloaded runtime code, WWDR fetch helper, native CLI,
installer, metadata extractor, OCSP client, archive codec, or WASI compatibility
shim is included. There is no TLS/libssl dependency.

## Build

Prerequisites are installed independently: Git, Python 3, Perl, Make and the
project-pinned Emscripten 4.0.20. Run from the repository root:

    bash web/toolchain/zsign-wasm/build.sh
    node web/toolchain/zsign-wasm/wasm-smoke.mjs

The recipe fetches exact source commits, applies audited source-copy patches,
builds official OpenSSL 3.5.9 with Emscripten, and links only libcrypto. It does
not install software, execute downloaded binaries, accept credentials, or sign
an application. `no-module` retains the static legacy provider required for older
P12 encryption. Do not replace it with `no-legacy`. Both default and legacy
providers and an initialized cryptographic RNG are required at the signing call;
failure returns `-205` rather than fetching a provider or using weak randomness.

Outputs are `dist/zsign.mjs`, `dist/zsign.wasm`, three license files, an OpenSSL
notice file, copied pins, compiler version, patch receipt, and build receipt.
The receipt records byte counts and SHA-256 for generated files. It does not
claim browser execution, installability, certificate validity or device testing.
License files must accompany deployment:

- `ZSIGN-LICENSE.txt`: upstream MIT, copyright 2026 zhlynn.
- `PORT-LICENSE.txt`: selected fork MIT, copyright 2023 DeepSeek, as shipped.
- `OPENSSL-LICENSE.txt`: OpenSSL Apache-2.0, with `OPENSSL-NOTICE.txt`.

## Worker ABI and isolation

`zsign.mjs` exports the default modularized factory. Supply already-verified WASM
bytes with the application's sealed byte factory, never a URL fallback. Native
exports are only `_zsign_sign_bundle`, `_malloc`, `_free`. Runtime methods include
`FS`, `MEMFS`, `HEAPU8`, `ccall`, `UTF8ToString`; the worker uses direct calls,
not caller-selected export names. Module stdout/stderr must be suppressed.

The `zsign_sign_bundle` ABI is nine UTF-8 C strings followed by five integers:

    input_folder, cert_file, pkey_file, prov_file, password,
    entitlements_file, bundle_id, bundle_version, display_name,
    adhoc, sha256_only, force_sign, weak_inject, enable_cache

The build-owned worker must always pass fixed internal paths and empty optional
strings: `/work/Payload/App.app`, empty cert, `/credentials/identity.p12`,
`/credentials/profile.mobileprovision`, password, four empty option strings,
then `0, 1, 1, 0, 0`. It must reject arbitrary paths, bundle edits, entitlements,
cache/debug options, ad-hoc requests and extension apps before calling native.

Return codes: `0` success; `-201` invalid tree; `-202` missing credential paths;
`-203` identity/profile initialization failed; `-204` signing failed;
`-205` provider/entropy unavailable. Translate these to closed UI error codes;
never display raw native errors, certificate names, passwords or file contents.

Use a fresh worker/module per job. Allocate each string explicitly, then zero
and free its memory. Clear credential files and buffers, clear the module heap,
and terminate the worker on success, failure, timeout or cancellation. Browser
strings cannot be reliably erased: make no forensic-erasure promise. Credentials
must never enter persistent storage, logs, telemetry, workers' bootstrap assets,
network requests or the output IPA. The provisioning profile is intentionally
embedded in the signed output; the P12 and password are not.

## Memory and output contract

- Resource hashing reads at most 64 KiB at a time, including multi-GB files.
- Native mutable mapping is capped at 128 MiB per file.
- WASM linear memory starts at 32 MiB and cannot exceed 512 MiB.
- The filesystem adapter must separately bound total mutable file storage to
  256 MiB and cap entry count/path lengths/metadata. Heap size is not a limit on
  JavaScript allocations. A Mach-O may coexist in FS and native scratch memory.
- Resource files are immutable Blob slices accessed synchronously inside the
  dedicated worker. Never copy the whole IPA or resource tree into MEMFS.
- Serialize changed Mach-Os, CodeResources and embedded.mobileprovision plus
  unchanged resources using the existing bounded ZIP writer. Preserve the
  original app folder name in the output archive.
- Keep the completed unsigned IPA untouched. Signing is a separate transaction;
  publish the signed result only after complete archive validation. Failure or
  cancellation preserves the unsigned download.

## Verification boundary

The patch transformer has been exercised against the exact referenced source
files; Python and shell syntax checks have passed. No WASM compilation, real
credential use, browser signing or device installation has been performed here.
The post-build Node 24+ smoke verifies offline instantiation, runtime exports,
receipt hashes and static-provider/entropy initialization without credentials.
CI must also test modern and
legacy P12 parsing, unreadable/short resource rejection, signed Mach-O/resource
integrity and the worker's offline cleanup before enabling the UI. A successful
signing return alone does not establish Apple trust, entitlement/profile/device
eligibility, revocation status, or installability.
