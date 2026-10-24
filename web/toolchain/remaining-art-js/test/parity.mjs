// 窄范围生产操作组合一致性，不使用浏览器或完整游戏输入。
// Narrow production operation composition parity. No browser/full game inputs.
import process from "node:process";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createImageKernels } from "../../image-kernels-rust/kernels.mjs";
import { createPngCodec } from "../../png-codec-exact/codec.mjs";
import * as numeric from "../../art-kernels/kernels.mjs";
import {
  createRemainingArtRecipes,
  supportsRemainingArtOperation,
  troveGeometry,
  troveSlots,
} from "../recipes.mjs";
const source = new URL("../../asset-generation-spike/public/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("vendor/pyodide/vendor-manifest.json", source)));
const dir = mkdtempSync(join(tmpdir(), "d2r-remaining-art-oracle-"));
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
try {
  for (const [name, digest] of Object.entries(manifest.sha256)) {
    const path = new URL("vendor/pyodide/" + name, source);
    assert.equal(hash(readFileSync(path)), digest);
    copyFileSync(path, join(dir, name));
  }
  const { loadPyodide } = await import(pathToFileURL(join(dir, "pyodide.mjs")));
  const python = await loadPyodide({ indexURL: dir + "/" });
  await python.loadPackage("pillow");
  python.registerJsModule("art_kernel_bridge", numeric);
  python.FS.mkdir("/oracle");
  for (const name of [
    "art_pixels",
    "remaining_art",
    "remaining_art_original",
    "trove_original",
    "mercenary",
    "mercenary_original",
  ])
    python.FS.writeFile(
      `/oracle/${name}.py`,
      readFileSync(new URL(`generated/${name}.py`, source)),
    );
  python.runPython(
    "import sys; sys.path.insert(0,'/oracle')\nimport io,json,base64\nfrom PIL import Image,features\nimport remaining_art,mercenary,trove_original\nassert Image.__version__=='10.2.0' and features.version('zlib')=='1.3.1'",
  );
  const pixels = await createImageKernels(
    readFileSync(new URL("../../image-kernels-rust/dist/image-kernels.wasm", import.meta.url)),
  );
  // 默认验证 JS 配方/像素正确性；--wasm 另证明新 PNG 编解码器。默认两侧使用同一固定 PNG 参考。
  // Default run isolates JS recipe/pixel correctness. --wasm additionally proves
  // the new PNG codec; default uses the same pinned PNG oracle for both sides.
  const png = process.argv.includes("--wasm")
    ? await createPngCodec(
        readFileSync(new URL("../../png-codec-exact/dist/png-codec.wasm", import.meta.url)),
      )
    : {
        encodeRgba(raw, width, height) {
          python.globals.set("png_raw", raw);
          python.globals.set("png_w", width);
          python.globals.set("png_h", height);
          const encoded = python.runPython(
            "png_out=io.BytesIO(); Image.frombytes('RGBA',(png_w,png_h),bytes(png_raw.to_py())).save(png_out,'PNG'); base64.b64encode(png_out.getvalue()).decode()",
          );
          return new Uint8Array(Buffer.from(encoded, "base64"));
        },
      };
  const api = createRemainingArtRecipes({ pixels, png, numeric });
  const rawImage = (width, height, seed = 0) => {
    const raw = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        raw[p] = (x * 17 + y * 3 + seed * 19) % 256;
        raw[p + 1] = (x * 7 + y * 13 + seed * 31) % 256;
        raw[p + 2] = (x * 5 + y * 23 + seed * 43) % 256;
        raw[p + 3] = (x * 11 + y * 29 + seed * 53) % 256;
      }
    return { width, height, data: raw };
  };
  const encodeImage = (im) => ({
    width: im.width,
    height: im.height,
    rgba: Buffer.from(im.data).toString("base64"),
  });
  let passed = 0;
  const records = [];
  function compare(operation, bundle, options) {
    const payload = new TextEncoder().encode(JSON.stringify(bundle));
    python.globals.set("payload", payload);
    python.globals.set("options_json", JSON.stringify(options));
    python.globals.set("operation", operation);
    const reference = JSON.parse(
      python.runPython(
        "r=(remaining_art if operation=='remaining-art' else mercenary).generate(bytes(payload.to_py()),json.loads(options_json)); json.dumps({'width':r['width'],'height':r['height'],'files':{k:base64.b64encode(v).decode() for k,v in r['files'].items()}})",
      ),
    );
    const actual = api.execute(operation, payload, options);
    assert.deepEqual([actual.width, actual.height], [reference.width, reference.height]);
    assert.deepEqual(Object.keys(actual.files).sort(), Object.keys(reference.files).sort());
    const outputs = {};
    for (const [name, b64] of Object.entries(reference.files)) {
      const expected = new Uint8Array(Buffer.from(b64, "base64"));
      assert.deepEqual(
        actual.files[name],
        expected,
        `${operation} ${JSON.stringify(options)} ${name}`,
      );
      outputs[name] = { bytes: expected.length, sha256: hash(expected) };
    }
    records.push({ operation, options, outputs });
    passed++;
    console.log(`Exact recipe ${passed}: ${operation} ${JSON.stringify(options)}`);
  }
  assert.deepEqual(
    troveGeometry(),
    JSON.parse(python.runPython("json.dumps(trove_original.geometry())")),
  );
  assert.deepEqual(
    troveSlots(),
    JSON.parse(python.runPython("json.dumps(trove_original.slots())")),
  );
  const stash = encodeImage(rawImage(652, 649, 1)),
    personal = encodeImage(rawImage(652, 649, 2));
  for (const name of ["StashPanelBG", "StashPanelBGPersonal", "StashPanelBGShared"])
    compare("remaining-art", { image: stash, personal }, { kind: "stash", name });
  compare(
    "remaining-art",
    { image: encodeImage(rawImage(652, 650, 3)), personal },
    { kind: "stash", name: "StashPanelBGPersonal" },
  );
  for (const name of ["AdvancedStash_Consumables_Console", "AdvancedStash_Runes_Console"])
    compare("remaining-art", { image: stash }, { kind: "advanced", name });
  compare(
    "remaining-art",
    {
      gems: stash,
      runes: personal,
      cons: encodeImage(rawImage(652, 649, 3)),
      character: encodeImage(rawImage(1369, 706, 4)),
    },
    { kind: "trove", name: "AdvancedStash_Gems_Console" },
  );
  for (const width of [507, 508])
    compare(
      "remaining-art",
      { image: encodeImage(rawImage(width, 700, 5)) },
      { kind: "pouch", name: "PouchBox" },
    );
  const vault = rawImage(848, 649, 6);
  for (let x = 342; x < 504; x++) vault.data.set([10, 10, 10, 255], (608 * 848 + x) * 4);
  for (let x = 262; x < 312; x++) vault.data.set([50, 60, 70, 255], (608 * 848 + x) * 4);
  compare("remaining-art", { image: encodeImage(vault) }, { kind: "vault", name: "VaultBottom" });
  const merc = {};
  for (const [i, [name, width, height]] of [
    ["hirelinginventory/v2/hirelinginventorybg", 652, 704],
    ["inventorypanel/v2/inventorybg_classic", 507, 700],
    ["mainpanelbg", 2888, 881],
  ].entries()) {
    const header = new Uint8Array(40),
      view = new DataView(header.buffer);
    header.set(new TextEncoder().encode("SpA1"));
    view.setUint16(4, 61, true);
    view.setUint16(6, width, true);
    view.setUint32(8, width, true);
    view.setUint32(12, height, true);
    merc[name] = {
      header: Buffer.from(header).toString("base64"),
      rgba: encodeImage(rawImage(width, height, i + 7)).rgba,
    };
  }
  compare("mercenary-art", merc, {});
  assert.equal(supportsRemainingArtOperation("remaining-art"), true);
  assert.equal(supportsRemainingArtOperation("hud-v4"), false);
  assert.throws(
    () =>
      api.execute("remaining-art", new TextEncoder().encode("{}"), {
        kind: "stash",
        name: "StashPanelBG",
      }),
    /INPUT_SET/,
  );
  assert.throws(
    () =>
      api.execute("remaining-art", new Uint8Array(21 * 1024 * 1024), {
        kind: "stash",
        name: "StashPanelBG",
      }),
    /LIMIT/,
  );
  assert.throws(
    () =>
      api.execute("remaining-art", new TextEncoder().encode(JSON.stringify({ image: stash })), {
        kind: "advanced",
        name: "no",
      }),
    /GEOMETRY/,
  );
  assert.deepEqual(
    records,
    JSON.parse(readFileSync(new URL("expected-output-hashes.json", import.meta.url))),
    "Pinned synthetic encoded/raw output hashes",
  );
  const out = new URL("../test-results/", import.meta.url);
  mkdirSync(out, { recursive: true });
  writeFileSync(
    new URL("parity.json", out),
    JSON.stringify(
      {
        cases: passed,
        geometry: true,
        numericBackend: "existing source-pinned JS kernels",
        pngBackend: process.argv.includes("--wasm") ? "dual-zlib WASM" : "bundled Pillow oracle",
        records,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `All ${passed} production recipe cases match; full bytes, dimensions, geometry and output sets.`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
