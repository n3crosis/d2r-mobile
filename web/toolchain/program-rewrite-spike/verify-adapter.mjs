import { Buffer } from "node:buffer";
/* Node/browser parity helper; called only with a local synthetic fixture server. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export async function verifyGuestAdapter(page) {
  const results = await page.evaluate(async () => {
    const { createProgramRewriterAdapter } = await import("/program-rewriter-adapter.mjs");
    const catalog = await (await fetch("/fixtures/trusted-synthetic-catalog.json")).json();
    const results = [];
    let created = 0,
      closed = 0;
    const createWorker = () => {
      created++;
      const worker = new Worker("/worker.mjs", { type: "module" });
      let pending, timer;
      return {
        run(request) {
          return new Promise((resolve, reject) => {
            pending = reject;
            timer = setTimeout(() => reject(new Error("Synthetic worker timeout")), 120000);
            worker.onmessage = ({ data }) => {
              clearTimeout(timer);
              pending = undefined;
              resolve(data);
            };
            worker.onerror = () => {
              clearTimeout(timer);
              pending = undefined;
              reject(new Error("Synthetic worker failure"));
            };
            worker.postMessage({ id: "adapter", ...request });
          });
        },
        close() {
          closed++;
          clearTimeout(timer);
          worker.terminate();
          pending?.(new Error("Synthetic worker closed"));
          pending = undefined;
        },
      };
    };
    for (const version of catalog.versions) {
      const bytes = new Uint8Array(
        await (await fetch(`/fixtures/${version.id}.nso`)).arrayBuffer(),
      );
      const adapter = createProgramRewriterAdapter({
        trustedCatalog: catalog,
        createWorker,
        resolveInput: () => ({ versionId: version.id, bytes }),
      });
      const entries = await adapter.generateProgram({ extracted: {}, selection: {} });
      const output = {};
      for (const entry of entries) {
        const chunks = [];
        for await (const chunk of entry.chunks()) chunks.push(...chunk);
        output[entry.path] = { bytes: chunks, mode: entry.mode, signature: entry.signature };
      }
      await adapter.dispose();
      results.push({ id: version.id, output });
    }
    const expectCode = async (action, expected) => {
      try {
        await action();
      } catch (error) {
        if (error.code === expected) return;
        throw error;
      }
      throw new Error(`Expected ${expected}`);
    };
    await expectCode(
      () =>
        createProgramRewriterAdapter({
          trustedCatalog: { ...catalog, scope: "production" },
          createWorker,
          resolveInput: () => {},
        }),
      "PROGRAM_TRUSTED_CATALOG_REQUIRED",
    );
    const mutated = new Uint8Array(await (await fetch("/fixtures/gates.nso")).arrayBuffer());
    mutated[0x50] ^= 1;
    const invalid = createProgramRewriterAdapter({
      trustedCatalog: catalog,
      createWorker,
      resolveInput: () => ({ versionId: "gates", bytes: mutated }),
    });
    await expectCode(() => invalid.generateProgram(), "PROGRAM_INPUT_DIGEST_MISMATCH");
    await invalid.dispose();
    const validBytes = new Uint8Array(await (await fetch("/fixtures/gates.nso")).arrayBuffer());
    const tamperedOutput = createProgramRewriterAdapter({
      trustedCatalog: catalog,
      resolveInput: () => ({ versionId: "gates", bytes: validBytes }),
      createWorker: () => {
        const base = createWorker();
        return {
          close: () => base.close(),
          async run(request) {
            const result = await base.run(request);
            result.files["main.patched.bin"][0] ^= 1;
            return result;
          },
        };
      },
    });
    await expectCode(() => tamperedOutput.generateProgram(), "PROGRAM_OUTPUT_DIGEST_MISMATCH");
    await tamperedOutput.dispose();
    const abortController = new AbortController();
    const cancelled = createProgramRewriterAdapter({
      trustedCatalog: catalog,
      createWorker,
      resolveInput: () => new Promise(() => {}),
    });
    const cancelledRun = cancelled.generateProgram({ signal: abortController.signal });
    abortController.abort();
    await expectCode(() => cancelledRun, "PROGRAM_CANCELLED");
    await cancelled.dispose();
    if (created !== catalog.versions.length + 1 || closed !== created)
      throw new Error("Worker lifecycle or early rejection failed");
    return results;
  });
  for (const result of results) {
    const guest = result.output["Frameworks/Guest.framework/Guest"];
    assert.equal(guest.mode, 0o755);
    assert.equal(guest.signature.kind, "ad-hoc");
    assert.deepEqual(
      Buffer.from(guest.bytes),
      await readFile(new URL(`./oracle-guest/${result.id}/Guest.framework/Guest`, import.meta.url)),
    );
    assert.deepEqual(
      Buffer.from(result.output["Frameworks/Guest.framework/Info.plist"].bytes),
      await readFile(
        new URL(`./oracle-guest/${result.id}/Guest.framework/Info.plist`, import.meta.url),
      ),
    );
    for (const suffix of ["fixups", "gates", "cuts"])
      assert.deepEqual(
        Buffer.from(result.output[`dm/main.${suffix}.tsv`].bytes),
        await readFile(new URL(`./oracle/${result.id}/main.${suffix}.tsv`, import.meta.url)),
      );
  }
  return {
    syntheticOnly: true,
    guestNativeParityCases: results.length,
    trustedCatalogRequired: true,
    corruptedWorkerOutputRejected: true,
    inputWaitCancellation: true,
    changedInputRejectedBeforeWorker: true,
  };
}
