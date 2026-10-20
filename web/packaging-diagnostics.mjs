// 浏览器打包诊断：依据固定错误代码与共享界面文字表，不显示私密输入。
// Browser packaging diagnostics based on fixed error codes and the shared UI table, without private inputs.
import { t } from "./i18n.mjs";
import { extractionProgressLabel, isExtractionDiagnosticCode } from "./extraction-errors.mjs";
const reasons = Object.freeze({
  PROD_KEYS_MISSING: "dmWebReasonsProdKeysMissing",
  PROD_KEYS_UNREADABLE: "dmWebReasonsProdKeysUnreadable",
  PROD_KEYS_TOO_LARGE: "dmWebReasonsProdKeysTooLarge",
  PROD_KEYS_EMPTY: "dmWebReasonsProdKeysEmpty",
  PROD_KEYS_MALFORMED: "dmWebReasonsProdKeysMalformed",
  TITLE_KEY_REQUIRED: "dmWebReasonsTitleKeyRequired",
  TITLE_KEYS_MISSING: "dmWebReasonsTitleKeysMissing",
  TITLE_KEYS_UNREADABLE: "dmWebReasonsTitleKeysUnreadable",
  TITLE_KEYS_TOO_LARGE: "dmWebReasonsTitleKeysTooLarge",
  TITLE_KEYS_MALFORMED: "dmWebReasonsTitleKeysMalformed",
  KEYS_RUNTIME_FAILED: "dmWebReasonsKeysRuntimeFailed",
  PACKAGE_INDEX_INVALID: "dmWebReasonsPackageIndexInvalid",
  TICKET_UNSUPPORTED: "dmWebReasonsTicketUnsupported",
  TICKET_INVALID: "dmWebReasonsTicketInvalid",
  TICKET_RIGHTS_ID_MISMATCH: "dmWebReasonsTicketRightsIdMismatch",
  TICKET_KEY_CONFLICT: "dmWebReasonsTicketKeyConflict",
  TICKET_LIMIT_EXCEEDED: "dmWebReasonsTicketLimitExceeded",
  CONTENT_READ_FAILED: "dmWebReasonsContentReadFailed",
  CONTENT_AUTHENTICATION_FAILED: "dmWebReasonsContentAuthenticationFailed",
  CONTENT_METADATA_INVALID: "dmWebReasonsContentMetadataInvalid",
  EXTRACTION_WORKER_UNAVAILABLE: "dmWebReasonsExtractionWorkerUnavailable",
  EXTRACTION_TRANSPORT_FAILED: "dmWebReasonsExtractionTransportFailed",
  EXTRACTION_PROTOCOL_FAILED: "dmWebReasonsExtractionProtocolFailed",
  EXTRACTION_WORKER_FAILED: "dmWebReasonsExtractionWorkerFailed",
  EXTRACTION_TIMEOUT: "dmWebReasonsExtractionTimeout",
  EXTRACTION_FAILED: "dmWebReasonsExtractionFailed",
});
const stages = Object.freeze({
  capabilities: "dmWebStagesCapabilities",
  discovery: "dmWebStagesDiscovery",
  secrets: "dmWebStagesSecrets",
  inspection: "dmWebStagesInspection",
  selection: "dmWebStagesSelection",
  extraction: "dmWebStagesExtraction",
  disposal: "dmWebStagesDisposal",
  program: "dmWebStagesProgram",
  assets: "dmWebStagesAssets",
  shaders: "dmWebStagesShaders",
  shell: "dmWebStagesShell",
  validation: "dmWebStagesValidation",
  assembly: "dmWebStagesAssembly",
  output: "dmWebStagesOutput",
  resources: "dmWebStagesResources",
  archive: "dmWebStagesArchive",
  cleanup: "dmWebStagesCleanup",
  commit: "dmWebStagesCommit",
});
// 仅固定标签与有界数值进度进入活动日志。
// Only fixed labels and bounded numeric progress enter the activity log.
export function packagingActivity(event) {
  const diagnostic = extractionProgressLabel(event?.diagnostic);
  if (diagnostic) return diagnostic;
  if (!Object.hasOwn(stages, event?.stage)) return null;
  const state = ["running", "complete", "failed"].includes(event.state) ? event.state : "running";
  return t(
    "dmWebStageState",
    t(stages[event.stage]),
    t({ running: "dmWebRunning", complete: "dmWebComplete", failed: "dmWebFailed" }[state]),
  );
}
export function packagingFailureSummary(report) {
  if (report?.code === "CANCELLED") return t("dmWebCancelled");
  const code = isExtractionDiagnosticCode(report?.detailCode) ? report.detailCode : null;
  const stage = Object.hasOwn(stages, report?.stage)
    ? t(stages[report.stage])
    : t("dmWebLocalPackaging");
  return t(
    "dmWebFailureSummary",
    stage,
    code ? ` [${code}]` : "",
    code ? `${t(reasons[code])} ` : "",
  );
}
// 仅使用生成的目标名称；不复制源文件名或任意嵌套报告。
// Generated destinations only; never copy source filenames or arbitrary nested reports.
export function sanitizeResourceOutcome(outcome) {
  if (!outcome || !["complete", "incomplete"].includes(outcome.status)) return undefined;
  const directoryName = outcome.directoryName;
  if (
    directoryName !== null &&
    (typeof directoryName !== "string" ||
      !/^D2R-resources-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        directoryName,
      ))
  )
    return undefined;
  if (outcome.status === "complete")
    return directoryName ? Object.freeze({ status: "complete", directoryName }) : undefined;
  if (
    typeof outcome.cleanupComplete !== "boolean" ||
    typeof outcome.incompleteMarkerPresent !== "boolean"
  )
    return undefined;
  return Object.freeze({
    status: "incomplete",
    directoryName,
    cleanupComplete: outcome.cleanupComplete,
    incompleteMarkerPresent: outcome.incompleteMarkerPresent,
  });
}
export function packagingFailureMessage(report) {
  const resources = sanitizeResourceOutcome(report?.resources);
  let output = report?.outputStarted === true ? t("dmWebOutputPossible") : t("dmWebOutputNone");
  if (resources?.status === "complete") output = t("dmWebOutputComplete", resources.directoryName);
  else if (resources?.cleanupComplete === true) output = t("dmWebOutputRemoved");
  else if (resources?.directoryName)
    output = t(
      "dmWebOutputIncomplete",
      resources.directoryName,
      t(resources.incompleteMarkerPresent ? "dmWebMarkerPresent" : "dmWebMarkerUnknown"),
    );
  return `${packagingFailureSummary(report)}${output}${t("dmWebFailureRetry")}`;
}
