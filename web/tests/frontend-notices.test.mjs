// 验证实际产物的许可证保留及输入边界；依据构建元数据和已安装包的原文。
// Verify emitted license preservation and input boundaries using metadata and installed originals.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { writeFrontendNotices } from "../scripts/frontend-notices.mjs";

const metadata = (inputs) => ({ outputs: { "app.js": { inputs } } });

test("frontend notices retain actual runtime and vendored license bytes, not unused dependencies", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "frontend-notices-"));
  try {
    await writeFrontendNotices(
      directory,
      metadata({
        "src/index.css": { bytesInOutput: 1 },
        "node_modules/react/index.js": { bytesInOutput: 1 },
        "node_modules/@radix-ui/react-compose-refs/dist/index.mjs": { bytesInOutput: 1 },
        "node_modules/react-dom/client.js": { bytesInOutput: 1 },
        "node_modules/scheduler/index.js": { bytesInOutput: 1 },
        "node_modules/@radix-ui/react-checkbox/dist/index.mjs": { bytesInOutput: 1 },
        "node_modules/class-variance-authority/dist/index.mjs": { bytesInOutput: 1 },
        "node_modules/clsx/dist/clsx.mjs": { bytesInOutput: 1 },
        "node_modules/tailwind-merge/dist/bundle-mjs.mjs": { bytesInOutput: 1 },
        "node_modules/lucide-react/dist/cjs/lucide-react.js": { bytesInOutput: 1 },
        "node_modules/typescript/lib/typescript.js": { bytesInOutput: 0 },
      }),
    );
    const notices = await readFile(resolve(directory, "third-party-notices.txt"), "utf8");
    for (const file of [
      "tailwindcss/LICENSE",
      "react/LICENSE",
      "react-dom/LICENSE",
      "scheduler/LICENSE",
      "@radix-ui/react-checkbox/LICENSE",
      "class-variance-authority/LICENSE",
      "clsx/license",
      "tailwind-merge/LICENSE.md",
      "lucide-react/LICENSE",
    ])
      assert.ok(
        notices.includes(
          await readFile(new URL(`../node_modules/${file}`, import.meta.url), "utf8"),
        ),
        file,
      );
    for (const file of ["SHADCN_LICENSE.md", "vendor/spark-md5-3.0.2/LICENSE2"])
      assert.ok(
        notices.includes(await readFile(new URL(`../${file}`, import.meta.url), "utf8")),
        file,
      );
    for (const name of [
      "react@",
      "react-dom@",
      "scheduler@",
      "@radix-ui/react-checkbox@",
      "class-variance-authority@",
    ])
      assert.ok(notices.includes(name));
    assert.match(notices, /react-compose-refs@1\.1\.2 \(shared upstream/);
    assert.ok(
      notices.includes(
        await readFile(new URL("../node_modules/radix-ui/LICENSE", import.meta.url), "utf8"),
      ),
    );
    assert.doesNotMatch(notices, /typescript@|oxlint@|bun-plugin-tailwind@/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("frontend notices fail closed on missing or malformed bundle metadata", async () => {
  for (const value of [
    undefined,
    {},
    { outputs: {} },
    metadata({}),
    metadata({ x: { bytesInOutput: -1 } }),
    { outputs: { x: {} } },
  ])
    await assert.rejects(writeFrontendNotices(tmpdir(), value), /metadata|inputs|contribution/);
});
