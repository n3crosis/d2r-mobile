export class MockWorker {
  listeners = new Map();
  requests = [];
  terminated = false;
  constructor(handler) {
    this.handler = handler;
  }
  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }
  removeEventListener(type) {
    this.listeners.delete(type);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    this.listeners.get("message")?.({ data });
  }
  postMessage(data) {
    this.requests.push(structuredClone(data));
    if (this.handler)
      queueMicrotask(async () => {
        try {
          const result = await this.handler(data);
          this.emit({
            id: data.id,
            ok: true,
            result: structuredClone(
              result,
              result instanceof Uint8Array ? { transfer: [result.buffer] } : undefined,
            ),
          });
        } catch {
          this.emit({ id: data.id, ok: false, error: "EXTRACTION_FAILED" });
        }
      });
  }
}
