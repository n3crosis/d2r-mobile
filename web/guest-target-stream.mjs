// 从分块 Guest Mach-O 中检查目标系统，不复制完整可执行文件。
// Inspect the target OS of a chunked Guest Mach-O without copying the whole executable.

/**
 * 仅保留 32 字节解析前缀；跳过命令正文，但仍耗尽并计数整个条目。
 * Retain only a 32-byte parsing prefix; skip command bodies, but drain and count
 * the complete entry. The caller retains ownership of all yielded chunks.
 */
export async function inspectGuestTarget(entry, { signal } = {}) {
  if (
    !entry ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    entry.size > 128 * 1024 * 1024
  )
    throw new Error("GUEST_MISSING");
  const prefix = new Uint8Array(32);
  const view = new DataView(prefix.buffer);
  const u = (offset) => view.getUint32(offset, true);
  const fail = () => {
    throw new Error("GUEST_TARGET");
  };
  let total = 0,
    have = 0,
    need = 32,
    state = "header",
    end = 0,
    commandCount = 0,
    commands = 0,
    commandOffset = 32,
    skip = 0,
    target;
  const nextCommand = () => {
    have = 0;
    if (commands === commandCount) {
      if (commandOffset !== end) fail();
      state = "body";
    } else {
      if (commandOffset + 8 > end) fail();
      state = "command";
      need = 8;
    }
  };
  try {
    signal?.throwIfAborted();
    for await (const chunk of entry.chunks()) {
      signal?.throwIfAborted();
      if (!(chunk instanceof Uint8Array) || chunk.length > entry.size - total)
        throw new Error("GUEST_SIZE");
      total += chunk.length;
      let at = 0;
      while (at < chunk.length && state !== "body") {
        if (state === "skip") {
          const length = Math.min(skip, chunk.length - at);
          at += length;
          skip -= length;
          if (skip === 0) nextCommand();
          continue;
        }
        const length = Math.min(need - have, chunk.length - at);
        prefix.set(chunk.subarray(at, at + length), have);
        have += length;
        at += length;
        if (have !== need) continue;
        if (state === "header") {
          if (u(0) !== 0xfeedfacf || u(4) !== 0x0100000c || u(12) !== 6) fail();
          end = 32 + u(20);
          commandCount = u(16);
          if (end > entry.size || commandCount > 4096) fail();
          nextCommand();
        } else if (state === "command") {
          const command = u(0),
            size = u(4);
          if (size < 8 || size % 8 || commandOffset + size > end) fail();
          commandOffset += size;
          commands++;
          if (command === 0x32) {
            if (target || size < 24) fail();
            state = "build";
            need = 24;
            skip = size - 24;
          } else {
            skip = size - 8;
            state = "skip";
            if (skip === 0) nextCommand();
          }
        } else {
          if (u(8) !== 2) fail();
          const version = u(12);
          target = {
            platform: "ios",
            minimumVersion: `${version >>> 16}.${(version >>> 8) & 255}.${version & 255}`,
          };
          state = "skip";
          if (skip === 0) nextCommand();
        }
      }
    }
    signal?.throwIfAborted();
    if (total !== entry.size) throw new Error("GUEST_SIZE");
    if (state !== "body" || !target) fail();
    return target;
  } finally {
    prefix.fill(0);
  }
}
