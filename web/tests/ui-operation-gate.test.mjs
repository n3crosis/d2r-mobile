// 合成异步交错测试，不模拟 React 渲染或真实浏览器事件。
// Synthetic async interleavings, not React-rendering or real-browser event proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUiOperationGate } from "../ui-operation-gate.mjs";

test("synchronous duplicate starts cannot replace the active cancellation controller", () => {
  const gate = createUiOperationGate(),
    first = gate.begin();
  assert.equal(gate.begin(), null);
  assert.equal(first.isCurrent(), true);
  assert.equal(gate.busy, true);
  first.controller.abort();
  assert.equal(gate.begin(), null);
  first.finish();
  assert.equal(gate.busy, false);
  assert.ok(gate.begin());
});
test("late completion from an unmounted operation cannot clear a replacement lease", async () => {
  const gate = createUiOperationGate(),
    old = gate.begin();
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  let status = "new operation";
  const task = (async () => {
    await pending;
    if (old.isCurrent()) status = "stale result";
    old.finish();
  })();
  gate.cancel();
  assert.equal(old.controller.signal.aborted, true);
  const replacement = gate.begin();
  resolve();
  await task;
  assert.equal(status, "new operation");
  assert.equal(replacement.isCurrent(), true);
  assert.equal(gate.busy, true);
  replacement.finish();
});
test("revocation precedes abort callbacks and repeat cancellation is harmless", () => {
  const gate = createUiOperationGate(),
    lease = gate.begin();
  lease.controller.signal.addEventListener("abort", () => assert.equal(lease.isCurrent(), false));
  gate.cancel();
  gate.cancel();
  lease.finish();
  assert.equal(gate.busy, false);
});
test("UI shares operation lease across folder, generation and signing retry handlers", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal(
    (source.match(/const operation = operationGate.current.begin\(\)/g) ?? []).length,
    3,
  );
  assert.match(source, /operations\.cancel\(\)/);
  assert.match(source, /if \(operationGate\.current\.busy\) return;\s+setSkipResources\(false\)/);
  assert.match(source, /if \(!current\(\)\) return;\s+generationCompleted = true/);
  assert.match(source, /if \(!current\(\)\) return;\s+const names = files\.nsps/);
});

test("stale option events cannot change configuration while a lease owns the UI", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const anchor of [
    'id="ios-target"',
    "checked={legacyAstc}",
    'id="astc-preset"',
    "checked={skipResources}",
  ]) {
    const start = source.indexOf(anchor);
    assert.ok(start >= 0);
    const handler = source.indexOf("onChange={(event) => {", start);
    const finish = source.indexOf("}}", handler);
    assert.match(source.slice(handler, finish), /operationGate\.current\.busy/);
  }
});

// 源码契约检查只约束稳定键和复制文本，不宣称实际 React 耗时。
// Source-contract checks constrain stable keys and copied text, not actual React timing.
test("bounded activity log keeps monotonic row identities and copies text only", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /activityRevision\.current \+= 1;[\s\S]*?activityBuffer\.current\.push\(\{\s*id: activityRevision\.current,/,
  );
  assert.match(
    source,
    /if \(activityBuffer\.current\.length > 200\) activityBuffer\.current\.shift\(\)/,
  );
  assert.match(source, /<li key=\{line\.id\}>\{line\.text\}<\/li>/);
  assert.match(source, /activityBuffer\.current\.map\(\(line\) => line\.text\)\.join\("\\n"\)/);
  assert.match(source, /setTimeout\(flushActivity, 250\)/);
  assert.doesNotMatch(source, /activityRevision\.current\s*=\s*0/);
});

// 检查真实处理器的关闭条件与等待顺序；不声称已运行浏览器目录选取器。
// Check the actual handler's close condition and await ordering, not a real directory-picker run.
test("terminal folder cancellation releases the captured packager before clearing busy state", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const choose = source.slice(
    source.indexOf("async function choose()"),
    source.indexOf("function prepareDownload"),
  );
  assert.match(choose, /const jobPackager = packager\.current/);
  assert.match(
    choose,
    /if \(controller\.signal\.aborted && current\(\)\)\s*\{[\s\S]*?await jobPackager\?\.close\(\)/,
  );
  const cleanup = choose.indexOf("await jobPackager?.close()");
  assert.ok(cleanup > 0);
  assert.match(choose.slice(cleanup), /if \(current\(\)\)\s*\{\s*setBusy\(false\)/);
});
