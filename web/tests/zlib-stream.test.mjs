// 合成 ABI 生命周期检查与本地固定原生 zlib 字节检查分开报告；不将模拟当作 WASM 证明。
// Separate synthetic ABI lifecycle checks from pinned local native zlib byte checks; mocks are not WASM proof.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createZlibStream, ZLIB_STREAM_CHUNK_BYTES } from "../toolchain/png-codec-exact/codec.mjs";
const options = {
  maxInputBytes: 4 * ZLIB_STREAM_CHUNK_BYTES,
  maxOutputBytes: 5 * ZLIB_STREAM_CHUNK_BYTES,
};
const collect = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};
async function* source(...parts) {
  yield* parts;
}
function fixture() {
  let active = false;
  const calls = [];
  const stream = createZlibStream({
    begin() {
      if (active) throw new Error("busy");
      active = true;
      calls.push("begin");
    },
    push(bytes, finish) {
      calls.push([bytes.length, finish]);
      return finish ? new Uint8Array([9]) : bytes.slice();
    },
    abort() {
      active = false;
      calls.push("abort");
    },
  });
  return {
    stream,
    calls,
    get active() {
      return active;
    },
  };
}

test("mock ABI: lazy start, backpressure, empty chunks and one final finish", async () => {
  const f = fixture();
  let pulls = 0;
  const input = {
    async *[Symbol.asyncIterator]() {
      pulls++;
      yield new Uint8Array([1, 2]);
      pulls++;
      yield new Uint8Array(0);
      pulls++;
      yield new Uint8Array([3]);
    },
  };
  const stream = f.stream(input, options);
  assert.equal(f.active, false);
  assert.deepEqual((await stream.next()).value, new Uint8Array([1, 2]));
  assert.equal(pulls, 1);
  assert.equal(f.active, true);
  assert.deepEqual(await collect(stream), Buffer.from([3, 9]));
  assert.deepEqual(f.calls, ["begin", [2, false], [1, false], [0, true], "abort"]);
  assert.equal(f.active, false);
  assert.deepEqual(await collect(f.stream(source(), options)), Buffer.from([9]));
});

test("mock ABI: return, throw, upstream failure and budget errors release the instance", async () => {
  for (const method of ["return", "throw"]) {
    const f = fixture();
    let returned = false;
    const input = {
      async *[Symbol.asyncIterator]() {
        try {
          yield new Uint8Array([1]);
          yield new Uint8Array([2]);
        } finally {
          returned = true;
        }
      },
    };
    const stream = f.stream(input, options);
    await stream.next();
    if (method === "throw") await assert.rejects(stream.throw(new Error("consumer")), /consumer/);
    else await stream.return();
    assert.equal(returned, true);
    assert.equal(f.active, false);
    assert.equal(f.calls.at(-1), "abort");
    assert.deepEqual(await collect(f.stream(source(), options)), Buffer.from([9]));
  }
  for (const [input, limits, pattern] of [
    [source(new Uint8Array(ZLIB_STREAM_CHUNK_BYTES + 1)), options, /bounded/],
    [source(new Uint8Array(2)), { ...options, maxInputBytes: 1 }, /input limit/],
    [source(new Uint8Array(2)), { ...options, maxOutputBytes: 1 }, /output limit/],
    [source(), { ...options, maxOutputBytes: 0 }, /output limit/],
    [
      {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error("upstream");
            },
          };
        },
      },
      options,
      /upstream/,
    ],
  ]) {
    const f = fixture();
    await assert.rejects(collect(f.stream(input, limits)), pattern);
    assert.equal(f.active, false);
    assert.equal(f.calls.at(-1), "abort");
  }
});

test("mock ABI: cancellation while upstream never resolves releases without waiting", async () => {
  const f = fixture(),
    controller = new AbortController();
  let requested = false,
    closed = false;
  const input = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          requested = true;
          return new Promise(() => {});
        },
        return() {
          closed = true;
          return new Promise(() => {});
        },
      };
    },
  };
  const pending = f.stream(input, { ...options, signal: controller.signal }).next();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requested, true);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await Promise.resolve();
  assert.equal(closed, true);
  assert.equal(f.active, false);
  assert.deepEqual(await collect(f.stream(source(), options)), Buffer.from([9]));
});

test("mock ABI: another stream cannot abort the current owner's state", async () => {
  const f = fixture(),
    first = f.stream(source(new Uint8Array([1])), options);
  await first.next();
  await assert.rejects(f.stream(source(), options).next(), /busy/);
  assert.equal(f.active, true);
  assert.equal(f.calls.filter((v) => v === "abort").length, 0);
  await first.return();
  assert.equal(f.active, false);
  for (const limits of [{}, { ...options, level: 6 }, { ...options, maxInputBytes: Infinity }])
    await assert.rejects(collect(f.stream(source(), limits)));
});

test("mock ABI: cancellation while yielded releases immediately without aborting a later stream", async () => {
  const f = fixture(),
    controller = new AbortController();
  const first = f.stream(source(new Uint8Array([1])), { ...options, signal: controller.signal });
  await first.next();
  controller.abort();
  assert.equal(f.active, false);
  const second = f.stream(source(new Uint8Array([2])), options);
  await second.next();
  assert.equal(f.active, true);
  await assert.rejects(first.next(), { name: "AbortError" });
  assert.equal(f.active, true);
  await second.return();
  assert.equal(f.active, false);
});

test("mock ABI: bounded output slices preserve backpressure and failure cleanup", async () => {
  let pulls = 0,
    released = 0;
  const stream = createZlibStream({
    begin() {},
    push(bytes, finish) {
      if (finish) return new Uint8Array(0);
      return new Uint8Array(ZLIB_STREAM_CHUNK_BYTES + 7).fill(bytes[0]);
    },
    abort() {
      released++;
    },
  });
  const input = {
    async *[Symbol.asyncIterator]() {
      pulls++;
      yield new Uint8Array([4]);
      pulls++;
      yield new Uint8Array([5]);
    },
  };
  const iterator = stream(input, options);
  const first = await iterator.next();
  assert.equal(first.value.length, ZLIB_STREAM_CHUNK_BYTES);
  const second = await iterator.next();
  assert.equal(second.value.length, 7);
  assert.equal(pulls, 1);
  assert.ok(second.value.every((value) => value === 4));
  await iterator.return();
  assert.equal(released, 1);
  const broken = createZlibStream({
    begin() {},
    push() {
      throw new Error("ABI rejected");
    },
    abort() {
      released++;
    },
  });
  await assert.rejects(collect(broken(source(new Uint8Array([1])), options)), /ABI rejected/);
  assert.equal(released, 2);
});

test("mock ABI: paused abort closes upstream once even if consumer abandons the iterator", async () => {
  const f = fixture(),
    controller = new AbortController();
  let closes = 0;
  const input = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { value: new Uint8Array([1]), done: false };
        },
        async return() {
          closes++;
          return { done: true };
        },
      };
    },
  };
  const first = f.stream(input, { ...options, signal: controller.signal });
  await first.next();
  controller.abort();
  await Promise.resolve();
  assert.equal(closes, 1);
  assert.equal(f.active, false);
  const second = f.stream(source(new Uint8Array([2])), options);
  await second.next();
  await first.return();
  assert.equal(closes, 1);
  assert.equal(f.active, true);
  await second.return();
});

test("mock ABI: hung or rejecting upstream cleanup cannot hide primary failures", async () => {
  for (const cleanup of ["hung", "reject", "throw"]) {
    for (const failure of ["input", "output", "abi", "upstream"]) {
      let closes = 0,
        releases = 0;
      const stream = createZlibStream({
        begin() {},
        push() {
          if (failure === "abi") throw new Error("primary ABI");
          return new Uint8Array([1]);
        },
        abort() {
          releases++;
        },
      });
      const input = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (failure === "upstream") throw new Error("primary upstream");
              return { done: false, value: new Uint8Array([1]) };
            },
            return() {
              closes++;
              if (cleanup === "throw") throw new Error("cleanup");
              return cleanup === "hung"
                ? new Promise(() => {})
                : Promise.reject(new Error("cleanup"));
            },
          };
        },
      };
      const limits = {
        ...options,
        maxInputBytes: failure === "input" ? 0 : options.maxInputBytes,
        maxOutputBytes: failure === "output" ? 0 : options.maxOutputBytes,
      };
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("blocked on cleanup")), 1000);
      });
      try {
        await assert.rejects(
          Promise.race([stream(input, limits).next(), timeout]),
          failure === "input"
            ? /input limit/
            : failure === "output"
              ? /output limit/
              : failure === "abi"
                ? /primary ABI/
                : /primary upstream/,
        );
      } finally {
        clearTimeout(timer);
      }
      assert.equal(closes, 1);
      assert.equal(releases, 1);
    }
  }
});

test("mock ABI: normal consumer return still awaits cooperative upstream closure", async () => {
  const f = fixture();
  let completeClose,
    closes = 0;
  const input = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: false, value: new Uint8Array([1]) };
        },
        return() {
          closes++;
          return new Promise((resolve) => {
            completeClose = resolve;
          });
        },
      };
    },
  };
  const stream = f.stream(input, options);
  await stream.next();
  let settled = false;
  const closing = stream.return().then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.active, false);
  assert.equal(closes, 1);
  assert.equal(settled, false);
  completeClose({ done: true });
  await closing;
  assert.equal(settled, true);
});

test("mock ABI: streaming rejects oversized backing buffers but accepts bounded subviews", async () => {
  const f = fixture();
  const oversized = new Uint8Array(new ArrayBuffer(ZLIB_STREAM_CHUNK_BYTES + 1), 0, 1);
  await assert.rejects(collect(f.stream(source(oversized), options)), /bounded zlib input chunk/);
  assert.deepEqual(f.calls, ["begin", "abort"]);
  const backing = new Uint8Array(ZLIB_STREAM_CHUNK_BYTES);
  backing.set([7, 8], 3);
  assert.deepEqual(
    await collect(f.stream(source(backing.subarray(3, 5)), options)),
    Buffer.from([7, 8, 9]),
  );
});

const native = fileURLToPath(
  new URL("../toolchain/png-codec-exact/dist/png_codec_native.so", import.meta.url),
);
test(
  "real local native ABI: fragmented input + separate empty finish preserves exact zlib bytes",
  { skip: !existsSync(native) },
  () => {
    const result = spawnSync(
      "python3",
      [
        "-c",
        String.raw`
import ctypes,sys,zlib,random
lib=ctypes.CDLL(sys.argv[1])
lib.png_input.restype=ctypes.c_void_p
lib.png_output.restype=ctypes.c_void_p
lib.generic_zlib_version.restype=ctypes.c_char_p
assert lib.generic_zlib_version()==b'1.2.13'
def encode(raw,step,separate):
    assert lib.zlib_begin(9)==0
    out=[]
    try:
        for off in range(0,len(raw),step):
            part=raw[off:off+step]
            ctypes.memmove(lib.png_input(),part,len(part))
            n=lib.zlib_push(len(part),int(not separate and off+step>=len(raw)))
            assert n>=0
            out.append(ctypes.string_at(lib.png_output(),n))
        if separate or not raw:
            n=lib.zlib_push(0,1)
            assert n>=0
            out.append(ctypes.string_at(lib.png_output(),n))
        return b''.join(out)
    finally: lib.zlib_abort()
rng=random.Random(1234)
for raw in [b'',b'a',bytes(range(256))*4097,rng.randbytes(2*1024*1024+17)]:
    expected=encode(raw,1024*1024,False)
    assert zlib.decompress(expected)==raw
    for step in [1 if len(raw)<2 else 8191,65536,1024*1024]:
        assert encode(raw,step,True)==expected
print('Pinned native zlib1.2.13: four deterministic inputs, three fragment sizes, exact byte equality')
`,
        native,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /exact byte equality/);
  },
);
