import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
const source = await readFile(new URL("../dotnet-worker.mjs", import.meta.url), "utf8");
const upstream = JSON.parse(
  await readFile(new URL("./dotnet-sidecar-source.json", import.meta.url), "utf8"),
);
// Exact MIT-licensed .NET10.0.13 source excerpts, full source SHA-256 recorded in fixture.
// Strip only TS export/as-any syntax and expose declarations for VM observation.
const classification = upstream.classification
  .replaceAll("(globalThis as any)", "globalThis")
  .replaceAll("export const ", "globalThis.");
function context() {
  const listeners = new Map(),
    replies = [];
  const sandbox = {
    importScripts() {},
    onmessage: null,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    postMessage(value) {
      replies.push(value);
    },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  return { sandbox, listeners, replies };
}
function classifyAndComplete(sandbox) {
  let completed = false;
  sandbox.runtimeHelpers = {
    coreAssetsInMemory: {
      promise_control: {
        resolve() {
          completed = true;
        },
      },
    },
  };
  vm.runInContext(classification, sandbox);
  vm.runInContext(upstream.coreReadiness, sandbox);
  return {
    sidecar: sandbox.ENVIRONMENT_IS_SIDECAR,
    worker: sandbox.ENVIRONMENT_IS_WORKER,
    completed,
  };
}
test("old onmessage assignment reproduces blocked core readiness branch", () => {
  const { sandbox } = context();
  sandbox.onmessage = () => {};
  assert.deepEqual(classifyAndComplete(sandbox), {
    sidecar: false,
    worker: true,
    completed: false,
  });
});
test("actual sealed worker listener permits upstream sidecar detection and core completion", () => {
  const { sandbox, listeners } = context();
  vm.runInContext(source, sandbox);
  assert.equal(sandbox.onmessage, null);
  assert.equal(typeof listeners.get("message"), "function");
  assert.deepEqual(classifyAndComplete(sandbox), { sidecar: true, worker: false, completed: true });
});
test("early requests still reject synchronously without starting runtime or accepting payload", () => {
  const { sandbox, listeners, replies } = context();
  vm.runInContext(source, sandbox);
  listeners.get("message")({ data: { id: 7, type: "run" } });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 7);
  assert.equal(replies[0].ok, false);
  assert.equal(replies[0].error, "Runtime not initialized");
  assert.equal(sandbox.onmessage, null);
});
