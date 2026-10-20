// 仅使用合成 Mach-O 前缀测试分块目标检查；不读取游戏或密钥。
// Exercise chunked target inspection using synthetic Mach-O prefixes only; no game or key input.
import test from "node:test";
import assert from "node:assert/strict";
import { inspectGuestTarget, inspectGuestPlist } from "../guest-target-stream.mjs";

import { guestInfoPlist } from "../guest-framework.mjs";

const expected = { platform: "ios", minimumVersion: "18.2.3", sdkVersion: "26.0.0" };
function fixture() {
  const bytes = new Uint8Array(96);
  const view = new DataView(bytes.buffer);
  const put = (offset, value) => view.setUint32(offset, value, true);
  put(0, 0xfeedfacf);
  put(4, 0x0100000c);
  put(12, 6);
  put(16, 2);
  put(20, 48);
  put(32, 0x19);
  put(36, 24);
  put(56, 0x32);
  put(60, 24);
  put(64, 2);
  put(68, 0x120203);
  put(72, 0x1a0000);
  return { bytes, put };
}
function entry(bytes, split = bytes.length, size = bytes.length) {
  return {
    size,
    async *chunks() {
      yield new Uint8Array();
      for (let at = 0; at < bytes.length; at += split) yield bytes.subarray(at, at + split);
    },
  };
}

test("all small chunk boundaries preserve headers, skipped commands and target", async () => {
  const { bytes } = fixture();
  for (let split = 1; split <= bytes.length; split++)
    assert.deepEqual(await inspectGuestTarget(entry(bytes, split)), expected);
});

test("target recognition still drains all payload chunks", async () => {
  const { bytes } = fixture();
  let drained = false;
  const source = {
    size: bytes.length,
    async *chunks() {
      yield bytes.subarray(0, 80);
      yield bytes.subarray(80);
      drained = true;
    },
  };
  assert.deepEqual(await inspectGuestTarget(source), expected);
  assert.equal(drained, true);
});

test("short, excess and invalid trailing chunks are rejected after valid target", async () => {
  const { bytes } = fixture();
  await assert.rejects(inspectGuestTarget(entry(bytes, 1, bytes.length + 1)), /GUEST_SIZE/);
  await assert.rejects(inspectGuestTarget(entry(bytes, 1, bytes.length - 1)), /GUEST_SIZE/);
  await assert.rejects(
    inspectGuestTarget({
      size: bytes.length,
      async *chunks() {
        yield bytes;
        yield [0];
      },
    }),
    /GUEST_SIZE/,
  );
});

test("malformed headers, command bounds and duplicate targets fail closed", async () => {
  const mutations = [
    (put) => put(0, 0),
    (put) => put(4, 0),
    (put) => put(12, 2),
    (put) => put(16, 4097),
    (put) => put(16, 3),
    (put) => put(16, 1),
    (put) => put(20, 1000),
    (put) => put(20, 49),
    (put) => put(36, 0),
    (put) => put(36, 9),
    (put) => put(36, 64),
    (put) => put(60, 16),
    (put) => put(64, 1),
    (put) => put(56, 0x19),
    (put) => {
      put(32, 0x32);
      put(40, 2);
    },
  ];
  for (const mutate of mutations) {
    const { bytes, put } = fixture();
    mutate(put);
    await assert.rejects(inspectGuestTarget(entry(bytes, 1)), /GUEST_TARGET/);
  }
});

test("truncated header and partial command prefix fail closed", async () => {
  await assert.rejects(inspectGuestTarget(entry(new Uint8Array(31), 1)), /GUEST_TARGET/);
  const { bytes, put } = fixture();
  put(16, 1);
  put(20, 7);
  await assert.rejects(inspectGuestTarget(entry(bytes, 1)), /GUEST_TARGET/);
});

test("cancellation and producer failures after target detection propagate", async () => {
  const { bytes } = fixture();
  const controller = new AbortController();
  await assert.rejects(
    inspectGuestTarget(
      {
        size: bytes.length,
        async *chunks() {
          yield bytes.subarray(0, 80);
          controller.abort();
          yield bytes.subarray(80);
        },
      },
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  );
  await assert.rejects(
    inspectGuestTarget({
      size: bytes.length,
      async *chunks() {
        yield bytes.subarray(0, 80);
        throw new Error("PRODUCER_FAILED");
      },
    }),
    /PRODUCER_FAILED/,
  );
});

test("large skipped command needs no command-sized parser allocation", async () => {
  const { bytes, put } = fixture();
  const commandSize = 8 * 1024 * 1024;
  put(20, commandSize + 24);
  put(36, commandSize);
  const block = new Uint8Array(65536);
  const source = {
    size: 32 + commandSize + 24,
    async *chunks() {
      yield bytes.subarray(0, 40);
      let remaining = commandSize - 8;
      while (remaining) {
        const length = Math.min(remaining, block.length);
        yield block.subarray(0, length);
        remaining -= length;
      }
      yield bytes.subarray(56, 80);
    },
  };
  assert.deepEqual(await inspectGuestTarget(source), expected);
});

test("invalid declared entry budgets fail before pulling", async () => {
  for (const size of [-1, 0.5, NaN, 128 * 1024 * 1024 + 1]) {
    await assert.rejects(
      inspectGuestTarget({
        size,
        chunks() {
          throw new Error("MUST_NOT_PULL");
        },
      }),
      /GUEST_MISSING/,
    );
  }
});

test("build tool counts exactly match command size and valid tool records stream", async () => {
  for (const count of [1, 2, 0xffffffff]) {
    const { bytes, put } = fixture();
    put(76, count);
    await assert.rejects(inspectGuestTarget(entry(bytes, 1)), /GUEST_TARGET/);
  }
  const { bytes, put } = fixture();
  put(20, 56);
  put(60, 32);
  await assert.rejects(inspectGuestTarget(entry(bytes, 1)), /GUEST_TARGET/);
  put(76, 1);
  put(80, 3);
  put(84, 0x1a0000);
  for (let split = 1; split <= bytes.length; split++)
    assert.deepEqual(await inspectGuestTarget(entry(bytes, split)), expected);
});

test("all legacy minimum-version commands reject even alongside a build target", async () => {
  for (const command of [0x24, 0x25, 0x2f, 0x30]) {
    const { bytes, put } = fixture();
    put(32, command);
    await assert.rejects(inspectGuestTarget(entry(bytes, 1)), /GUEST_TARGET/);
    put(32, 0x19);
    put(56, command);
    await assert.rejects(inspectGuestTarget(entry(bytes, 1)), /GUEST_TARGET/);
  }
});

test("expected SDK and parsed plist minimum must agree with the executable", async () => {
  const { bytes } = fixture();
  assert.deepEqual(
    await inspectGuestTarget(entry(bytes, 1), {
      expectedSdkVersion: "26.0",
      minimumOSVersion: "18.2.3",
    }),
    expected,
  );
  for (const options of [
    { expectedSdkVersion: "18.0.0" },
    { minimumOSVersion: "26.0" },
    ...[null, 26, "", "26.0.0.0", "65536.0", "26.256", "26.x", " 26.0"].flatMap((value) => [
      { expectedSdkVersion: value },
      { minimumOSVersion: value },
    ]),
  ])
    await assert.rejects(inspectGuestTarget(entry(bytes, 1), options), /GUEST_TARGET/);
});

test("canonical generated plist streams exactly and binds to the closed profile", async () => {
  for (const [profileId, minimumVersion] of [
    [undefined, "26.0.0"],
    ["v1.0.18-ios18", "18.0.0"],
  ]) {
    const bytes = new TextEncoder().encode(guestInfoPlist(undefined, { profileId }));
    for (const split of [1, 7, 32, bytes.length])
      assert.deepEqual(await inspectGuestPlist(entry(bytes, split), { profileId }), {
        minimumVersion,
      });
    const otherProfile = profileId ? undefined : "v1.0.18-ios18";
    await assert.rejects(
      inspectGuestPlist(entry(bytes), { profileId: otherProfile }),
      /GUEST_PLIST/,
    );
    await assert.rejects(
      inspectGuestPlist(entry(bytes, 1, bytes.length + 1), { profileId }),
      /GUEST_PLIST/,
    );
    await assert.rejects(
      inspectGuestPlist(entry(bytes.subarray(0, -1), 1, bytes.length), { profileId }),
      /GUEST_PLIST/,
    );
    const changed = bytes.slice();
    changed[changed.length - 2] ^= 1;
    await assert.rejects(inspectGuestPlist(entry(changed), { profileId }), /GUEST_PLIST/);
  }
});

test("plist validation rejects noncanonical XML, invalid size and producer behavior", async () => {
  const encoder = new TextEncoder();
  const canonical = guestInfoPlist();
  for (const text of [
    canonical + " ",
    canonical.replace("</dict>", "<key>MinimumOSVersion</key><string>18.0</string></dict>"),
    canonical.replace("26.0", "&#50;6.0"),
  ])
    await assert.rejects(inspectGuestPlist(entry(encoder.encode(text))), /GUEST_PLIST/);
  for (const size of [-1, NaN, 0.5, 16385])
    await assert.rejects(
      inspectGuestPlist({
        size,
        chunks() {
          assert.fail("Unexpected read");
        },
      }),
      /GUEST_PLIST/,
    );
  const bytes = encoder.encode(canonical);
  await assert.rejects(
    inspectGuestPlist({
      size: bytes.length,
      async *chunks() {
        yield bytes;
        yield [0];
      },
    }),
    /GUEST_PLIST/,
  );
  await assert.rejects(
    inspectGuestPlist({
      size: bytes.length,
      async *chunks() {
        yield bytes;
        yield new Uint8Array([0]);
      },
    }),
    /GUEST_PLIST/,
  );
  await assert.rejects(
    inspectGuestPlist({
      size: bytes.length,
      async *chunks() {
        yield bytes;
        throw new Error("PRODUCER_FAILED");
      },
    }),
    /PRODUCER_FAILED/,
  );
  const controller = new AbortController();
  await assert.rejects(
    inspectGuestPlist(
      {
        size: bytes.length,
        async *chunks() {
          yield bytes;
          controller.abort();
        },
      },
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  );
});
