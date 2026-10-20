import factory from "./dist/hactool-boundary.mjs";
import { createBoundary } from "./browser-boundary.mjs";
const assert = (ok) => {
  if (!ok) throw new Error("Synthetic assertion failed");
};
function fixture(name, payload) {
  const names = new TextEncoder().encode(`${name}\0`);
  const header = new Uint8Array(40 + names.length);
  header.set([80, 70, 83, 48]);
  const view = new DataView(header.buffer);
  view.setUint32(4, 1, true);
  view.setUint32(8, names.length, true);
  view.setBigUint64(24, BigInt(payload.length), true);
  header.set(names, 40);
  return new Blob([header, payload]);
}
let stage = "module-initialization";
try {
  let wasm;
  const boundary = await createBoundary(async (options) => {
    wasm = await factory(options);
    return wasm;
  });
  // Code has loaded. No further network API is permitted during operations.
  globalThis.fetch = () => {
    throw new Error("Unexpected network operation");
  };
  stage = "crypto-fixture";
  assert(boundary.cryptoFixture() === 0);
  const prod = new TextEncoder().encode(`header_key = ${"0123456789abcdef".repeat(4)}\n`);
  const title = new TextEncoder().encode(`${"11".repeat(16)} = ${"22".repeat(16)}\n`);
  stage = "explicit-key-loading";
  boundary.loadKeys(prod, title);
  assert(prod.every((b) => b === 0) && title.every((b) => b === 0));
  assert(!boundary.secretFilesPresent());
  stage = "blob-pfs0-mount";
  const payload = new Uint8Array(3 * 65536 + 17);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  boundary.mount([fixture("synthetic.cnmt", payload)]);
  assert(boundary.open(0, "synthetic-pfs0") === 1);
  assert(boundary.entry(0).size === BigInt(payload.length));
  stage = "bounded-output";
  let received = 0,
    calls = 0;
  await boundary.streamEntry(0, async (chunk) => {
    assert(chunk.length <= 65536);
    for (let i = 0; i < chunk.length; i++) assert(chunk[i] === payload[received + i]);
    received += chunk.length;
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 1));
  });
  assert(received === payload.length && calls === 4);
  let rejected = false;
  try {
    boundary.read(0, 0n, 65537);
  } catch {
    rejected = true;
  }
  assert(rejected);
  const controller = new AbortController();
  controller.abort();
  rejected = false;
  try {
    await boundary.streamEntry(0, async () => {}, controller.signal);
  } catch {
    rejected = true;
  }
  assert(rejected);
  // A sparse synthetic read-only FS node exercises actual WASM off_t seeks
  // beyond 4 GiB without allocating or downloading a 5 GiB Blob. The regular
  // path above separately exercises real Blob/WORKERFS reads.
  stage = "sparse-64bit-seek";
  const sparse = new Uint8Array(await fixture("sparse.bin", new Uint8Array(1)).arrayBuffer());
  const sparseOffset = 5n * 1024n ** 3n;
  new DataView(sparse.buffer).setBigUint64(16, sparseOffset, true);
  boundary.mount([new Blob([sparse])]);
  const node = wasm.FS.lookupPath("/input/input-0").node;
  const payloadAt = BigInt(sparse.length - 1) + sparseOffset;
  node.size = Number(payloadAt + 1n);
  node.stream_ops = {
    ...node.stream_ops,
    read(stream, buffer, offset, length, position) {
      void stream;
      const count = Math.min(length, node.size - position);
      for (let i = 0; i < count; i++)
        buffer[offset + i] =
          position + i < sparse.length - 1
            ? sparse[position + i]
            : BigInt(position + i) === payloadAt
              ? 173
              : 0;
      return count;
    },
  };
  assert(boundary.open(0, "synthetic-pfs0") === 1);
  assert(boundary.entry(0).offset === sparseOffset);
  assert(boundary.read(0, 0n, 1)[0] === 173);
  // The production Meta entrypoint must reject an unsigned synthetic header.
  // There is no test-key override or skip-signature flag in that entrypoint.
  stage = "unsigned-meta-rejection";
  const unsignedHeader = new Uint8Array(0xc00);
  unsignedHeader.set([78, 67, 65, 51], 0x200);
  unsignedHeader[0x205] = 1;
  new DataView(unsignedHeader.buffer).setBigUint64(0x208, 0xc00n, true);
  boundary.mount([new Blob([unsignedHeader])]);
  assert(boundary.inspect(0).fixedSignatureValid === false);
  rejected = false;
  try {
    boundary.open(0, "meta");
  } catch {
    rejected = true;
  }
  assert(rejected);
  stage = "path-rejection";
  boundary.mount([fixture("../unsafe", new Uint8Array(1))]);
  rejected = false;
  try {
    boundary.open(0, "synthetic-pfs0");
  } catch {
    rejected = true;
  }
  assert(rejected);
  stage = "disposal";
  boundary.dispose();
  self.postMessage({
    ok: true,
    checks: [
      "WASM crypto fixture",
      "explicit key paths and wiping",
      "WORKERFS synthetic PFS0",
      "bounded output/backpressure",
      "WASM sparse >4GiB seek",
      "unsigned Meta header rejected",
      "bounds/traversal/cancellation",
    ],
  });
} catch {
  // Never surface exception messages or stacks from a key-handling context.
  self.postMessage({ ok: false, error: "Synthetic WASM browser smoke failed", stage });
}
