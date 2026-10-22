// 用规范 ZIP 的路径字节变更验证上传签名归档的目录大小写边界。
// Verify uploaded signing archive directory-case boundaries by changing canonical ZIP path bytes.
import test from "node:test";
import assert from "node:assert/strict";
import { writeZip } from "../zip-writer.mjs";
import { inspectUnsignedSigningArchive } from "../ipa-signing-zip.mjs";

async function archiveBytes(paths) {
  const parts = [];
  await writeZip(
    paths.map((path) => ({ path, size: 0, async *chunks() {} })),
    {
      async write(bytes) {
        parts.push(bytes.slice());
      },
      async close() {},
      async abort() {},
    },
  );
  return Buffer.concat(parts);
}

test("uploaded canonical unsigned IPA rejects differently cased implicit directories", async () => {
  const paths = [
    "Payload/Test.app/Info.plist",
    "Payload/Test.app/Resources/a",
    "Payload/Test.app/Resources/b",
  ];
  const bytes = await archiveBytes(paths);
  const archive = await inspectUnsignedSigningArchive(new Blob([bytes]));
  assert.deepEqual(
    archive.entries.map(({ path }) => path),
    paths,
  );

  // 同时修改本地头和中央目录名称，保持长度、CRC、偏移和其余规范布局不变。
  // Change both local and central names, preserving lengths, CRCs, offsets and the rest of the canonical layout.
  const name = Buffer.from("/Resources/b");
  let changed = 0;
  for (let at = bytes.indexOf(name); at !== -1; at = bytes.indexOf(name, at + name.length)) {
    bytes[at + 1] = "r".charCodeAt(0);
    changed++;
  }
  assert.equal(changed, 2);
  await assert.rejects(inspectUnsignedSigningArchive(new Blob([bytes])), /SIGNING_INPUT_INVALID/);
});

test("uploaded canonical unsigned IPA rejects deep implicit directory expansion", async () => {
  const path = "Payload/Test.app/" + "x_".repeat(30) + "file";
  const bytes = await archiveBytes(["Payload/Test.app/Info.plist", path]);
  assert.equal((await inspectUnsignedSigningArchive(new Blob([bytes]))).entries.length, 2);
  const original = Buffer.from(path),
    deep = Buffer.from(path.replaceAll("_", "/"));
  assert.equal(deep.length, original.length);
  assert.equal(deep.toString().split("/").length, 33);
  let changed = 0;
  for (
    let at = bytes.indexOf(original);
    at !== -1;
    at = bytes.indexOf(original, at + deep.length)
  ) {
    bytes.set(deep, at);
    changed++;
  }
  assert.equal(changed, 2);
  await assert.rejects(inspectUnsignedSigningArchive(new Blob([bytes])), /SIGNING_INPUT_INVALID/);
});
