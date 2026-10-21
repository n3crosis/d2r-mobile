// 仅使用合成工作线程验证生命周期，不读取真实凭据、不签名或执行浏览器代码。
// Synthetic worker lifecycle only: no real credentials, signing, network or browser execution.
import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { prepareVerifiedIpaSigningFactory } from "../sealed-runtime/ipa-signing-factory.mjs";
function setup(t) {
  const state = { workers: [], created: [], revoked: [], initialize: true };
  t.mock.method(URL, "createObjectURL", () => {
    const url = `blob:synthetic-${state.created.length}`;
    state.created.push(url);
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url) => state.revoked.push(url));
  t.mock.method(globalThis, "fetch", () => assert.fail("signing retries must not fetch"));
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  t.after(() => {
    if (previousWorker) Object.defineProperty(globalThis, "Worker", previousWorker);
    else delete globalThis.Worker;
  });
  globalThis.Worker = class extends EventTarget {
    terminations = 0;
    requests = [];
    constructor(url) {
      super();
      this.url = url;
      state.workers.push(this);
    }
    postMessage(message, transfers) {
      const data = structuredClone(message, { transfer: transfers });
      this.requests.push(data);
      if (data.type === "initialize" && state.initialize)
        queueMicrotask(() => this.reply({ id: 0, ok: true, result: { initialized: true } }));
    }
    reply(data) {
      this.dispatchEvent(new MessageEvent("message", { data }));
    }
    terminate() {
      this.terminations++;
    }
  };
  return state;
}
const create = () =>
  prepareVerifiedIpaSigningFactory({
    workerBlob: new Blob(["verified worker"]),
    wasmBytes: new Uint8Array(8),
  });
const options = () => ({
  ipa: new Blob([new Uint8Array(22)]),
  credentials: {
    kind: "p12",
    identity: new ArrayBuffer(2),
    profile: new ArrayBuffer(2),
    password: "",
  },
});
const success = (worker) =>
  worker.reply({ id: 1, ok: true, result: { blob: new Blob([new Uint8Array(23)]) } });
test("initial worker is reused, failed signing retries locally in a fresh worker", async (t) => {
  const state = setup(t),
    factory = await create();
  t.after(() => factory.close());
  assert.equal(state.workers.length, 1);
  const first = await factory.prepare();
  assert.equal(state.workers.length, 1);
  const failed = first.sign(options());
  state.workers[0].reply({ id: 1, ok: false, error: { code: "SIGNING_PROFILE_MISMATCH" } });
  await assert.rejects(failed, /SIGNING_PROFILE_MISMATCH/);
  assert.ok(state.workers[0].terminations > 0);
  const second = await factory.prepare();
  assert.equal(state.workers.length, 2);
  const result = second.sign(options());
  success(state.workers[1]);
  assert.equal((await result).blob.size, 23);
  assert.ok(state.workers[1].terminations > 0);
  assert.deepEqual(state.revoked, state.created);
  factory.close();
  await assert.rejects(factory.prepare(), /SIGNING_CLOSED/);
});
test("abandoning prepared credentials frees the worker and allows another preparation", async (t) => {
  const state = setup(t),
    factory = await create();
  t.after(() => factory.close());
  const first = await factory.prepare();
  await assert.rejects(factory.prepare(), /SIGNING_CLOSED/);
  first.close();
  first.close();
  assert.equal(state.workers[0].terminations, 1);
  const second = await factory.prepare();
  assert.equal(state.workers.length, 2);
  await assert.rejects(first.sign(options()), /SIGNING_CLOSED/);
  second.close();
});
test("cancelled signing destroys only its attempt and preserves retry factory", async (t) => {
  const state = setup(t),
    factory = await create();
  t.after(() => factory.close());
  const attempt = await factory.prepare(),
    controller = new AbortController();
  const signing = attempt.sign({ ...options(), signal: controller.signal });
  controller.abort();
  await assert.rejects(signing, { name: "AbortError" });
  const retry = await factory.prepare();
  assert.equal(state.workers.length, 2);
  retry.close();
});
test("close interrupts retry initialization, revokes its URL and prevents revival", async (t) => {
  const state = setup(t),
    factory = await create();
  (await factory.prepare()).close();
  state.initialize = false;
  const preparing = factory.prepare();
  assert.equal(state.workers.length, 2);
  await assert.rejects(factory.prepare(), /SIGNING_CLOSED/);
  factory.close();
  await assert.rejects(preparing, { name: "AbortError" });
  state.workers[1].reply({ id: 0, ok: true, result: { initialized: true } });
  await assert.rejects(factory.prepare(), /SIGNING_CLOSED/);
  assert.ok(state.workers.every((worker) => worker.terminations > 0));
  assert.deepEqual(state.revoked, state.created);
});
test("cancelled retry initialization remains retryable and accepts no credentials", async (t) => {
  const state = setup(t),
    factory = await create();
  t.after(() => factory.close());
  (await factory.prepare()).close();
  state.initialize = false;
  const controller = new AbortController(),
    preparing = factory.prepare({ signal: controller.signal });
  controller.abort();
  await assert.rejects(preparing, { name: "AbortError" });
  assert.ok(
    state.workers.every((worker) =>
      worker.requests.every((request) => request.type === "initialize"),
    ),
  );
  state.initialize = true;
  (await factory.prepare()).close();
  assert.equal(state.workers.length, 3);
});
test("explicit close terminates active signing and leaves no usable attempt", async (t) => {
  const state = setup(t),
    factory = await create();
  const attempt = await factory.prepare();
  const signing = attempt.sign(options());
  factory.close();
  await assert.rejects(signing, /SIGNING_CLOSED/);
  await assert.rejects(attempt.sign(options()), /SIGNING_CLOSED/);
  assert.ok(state.workers[0].terminations > 0);
});

test("failed fresh initialization is retryable without touching credentials", async (t) => {
  const state = setup(t),
    factory = await create();
  t.after(() => factory.close());
  (await factory.prepare()).close();
  state.initialize = false;
  const preparing = factory.prepare();
  state.workers[1].reply({ id: 0, ok: false, error: { code: "SIGNING_INITIALIZATION_FAILED" } });
  await assert.rejects(preparing, /SIGNING_INITIALIZATION_FAILED/);
  assert.ok(state.workers[1].terminations > 0);
  state.initialize = true;
  (await factory.prepare()).close();
  assert.equal(state.workers.length, 3);
  assert.ok(
    state.workers.every((worker) =>
      worker.requests.every((request) => request.type === "initialize"),
    ),
  );
});

test("direct signing cannot lazily initialize and concurrent signing leaves the first attempt intact", async (t) => {
  const state = setup(t),
    factory = await create();
  t.after(() => factory.close());
  await assert.rejects(factory.sign(options()), /SIGNING_CLOSED/);
  assert.equal(state.workers.length, 1);
  const attempt = await factory.prepare();
  const signing = attempt.sign(options());
  await assert.rejects(attempt.sign(options()), /SIGNING_CLOSED/);
  await assert.rejects(factory.prepare(), /SIGNING_CLOSED/);
  assert.equal(state.workers[0].terminations, 0);
  success(state.workers[0]);
  await signing;
  await assert.rejects(factory.sign(options()), /SIGNING_CLOSED/);
  assert.equal(state.workers.length, 1);
});

test("factory initialization requires no AbortSignal.any and releases forwarding listeners", async (t) => {
  setup(t);
  const previousAny = AbortSignal.any;
  AbortSignal.any = undefined;
  t.after(() => {
    AbortSignal.any = previousAny;
  });
  const controller = new AbortController();
  const factory = await prepareVerifiedIpaSigningFactory({
    workerBlob: new Blob(["verified worker"]),
    wasmBytes: new Uint8Array(8),
    signal: controller.signal,
  });
  t.after(() => factory.close());
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  (await factory.prepare()).close();
  const retryController = new AbortController();
  (await factory.prepare({ signal: retryController.signal })).close();
  assert.equal(getEventListeners(retryController.signal, "abort").length, 0);
});
