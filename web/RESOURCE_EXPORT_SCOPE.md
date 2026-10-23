# Authenticated bulk resource export

`resource-folder-export.mjs` implements the separate full-size game-resource
output required by the unchanged native shell. The unsigned IPA alone is not the
complete output: the native app locates the original archive files separately
(`dm/ios/README.md`, “Locating the game assets”; `dm/host/romfs_validate.c`).

The browser flow calls:

```js
await exportRomfsResources({
  romfs: readAuthenticatedAssets(extracted, selection, { signal }).romfs,
  outputDirectoryHandle,
  signal,
  onProgress,
});
```

The selected NSPs and keys are the inputs. No plaintext RomFS, extracted archive,
external command-line tools, upload or extra user-supplied data is required. The
extraction/key worker must stay alive throughout export: `getFile(path).readAt`
uses its authenticated, immutable RomFS capability. A hand-created reader object
is not authentication; the orchestration layer must obtain this capability from
`readAuthenticatedAssets` rather than accepting arbitrary caller provenance.

The production flow uses the single input directory, selected and granted
read/write access by the user before packaging, as the resource parent. This
module never opens a picker or asks for broader access. It never modifies
existing NSPs or key files, and input discovery does not recurse into children.
The exporter creates `data` directly inside that input folder and writes only
RomFS `data/...` members into it, without a wrapper or UUID. The native locator
accepts `Documents/data` directly. No ZIP32 resource archive or native layout
change is involved.

An existing `data` is never overwritten or cleaned up. Its full expected file
set is checked against the current source in bounded 64 KiB byte comparisons.
Only an exact match is reused, read-only; missing/extra files, wrong sizes,
changed bytes or replaced handles stop export. Existing export markers are not
proof and are not rewritten. The comparison reads the source again (including
package decryption where required), but does not duplicate disk writes. This
checks the local folder, not files on a device. If verification fails, preserve
or move that folder aside, or explicitly skip export when you already have a
complete matching resource set.

Older `D2R-resources-<UUID>` exports remain untouched. You may move their inner
`data` folder to the input folder yourself; it must pass the same full comparison
before reuse. No automatic migration, deletion or trust in old markers occurs.

Before creating output, metadata is bounded and the eighteen required full-size
`data/*.data` archives must match the native source's exact file-size table.
This rejects missing/wrong-version resource inventories early. All authenticated
RomFS data members are exported, including optional language archives, not just the
eighteen required by the native validator. Source authentication and destination
file-size checks are not claims of end-to-end on-device compatibility.

## Bounded I/O and completion

- Authenticated reads remain sequential and capped at 64 KiB. A fixed 1 MiB
  buffer coalesces serial filesystem writes, deliberately replacing the former
  64 KiB write cap only. Sources are cleared after copying, and byte progress
  advances only after a successful flush. See the paired
  [write-batching contract](RESOURCE_WRITE_BATCHING.md) for memory and cancellation limits.
- Offsets, sizes and aggregate counters use BigInt. Each file and the aggregate
  are limited to `Number.MAX_SAFE_INTEGER` bytes because browser File sizes use
  exact JavaScript numbers. Other bounds reuse the RomFS policy: 100,000 total
  file/directory members, 4,096 UTF-8 bytes per relative path, 255 per component,
  64 directory levels and 16 MiB aggregate file-path bytes.
- Every file is closed and its actual reported byte count checked before it is
  counted as complete. There is no free-space reservation API for an arbitrary
  user-selected filesystem directory. Disk-full, revocation and browser I/O
  errors stop export and trigger owned cleanup.
- For a new export, `data/.d2rm-resource-export.json` begins with `status: "incomplete"`. Only after all
  bytes/files finish does its final transactional close publish
  `status: "complete"`, with exact decimal-string byte totals. That is the
  resource-export completion boundary; late cancellation does not relabel it.
- Resource completion is independent of IPA completion. The marker explicitly
  says the IPA is a separate output whose status is not tracked here. If later
  IPA generation fails, a completed resource folder may already remain.

On failure/cancellation, the open writer is aborted and each tracked file and
directory is removed individually, after verifying its handle still matches.
Cleanup is nonrecursive and never clears the selected directory. Unknown user
additions or replacement entries are preserved, even inside the new child.
The incomplete marker is retained when payload cleanup fails. The thrown
`ResourceExportError.report` identifies the generated folder and whether cleanup
completed; the UI must not report unqualified success or guaranteed rollback.

The browser API has no exclusive directory creation operation. A required,
origin-wide Web Lock covers creation, marker reservation, copy/verification and
cleanup, preventing concurrent packager tabs from claiming the same output.
Explicit absence checks remain mandatory. Arbitrary external modifications to
the output subtree are unsupported; detected replacements are preserved and
rejected. Process/browser termination can leave partial data and an incomplete
marker. There is no background deletion or unknown-folder scavenging.

To use the unchanged iOS shell after signing/installing separately, copy the
completed `data` folder into the app's Files/Documents location, keeping its name
and contents intact. No outer resource folder is needed. This exporter
does not sign/install the IPA or copy resources onto an iPhone.

No new test suites, fixtures, browser runs or CI were added for this module, per
the requested full-chain-first implementation scope. Static checks do not prove
real full-game disk capacity, throughput or on-device loading.
