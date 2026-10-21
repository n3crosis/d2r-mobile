// 使用可转移合成凭据测试边界；不读取真实身份或伪称验证苹果签名。
// Test boundaries with transferable synthetic credentials, not real identities or claimed Apple verification.
import test from "node:test";
import assert from "node:assert/strict";
import { createDownloadPreparation } from "../download-preparation.mjs";
import { prepareIpaSigningClient } from "../ipa-signing-client.mjs";
import { validateSigningCredentials, validateSigningProgress } from "../ipa-signing-contract.mjs";
class WorkerDouble extends EventTarget {
  terminated = 0;
  messages = [];
  postMessage(message, transfers) {
    const copy = structuredClone(message, { transfer: transfers });
    this.messages.push(copy);
    this.handle?.(copy);
  }
  reply(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  terminate() {
    this.terminated++;
  }
}
const identity = () => ({
  kind: "p12",
  identity: new Uint8Array([1, 2, 3]).buffer,
  profile: new Uint8Array([4, 5, 6]).buffer,
  password: "synthetic-only",
});
const ipa = () => new Blob([new Uint8Array(30)]);
async function ready(handler, options = {}) {
  const worker = new WorkerDouble();
  worker.handle = ({ id }) => {
    if (id === 0)
      queueMicrotask(() => worker.reply({ id: 0, ok: true, result: { initialized: true } }));
    else handler?.(worker);
  };
  const wasm = new Uint8Array(8).buffer;
  const client = await prepareIpaSigningClient({
    worker,
    assets: [["zsign.wasm", wasm]],
    ...options,
  });
  assert.equal(wasm.byteLength, 0);
  return { client, worker };
}
test("success consumes buffers, preserves unsigned Blob and terminates one-shot worker", async () => {
  const output = ipa(),
    input = ipa(),
    credentials = identity();
  const { client, worker } = await ready((w) =>
    queueMicrotask(() => w.reply({ id: 1, ok: true, result: { blob: output } })),
  );
  const result = await client.sign({ ipa: input, credentials });
  assert.equal(result.fileName, "D2RMobile-signed.ipa");
  assert.equal(result.blob, output);
  assert.equal(input.size, 30);
  assert.equal(credentials.identity.byteLength, 0);
  assert.equal(credentials.profile.byteLength, 0);
  assert.equal(worker.terminated, 1);
  await assert.rejects(client.sign({ ipa: input, credentials: identity() }), /SIGNING_CLOSED/);
  client.close();
  assert.equal(worker.terminated, 1);
});
test("cancel interrupts nonresponsive native worker and ignores late success", async () => {
  const { client, worker } = await ready();
  const controller = new AbortController();
  const pending = client.sign({ ipa: ipa(), credentials: identity(), signal: controller.signal });
  controller.abort(new Error("private reason"));
  await assert.rejects(pending, (e) => e.name === "AbortError" && !e.message.includes("private"));
  worker.reply({ id: 1, ok: true, result: { blob: ipa() } });
  assert.equal(worker.terminated, 1);
});
test("invalid inputs zero untransferred buffers and never send a private operation", async () => {
  const { client, worker } = await ready();
  const credentials = identity();
  await assert.rejects(client.sign({ ipa: new Blob([]), credentials }), /SIGNING_INPUT_INVALID/);
  assert.deepEqual([...new Uint8Array(credentials.identity)], [0, 0, 0]);
  assert.deepEqual([...new Uint8Array(credentials.profile)], [0, 0, 0]);
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.terminated, 1);
});
test("already cancelled request transfers no credentials and clears owned buffers", async () => {
  const { client, worker } = await ready();
  const credentials = identity();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.sign({ ipa: ipa(), credentials, signal: controller.signal }), {
    name: "AbortError",
  });
  assert.deepEqual([...new Uint8Array(credentials.identity)], [0, 0, 0]);
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.terminated, 1);
});
test("raw worker errors are redacted and output extra fields are rejected", async () => {
  for (const reply of [
    { id: 1, ok: false, error: { code: "password: private" } },
    { id: 1, ok: true, result: { blob: ipa(), password: "private" } },
    { id: 1, ok: true, result: { blob: new Blob([]) } },
  ]) {
    const { client, worker } = await ready((w) => queueMicrotask(() => w.reply(reply)));
    await assert.rejects(
      client.sign({ ipa: ipa(), credentials: identity() }),
      (e) => /^SIGNING_/.test(e.message) && !e.message.includes("private"),
    );
    assert.equal(worker.terminated, 1);
  }
});
test("progress only exposes closed stages and bounded counts; observer errors are harmless", async () => {
  const events = [];
  const { client } = await ready((w) =>
    queueMicrotask(() => {
      w.reply({ id: 1, type: "progress", stage: "sign", completed: 1, total: 2 });
      w.reply({ id: 1, ok: true, result: { blob: ipa() } });
    }),
  );
  await client.sign({
    ipa: ipa(),
    credentials: identity(),
    onProgress: (e) => {
      events.push(e);
      throw Error("observer");
    },
  });
  assert.deepEqual(events, [{ stage: "sign", completed: 1, total: 2 }]);
  for (const extra of [{ stage: "private" }, { completed: 3 }, { path: "private" }]) {
    assert.equal(
      validateSigningProgress({
        id: 1,
        type: "progress",
        stage: "sign",
        completed: 1,
        total: 2,
        ...extra,
      }),
      false,
    );
  }
});
test("concurrent invocation does not terminate active operation or clear its inputs", async () => {
  const { client, worker } = await ready();
  const first = client.sign({ ipa: ipa(), credentials: identity() });
  const secondCredentials = identity();
  await assert.rejects(
    client.sign({ ipa: ipa(), credentials: secondCredentials }),
    /SIGNING_CLOSED/,
  );
  assert.equal(worker.terminated, 0);
  assert.equal(secondCredentials.identity.byteLength, 3);
  worker.reply({ id: 1, ok: true, result: { blob: ipa() } });
  await first;
});
test("postMessage failure clears credentials and masks raw error", async () => {
  const { client, worker } = await ready();
  const credentials = identity();
  worker.postMessage = () => {
    throw Error("private error");
  };
  await assert.rejects(client.sign({ ipa: ipa(), credentials }), /SIGNING_WORKER_FAILED/);
  assert.deepEqual([...new Uint8Array(credentials.identity)], [0, 0, 0]);
  assert.equal(worker.terminated, 1);
});
test("initialization cancellation owns and terminates worker", async () => {
  const worker = new WorkerDouble(),
    controller = new AbortController();
  const result = prepareIpaSigningClient({
    worker,
    assets: [["zsign.wasm", new ArrayBuffer(8)]],
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(worker.terminated, 1);
});
test("credentials reject shared buffers, unexpected fields and oversized passwords", () => {
  const same = new ArrayBuffer(2);
  assert.equal(validateSigningCredentials({ ...identity(), identity: same, profile: same }), false);
  assert.equal(validateSigningCredentials({ ...identity(), path: "private" }), false);
  assert.equal(validateSigningCredentials({ ...identity(), password: "x".repeat(4097) }), false);
});

test("resizable credential and bootstrap buffers are rejected", async () => {
  const growing = new ArrayBuffer(8, { maxByteLength: 16 });
  assert.equal(growing.resizable, true);
  assert.equal(validateSigningCredentials({ ...identity(), identity: growing }), false);
  assert.equal(validateSigningCredentials({ ...identity(), profile: growing }), false);
  const worker = new WorkerDouble();
  await assert.rejects(
    prepareIpaSigningClient({ worker, assets: [["zsign.wasm", growing]] }),
    /SIGNING_INITIALIZATION_FAILED/,
  );
  assert.equal(worker.messages.length, 0);
  assert.equal(worker.terminated, 1);
});

test("embedded NUL password is rejected before native C strings", () => {
  assert.equal(validateSigningCredentials({ ...identity(), password: "before\0after" }), false);
});

test("silent initialization expires, terminates and ignores late success", async () => {
  const worker = new WorkerDouble();
  await assert.rejects(
    prepareIpaSigningClient({
      worker,
      assets: [["zsign.wasm", new ArrayBuffer(8)]],
      initializeTimeoutMs: 5,
    }),
    /SIGNING_TIMEOUT/,
  );
  worker.reply({ id: 0, ok: true, result: { initialized: true } });
  assert.equal(worker.terminated, 1);
});
test("silent signing expires and late result cannot replace the unsigned input", async () => {
  const { client, worker } = await ready(undefined, { signingTimeoutMs: 5 });
  const original = ipa(),
    credentials = identity();
  await assert.rejects(client.sign({ ipa: original, credentials }), /SIGNING_TIMEOUT/);
  worker.reply({ id: 1, ok: true, result: { blob: ipa() } });
  assert.equal(worker.terminated, 1);
  assert.equal(original.size, 30);
  assert.equal(credentials.identity.byteLength, 0);
});
test("rejected async progress observer is observed without changing signing", async () => {
  const { client } = await ready((w) =>
    queueMicrotask(() => {
      w.reply({ id: 1, type: "progress", stage: "sign", completed: 1, total: 1 });
      w.reply({ id: 1, ok: true, result: { blob: ipa() } });
    }),
  );
  await client.sign({
    ipa: ipa(),
    credentials: identity(),
    onProgress: async () => {
      throw Error("private observer");
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
});
test("deadline overrides cannot disable or exceed bounded production defaults", async () => {
  for (const options of [
    { initializeTimeoutMs: 0 },
    { initializeTimeoutMs: 120001 },
    { signingTimeoutMs: Infinity },
    { signingTimeoutMs: 600001 },
  ]) {
    const worker = new WorkerDouble();
    await assert.rejects(
      prepareIpaSigningClient({ worker, assets: [["zsign.wasm", new ArrayBuffer(8)]], ...options }),
      /SIGNING_INITIALIZATION_FAILED/,
    );
    assert.equal(worker.messages.length, 0);
    assert.equal(worker.terminated, 1);
  }
});

test("profile mismatch keeps the committed unsigned download available", async () => {
  const original = ipa();
  let retainedBlob;
  const fallback = createDownloadPreparation({
    createObjectURL: (blob) => {
      retainedBlob = blob;
      return "blob:unsigned";
    },
    revokeObjectURL() {},
  });
  fallback.retain({ blob: original, fileName: "D2RMobile-unsigned.ipa" });
  const before = fallback.prepare();
  const { client, worker } = await ready((w) =>
    queueMicrotask(() =>
      w.reply({ id: 1, ok: false, error: { code: "SIGNING_PROFILE_MISMATCH" } }),
    ),
  );
  await assert.rejects(client.sign({ ipa: original, credentials: identity() }), {
    message: "SIGNING_PROFILE_MISMATCH",
  });
  assert.deepEqual(fallback.prepare(), before);
  assert.equal(retainedBlob, original);
  assert.equal(worker.terminated, 1);
  fallback.dispose();
});
