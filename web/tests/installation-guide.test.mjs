// Static source and isolated navigation checks only; no browser, compiler, game or device execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { catalog } from "../i18n-catalog.mjs";
import { writeFrontendNotices } from "../scripts/frontend-notices.mjs";

const guide = await readFile(
  new URL("../src/components/InstallationGuide.tsx", import.meta.url),
  "utf8",
);
const stepper = await readFile(
  new URL("../src/components/ui/stepper.tsx", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "stepper.tsx",
  stepper,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function declaration(name) {
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1, name);
  return matches[0].initializer;
}

test("guide uses the attributed community Stepper with a compact disclosure and four linked panels", () => {
  assert.match(guide, /<Accordion type="single" collapsible/);
  assert.match(guide, /<Stepper defaultValue=\{1\}/);
  assert.match(guide, /<StepperNav aria-label=/);
  assert.match(guide, /<StepperItem[\s\S]*?completed=\{false\}/);
  assert.match(guide, /<StepperContent[\s\S]*?forceMount/);
  assert.match(guide, /<StepperSeparator/);
  const titles = [
    ...guide
      .slice(guide.indexOf("const steps ="), guide.indexOf("] as const;"))
      .matchAll(/title: "(dmWebGuide\w+)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(titles, [
    "dmWebGuidePrepare",
    "dmWebGuideGenerate",
    "dmWebGuideInstall",
    "dmWebGuideCopy",
  ]);
  for (const key of [...guide.matchAll(/"(dmWebGuide\w+)"/g)].map((match) => match[1])) {
    assert.equal(catalog[key]?.length, 2, key);
    assert.ok(
      catalog[key].every((text) => text.length > 0),
      key,
    );
  }
  assert.doesNotMatch(
    guide,
    /useEffect|setTimeout|fetch\(|localStorage|onDrop|type="file"|completed=\{true\}/,
  );
});

test("browsing a later guide step cannot auto-complete earlier manual steps", () => {
  const state = declaration("state").getText(parsed);
  for (let activeStep = 1; activeStep <= 4; activeStep++) {
    for (let step = 1; step <= 4; step++) {
      assert.equal(
        vm.runInNewContext(state, { step, activeStep, completed: false }),
        step === activeStep ? "active" : "inactive",
      );
    }
  }
  assert.equal(
    vm.runInNewContext(state, { step: 1, activeStep: 4, completed: undefined }),
    "completed",
    "upstream default is retained outside the guide",
  );
});

test("real keyboard handler supports arrow, Home/End and explicit panel activation", () => {
  const callback = declaration("handleKeyDown");
  const code = `(${callback.parameters.map((parameter) => parameter.name.getText(parsed)).join(",")}) => ${callback.body.getText(parsed)}`;
  for (const [key, expected] of [
    ["ArrowRight", "next"],
    ["ArrowDown", "next"],
    ["ArrowLeft", "prev"],
    ["ArrowUp", "prev"],
    ["Home", "first"],
    ["End", "last"],
    ["Enter", "select"],
    [" ", "select"],
  ]) {
    const calls = [];
    const handler = vm.runInNewContext(code, {
      myIdx: 2,
      step: 3,
      focusNext: () => calls.push("next"),
      focusPrev: () => calls.push("prev"),
      focusFirst: () => calls.push("first"),
      focusLast: () => calls.push("last"),
      setActiveStep: (step) => {
        assert.equal(step, 3);
        calls.push("select");
      },
    });
    handler({ key, preventDefault: () => calls.push("prevent") });
    assert.deepEqual(calls, ["prevent", expected]);
  }
});

test("tablist is limited to navigation and stable IDs connect tabs to hidden retained panels", () => {
  const root = stepper.slice(
    stepper.indexOf("function Stepper("),
    stepper.indexOf("interface StepperItemProps"),
  );
  const nav = stepper.slice(
    stepper.indexOf("function StepperNav("),
    stepper.indexOf("function StepperPanel("),
  );
  const content = stepper.slice(stepper.indexOf("function StepperContent("));
  assert.doesNotMatch(root, /role="tablist"/);
  assert.match(root, /const id = useId\(\)/);
  assert.match(nav, /role="tablist"/);
  assert.match(nav, /aria-orientation=\{orientation\}/);
  assert.match(stepper, /const id = `\$\{stepperCtx.id\}-tab-\$\{step\}`/);
  assert.match(stepper, /const panelId = `\$\{stepperCtx.id\}-panel-\$\{step\}`/);
  assert.match(content, /role="tabpanel"/);
  assert.match(content, /aria-labelledby=\{`\$\{id\}-tab-\$\{value\}`\}/);
  assert.match(content, /hidden=\{!isActive && forceMount\}/);
  assert.match(stepper, /if \(node\) return registerTrigger\(node\)/);
});

test("guide copy distinguishes local output from manual device installation and resource copying", () => {
  assert.match(
    catalog.dmWebOutputCompatibility[0],
    /iOS 26\+ by default.*iOS 18\+ compatibility.*Selected: %s/,
  );
  assert.match(
    catalog.dmWebGuideTargets[0],
    /iOS 26\+.*iOS 18\+.*BC texture support.*experimental.*unverified/,
  );
  assert.match(
    catalog.dmWebGuidePackages[0],
    /prod.keys at the root of one folder.*title.keys.*DLC is optional/,
  );
  assert.match(
    catalog.dmWebGuideExtracted[0],
    /already-merged ExeFS\/RomFS.*without keys.*not expansion/,
  );
  assert.match(catalog.dmWebGuideFolderAccess[0], /read\/write/);
  assert.match(
    catalog.dmWebGuideExport[0],
    /first install.*off.*already on the device.*cannot check/,
  );
  assert.match(
    catalog.dmWebGuideOutputs[0],
    /D2RMobile-unsigned\.ipa.*D2RMobile-signed\.ipa.*inside the input folder.*D2R-resources-<UUID>\/data\/.*not inside the IPA/,
  );
  assert.match(catalog.dmWebGuideLegacy[0], /LegacyDevicePack-<UUID>.*copy/);
  assert.match(catalog.dmWebGuideDestination[0], /Files.*On My iPhone \/ iPad.*custom app name/);
  assert.match(
    catalog.dmWebGuideCopyWhole[0],
    /entire completed.*preserving its name and inner data folder.*incomplete export/,
  );
  assert.match(
    catalog.dmWebGuideRetry[0],
    /copying to finish.*Retry.*does not need NSP\/XCI or key files/,
  );
});

test("installation instructions separate IPA signing from asset file sharing and retain official help links", () => {
  assert.match(
    catalog.dmWebGuideSignInstall[0],
    /Unsigned IPA.*Sideloadly for Mac or Windows.*signs the IPA and installs it/,
  );
  assert.match(
    catalog.dmWebGuideWindowsSetup[0],
    /web-download iTunes and iCloud.*not the Microsoft Store/,
  );
  assert.match(catalog.dmWebGuideConnect[0], /USB.*Trust.*select the device/);
  assert.match(
    catalog.dmWebGuideSideload[0],
    /Drag the IPA.*Apple ID Sideload.*Start to sign and install.*never on this page/,
  );
  assert.match(catalog.dmWebGuideTrust[0], /Developer Mode.*VPN & Device Management/);
  assert.match(
    catalog.dmWebGuideRefresh[0],
    /every 7 days.*back up saves.*Do not delete the app.*saves and resources can be removed/,
  );
  assert.match(catalog.dmWebGuideSigned[0], /profile must cover your device.*Apple Configurator/);
  assert.match(
    catalog.dmWebGuideTransfer[0],
    /Finder.*drag the whole resource folder onto the app name.*Apple Devices.*not signing\/installing an unsigned IPA/,
  );
  assert.match(
    catalog.dmWebGuideZip[0],
    /If whole-folder transfer is unavailable.*zip the complete folder.*drag the ZIP.*extra ZIP wrapper.*space for both/,
  );
  for (const url of [
    "https://sideloadly.io/",
    "https://sideloadly.io/faq",
    "https://support.apple.com/en-us/119585",
    "https://support.apple.com/en-us/102532",
  ])
    assert.ok(guide.includes(url));
});

test("production notices retain the ReUI MIT license in full without running a frontend build", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "reui-notices-"));
  try {
    await writeFrontendNotices(directory);
    const license = await readFile(new URL("../REUI_LICENSE.md", import.meta.url), "utf8");
    assert.match(license, /Copyright \(c\) 2025 Keenthemes Inc/);
    assert.ok(
      (await readFile(resolve(directory, "third-party-notices.txt"), "utf8")).includes(license),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
