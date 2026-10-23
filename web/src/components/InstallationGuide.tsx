// 浏览器生成前后的操作指南；阅读某一步不代表已在设备上完成。
// Preparation and installation guidance; viewing a step never marks device work complete.
import { t } from "../../i18n.mjs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const steps = [
  {
    title: "dmWebGuidePrepare",
    details: [
      "dmWebGuidePackages",
      "dmWebGuideExtracted",
      "dmWebGuideFolderAccess",
      "dmWebGuideTargets",
    ],
  },
  {
    title: "dmWebGuideGenerate",
    details: ["dmWebGuideExport", "dmWebGuideOutputs", "dmWebGuideLegacy"],
  },
  {
    title: "dmWebGuideInstall",
    details: [
      "dmWebGuideSignInstall",
      "dmWebGuideConnect",
      "dmWebGuideSideload",
      "dmWebGuideFirstLaunch",
    ],
  },
  {
    title: "dmWebGuideCopy",
    details: [
      "dmWebGuideDestination",
      "dmWebGuideTransfer",
      "dmWebGuideCopyWhole",
      "dmWebGuideRetry",
    ],
  },
] as const;

const extraDetails: Record<number, { title: string; details: string[] }> = {
  3: {
    title: "dmWebGuideSigningDetails",
    details: ["dmWebGuideWindowsSetup", "dmWebGuideTrust", "dmWebGuideRefresh", "dmWebGuideSigned"],
  },
  4: { title: "dmWebGuideTransferDetails", details: ["dmWebGuideZip"] },
};

const references: Record<number, { label: string; href: string }[]> = {
  3: [
    { label: "dmWebGuideSideloadlyLink", href: "https://sideloadly.io/" },
    { label: "dmWebGuideInstallerHelpLink", href: "https://sideloadly.io/faq" },
    {
      label: "dmWebGuideConfiguratorLink",
      href: "https://support.apple.com/guide/apple-configurator-mac/add-apps-to-a-device-cad4cd08c03/mac",
    },
  ],
  4: [
    { label: "dmWebGuideMacTransferLink", href: "https://support.apple.com/en-us/119585" },
    {
      label: "dmWebGuideWindowsTransferLink",
      href: "https://support.apple.com/guide/devices-windows/transfer-files-between-your-devices-mchl4bd77d3a/windows",
    },
    { label: "dmWebGuideUnzipLink", href: "https://support.apple.com/en-us/102532" },
  ],
};

export function InstallationGuide() {
  return (
    <Accordion type="single" collapsible className="rounded-xl border bg-muted/30 px-3 sm:px-4">
      <AccordionItem value="installation-guide" className="border-0">
        <AccordionTrigger className="min-h-11 py-3">{t("dmWebGuideTitle")}</AccordionTrigger>
        <AccordionContent className="space-y-4 pb-4">
          <p className="text-xs text-muted-foreground">{t("dmWebGuideIntro")}</p>
          <Accordion type="single" collapsible defaultValue="dmWebGuidePrepare">
            {steps.map((step, index) => (
              <AccordionItem key={step.title} value={step.title}>
                <AccordionTrigger className="min-h-11 py-3 text-sm">
                  <span>
                    {index + 1}. {t(step.title)}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-4 text-xs leading-relaxed text-muted-foreground">
                  <ul className="list-disc space-y-2 pl-4">
                    {step.details.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                  </ul>
                  {extraDetails[index + 1] && (
                    <Accordion type="single" collapsible className="mt-3 border-t">
                      <AccordionItem value="more" className="border-0">
                        <AccordionTrigger className="min-h-11 py-2 text-xs">
                          {t(extraDetails[index + 1].title)}
                        </AccordionTrigger>
                        <AccordionContent className="pb-0 text-xs leading-relaxed">
                          <ul className="list-disc space-y-2 pl-4">
                            {extraDetails[index + 1].details.map((key) => (
                              <li key={key}>{t(key)}</li>
                            ))}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                  {references[index + 1] && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t pt-3">
                      {references[index + 1].map(({ label, href }) => (
                        <a
                          key={href}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t(label)}
                        </a>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
