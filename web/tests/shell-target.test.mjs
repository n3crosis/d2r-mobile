// 验证 shell-target 的约定与边界；依据 ../shell-target.mjs 及本文件的测试断言。
// Verify shell-target contracts and boundaries against ../shell-target.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { inspectMachOTarget, createShellTargetInspector } from "../shell-target.mjs";
function fixture() {
  const b = new Uint8Array(64),
    v = new DataView(b.buffer);
  for (const [offset, value] of [
    [0, 0xfeedfacf],
    [4, 0x0100000c],
    [12, 2],
    [16, 1],
    [20, 32],
    [32, 0x32],
    [36, 32],
    [40, 2],
    [44, 0x1a0000],
    [48, 0x1a0500],
    [52, 1],
  ])
    v.setUint32(offset, value, true);
  return b;
}
test("observes target from bounded thin arm64 Mach-O, including sliced buffers", () => {
  const raw = fixture(),
    padded = new Uint8Array(100);
  padded.set(raw, 3);
  assert.deepEqual(inspectMachOTarget(padded.subarray(3, 67)), {
    platform: "ios",
    minimumVersion: "26.0.0",
  });
});
test("rejects unsupported and malformed load commands instead of trusting a recipe", () => {
  for (const [offset, value] of [
    [0, 0xcafebabe],
    [4, 7],
    [12, 6],
    [16, 4097],
    [20, 0xffffff],
    [32, 0x25],
    [36, 0],
    [36, 31],
    [40, 7],
    [44, 0],
    [52, 129],
  ]) {
    const b = fixture();
    new DataView(b.buffer).setUint32(offset, value, true);
    assert.throws(() => inspectMachOTarget(b));
  }
  assert.throws(() => inspectMachOTarget(new Uint8Array(31)));
});
test("verified reader supplies executable bytes and cancellation blocks reads", async () => {
  const inspect = createShellTargetInspector({ executablePath: "Game" });
  const context = {
    base: "Payload/Game.app/",
    entries: [{ path: "Payload/Game.app/Game", mode: 0o100755 }],
    readEntry: async (path) => {
      assert.equal(path, "Payload/Game.app/Game");
      return fixture();
    },
  };
  assert.equal((await inspect(context)).minimumVersion, "26.0.0");
  await assert.rejects(
    inspect({
      ...context,
      signal: AbortSignal.abort(),
      readEntry: () => assert.fail("read after abort"),
    }),
  );
  for (const executablePath of ["../Game", "a/b", ".", ""])
    assert.throws(() => createShellTargetInspector({ executablePath }));
});
