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
The exporter creates a fresh `D2R-resources-<UUID>` child and preserves every raw
RomFS relative path beneath it, including `data/...`. It neither builds a ZIP32
resource archive nor changes the native shell's layout. A collision is an error,
never permission to reuse or overwrite an existing user entry.

Before creating output, metadata is bounded and the eighteen required full-size
`data/*.data` archives must match the native source's exact file-size table.
This rejects missing/wrong-version resource inventories early. All authenticated
RomFS files are exported, including optional language archives, not just the
eighteen required by the native validator. Source authentication and destination
file-size checks are not claims of end-to-end on-device compatibility.

## Bounded I/O and completion

- Reads and awaited writes are sequential, at most 64 KiB each. No whole game,
  archive or full resource file is buffered. Read buffers are cleared after the
  writable has consumed them. Progress is throttled between file transitions.
- Offsets, sizes and aggregate counters use BigInt. Each file and the aggregate
  are limited to `Number.MAX_SAFE_INTEGER` bytes because browser File sizes use
  exact JavaScript numbers. Other bounds reuse the RomFS policy: 100,000 total
  file/directory members, 4,096 UTF-8 bytes per relative path, 255 per component,
  64 directory levels and 16 MiB aggregate file-path bytes.
- Every file is closed and its actual reported byte count checked before it is
  counted as complete. There is no free-space reservation API for an arbitrary
  user-selected filesystem directory. Disk-full, revocation and browser I/O
  errors stop export and trigger owned cleanup.
- `.d2rm-resource-export.json` begins with `status: "incomplete"`. Only after all
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

The browser API has no exclusive directory creation operation. The implementation
uses a cryptographically fresh UUID and explicit absence checks; concurrent
external modifications to the new output subtree are unsupported. Process/browser
termination can leave a partial folder and incomplete marker. There is no
background deletion, automatic resume, or unknown-folder scavenging.

To use the unchanged iOS shell after signing/installing separately, copy the
completed resource folder into the app's Files/Documents location. Its `data`
child remains within the native locator's supported nesting depth. This exporter
does not sign/install the IPA or copy resources onto an iPhone.

No new test suites, fixtures, browser runs or CI were added for this module, per
the requested full-chain-first implementation scope. Static checks do not prove
real full-game disk capacity, throughput or on-device loading.
