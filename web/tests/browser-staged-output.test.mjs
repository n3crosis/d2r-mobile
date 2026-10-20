// 根据 STAGED_OUTPUT_SCOPE.md，使用内存文件系统替身验证暂存输出的提交、取消和清理契约。
// Verify staged-output commit, cancellation, and cleanup contracts using an in-memory filesystem double, based on STAGED_OUTPUT_SCOPE.md.
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserStagedOutputAdapters } from "../browser-staged-output.mjs";
import { writeZip } from "../zip-writer.mjs";
import { writeZip64 } from "../zip64-writer.mjs";
import { planStagedZip } from "../staged-zip-validator.mjs";
const uuid = "12345678-1234-4123-8123-123456789abc",
  name = `d2rm-output-${uuid}.tmp`;
const manifest = [{ path: "Payload/Test.app/a", size: 3, mode: 0o100755 }];
const entries = [
  {
    ...manifest[0],
    mode: 0o755,
    async *chunks() {
      yield Uint8Array.of(1, 2, 3);
    },
  },
];
function environment(faults = {}) {
  const files = new Map([["unrelated", Uint8Array.of(9)]]),
    events = [];
  let committed = Uint8Array.of(7),
    stageBytes,
    destinationOpens = 0;
  const handle = (key, destination = false) => ({
    kind: "file",
    async queryPermission() {
      return faults.permission ?? "granted";
    },
    async getFile() {
      return new Blob([files.get(key)]);
    },
    async createWritable() {
      if (destination) destinationOpens++;
      const chunks = [];
      return {
        async write(bytes) {
          events.push(destination ? "destination-write" : "stage-write");
          if (faults[destination ? "destinationWrite" : "stageWrite"]) throw new Error("disk full");
          chunks.push(bytes.slice());
          if (destination) faults.onDestinationWrite?.();
        },
        async close() {
          events.push(destination ? "destination-close" : "stage-close");
          if (faults[destination ? "destinationClose" : "stageClose"])
            throw new Error("close failed");
          const data = new Uint8Array(Buffer.concat(chunks));
          if (destination) {
            committed = data;
            faults.onDestinationClose?.();
          } else {
            files.set(key, data);
            stageBytes = data;
          }
        },
        async abort() {
          events.push(destination ? "destination-abort" : "stage-abort");
          await faults[destination ? "onDestinationAbort" : "onStageAbort"]?.();
          if (faults[destination ? "destinationAbort" : "stageAbort"])
            throw new Error("abort failed");
        },
      };
    },
  });
  const storage = {
    async estimate() {
      return { usage: 0, quota: faults.quota ?? 10 ** 9 };
    },
    async getDirectory() {
      return {
        async getFileHandle(key, options) {
          if (!files.has(key) && !options?.create)
            throw new DOMException("missing", "NotFoundError");
          if (!files.has(key)) files.set(key, new Uint8Array());
          return handle(key);
        },
        async removeEntry(key) {
          events.push(`remove:${key}`);
          if (faults.remove) throw new Error("remove failed");
          files.delete(key);
        },
      };
    },
  };
  return {
    files,
    events,
    storage,
    destinationHandle: handle("destination", true),
    get committed() {
      return committed;
    },
    get stageBytes() {
      return stageBytes;
    },
    get destinationOpens() {
      return destinationOpens;
    },
  };
}
function adapters(env, format = "zip64", overrides = {}) {
  return createBrowserStagedOutputAdapters({
    destinationHandle: env.destinationHandle,
    storage: env.storage,
    secureContext: true,
    randomUUID: () => uuid,
    archiveFormat: format,
    maxOutputBytes: 1024 * 1024,
    ...overrides,
  });
}
async function writeStage(adapter, format = "zip64", signal) {
  const output = await adapter.createOutput({ manifest, signal });
  await (format === "zip64" ? writeZip64 : writeZip)(
    entries,
    { write: output.write, async close() {}, abort: output.abort },
    { maxTotalBytes: 1024 * 1024, signal },
  );
  return output;
}
for (const format of ["zip32", "zip64"])
  test(`${format}: validation precedes destination opening; cleanup precedes commit`, async () => {
    const env = environment(),
      adapter = adapters(env, format),
      output = await writeStage(adapter, format);
    await assert.rejects(output.close(), /OUTPUT_NOT_VALIDATED/);
    assert.equal((await adapter.validateArchive({ output, manifest })).valid, true);
    assert.equal(env.destinationOpens, 0);
    await assert.rejects(output.write(Uint8Array.of(0)), /OUTPUT_NOT_WRITABLE/);
    await output.close();
    await output.abort();
    assert.equal(
      env.committed.length,
      planStagedZip(manifest, { archiveFormat: format, maxOutputBytes: 1024 * 1024 }).totalBytes,
    );
    assert.deepEqual([...env.files.keys()], ["unrelated"]);
    assert.ok(env.events.indexOf(`remove:${name}`) < env.events.indexOf("destination-close"));
  });
test("quota, permission, capability and collisions fail without collateral cleanup", async () => {
  for (const faults of [{ quota: 0 }, { permission: "prompt" }]) {
    const env = environment(faults);
    await assert.rejects(adapters(env).createOutput({ manifest }));
    assert.deepEqual([...env.files.keys()], ["unrelated"]);
    assert.equal(env.destinationOpens, 0);
  }
  const env = environment();
  env.files.set(name, Uint8Array.of(42));
  await assert.rejects(adapters(env).createOutput({ manifest }), /OUTPUT_TEMP_COLLISION/);
  assert.deepEqual(env.files.get(name), Uint8Array.of(42));
  await assert.rejects(
    adapters(env, "zip64", { secureContext: false }).createOutput({ manifest }),
    /OUTPUT_OPFS_UNAVAILABLE/,
  );
});
test("short/excess archives and alien output/manifest fail closed", async () => {
  const env = environment(),
    adapter = adapters(env),
    output = await adapter.createOutput({ manifest });
  await assert.rejects(adapter.validateArchive({ output, manifest }), /OUTPUT_SHORT_ARCHIVE/);
  await assert.rejects(output.write(new Uint8Array(1024)), /OUTPUT_BYTE_LIMIT/);
  await assert.rejects(adapter.validateArchive({ output: {}, manifest }), /OUTPUT_NOT_OWNED/);
  await assert.rejects(
    adapter.validateArchive({ output, manifest: [] }),
    /OUTPUT_MANIFEST_MISMATCH/,
  );
  await output.abort();
  assert.equal(env.destinationOpens, 0);
  assert.deepEqual([...env.files.keys()], ["unrelated"]);
});
test("corrupted stage bytes and post-validation mutations cannot commit", async () => {
  for (const after of [false, true]) {
    const env = environment(),
      adapter = adapters(env);
    const output = after ? await writeStage(adapter) : await adapter.createOutput({ manifest });
    if (after) {
      await adapter.validateArchive({ output, manifest });
      env.stageBytes[0] ^= 1;
      await assert.rejects(output.close());
      assert.ok(!env.events.includes("destination-close"));
    } else {
      await output.write(
        new Uint8Array(
          planStagedZip(manifest, {
            archiveFormat: "zip64",
            maxOutputBytes: 1024 * 1024,
          }).totalBytes,
        ),
      );
      await assert.rejects(adapter.validateArchive({ output, manifest }));
    }
    await output.abort();
    assert.deepEqual(env.committed, Uint8Array.of(7));
    assert.deepEqual([...env.files.keys()], ["unrelated"]);
  }
});
test("transfer/cleanup failures, cancellation and late cancellation", async () => {
  for (const kind of ["destinationWrite", "destinationClose", "remove", "cancel", "lateCancel"]) {
    const controller = new AbortController(),
      faults = { [kind]: true };
    if (kind === "cancel") faults.onDestinationWrite = () => controller.abort();
    if (kind === "lateCancel") faults.onDestinationClose = () => controller.abort();
    const env = environment(faults),
      adapter = adapters(env),
      output = await writeStage(adapter, "zip64", controller.signal);
    await adapter.validateArchive({ output, manifest, signal: controller.signal });
    if (kind === "lateCancel") await output.close();
    else {
      await assert.rejects(output.close());
      assert.deepEqual(env.committed, Uint8Array.of(7));
      assert.ok(env.events.includes("destination-abort"));
    }
    faults.remove = false;
    await output.abort();
    assert.deepEqual([...env.files.keys()], ["unrelated"]);
  }
});
test("stage write/close failures and pre-cancellation never open destination", async () => {
  for (const kind of ["stageWrite", "stageClose"]) {
    const env = environment({ [kind]: true }),
      adapter = adapters(env);
    if (kind === "stageWrite") await assert.rejects(writeStage(adapter));
    else {
      const output = await writeStage(adapter);
      await assert.rejects(adapter.validateArchive({ output, manifest }));
      await output.abort();
    }
    assert.equal(env.destinationOpens, 0);
    assert.deepEqual([...env.files.keys()], ["unrelated"]);
  }
  const env = environment();
  await assert.rejects(adapters(env).createOutput({ manifest, signal: AbortSignal.abort() }));
  assert.deepEqual([...env.files.keys()], ["unrelated"]);
});

test("explicit abort during pending transfer cancels before commit", async () => {
  const faults = {},
    env = environment(faults),
    adapter = adapters(env);
  const output = await writeStage(adapter);
  await adapter.validateArchive({ output, manifest });
  let abortPromise;
  faults.onDestinationWrite = () => {
    abortPromise = output.abort();
  };
  await assert.rejects(output.close());
  await abortPromise;
  assert.deepEqual(env.committed, Uint8Array.of(7));
  assert.deepEqual([...env.files.keys()], ["unrelated"]);
  assert.ok(!env.events.includes("destination-close"));
});

test("oversized source chunks are rejected before staging write", async () => {
  const env = environment(),
    adapter = adapters(env),
    output = await adapter.createOutput({ manifest });
  await assert.rejects(output.write(new Uint8Array(4 * 1024 * 1024 + 1)), /OUTPUT_INVALID_CHUNK/);
  assert.ok(!env.events.includes("stage-write"));
  await output.abort();
});

test("failed writer aborts retain the stream for a later cleanup retry", async () => {
  for (const destination of [false, true]) {
    const kind = destination ? "destination" : "stage",
      faults = { [`${kind}Abort`]: true },
      env = environment(faults),
      adapter = adapters(env);
    const output = destination
      ? await writeStage(adapter)
      : await adapter.createOutput({ manifest });
    if (destination) {
      await adapter.validateArchive({ output, manifest });
      faults.destinationWrite = true;
      await assert.rejects(output.close(), /disk full/);
    }
    await assert.rejects(output.abort(), /OUTPUT_CLEANUP_FAILED/);
    const attempts = env.events.filter((event) => event === `${kind}-abort`).length;
    faults[`${kind}Abort`] = false;
    await output.abort();
    assert.equal(env.events.filter((event) => event === `${kind}-abort`).length, attempts + 1);
    await output.abort();
    assert.equal(env.events.filter((event) => event === `${kind}-abort`).length, attempts + 1);
    assert.deepEqual(env.committed, Uint8Array.of(7));
    assert.deepEqual([...env.files.keys()], ["unrelated"]);
  }
});

test("concurrent abort calls share cleanup instead of disposing a writer twice", async () => {
  let resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const env = environment({ onStageAbort: () => gate }),
    adapter = adapters(env),
    output = await adapter.createOutput({ manifest });
  const first = output.abort(),
    second = output.abort();
  resume();
  await Promise.all([first, second]);
  assert.equal(env.events.filter((event) => event === "stage-abort").length, 1);
  assert.equal(env.events.filter((event) => event === `remove:${name}`).length, 1);
  assert.deepEqual(env.committed, Uint8Array.of(7));
  assert.deepEqual([...env.files.keys()], ["unrelated"]);
});
