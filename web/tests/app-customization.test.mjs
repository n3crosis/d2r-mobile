// 仅使用自造 plist、PNG 和惰性 ZIP 字节；不读取游戏、凭据或实际应用。
// Authored plist, PNG and lazy ZIP fixtures only; no games, credentials or real applications.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deflateSync, inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  normalizeAppCustomization,
  prepareAppCustomization,
  customizeUnsignedIpa,
} from "../app-customization.mjs";
import { readCustomizationPlist, writeCustomizationPlist } from "../app-customization-plist.mjs";
import { prepareCustomizationIcons, CUSTOM_ICON_FILES } from "../app-customization-icon.mjs";
import { inspectUnsignedSigningArchive, createSignedSigningArchive } from "../ipa-signing-zip.mjs";
const root = "Payload/Authored.app/";
const encode = (text) => new TextEncoder().encode(text);
const dict = (value) => Object.assign(Object.create(null), value);
const base = () =>
  dict({
    CFBundleIdentifier: "local.authored.original",
    CFBundlePackageType: "APPL",
    CFBundleExecutable: "Authored",
    CFBundleName: "Original",
    CFBundleDisplayName: "Original",
    CFBundleSpokenName: "Original",
    CFBundleShortVersionString: "1.0.0",
    CFBundleVersion: "1",
    MinimumOSVersion: "18.0",
    CFBundleIcons: dict({
      CFBundlePrimaryIcon: dict({
        CFBundleIconName: "AppIcon",
        CFBundleIconFiles: ["AppIcon60x60"],
      }),
      CFBundleAlternateIcons: dict({ stale: dict({ CFBundleIconName: "Stale" }) }),
    }),
    CFBundleIconName: "AppIcon",
    CFBundleIconsExtra: "not an icon key",
  });
const entry = (path, bytes, mode = 0o644) => ({
  path: root + path,
  size: bytes.length,
  mode,
  blob: new Blob([bytes]),
});
const fixtures = (plist = writeCustomizationPlist(base())) => [
  entry("Info.plist", plist),
  entry("Authored", new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]), 0o755),
  entry("Assets.car", encode("opaque immutable asset catalog")),
  entry("Frameworks/Guest.framework/Info.plist", encode("immutable guest plist")),
  entry("dm/compiled_shader_receipt.json", encode('{"authored":true}')),
  entry("romfs_overlay/inert", encode("immutable resource")),
];
const digest = async (blob) =>
  createHash("sha256")
    .update(new Uint8Array(await blob.arrayBuffer()))
    .digest("hex");
function python(code, input = "") {
  const run = spawnSync("python3", ["-c", code], {
    input,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}
function binaryFixture() {
  return new Uint8Array(
    Buffer.from(
      python(`import plistlib,base64,datetime
v={"CFBundleIdentifier":"local.authored.original","CFBundlePackageType":"APPL","CFBundleExecutable":"Authored","CFBundleDisplayName":"Original","CFBundleShortVersionString":"1.0.0","CFBundleVersion":"1","MinimumOSVersion":"26.0","Unicode":"中文 😀 & < >","Nested":{"__proto__":"ordinary key","items":[True,False,123,-1,1.25,b"\\x00\\xff",datetime.datetime(2020,1,2,3,4,5)]}}
print(base64.b64encode(plistlib.dumps(v,fmt=plistlib.FMT_BINARY)).decode())`).trim(),
      "base64",
    ),
  );
}
const crc = (bytes) => {
  let n = 0xffffffff;
  for (const b of bytes) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  }
  return (n ^ 0xffffffff) >>> 0;
};
function chunk(name, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(name, 4);
  out.set(data, 8);
  out.writeUInt32BE(crc(out.subarray(4, out.length - 4)), out.length - 4);
  return out;
}
function png({
  side = 256,
  channels = 3,
  transparent = false,
  filter = 0,
  width = side,
  interlace = 0,
  tail = false,
  trailingDeflate = false,
  invalidFilter = false,
  longDecoded = false,
  ancillary = [],
} = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = channels === 3 ? 2 : 6;
  header[12] = interlace;
  const stride = side * channels,
    raw = Buffer.alloc(side * (stride + 1) + (longDecoded ? 1 : 0));
  for (let y = 0; y < side; y++) {
    raw[y * (stride + 1)] = invalidFilter ? 5 : filter;
    for (let x = 0; x < stride; x++) {
      const value =
        channels === 4 && x % channels === 3
          ? transparent
            ? 254
            : 255
          : [40, 100, 170][x % channels];
      const a = x >= channels ? value : 0,
        b = y ? value : 0,
        c = x >= channels && y ? value : 0;
      const p = a + b - c,
        da = Math.abs(p - a),
        db = Math.abs(p - b),
        dc = Math.abs(p - c),
        predict = da <= db && da <= dc ? a : db <= dc ? b : c;
      raw[y * (stride + 1) + x + 1] = value - [0, a, b, (a + b) >> 1, predict][filter];
    }
  }
  let z = deflateSync(raw);
  if (trailingDeflate) z = Buffer.concat([z.subarray(0, -4), Buffer.from([0]), z.subarray(-4)]);
  return new Blob([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...ancillary.map((name) => chunk(name, Buffer.alloc(0))),
    chunk("IDAT", z),
    chunk("IEND", Buffer.alloc(0)),
    ...(tail ? [Buffer.from([0])] : []),
  ]);
}
async function pngOutput(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const side = bytes.readUInt32BE(16);
  let at = 8;
  const parts = [];
  while (at < bytes.length) {
    const size = bytes.readUInt32BE(at);
    assert.equal(crc(bytes.subarray(at + 4, at + 8 + size)), bytes.readUInt32BE(at + 8 + size));
    if (bytes.toString("ascii", at + 4, at + 8) === "IDAT")
      parts.push(bytes.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(parts));
  assert.equal(raw.length, side * (side * 3 + 1));
  return { side, raw };
}
test("default is byte-identical and blank values retain shell metadata without reading archive", async () => {
  const blob = new Blob(["not read"]);
  const options = await prepareAppCustomization({
    displayName: "",
    bundleIdentifier: undefined,
    version: "",
    buildVersion: "",
  });
  assert.deepEqual(options, {});
  assert.equal((await customizeUnsignedIpa(blob, options)).blob, blob);
  assert.equal(await prepareAppCustomization(options), options);
  await assert.rejects(customizeUnsignedIpa(blob, {}), /APP_CUSTOMIZATION_INVALID/);
});
test("field validation is closed, bounded and keeps release/build versions separate", () => {
  assert.deepEqual(
    normalizeAppCustomization({
      displayName: "My & 中文 😀",
      bundleIdentifier: "local.authored.My-App",
      version: "0.1.2",
      buildVersion: "9999.99.99",
    }),
    {
      displayName: "My & 中文 😀",
      bundleIdentifier: "local.authored.My-App",
      version: "0.1.2",
      buildVersion: "9999.99.99",
    },
  );
  for (const value of [null, [], { entitlements: {} }, { appPath: "elsewhere" }])
    assert.throws(() => normalizeAppCustomization(value), /APP_CUSTOMIZATION_INVALID/);
  for (const value of [" ", " Name", "Name ", "x\0", "x\n", "\ud800", "x".repeat(81)])
    assert.throws(() => normalizeAppCustomization({ displayName: value }), /NAME_INVALID/);
  for (const value of [
    "local",
    "local..app",
    ".app",
    "local.app.",
    "local.*",
    "local.app/name",
    "local_app.test",
    "local.😀",
    "x".repeat(256),
  ])
    assert.throws(() => normalizeAppCustomization({ bundleIdentifier: value }), /BUNDLE_INVALID/);
  for (const value of ["1", "1.2", "01.2.3", "1.2.3b1", "1.2.3.4", "1.2.-3", "1.2. 3"])
    assert.throws(() => normalizeAppCustomization({ version: value }), /VERSION_INVALID/);
  for (const value of ["0", "10000", "1.100", "1.01", "1.2.3.4", "1.2b1"])
    assert.throws(() => normalizeAppCustomization({ buildVersion: value }), /BUILD_INVALID/);
});
test("binary and XML plists round-trip standard typed data with independent Python parser", () => {
  const source = binaryFixture(),
    plist = readCustomizationPlist(source);
  assert.equal(plist.Unicode, "中文 😀 & < >");
  assert.equal(plist.Nested.__proto__, "ordinary key");
  const xml = writeCustomizationPlist(plist);
  assert.deepEqual(readCustomizationPlist(xml), plist);
  const result = python(
    `import plistlib,sys,base64
v=plistlib.loads(base64.b64decode(sys.stdin.read()))
assert v["Nested"]["items"][:5] == [True,False,123,-1,1.25]
assert v["Nested"]["items"][5] == b"\\x00\\xff"
assert v["Nested"]["items"][6].isoformat() == "2020-01-02T03:04:05"
assert v["Unicode"] == "中文 😀 & < >"
print("ok")`,
    Buffer.from(xml).toString("base64"),
  );
  assert.equal(result.trim(), "ok");
});
test("plist parser rejects malicious XML, duplicates, malformed references and budgets", () => {
  const wrap = (body) => encode(`<plist version="1.0">${body}</plist>`);
  for (const source of [
    wrap("<dict><key>x</key><string>1</string><key>x</key><string>2</string></dict>"),
    wrap("<dict><key>x</key><string>&unknown;</string></dict>"),
    wrap("<dict><key>x</key><string>&amp</string></dict>"),
    wrap("<dict><key>x</key><string>&#0;</string></dict>"),
    wrap("<dict><key>x</key><string><![CDATA[x]]></string></dict>"),
    encode(
      '<!DOCTYPE plist [<!ENTITY x SYSTEM "file:///private">]><plist version="1.0"><dict/></plist>',
    ),
    wrap("<dict><key>x</key><real>Infinity</real></dict>"),
    wrap("<dict><key>x</key><array>".repeat(34) + "</array></dict>".repeat(34)),
    new Uint8Array(1024 * 1024 + 1),
  ])
    assert.throws(() => readCustomizationPlist(source), /PLIST_INVALID/);
  for (const mutate of [
    (b) => b.subarray(0, -1),
    (b) => {
      b[b.length - 25] = 3;
      return b;
    },
    (b) => {
      b[b.length - 16] = 255;
      return b;
    },
  ])
    assert.throws(() => readCustomizationPlist(mutate(binaryFixture().slice())), /PLIST_INVALID/);
});
test("metadata transforms binary plist and preserves all unrelated payloads and input bytes", async () => {
  const initial = fixtures(binaryFixture()),
    original = await createSignedSigningArchive(initial),
    before = await digest(original);
  const result = await customizeUnsignedIpa(
    original,
    await prepareAppCustomization({
      displayName: "New & 中文",
      bundleIdentifier: "local.authored.changed",
      version: "2.4.6",
      buildVersion: "7.8.9",
    }),
  );
  assert.equal(result.changed, true);
  assert.equal(result.iconMode, "unchanged");
  assert.equal(await digest(original), before);
  const archive = await inspectUnsignedSigningArchive(result.blob),
    info = archive.entries.find((e) => e.path === root + "Info.plist"),
    parsed = readCustomizationPlist(new Uint8Array(await info.blob.arrayBuffer()));
  assert.equal(parsed.CFBundleIdentifier, "local.authored.changed");
  assert.equal(parsed.CFBundleDisplayName, "New & 中文");
  assert.equal(parsed.CFBundleName, "New & 中文");
  assert.equal(parsed.CFBundleShortVersionString, "2.4.6");
  assert.equal(parsed.CFBundleVersion, "7.8.9");
  assert.equal(parsed.MinimumOSVersion, "26.0");
  assert.equal(parsed.Unicode, "中文 😀 & < >");
  for (const e of initial.filter((e) => e.path !== info.path)) {
    const next = archive.entries.find((n) => n.path === e.path);
    assert.equal(await digest(next.blob), await digest(e.blob));
    assert.equal(next.mode, e.mode);
  }
  const onlyVersion = await customizeUnsignedIpa(
    original,
    await prepareAppCustomization({ version: "3.0.0" }),
  );
  const changed = await inspectUnsignedSigningArchive(onlyVersion.blob);
  const v = readCustomizationPlist(
    new Uint8Array(
      await changed.entries
        .find((e) => e.path.endsWith("Authored.app/Info.plist"))
        .blob.arrayBuffer(),
    ),
  );
  assert.equal(v.CFBundleVersion, "1");
});
test("icons decode all five PNG filters and opaque RGB/RGBA, then emit valid RGB sizes", async () => {
  for (const channels of [3, 4])
    for (const filter of [0, 1, 2, 3, 4]) {
      const icons = await prepareCustomizationIcons(png({ channels, filter }));
      assert.equal(icons.length, CUSTOM_ICON_FILES.length);
      for (let i = 0; i < icons.length; i++) {
        const { side, raw } = await pngOutput(icons[i].blob);
        assert.equal(side, CUSTOM_ICON_FILES[i][1]);
        assert.deepEqual([...raw.subarray(1, 4)], [40, 100, 170]);
        assert.deepEqual([...raw.subarray(-3)], [40, 100, 170]);
      }
    }
});
test("icons reject alpha, APNG, geometry, corruption, trailing streams and decompression excess", async () => {
  for (const options of [
    { channels: 4, transparent: true },
    { side: 255 },
    { side: 1025 },
    { width: 300 },
    { interlace: 1 },
    { invalidFilter: true },
    { tail: true },
    { trailingDeflate: true },
    { longDecoded: true },
    { ancillary: ["acTL"] },
    { ancillary: ["tRNS"] },
  ])
    await assert.rejects(prepareCustomizationIcons(png(options)), /ICON_INVALID/);
  const bytes = new Uint8Array(await png().arrayBuffer());
  bytes[20] ^= 1;
  await assert.rejects(prepareCustomizationIcons(new Blob([bytes])), /ICON_INVALID/);
  await assert.rejects(
    prepareCustomizationIcons(new Blob([new Uint8Array(4 * 1024 * 1024 + 1)])),
    /ICON_INVALID/,
  );
  await assert.rejects(
    prepareCustomizationIcons(new Blob(["<svg/>"], { type: "image/png" })),
    /ICON_INVALID/,
  );
});
test("icon references change coherently while Assets.car and old icon files stay immutable", async () => {
  const initial = [...fixtures(), entry("AppIcon60x60@2x.png", encode("original"))];
  const result = await customizeUnsignedIpa(
    await createSignedSigningArchive(initial),
    await prepareAppCustomization({ icon: png() }),
  );
  assert.equal(result.iconMode, "loose-png-only");
  const archive = await inspectUnsignedSigningArchive(result.blob),
    info = archive.entries.find((e) => e.path === root + "Info.plist"),
    p = readCustomizationPlist(new Uint8Array(await info.blob.arrayBuffer()));
  assert.equal(p.CFBundleIconName, undefined);
  assert.equal(p.CFBundleIcons.CFBundleAlternateIcons, undefined);
  assert.equal(p.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName, undefined);
  assert.equal(p.CFBundleIconsExtra, "not an icon key");
  for (const key of ["CFBundleIcons", "CFBundleIcons~ipad"])
    for (const name of p[key].CFBundlePrimaryIcon.CFBundleIconFiles)
      assert.ok(archive.entries.some((e) => e.path === root + name));
  for (const e of initial.filter((e) => e.path !== info.path))
    assert.equal(
      await digest(archive.entries.find((n) => n.path === e.path).blob),
      await digest(e.blob),
    );
});
test("signed/extension archives, localized overrides and name collisions fail closed", async () => {
  const metadata = await prepareAppCustomization({ displayName: "Changed" });
  for (const path of [
    "embedded.mobileprovision",
    "_CodeSignature/CodeResources",
    "PlugIns/Extra.appex/Info.plist",
  ])
    await assert.rejects(
      customizeUnsignedIpa(
        await createSignedSigningArchive([...fixtures(), entry(path, encode("fixture"))]),
        metadata,
      ),
      /CUSTOMIZATION_FAILED/,
    );
  await assert.rejects(
    customizeUnsignedIpa(
      await createSignedSigningArchive([
        ...fixtures(),
        entry("en.lproj/InfoPlist.strings", encode('"CFBundleDisplayName"="Other";')),
      ]),
      metadata,
    ),
    /LOCALIZED_METADATA/,
  );
  await assert.rejects(
    customizeUnsignedIpa(
      await createSignedSigningArchive([
        ...fixtures(),
        entry(CUSTOM_ICON_FILES[0][0], encode("existing")),
      ]),
      await prepareAppCustomization({ icon: png() }),
    ),
    /ARCHIVE_INVALID/,
  );
});
test("cancellation is preserved before prepare and archive output", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareAppCustomization({ icon: png() }, { signal: controller.signal }), {
    name: "AbortError",
  });
  await assert.rejects(
    customizeUnsignedIpa(
      new Blob(["test"]),
      await prepareAppCustomization({ displayName: "Cancelled" }),
      {
        signal: controller.signal,
      },
    ),
    { name: "AbortError" },
  );
});
test("browser integration customizes only after checked assembly and keeps native signing restrictions", () => {
  const browser = readFileSync(new URL("../browser-packager.mjs", import.meta.url), "utf8");
  assert.ok(
    browser.indexOf("prepareAppCustomization(appCustomization") < browser.indexOf("used = true"),
  );
  assert.ok(
    browser.indexOf("customizeUnsignedIpa(download.blob") > browser.indexOf("runPackagingJob({"),
  );
  assert.ok(browser.includes("committedDownloads.set(error, download)"));
});
test("binary reference expansion and serialized text have aggregate allocation budgets", () => {
  const bytes = new Uint8Array(
    Buffer.from(
      python(`import plistlib,base64
s="a"*100000
print(base64.b64encode(plistlib.dumps({"shared":[s]*20},fmt=plistlib.FMT_BINARY)).decode())`).trim(),
      "base64",
    ),
  );
  assert.ok(bytes.length < 110000);
  assert.throws(() => readCustomizationPlist(bytes), /PLIST_INVALID/);
  assert.throws(
    () => writeCustomizationPlist(dict({ repeated: Array(20).fill("a".repeat(100000)) })),
    /PLIST_INVALID/,
  );
});
test("archive customization reads large resources only in bounded slices, not whole archive", async () => {
  const initial = fixtures();
  const resource = new Blob(Array(128).fill(new Uint8Array(65536)));
  initial.push({
    path: root + "large-inert-resource",
    size: resource.size,
    mode: 0o644,
    blob: resource,
  });
  const original = await createSignedSigningArchive(initial);
  let largest = 0;
  class TrackedBlob extends Blob {
    arrayBuffer() {
      largest = Math.max(largest, this.size);
      assert.ok(this.size <= 4 * 1024 * 1024, `unexpected whole-file read ${this.size}`);
      return super.arrayBuffer();
    }
    slice(start, end, type) {
      return new TrackedBlob([super.slice(start, end, type)]);
    }
  }
  const result = await customizeUnsignedIpa(
    new TrackedBlob([original]),
    await prepareAppCustomization({ displayName: "Bounded" }),
  );
  assert.ok(result.changed);
  assert.equal(largest, 4 * 1024 * 1024);
});
test("signing still checks the final root identifier with no caller-selected native edits", () => {
  const bridge = readFileSync(
    new URL("../toolchain/zsign-wasm/prepare-source.py", import.meta.url),
    "utf8",
  );
  assert.ok(bridge.includes('fopen("/work/Payload/App.app/Info.plist", "rb")'));
  assert.ok(
    bridge.includes('zsa.ValidateProfileForBundle(infoPlist["CFBundleIdentifier"].as_string())'),
  );
  assert.ok(
    bridge.includes("!bundleVersion.empty() || !displayName.empty() || !entitlementsFile.empty()"),
  );
  const gate = readFileSync(
    new URL("../toolchain/zsign-wasm/profile-compatibility.inc", import.meta.url),
    "utf8",
  );
  assert.ok(gate.includes('entitlements["application-identifier"] = application'));
  assert.ok(gate.includes("D2RCertificateTeam(cert, team)"));
  assert.ok(gate.includes("D2RConcreteEntitlements(entitlements, 0, remaining)"));
});

test("a blank request cannot revoke an already committed archive on late cancellation", async () => {
  const options = await prepareAppCustomization({});
  const blob = new Blob(["already committed"]);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await customizeUnsignedIpa(blob, options, { signal: controller.signal })).blob,
    blob,
  );
});

test("binary negative zero survives the independent XML plist round-trip", () => {
  const bytes = new Uint8Array(
    Buffer.from(
      python(`import plistlib,base64
print(base64.b64encode(plistlib.dumps({"negativezero": -0.0},fmt=plistlib.FMT_BINARY)).decode())`).trim(),
      "base64",
    ),
  );
  const value = readCustomizationPlist(bytes),
    xml = writeCustomizationPlist(value);
  assert.match(new TextDecoder().decode(xml), /<real>-0<\/real>/);
  assert.deepEqual(readCustomizationPlist(xml), value);
  assert.equal(
    python(
      `import plistlib,base64,sys,math
v=plistlib.loads(base64.b64decode(sys.stdin.read()))
assert math.copysign(1.0,v["negativezero"]) == -1.0
print("ok")`,
      Buffer.from(xml).toString("base64"),
    ).trim(),
    "ok",
  );
});

test("binary dates outside supported four-digit XML years reject before serialization", () => {
  const bytes = new Uint8Array(
    Buffer.from(
      python(`import plistlib,base64,datetime,struct
v=plistlib.dumps({"future":datetime.datetime(2001,1,1)},fmt=plistlib.FMT_BINARY)
needle=b"\\x33"+b"\\x00"*8
assert v.count(needle)==1
seconds=(datetime.datetime(9999,12,31)-datetime.datetime(2001,1,1)).total_seconds()+86400
v=v.replace(needle,b"\\x33"+struct.pack(">d",seconds))
print(base64.b64encode(v).decode())`).trim(),
      "base64",
    ),
  );
  assert.throws(() => readCustomizationPlist(bytes), /PLIST_INVALID/);
});

test("near-budget malformed entity runs reject before entity substitution", () => {
  const bytes = encode(
    `<plist version="1.0"><dict><key>hostile</key><string>${"&".repeat(1024 * 1024 - 200)}</string></dict></plist>`,
  );
  assert.ok(bytes.length < 1024 * 1024);
  assert.throws(() => readCustomizationPlist(bytes), /PLIST_INVALID/);
  const source = readFileSync(new URL("../app-customization-plist.mjs", import.meta.url), "utf8");
  const start = source.indexOf("const unescape =");
  assert.ok(source.indexOf(".test(value)", start) < source.indexOf("value.replace", start));
});

test("binary string and key carriage returns survive conforming XML decoding", () => {
  const bytes = new Uint8Array(
    Buffer.from(
      python(`import plistlib,base64
print(base64.b64encode(plistlib.dumps({"line\\rkey": "a\\rb\\r\\nc"},fmt=plistlib.FMT_BINARY)).decode())`).trim(),
      "base64",
    ),
  );
  const value = readCustomizationPlist(bytes),
    xml = writeCustomizationPlist(value);
  assert.deepEqual(readCustomizationPlist(xml), value);
  assert.equal(value["line\rkey"], "a\rb\r\nc");
  assert.equal(
    python(
      `import plistlib,base64,sys
v=plistlib.loads(base64.b64decode(sys.stdin.read()))
assert v["line\\rkey"] == "a\\rb\\r\\nc"
print("ok")`,
      Buffer.from(xml).toString("base64"),
    ).trim(),
    "ok",
  );
});

test("XML literal CRLF and CR normalize but numeric carriage returns stay intact", () => {
  const bytes = encode(
    '<plist version="1.0"><dict><key>line\r\nkey</key><string>a\rb\r\nc&#13;d&#xD;e</string></dict></plist>',
  );
  const value = readCustomizationPlist(bytes);
  assert.equal(value["line\nkey"], "a\nb\nc\rd\re");
  assert.equal(
    python(
      `import plistlib,base64,sys
v=plistlib.loads(base64.b64decode(sys.stdin.read()))
assert v["line\\nkey"] == "a\\nb\\nc\\rd\\re"
print("ok")`,
      Buffer.from(bytes).toString("base64"),
    ).trim(),
    "ok",
  );
});
