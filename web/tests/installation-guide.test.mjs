// Static guide and notice checks only; no browser, compiler, game or device execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { catalog } from "../i18n-catalog.mjs";
import { IPA_SIGNING_LIMITS } from "../ipa-signing-contract.mjs";
import { writeFrontendNotices } from "../scripts/frontend-notices.mjs";

const guide = await readFile(
  new URL("../src/components/InstallationGuide.tsx", import.meta.url),
  "utf8",
);
const faq = await readFile(
  new URL("../src/components/PreparationFaq.tsx", import.meta.url),
  "utf8",
);

test("preparation is visible plain numbered text, not another component or disclosure", () => {
  const imports = [...guide.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["../../i18n.mjs"]);
  assert.match(guide, /<section aria-labelledby="preparation-heading"/);
  assert.match(guide, /<ol className="list-decimal/);
  for (const key of ["dmWebGuidePrepare", "dmWebGuideOptionalSigning", "dmWebGuideExpect"])
    assert.ok(guide.includes(key));
  assert.doesNotMatch(
    guide,
    /Accordion|<details|hidden|Stepper|Questionnaire|useState|useEffect|setTimeout|fetch\(|localStorage|onDrop|type="file"|completed=/,
  );
});

test("generation reminder stays visible beside Generate and sets expectations without a countdown", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /<p className="text-xs leading-relaxed text-muted-foreground">\s*\{t\("dmWebGenerationExpectation"\)\}\s*<\/p>/,
  );
  const reminder = app.indexOf('t("dmWebGenerationExpectation")');
  assert.ok(reminder > app.indexOf('t("dmWebGenerate")'));
  assert.ok(reminder < app.indexOf("{generationReadinessMessage && ("));
  assert.equal(
    catalog.dmWebGenerationExpectation[0],
    "Keep this tab in the foreground while generating. The first build may take 30 minutes or longer, depending on your computer.",
  );
  assert.match(
    catalog.dmWebGenerationExpectation[1],
    /生成期间.*标签页.*前台.*首次生成可能需要 30 分钟或更长时间.*取决于你的电脑/,
  );
});

test("only the short FAQ uses the existing Accordion, without adding a dependency", () => {
  const imports = [...faq.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["../../i18n.mjs", "@/components/ui/accordion"]);
  assert.match(faq, /<Accordion type="single" collapsible>/);
  assert.equal([...faq.matchAll(/\["dmWebFaq\w+Question"/g)].length, 6);
  assert.match(faq, /aria-labelledby="faq-heading"/);
});

test("all visible copy has English/Chinese translations and preparation avoids placeholder filenames", () => {
  for (const key of [...(guide + faq).matchAll(/"(dmWeb\w+)"/g)].map((match) => match[1])) {
    assert.equal(catalog[key]?.length, 2, key);
    assert.ok(
      catalog[key].every((text) => text.length > 0),
      key,
    );
    if (guide.includes(`"${key}"`))
      assert.doesNotMatch(catalog[key].join(" "), /UUID|<UUID>|Select a step|展开/);
  }
  assert.match(
    catalog.dmWebBrowserOnly[0],
    /entirely in your browser.*No Xcode, Python, \.NET installation, or command-line tools required/,
  );
  assert.match(
    catalog.dmWebGuideTargets[0],
    /iOS 26\+.*iOS 18\+.*BC texture support.*experimental.*unverified/,
  );
});

test("input preparation preserves the one-folder, optional-key/DLC and first-install rules", () => {
  assert.match(
    catalog.dmWebGuidePackages[0],
    /prod.keys at the root of one folder.*title.keys.*DLC is optional/,
  );
  assert.match(
    catalog.dmWebGuideExtracted[0],
    /merged ExeFS\/RomFS.*without keys.*not expansion.*automatically/,
  );
  assert.match(catalog.dmWebGuideFolderAccess[0], /read\/write/);
  assert.match(
    catalog.dmWebGuideExport[0],
    /first install.*off.*already on the device.*cannot check/,
  );
  assert.match(
    catalog.dmWebGuideOutputs[0],
    /separately inside the selected input folder.*not inside the IPA.*actual output names/,
  );
});

test("local signing preparation distinguishes certificate, private key, profile and password", () => {
  assert.match(catalog.dmWebGuideSigningIntro[0], /optional.*unsigned IPA output is the default/);
  assert.match(
    catalog.dmWebGuideIdentity[0],
    /certificate with its private key.*not a \.cer file alone.*Keychain Access.*password-protected P12/,
  );
  assert.match(
    catalog.dmWebGuideNewCertificate[0],
    /Apple Developer Program.*Account Holder\/Admin.*private key and CSR locally.*only the CSR.*Apple Distribution.*same key as P12/,
  );
  assert.match(
    catalog.dmWebGuideProfile[0],
    /device’s UDID.*App ID.*Ad Hoc.*same certificate.*device.*Bundle ID.*profile/,
  );
  assert.match(
    catalog.dmWebGuideSigningInputs[0],
    /P12 export password, not your Apple Account password.*passwordless.*cannot verify device eligibility/,
  );
  assert.match(catalog.dmWebGuidePrivateKey[0], /Keep your private key.*local.*Do not upload/);
  assert.match(
    catalog.dmWebFaqPrivacyAnswer[0],
    /not uploaded or included in the IPA.*profile is embedded/,
  );
  assert.match(
    catalog.dmWebFaqSigningAnswer[0],
    /local signing.*zsign.*still needs installation.*does not guarantee/,
  );
  for (const key of ["dmWebSigningIdentity", "dmWebSigningProfile", "dmWebGuideSigningInputs"])
    assert.doesNotMatch(catalog[key].join(" "), /4 MiB|4mb|4 MB/i);
  assert.equal(IPA_SIGNING_LIMITS.identityBytes, 4 * 1024 * 1024);
  assert.equal(IPA_SIGNING_LIMITS.profileBytes, 4 * 1024 * 1024);
  for (const url of [
    "https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request",
    "https://support.apple.com/guide/keychain-access/import-and-export-keychain-items-kyca35961/mac",
    "https://docs.openssl.org/3.0/man1/openssl-pkcs12/",
    "https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/",
  ])
    assert.ok(guide.includes(url));
  assert.doesNotMatch(
    guide + faq + JSON.stringify(catalog),
    /Sideloadly|sideloadly\.io|daisign\.lol/,
  );
});

test("postgeneration copy accepts actual names and does not imply signing installs the app", () => {
  for (const [key, count] of [
    ["dmWebResultInstall", 1],
    ["dmWebResultLaunch", 1],
    ["dmWebResultCopy", 2],
  ])
    for (const value of catalog[key]) assert.equal((value.match(/%s/g) ?? []).length, count, key);
  assert.match(catalog.dmWebResultInstall[0], /Signing and installation are separate/);
  assert.match(catalog.dmWebResultUnsigned[0], /unsigned.*before installing/);
  assert.match(catalog.dmWebResultSkipped[0], /matching resources already on your device/);
  assert.match(catalog.dmWebResultIncomplete[0], /incomplete.*Do not copy/);
  assert.match(catalog.dmWebResultLegacyIncomplete[0], /Do not copy/);
  assert.match(
    catalog.dmWebGuideSigned[0],
    /profile must cover your device.*Apple Configurator.*does not install/,
  );
  assert.match(
    catalog.dmWebGuideTransfer[0],
    /Finder.*whole resource folder.*Apple Devices.*not signing\/installing an unsigned IPA/,
  );
  assert.match(
    catalog.dmWebGuideZip[0],
    /zip the complete folder.*extra ZIP wrapper.*space for both/,
  );
  assert.match(
    catalog.dmWebGuideRetry[0],
    /copying to finish.*Retry.*does not need NSP\/XCI or key files/,
  );
  assert.match(
    catalog.dmWebGuideRefresh[0],
    /Do not delete the app.*saves and resources can be removed/,
  );
  assert.doesNotMatch(catalog.dmWebGuideRefresh[0], /7 days/);
});

test("removed community component and license remain absent from source and notices", async () => {
  for (const path of ["../src/components/ui/stepper.tsx", "../REUI_LICENSE.md"])
    await assert.rejects(access(new URL(path, import.meta.url)), { code: "ENOENT" });
  const provenance = await readFile(new URL("../SHADCN_PROVENANCE.md", import.meta.url), "utf8");
  assert.doesNotMatch(provenance, /ReUI|reui|community Stepper/);
  assert.match(provenance, /plain, always-visible numbered text/);
  assert.match(provenance, /FAQ reuses the existing official shadcn Accordion/);
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
