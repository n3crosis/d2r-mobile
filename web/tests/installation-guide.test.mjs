// Static guide and notice checks only; no browser, compiler, game or device execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { catalog } from "../i18n-catalog.mjs";
import { writeFrontendNotices } from "../scripts/frontend-notices.mjs";

const guide = await readFile(
  new URL("../src/components/InstallationGuide.tsx", import.meta.url),
  "utf8",
);

test("guide uses only the existing Accordion with four plain numbered step labels", () => {
  const imports = [...guide.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["../../i18n.mjs", "@/components/ui/accordion"]);
  assert.match(guide, /<Accordion type="single" collapsible defaultValue="dmWebGuidePrepare">/);
  assert.match(guide, /<AccordionItem key=\{step.title\} value=\{step.title\}>/);
  assert.match(guide, /\{index \+ 1\}\. \{t\(step.title\)\}/);
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
  assert.doesNotMatch(
    guide,
    /Stepper|Questionnaire|useState|useEffect|setTimeout|fetch\(|localStorage|onDrop|type="file"|completed=/,
  );
});

test("guide preserves bilingual instructions, optional details and the no-auto-completion warning", () => {
  for (const key of [...guide.matchAll(/"(dmWebGuide\w+)"/g)].map((match) => match[1])) {
    assert.equal(catalog[key]?.length, 2, key);
    assert.ok(
      catalog[key].every((text) => text.length > 0),
      key,
    );
  }
  assert.match(guide, /extraDetails\[index \+ 1\]/);
  assert.match(guide, /dmWebGuideSigningDetails/);
  assert.match(guide, /dmWebGuideTransferDetails/);
  assert.match(catalog.dmWebGuideIntro[0], /does not mark installation or copying complete/);
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

test("removed community component and license are absent from source and generated notices", async () => {
  for (const path of ["../src/components/ui/stepper.tsx", "../REUI_LICENSE.md"])
    await assert.rejects(access(new URL(path, import.meta.url)), { code: "ENOENT" });
  const provenance = await readFile(new URL("../SHADCN_PROVENANCE.md", import.meta.url), "utf8");
  assert.doesNotMatch(provenance, /ReUI|reui|community Stepper/);
  assert.match(provenance, /existing official shadcn Accordion/);
  assert.match(provenance, /Overall generation Progress/);
  const directory = await mkdtemp(resolve(tmpdir(), "guide-notices-"));
  try {
    await writeFrontendNotices(directory);
    const notices = await readFile(resolve(directory, "third-party-notices.txt"), "utf8");
    assert.doesNotMatch(notices, /ReUI|Keenthemes/);
    for (const path of ["../SHADCN_LICENSE.md", "../node_modules/lucide-react/LICENSE"])
      assert.ok(notices.includes(await readFile(new URL(path, import.meta.url), "utf8")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
