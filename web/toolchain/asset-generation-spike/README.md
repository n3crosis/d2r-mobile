# Browser asset-generation boundary spike

This is an **implemented, isolated transform subset**, not the full game asset generator and not an IPA builder. Users of the deployed static directory need only Chromium (Windows/macOS target), not Python, Pillow, NumPy, Xcode, or an installer. Python runs as WASM in a dedicated worker. Build/CI tooling still uses Node/Python. No game data, fonts, secrets, analytics, uploads, or external browser fetches are included.

## Implemented

- `image-default-frame`: validates SpA1 v31 raw RGBA, crops one horizontal frame, runs the **original** `gen_hud_v4.dflt` NumPy color-mask transformation, and returns raw RGBA, Pillow PNG, and the native overlay's v31 sprite header/pixels.
- `experience-table`: runs the **original** `gen_hud_exp.main` function with an in-memory reader and captured output. The 100-entry C header is not a placeholder or a re-created approximation.
- `derived-tables`: uses the original `shell_stubs.parse/data` to emit a complete runtime `derived.tsv` from all three genuine generated C texts, with external trusted count/hash expectations. See `DERIVED_TABLES.md`; new differential browser checks are pending CI.
- `overlay-paths`: runs the **original** `gen_romfs_overlay.touch_path` rewrite with its original `LAY`, `UI`, and `TDIR` constants. Returns a path plan only, never labels it a CASC overlay.
- Typed-array worker transport, serialized requests, caller-buffer ownership preserved, bounded reads, error propagation, and cancellation by terminating the dedicated worker.

`scripts/package-core.py` parses the native source AST without importing side-effectful CLI modules. It packages only the listed functions/constants. `source-provenance.json` pins SHA-256 of each original source, including the v31 adapter source. Changed source fails packaging until reviewed. No original subprocess runner, host filesystem paths, dynamic `ctypes` library loading, or native compiler invocation reaches the browser.

### API / extraction contract

Import `AssetWorker` from `public/client.mjs`:

```js
const worker = new AssetWorker();
const result = await worker.run("image-default-frame", spriteUint8Array, { frame: 0 });
// result.files: {'frame.rgba': ArrayBuffer, 'frame.png': ArrayBuffer,
//                'frame.sprite': ArrayBuffer}
worker.close();
```

Optional `fromReader(reader, logicalPath, operation, {frame, signal})` expects:

```ts
interface LogicalAssetReader {
  read(
    logicalPath: string,
    options: {
      maxBytes: number;
      signal?: AbortSignal;
    },
  ): Promise<Uint8Array>;
}
```

This is a **logical CASC asset byte reader**, not the NSP/NCA `readAt(offset,length)` contract. The archive reader must first resolve RomFS/CASC logical paths. No extraction reader implementation is silently assumed. `fromReader` asks for at most 20 MiB; `run` independently enforces that cap. Image transforms permit at most 4,194,304 pixels; worker computation stops through `close()`, not a misleading soft-cancel flag. Read abort is delegated to the supplied reader. Outputs are returned in memory; persisting into OPFS or packaging is the caller's responsibility. A v31 sprite is not a universal substitute for v61: native source explicitly notes that the 401×1080 frontend panel requires v61.

## Native portability audit

| Source                                                      | Portable core                                                    | Host-only / unimplemented boundary                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `gen_assets.py`                                             | Generator ordering, source fingerprint concept                   | subprocess orchestration, PID lock, workspace paths; must become a worker job graph                                |
| `romfs_art.py`                                              | v31 pixels and horizontal frame crop (adapted here)              | `touch_layout._read_entry` CASC reader, v61 BC3/NVN block-linear decode, runtime clang/ctypes                      |
| `gen_hud_v4.py`                                             | Pillow composition, NumPy masks; `dflt` packaged here            | whole HUD needs source sprites, layout configuration, locale data, fonts and rewritten input/output boundaries     |
| `gen_widestash_art.py`                                      | Pillow tile/crop/flip, NumPy pixel processing                    | NVN descriptor/swizzle and BC3 encoder path; not built here                                                        |
| `gen_pouch_art.py`, `gen_vault_cover.py`, `gen_merc_art.py` | Image geometry after decoding                                    | depend on `gen_widestash_art` and original sprites; v61 output needs encoder/swizzle                               |
| `gen_fe_rightpanel.py`                                      | NumPy column copies                                              | requires exact original 401×1080 sprite; cannot replace required v61 with raw RGBA                                 |
| `gen_map_goal_art.py`                                       | Image labels, table parsing                                      | game strings and original font retrieval; no font supplied or licensed by this spike                               |
| `native_art/generate.py`                                    | CSV/JSON skill-index generation, image export                    | requires original manifest hashes and exact game sprites/tables; those checks must survive porting                 |
| `gen_hud_exp.py`                                            | CSV -> exact C experience header (packaged here)                 | logical input reader supplied in memory                                                                            |
| `gen_vault_table.py`                                        | JSON/TSV joins, type ancestry, sort, C emission                  | `dmx.get` archive reads, inventory of sprite paths; not implemented here                                           |
| `gen_romfs_overlay.py`                                      | Sprite header encoding and touch-directory rewrite (subset here) | all layout patch builders, borrowed path registry, feature variants, CASC `.build.config` and data-archive packing |

**Unsupported:** v61 decoding, BC3 encoding, NVN deswizzle/swizzle, archive extraction/decryption, CASC packaging, full HUD/skill/vault generation, font rasterization, manifest-version validation for real files, and integration into the main web UI. `casc-pack` and v61 inputs fail explicitly. A future C/WASM bridge should accept validated descriptor + compressed bytes, return linear BC3 blocks with explicit dimensions, and be compared against native `nvn_deswizzle` before connecting to Pillow's DDS decode. No fake replacement pixels are emitted.

## Pinned runtime and deployment

- Pyodide **0.27.7**, from its official npm distribution; `package-lock.json` pins package integrity.
- Pillow and NumPy plus transitive WASM libraries are resolved from that exact distribution's `pyodide-lock.json`; each wheel/library download is SHA-256 checked against that lock.
- Playwright **1.64.1** controls real Chromium in CI. Native PNG reference decoding uses Pillow **11.1.0**.
- `scripts/vendor-runtime.mjs` downloads only at **build time**, from the documented versioned Pyodide distribution. It copies runtime files into `public/vendor/pyodide/`, includes a file SHA-256 manifest, and follows package dependencies recursively.
- Deploy the complete prepared `public/` directory to a static HTTPS host with `.wasm` MIME `application/wasm`. All browser requests are same-origin. No runtime CDN fallback, micropip/PyPI installation, remote telemetry or API credentials.
- The HTML CSP permits local WASM compilation but disallows remote connections. Hosting may also set the same policy as an HTTP header. No shared-memory/COOP/COEP dependency is introduced.

Official references: [deployment](https://pyodide.org/en/0.27.7/usage/downloading-and-deploying.html), [package catalog](https://pyodide.org/en/0.27.7/usage/packages-in-pyodide.html), [worker usage](https://pyodide.org/en/0.27.7/usage/webworker.html).

## Verification

The independent workflow `.github/workflows/browser-asset-checks.yml`:

1. Packages the audited native functions after source hash checks.
2. Prepares a fully self-hosted runtime.
3. Creates tiny **authored synthetic** sprite/table/path fixtures. No fonts or game inputs.
4. Builds independent reference RGBA/header bytes using scalar Python, calls the original native table function, and supplies explicit expected overlay paths.
5. Executes the module worker in real Chromium with external requests blocked, concurrently requests all three operations, and compares exact RGBA/sprite/header/path output bytes.
6. Decodes browser-generated PNG with native Pillow and demands exact pixel equality. Compressed PNG byte identity is intentionally not required across library versions.
7. Checks truncated headers/payloads, oversized dimensions, invalid frame selection, unsupported v61/CASC, short table input and traversal paths; checks recovery after errors.
8. Uploads report, fixture/reference/output bytes, source provenance and the self-hostable static build as evidence.

Maintainer commands (not end-user steps):

```sh
npm ci --ignore-scripts
npm run prepare:core
npm run prepare:runtime
python3 test/native-reference.py
npx --no-install playwright install chromium
npm run test:browser
python3 test/verify-png.py
```

Browser execution was delegated to GitHub CI after the coherent implementation batch. [Run 39392846657](https://github.com/n3crosis/d2r-mobile/actions/runs/39392846657) **passed** on commit `143e375973d4f4d5fbc770e3464f9112c2403a4b`: runtime preparation, independent native reference, real Chromium exact parity, PNG pixel verification, and artifact upload all succeeded. The `browser-asset-generation-evidence` artifact contains the report and prepared static build (9,864,227 compressed bytes; artifact SHA-256 `fcd01fd9daa64c9ec42ea8db90a369e7a965f98acbf7389b448a6e9fd7adddf9`). This proves the listed synthetic subset only. Linux Chromium CI validates the browser runtime path, not native Windows/macOS OS-specific integration or full real-game asset generation. Source changes after that commit require their own CI proof.

## Data and licensing

Synthetic pixels/tables are authored by this test. No proprietary game font or image is shipped/downloaded. Original game fonts must remain user-supplied and local, and their licenses must permit the intended use; this spike grants no redistribution rights. The prepared runtime remains subject to Pyodide and included packages' licenses. Keep package license metadata when distributing a deployment. Native adaptation retains this repository's licensing.

## Optional v61 PNG bridge (separate integration)

The standalone worker above still rejects v61. `web/v61-asset-worker.mjs` composes the separate real texture WASM worker with this unchanged Pyodide worker, and `web/asset-generator-adapter.mjs` exposes it only with explicit `enableV61Png: true`. Output is PNG only; native v61 sprite encoding is still unsupported. Texture worker parity passed [run 39395178181](https://github.com/n3crosis/d2r-mobile/actions/runs/39395178181). The extended asset workflow now includes an independent two-frame v61 native fixture and real cross-worker/browser packaging-adapter pixel comparison. The composed-path check passed [run 39396778418](https://github.com/n3crosis/d2r-mobile/actions/runs/39396778418) on commit `fe5abb21b5527c6d230f86c94a4a7a42c6982036`, with the log confirming exact native pixel parity through both workers and the packaging adapter. See `web/ASSET_GENERATOR_ADAPTER_SCOPE.md` for bounds and limitations.

The next named generator boundary is [complete native art](NATIVE_ART.md): all
manifest PNGs plus the actual skill-index text intermediate, original hash checks,
and separate padded-atlas decoding. Both strict synthetic proofs passed in
[asset CI run 39399152831](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152831)
at `b90743b5b70fdf9ffa895dfd1d54a0201ad270c7`; this is not real-game or full-IPA validation.

The complete [Switch-upscaled HUD stage](HUD.md) now preserves original layout,
glyph rendering and every required image. Both fonts are read from the archive;
CI uses newly authored synthetic outlines only. Full differential proof is pending.
