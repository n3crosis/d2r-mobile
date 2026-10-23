// Static JSX/CSS checks only: no application rendering, browser or packaging runtime.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { compile } from "tailwindcss";
import { FRONTEND_NOTICES_FILE, writeFrontendNotices } from "../scripts/frontend-notices.mjs";
import { createPreviewManifest } from "../verification/preview-manifest.mjs";

const sourcePaths = ["../src/App.tsx", "../src/components/AppCustomizationFields.tsx"];
const sources = await Promise.all(
  sourcePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
const documents = sources.map((source, index) =>
  ts.createSourceFile(sourcePaths[index], source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
);
function elements(document) {
  const matches = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(document);
  return matches;
}
function attribute(node, name) {
  return node.attributes.properties.find(
    (entry) => ts.isJsxAttribute(entry) && entry.name.getText() === name,
  );
}
function enclosing(node, name) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === name)
      return parent.openingElement;
  }
}

test("form uses shadcn controls with explicit matching labels and compact disclosure triggers", () => {
  for (const document of documents) {
    const nodes = elements(document);
    const controls = nodes.filter((node) =>
      ["Input", "Checkbox", "NativeSelect"].includes(node.tagName.getText()),
    );
    const labels = nodes.filter((node) => node.tagName.getText() === "FieldLabel");
    assert.ok(controls.length > 0);
    for (const control of controls) {
      const id = attribute(control, "id")?.initializer?.getText();
      assert.ok(id, control.tagName.getText());
      assert.ok(
        labels.some((label) => attribute(label, "htmlFor")?.initializer?.getText() === id),
        id,
      );
    }
    assert.equal(
      nodes.filter((node) =>
        ["input", "select", "fieldset", "details", "summary"].includes(node.tagName.getText()),
      ).length,
      0,
    );
    for (const trigger of nodes.filter((node) => node.tagName.getText() === "AccordionTrigger")) {
      assert.match(attribute(trigger, "className").initializer.text, /min-h-11/);
    }
  }
});

test("signing files are always mounted and Advanced retains the icon input when closed", () => {
  let count = 0;
  for (const document of documents) {
    for (const input of elements(document).filter(
      (node) =>
        node.tagName.getText() === "Input" && attribute(node, "type")?.initializer?.text === "file",
    )) {
      count++;
      const accordionContent = enclosing(input, "AccordionContent");
      if (accordionContent) assert.ok(attribute(accordionContent, "forceMount"));
      else if (document !== documents[0]) {
        const appElements = elements(documents[0]);
        const customization = appElements.find(
          (node) =>
            node.tagName.getText() === "AppCustomizationFields" &&
            attribute(node, "section")?.initializer?.text === "advanced",
        );
        assert.ok(attribute(enclosing(customization, "AccordionContent"), "forceMount"));
      }
      assert.ok(attribute(input, "ref"));
      assert.ok(attribute(enclosing(input, "FieldSet"), "disabled"));
    }
  }
  assert.equal(count, 3);
  assert.match(sources[0], /\[&_\[data-slot=accordion-content\]\[data-state=closed\]\]:hidden/);
  assert.match(sources[0], /onValueChange=\{setOpenOptions\}/);
  assert.doesNotMatch(sources[0], /<AccordionItem value="signing"|\{signing && \(/);
  assert.match(sources[0], /useState<string\[\]>\(\[\]\)/);
});

test("existing Tailwind pipeline emits file, focus, closed-content and numbered-step utilities", async () => {
  const uiDirectory = new URL("../src/components/ui/", import.meta.url);
  const componentSources = await Promise.all(
    (await readdir(uiDirectory))
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => readFile(new URL(name, uiDirectory), "utf8")),
  );
  const candidates = new Set();
  for (const source of [...sources, ...componentSources]) {
    const document = ts.createSourceFile(
      "component.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (ts.isStringLiteral(node))
        for (const candidate of node.text.split(/\s+/)) candidates.add(candidate);
      ts.forEachChild(node, visit);
    }
    visit(document);
  }
  const tailwindRoot = new URL("../node_modules/tailwindcss/", import.meta.url).pathname;
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const compiler = await compile(css, {
    async loadStylesheet(id, base) {
      const path = id === "tailwindcss" ? resolve(tailwindRoot, "index.css") : resolve(base, id);
      assert.ok(path.startsWith(tailwindRoot));
      return { path, base: dirname(path), content: await readFile(path, "utf8") };
    },
  });
  const output = compiler.build([...candidates]);
  assert.match(output, /::file-selector-button/);
  assert.match(
    output,
    /\[data-slot=accordion-content\]\[data-state=closed\]\s*\{\s*display: none;/,
  );
  assert.match(output, /\.min-h-11\s*\{\s*min-height:/);
  assert.match(output, /focus-visible/);
  assert.match(output, /\.sm\\:grid-cols-2/);
  assert.doesNotMatch(output, /@(?:apply|theme|source)\b|@import\s/);
  const input = componentSources.find((source) => source.includes('data-slot="input"'));
  assert.match(input, /border-input/);
  assert.match(input, /disabled:opacity-50/);
  assert.match(input, /focus-visible:ring/);
  assert.match(input, /type === "file"/);
  assert.match(input, /file:bg-secondary/);
  assert.match(input, /file:px-3/);
  assert.match(input, /hover:file:bg-accent/);
  const accordion = componentSources.find((source) =>
    source.includes('data-slot="accordion-content"'),
  );
  assert.match(accordion, /cn\("px-1 pt-0 pb-4", className\)/);
  assert.match(sources[0], /native-select-wrapper\]\]:max-w-xs/);
  assert.match(sources[0], /sm:grid-cols-\[11rem_minmax\(0,1fr\)\]/);
  assert.match(css, /--primary: oklch\(0\.511 0\.096 186\.391\)/);
});

test("generated frontend notices preserve full upstream texts and are included in artifact inventory", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "frontend-notices-"));
  try {
    await writeFrontendNotices(directory);
    const notices = await readFile(resolve(directory, FRONTEND_NOTICES_FILE), "utf8");
    for (const path of ["../SHADCN_LICENSE.md", "../node_modules/lucide-react/LICENSE"]) {
      assert.ok(notices.includes(await readFile(new URL(path, import.meta.url), "utf8")));
    }
    await writeFile(
      resolve(directory, "index.html"),
      '<link href="./app.css"><script src="./app.js"></script>',
    );
    await writeFile(resolve(directory, "app.js"), "/* inert fixture */");
    await writeFile(resolve(directory, "app.css"), "body{color:black}");
    const manifest = await createPreviewManifest(pathToFileURL(`${directory}/`));
    const record = manifest.files.find((file) => file.path === FRONTEND_NOTICES_FILE);
    assert.equal(record.bytes, Buffer.byteLength(notices));
    assert.match(record.sha256, /^[0-9a-f]{64}$/);
    await writeFile(resolve(directory, "other-notices.txt"), "unapproved extra file");
    await assert.rejects(createPreviewManifest(pathToFileURL(`${directory}/`)), /allowlist/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
