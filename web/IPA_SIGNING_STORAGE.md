# Optional local signing storage

This isolated adapter is not an enabled signing UI or a validated native signing release. It does not change the unsigned shell contract. No credentials, private game inputs, native signing, or device installation were used in its synthetic checks.

- `inspectUnsignedSigningArchive(blob, { signal })` in `ipa-signing-zip.mjs` derives a manifest from bounded central-directory bytes, then independently checks the entire canonical STORE ZIP32 with `validateStagedZip`. It returns frozen `{ appRoot, entries }`, with immutable Blob slices. Limits: 512 MiB archive, 256 MiB member, 20,000 entries, 8 MiB ZIP metadata. Multiple apps, preexisting signing files, PlugIns and Watch directories are rejected. ZIP64, compression, symlinks and noncanonical archives are intentionally unsupported.
- `createSigningFileStore(archive, { readBlobSync })` in `ipa-signing-fs.mjs` keeps resources Blob-backed. The default synchronous reader is `FileReaderSync`, available in the dedicated worker, not the main thread. Each resource read is at most 64 KiB. Verified Mach-O magic identifies mutable executable candidates, capped at 128 MiB each and 256 MiB total original executable bytes. Mutable backing-array capacities are capped at 256 MiB in aggregate; array growth can transiently retain both old and replacement storage until garbage collection. These are logical storage limits, not a browser process-memory guarantee.
- Writable paths are original Mach-O files, bundle Info.plist files, exact bundle `_CodeSignature/CodeResources`, the main app's `embedded.mobileprovision`, and narrowly named executable temporary siblings. Metadata files are capped at 8 MiB. Temporary replacement renames must target the corresponding executable. Final collection rejects remaining temporary files or missing original files. Resource contents cannot be overwritten. Disposal wipes mutable arrays; collected Blob snapshots remain independent.
- `mountSigningArchive(module, archive, options)` in `ipa-signing-mount.mjs` implements ordinary Emscripten FS nodes and streams at `/work`, remapping the app internally to `/work/Payload/App.app`. It returns `{ collectEntries, dispose }`, restoring original paths on collection. The selected native bridge must use bounded stdio, not mmap. Credentials live outside this mount and remain the worker's responsibility. No MEMFS resource copies are required.
- `createSignedSigningArchive(entries, { signal })` uses the existing canonical STORE writer, snapshots chunks into Blobs and performs a fresh independent manifest/layout/CRC validation before returning a Blob. Errors contain closed signing codes rather than filenames. This validates ZIP integrity, not certificate trust, provisioning eligibility or cryptographic signing semantics.

The committed unsigned IPA must remain a separate fallback. Signing is a new post-commit transaction in an independent disposable worker. These modules neither upload nor publish anything. Their synthetic tests cover canonical roundtrip, CRC corruption, forbidden paths, cancellation, read/write bounds, immutable resources, changed-entry snapshots, temporary replacement, disposal, and signed-byte WASM heap views. Real Emscripten/native interoperability and signing remain separate validation gates.

Retry orchestration is separate from storage. The independently owned public-asset
factory in `sealed-runtime/ipa-signing-factory.mjs` prepares each one-shot worker
before credential files are read. Its first attempt reuses the bootstrap worker;
later attempts initialize fresh workers from verified in-memory public bytes,
without network access. Each attempt must close even if credential-file reading
fails. Failure/cancellation preserves the same unsigned Blob and requires fresh
credential inputs; it does not repeat conversion or retain previous credentials.
Explicit packager close/unmount disposes the factory and its retained public
assets. These lifetime guarantees do not establish native signing or device trust.
