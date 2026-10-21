import { mkdir, readdir, stat, open, rename, rm, writeFile, statfs } from "node:fs/promises";
import { join, basename } from "node:path";

function missing() {
  return new DOMException("Entry not found", "NotFoundError");
}
function safe(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  )
    throw new DOMException("Invalid entry name", "TypeMismatchError");
  return name;
}
async function kind(path) {
  try {
    return (await stat(path)).isDirectory() ? "directory" : "file";
  } catch (error) {
    if (error.code === "ENOENT") throw missing();
    throw error;
  }
}

export class FileHandle {
  kind = "file";
  constructor(path) {
    this.path = path;
    this.name = basename(path);
  }
  async queryPermission() {
    return "granted";
  }
  async getFile() {
    if ((await kind(this.path)) !== "file")
      throw new DOMException("Not a file", "TypeMismatchError");
    const file = Bun.file(this.path);
    Object.defineProperty(file, "name", { value: this.name });
    return file;
  }
  async createWritable({ keepExistingData = false } = {}) {
    const temporary = `${this.path}.bun-write-${crypto.randomUUID()}`;
    if (keepExistingData) throw new Error("keepExistingData is unsupported in this CLI");
    const file = await open(temporary, "wx");
    let state = "open",
      position = 0;
    return {
      async write(bytes) {
        if (state !== "open" || !(bytes instanceof Uint8Array)) throw new Error("Invalid write");
        for (let at = 0; at < bytes.length;) {
          const { bytesWritten } = await file.write(bytes, at, bytes.length - at, position + at);
          if (!bytesWritten) throw new Error("Short write");
          at += bytesWritten;
        }
        position += bytes.length;
      },
      async close() {
        if (state !== "open") throw new Error("Writer closed");
        state = "closed";
        await file.close();
        await rename(temporary, this.path);
      },
      async abort() {
        if (state !== "open") return;
        state = "aborted";
        await file.close();
        await rm(temporary, { force: true });
      },
    };
  }
}

export class DirectoryHandle {
  kind = "directory";
  constructor(path) {
    this.path = path;
    this.name = basename(path);
  }
  async queryPermission() {
    return "granted";
  }
  async *entries() {
    for (const item of await readdir(this.path, { withFileTypes: true })) {
      const path = join(this.path, item.name);
      yield [item.name, item.isDirectory() ? new DirectoryHandle(path) : new FileHandle(path)];
    }
  }
  async *keys() {
    for await (const [name] of this.entries()) yield name;
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    const path = join(this.path, safe(name));
    if (create) await mkdir(path, { recursive: true });
    if ((await kind(path)) !== "directory")
      throw new DOMException("Not a directory", "TypeMismatchError");
    return new DirectoryHandle(path);
  }
  async getFileHandle(name, { create = false } = {}) {
    const path = join(this.path, safe(name));
    if (create) {
      try {
        await writeFile(path, new Uint8Array(), { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    if ((await kind(path)) !== "file") throw new DOMException("Not a file", "TypeMismatchError");
    return new FileHandle(path);
  }
  async removeEntry(name, { recursive = false } = {}) {
    const path = join(this.path, safe(name));
    if ((await kind(path)) === "directory" && !recursive)
      throw new DOMException("Directory is not empty", "InvalidModificationError");
    await rm(path, { recursive, force: false });
  }
}

export async function storageAt(path) {
  await mkdir(path, { recursive: true });
  const volume = await statfs(path);
  const available = volume.bavail * volume.bsize;
  return {
    async getDirectory() {
      return new DirectoryHandle(path);
    },
    async estimate() {
      return { quota: available, usage: 0 };
    },
  };
}
