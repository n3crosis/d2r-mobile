// Serialize browser packager exports across same-origin tabs. Filesystem APIs
// have no exclusive mkdir; arbitrary external filesystem writers remain unsupported.
const NAME = "d2r-resource-output-v1";
export async function withResourceOutputLock(locks, signal, run) {
  signal?.throwIfAborted();
  if (typeof locks?.request !== "function") throw new Error("RESOURCE_EXPORT_LOCK_UNAVAILABLE");
  return locks.request(NAME, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    signal?.throwIfAborted();
    if (!lock) throw new Error("RESOURCE_EXPORT_BUSY");
    return run();
  });
}

// Call only while holding the export lock, then create and reserve the directory
// before releasing it. Existing files and directories are never reused here.
export async function unusedOutputDirectory(parent, baseName, check) {
  for (let number = 1; number <= 10000; number++) {
    check();
    const name = number === 1 ? baseName : `${baseName}-${number}`;
    try {
      await parent.getDirectoryHandle(name);
    } catch (cause) {
      if (cause?.name === "NotFoundError") return name;
      if (cause?.name !== "TypeMismatchError") throw cause;
    }
  }
  throw new Error("RESOURCE_OUTPUT_NAME_LIMIT");
}
