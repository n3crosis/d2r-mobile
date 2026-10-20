/** One bounded read from an extraction adapter, not whole-RomFS materialization.
 * reader.read(logicalPath, {maxBytes, signal}) -> Promise<Uint8Array>
 * Archive/decryption/CASC readers are deliberately supplied by caller.
 */
export class AssetWorker {
  #worker;
  #next = 1;
  #pending = new Map();
  constructor() {
    this.#worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
    this.#worker.onmessage = ({ data }) => {
      const pending = this.#pending.get(data.id);
      if (!pending) return;
      this.#pending.delete(data.id);
      data.ok ? pending.resolve(data.result) : pending.reject(new Error(data.error));
    };
    this.#worker.onerror = (event) => this.close(new Error(event.message));
  }
  run(operation, bytes, options = {}) {
    const limit = (["hud-v4", "casc-overlay"].includes(operation) ? 64 : 20) * 1024 * 1024;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > limit)
      return Promise.reject(new Error("Input exceeds operation byte limit"));
    if (!this.#worker) return Promise.reject(new Error("Worker closed"));
    const payload = bytes.slice().buffer; // Never detach caller-owned extraction data.
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, operation, payload, options }, [payload]);
    });
  }
  async fromReader(reader, path, operation, options = {}) {
    const bytes = await reader.read(path, { maxBytes: 20 * 1024 * 1024, signal: options.signal });
    return this.run(operation, bytes, { frame: options.frame ?? 0 });
  }
  close(reason = new Error("Asset generation cancelled")) {
    this.#worker?.terminate();
    this.#worker = null;
    for (const pending of this.#pending.values()) pending.reject(reason);
    this.#pending.clear();
  }
}
