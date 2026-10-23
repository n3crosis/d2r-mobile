import test from "node:test";
import assert from "node:assert/strict";
import { discoverGameFolder, discoverGameFiles } from "../game-input.mjs";
import { discoverNspFolder } from "../nsp-input.mjs";
const blob = (name, value = "synthetic", relative = `root/${name}`) =>
  Object.assign(new Blob([value]), { name, webkitRelativePath: relative });
function directory(entries) {
  return {
    kind: "directory",
    async *entries() {
      yield* entries;
    },
  };
}
const file = (value, reads = []) => ({
  kind: "file",
  async getFile() {
    reads.push(value.name);
    return value;
  },
});
function extracted({
  exefsName = "ExeFS",
  romfsName = "RomFS",
  files = ["main", "sdk"],
  reads = [],
} = {}) {
  return directory([
    [exefsName, directory(files.map((name) => [name, file(blob(name), reads)]))],
    [
      romfsName,
      directory([
        ["data", directory([["build_manifest.psv", file(blob("build_manifest.psv"), reads)]])],
      ]),
    ],
    [
      "unrelated",
      {
        kind: "directory",
        entries() {
          throw Error("Unrelated directory must not be enumerated");
        },
      },
    ],
    [
      "prod.keys",
      {
        kind: "file",
        getFile() {
          throw Error("Keys must not be opened in extracted mode");
        },
      },
    ],
  ]);
}
test("package mode finds NSP plus XCI, preserves required keys and old NSP API", async () => {
  const root = directory(
    ["base.xci", "update.nsp", "prod.keys"].map((name) => [name, file(blob(name))]),
  );
  const progress = [];
  const found = await discoverGameFolder(root, { onProgress: (event) => progress.push(event) });
  assert.equal(found.inputMode, "packages");
  assert.deepEqual(
    found.nsps.map((f) => f.name),
    ["base.xci", "update.nsp"],
  );
  assert.equal(progress.at(-1).nspCount, 2);
  assert.deepEqual(
    (await discoverNspFolder(root)).nsps.map((f) => f.name),
    ["update.nsp"],
  );
  await assert.rejects(discoverGameFolder(directory([["base.xci", file(blob("base.xci"))]])), {
    code: "MISSING_INPUT",
  });
});
test("extracted discovery reads metadata only, includes bounded file references and ignores keys", async () => {
  const reads = [],
    progress = [];
  const found = await discoverGameFolder(extracted({ reads }), {
    inputMode: "extracted",
    onProgress: (event) => progress.push(event),
  });
  assert.equal(found.inputMode, "extracted");
  assert.deepEqual(found.nsps, []);
  assert.deepEqual(
    found.exefs.map((f) => f.path),
    ["main", "sdk"],
  );
  assert.deepEqual(
    found.romfs.map((f) => f.path),
    ["data/build_manifest.psv"],
  );
  assert.equal(progress.at(-1).extractedFileCount, 3);
  assert.equal(reads.length, 3);
  assert.equal(Object.hasOwn(found, "prodKeys"), false);
});
test("extracted folder and FileList paths accept native casing and reject missing/ambiguous/unsafe aliases", async () => {
  await discoverGameFolder(extracted({ exefsName: "exefs", romfsName: "romfs" }), {
    inputMode: "extracted",
  });
  await assert.rejects(
    discoverGameFolder(extracted({ files: ["Main", "sdk"] }), { inputMode: "extracted" }),
    { code: "EXTRACTED_MISSING_INPUT" },
  );
  await assert.rejects(
    discoverGameFolder(
      directory([
        ["ExeFS", directory([])],
        ["exefs", directory([])],
      ]),
      { inputMode: "extracted" },
    ),
    { code: "EXTRACTED_NAME" },
  );
  await assert.rejects(
    discoverGameFolder(extracted({ files: ["../main", "sdk"] }), { inputMode: "extracted" }),
    { code: "EXTRACTED_NAME" },
  );
  const selected = ["ExeFS/main", "ExeFS/sdk", "RomFS/data/build_manifest.psv"].map((path) =>
    blob(path.split("/").at(-1), "synthetic", `root/${path}`),
  );
  assert.equal(discoverGameFiles(selected, { inputMode: "extracted" }).romfs.length, 1);
  assert.throws(
    () =>
      discoverGameFiles([...selected, blob("other", "x", "root/romfs/other")], {
        inputMode: "extracted",
      }),
    { code: "EXTRACTED_NAME" },
  );
  assert.throws(() => discoverGameFiles([...selected, selected[0]], { inputMode: "extracted" }), {
    code: "EXTRACTED_NAME",
  });
  assert.throws(
    () =>
      discoverGameFiles([blob("main", "x", "second/ExeFS/main"), ...selected], {
        inputMode: "extracted",
      }),
    { code: "DIRECTORY" },
  );
});
test("extracted cancellation does not wait for stalled metadata or enumeration", async () => {
  for (const kind of ["metadata", "enumeration"]) {
    const controller = new AbortController();
    const entered = Promise.withResolvers(),
      late = Promise.withResolvers();
    let closed = false;
    const root =
      kind === "metadata"
        ? directory([
            [
              "ExeFS",
              directory([
                [
                  "main",
                  {
                    kind: "file",
                    getFile() {
                      entered.resolve();
                      return late.promise;
                    },
                  },
                ],
              ]),
            ],
          ])
        : {
            kind: "directory",
            entries() {
              return {
                [Symbol.asyncIterator]() {
                  return this;
                },
                next() {
                  entered.resolve();
                  return late.promise;
                },
                return() {
                  closed = true;
                  return { done: true };
                },
              };
            },
          };
    const pending = discoverGameFolder(root, { inputMode: "extracted", signal: controller.signal });
    await entered.promise;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    late.reject(new Error("late synthetic error"));
    await new Promise((resolve) => setImmediate(resolve));
    if (kind === "enumeration") assert.equal(closed, true);
  }
});

test("recognized separate DLC layouts fail closed rather than imply authenticated absence", async () => {
  for (const name of [
    "DLC",
    "AddOnContent",
    "aoc",
    "Warlock",
    "Reign of the Warlock",
    "game [0100726014353001].nsp",
  ]) {
    const root = extracted();
    const original = root.entries.bind(root);
    root.entries = async function* () {
      yield* original();
      yield [name, directory([])];
    };
    await assert.rejects(discoverGameFolder(root, { inputMode: "extracted" }), {
      code: "EXTRACTED_DLC_UNSUPPORTED",
    });
    const files = ["ExeFS/main", "ExeFS/sdk", "RomFS/data/build_manifest.psv", `${name}/main`].map(
      (path) => blob(path.split("/").at(-1), "synthetic", `root/${path}`),
    );
    assert.throws(() => discoverGameFiles(files, { inputMode: "extracted" }), {
      code: "EXTRACTED_DLC_UNSUPPORTED",
    });
  }
});

test("ordinary nested Warlock-named resources do not imply a separate DLC layout", async () => {
  const paths = [
    "ExeFS/main",
    "ExeFS/sdk",
    "RomFS/data/build_manifest.psv",
    "RomFS/data/hd/warlock/0100726014353001.bin",
  ];
  const files = paths.map((path) => blob(path.split("/").at(-1), "synthetic", `root/${path}`));
  assert.equal(discoverGameFiles(files, { inputMode: "extracted" }).romfs.length, 2);
  const root = directory([
    ["ExeFS", directory(["main", "sdk"].map((name) => [name, file(blob(name))]))],
    [
      "RomFS",
      directory([
        [
          "data",
          directory([
            ["build_manifest.psv", file(blob("build_manifest.psv"))],
            ["warlock", directory([["0100726014353001.bin", file(blob("asset"))]])],
          ]),
        ],
      ]),
    ],
  ]);
  assert.equal((await discoverGameFolder(root, { inputMode: "extracted" })).romfs.length, 2);
});
