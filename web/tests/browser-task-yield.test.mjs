// 使用受控调度器、端口和真实 Node 消息通道验证生命周期；不保证浏览器时序。
// Controlled schedulers/ports and a real Node channel test lifetimes, not browser timing.
import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { yieldBrowserTask } from "../browser-task-yield.mjs";

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fakeChannels(t, { post, close, construct } = {}) {
  const channels = [];
  replaceGlobal(
    t,
    "MessageChannel",
    class {
      constructor() {
        const port = () => ({
          onmessage: null,
          onmessageerror: null,
          closes: 0,
          close() {
            this.closes++;
            close?.(this);
          },
          postMessage(value) {
            post?.(value);
          },
        });
        this.port1 = port();
        this.port2 = port();
        channels.push(this);
        construct?.();
      }
    },
  );
  return channels;
}
function assertClean(channel, signal) {
  assert.equal(getEventListeners(signal, "abort").length, 0);
  for (const port of [channel.port1, channel.port2]) {
    assert.equal(port.closes, 1);
    assert.equal(port.onmessage, null);
    assert.equal(port.onmessageerror, null);
  }
}

test("already aborted calls allocate no channel and never invoke the scheduler", async (t) => {
  const controller = new AbortController(),
    reason = new Error("cancelled first");
  controller.abort(reason);
  replaceGlobal(t, "scheduler", {
    yield() {
      assert.fail("scheduler must not run");
    },
  });
  const channels = fakeChannels(t);
  await assert.rejects(
    yieldBrowserTask({ signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(channels.length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("callable scheduler is preferred with its receiver and removes the abort listener", async (t) => {
  const ready = deferred(),
    controller = new AbortController();
  let calls = 0,
    finished = false;
  const scheduler = {
    yield() {
      assert.equal(this, scheduler);
      calls++;
      return ready.promise;
    },
  };
  replaceGlobal(t, "scheduler", scheduler);
  const channels = fakeChannels(t);
  const pending = yieldBrowserTask({ signal: controller.signal }).then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(calls, 1);
  assert.equal(channels.length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  ready.resolve();
  await pending;
  assert.equal(finished, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("abort does not wait for the scheduler and its late rejection stays observed", async (t) => {
  const ready = deferred(),
    controller = new AbortController(),
    reason = new Error("cancelled");
  replaceGlobal(t, "scheduler", { yield: () => ready.promise });
  const pending = yieldBrowserTask({ signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  ready.reject(new Error("late scheduler rejection"));
  await Promise.resolve();
});

test("scheduler failures preserve their cause without a fallback or retained listener", async (t) => {
  const channels = fakeChannels(t),
    controller = new AbortController(),
    reason = new Error("scheduler failed");
  replaceGlobal(t, "scheduler", undefined);
  for (const yieldCall of [
    () => {
      throw reason;
    },
    () => Promise.reject(reason),
  ]) {
    globalThis.scheduler = { yield: yieldCall };
    await assert.rejects(
      yieldBrowserTask({ signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
  assert.equal(channels.length, 0);
});

test("abort after scheduler fulfillment but before async continuation still rejects", async (t) => {
  const ready = deferred(),
    controller = new AbortController(),
    reason = new Error("late abort");
  replaceGlobal(t, "scheduler", { yield: () => ready.promise });
  const pending = yieldBrowserTask({ signal: controller.signal });
  const aborting = ready.promise.then(() => controller.abort(reason));
  ready.resolve();
  await assert.rejects(pending, (error) => error === reason);
  await aborting;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("missing or noncallable scheduler uses a fresh one-shot channel and closes both ports", async (t) => {
  const channels = fakeChannels(t),
    controller = new AbortController();
  replaceGlobal(t, "scheduler", undefined);
  for (const scheduler of [undefined, { yield: false }]) {
    globalThis.scheduler = scheduler;
    let done = false;
    const pending = yieldBrowserTask({ signal: controller.signal }).then(() => {
      done = true;
    });
    const channel = channels.at(-1),
      receive = channel.port1.onmessage;
    await Promise.resolve();
    assert.equal(done, false);
    receive({ data: null });
    await pending;
    assert.equal(done, true);
    assertClean(channel, controller.signal);
    receive({ data: null });
    assertClean(channel, controller.signal);
  }
  assert.equal(channels.length, 2);
});

test("channel cancellation rejects promptly and ignores already queued delivery", async (t) => {
  replaceGlobal(t, "scheduler", undefined);
  const channels = fakeChannels(t),
    controller = new AbortController();
  const pending = yieldBrowserTask({ signal: controller.signal }),
    channel = channels[0],
    receive = channel.port1.onmessage;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assertClean(channel, controller.signal);
  receive({ data: null });
  assertClean(channel, controller.signal);
});

test("channel post failure closes both ports even when one close throws", async (t) => {
  replaceGlobal(t, "scheduler", undefined);
  const reason = new Error("post failed"),
    controller = new AbortController();
  const channels = fakeChannels(t, {
    post() {
      throw reason;
    },
    close() {
      throw new Error("close failed");
    },
  });
  await assert.rejects(
    yieldBrowserTask({ signal: controller.signal }),
    (error) => error === reason,
  );
  assertClean(channels[0], controller.signal);
});

test("channel message errors release ports and listeners", async (t) => {
  replaceGlobal(t, "scheduler", undefined);
  const channels = fakeChannels(t),
    controller = new AbortController();
  const pending = yieldBrowserTask({ signal: controller.signal });
  channels[0].port1.onmessageerror();
  await assert.rejects(pending, /Task yield message failed/);
  assertClean(channels[0], controller.signal);
});

test("abort during channel construction cleans up the late acquired ports", async (t) => {
  replaceGlobal(t, "scheduler", undefined);
  const controller = new AbortController(),
    channels = fakeChannels(t, {
      construct() {
        controller.abort();
      },
      post() {
        assert.fail("must not post after abort");
      },
    });
  await assert.rejects(yieldBrowserTask({ signal: controller.signal }), { name: "AbortError" });
  assertClean(channels[0], controller.signal);
});

test("real Node MessageChannel yields without a timer or persistent channel", async (t) => {
  replaceGlobal(t, "scheduler", undefined);
  replaceGlobal(t, "setTimeout", () => {
    assert.fail("timer fallback is not allowed");
  });
  let resumed = false;
  const pending = yieldBrowserTask().then(() => {
    resumed = true;
  });
  await Promise.resolve();
  assert.equal(resumed, false);
  await pending;
  assert.equal(resumed, true);
});
