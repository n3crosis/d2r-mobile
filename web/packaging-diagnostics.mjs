import { extractionProgressLabel, isExtractionDiagnosticCode } from "./extraction-errors.mjs";
const reasons = Object.freeze({
  PROD_KEYS_MISSING: "prod.keys is missing.",
  PROD_KEYS_UNREADABLE: "prod.keys could not be read. Check local file access.",
  PROD_KEYS_TOO_LARGE: "prod.keys exceeds the 1 MiB limit.",
  PROD_KEYS_EMPTY: "prod.keys contains no key entries.",
  PROD_KEYS_MALFORMED: "prod.keys has an unsupported or malformed key line.",
  TITLE_KEY_REQUIRED:
    "No matching title key was available from supported NSP tickets or title.keys. Add your own matching title.keys to the selected folder.",
  TITLE_KEYS_MISSING:
    "title.keys is missing. An empty file is allowed when no title keys are needed.",
  TITLE_KEYS_UNREADABLE: "title.keys could not be read. Check local file access.",
  TITLE_KEYS_TOO_LARGE: "title.keys exceeds the 1 MiB limit.",
  TITLE_KEYS_MALFORMED: "title.keys has an unsupported or malformed key line.",
  KEYS_RUNTIME_FAILED: "The isolated package reader could not load the key files.",
  PACKAGE_INDEX_INVALID: "An NSP index is unreadable, damaged, or unsupported.",
  TICKET_UNSUPPORTED:
    "An embedded ticket format cannot be read. A matching title.keys entry can be used only when the ticket rights ID can be verified.",
  TICKET_INVALID: "An embedded ticket is malformed, truncated, or unreadable.",
  TICKET_RIGHTS_ID_MISMATCH: "An embedded ticket name does not match its rights ID.",
  TICKET_KEY_CONFLICT: "Embedded tickets contain conflicting keys for the same rights ID.",
  TICKET_LIMIT_EXCEEDED: "The selected packages exceed the embedded-ticket limit.",
  CONTENT_READ_FAILED: "Package content could not be read completely.",
  CONTENT_AUTHENTICATION_FAILED:
    "Content verification failed. The keys may not match the packages, or a package may be damaged or unsupported.",
  CONTENT_METADATA_INVALID: "Package metadata is invalid or inconsistent.",
  EXTRACTION_WORKER_UNAVAILABLE: "The isolated package reader is unavailable.",
  EXTRACTION_TRANSPORT_FAILED: "The browser could not pass local inputs to the package reader.",
  EXTRACTION_PROTOCOL_FAILED: "The package reader returned an unexpected response.",
  EXTRACTION_WORKER_FAILED: "The isolated package reader stopped unexpectedly.",
  EXTRACTION_TIMEOUT: "Package verification exceeded its time limit.",
  EXTRACTION_FAILED: "Local package verification did not complete.",
});
const stages = Object.freeze({
  capabilities: "Checking capabilities",
  discovery: "Finding local inputs",
  secrets: "Verifying local keys and packages",
  inspection: "Inspecting package identities",
  selection: "Selecting package content",
  extraction: "Extracting selected content",
  disposal: "Closing the isolated key session",
  program: "Generating the application",
  assets: "Generating assets",
  shaders: "Generating shaders",
  shell: "Validating the application shell",
  validation: "Validating generated content",
  assembly: "Checking the assembly",
  output: "Writing the archive",
  resources: "Saving game resources locally",
  archive: "Validating the archive",
  cleanup: "Releasing temporary resources",
  commit: "Finalizing the archive",
});
/** Only fixed labels and bounded numeric progress enter the activity log. */
export function packagingActivity(event) {
  const diagnostic = extractionProgressLabel(event?.diagnostic);
  if (diagnostic) return diagnostic;
  if (!Object.hasOwn(stages, event?.stage)) return null;
  const state = ["running", "complete", "failed"].includes(event.state) ? event.state : "running";
  return `${stages[event.stage]}: ${state}`;
}
export function packagingFailureSummary(report) {
  if (report?.code === "CANCELLED") return "Cancelled.";
  const code = isExtractionDiagnosticCode(report?.detailCode) ? report.detailCode : null;
  const stage = Object.hasOwn(stages, report?.stage) ? stages[report.stage] : "Local packaging";
  return `${stage} failed${code ? ` [${code}]` : ""}. ${code ? `${reasons[code]} ` : ""}No completed IPA is available.`;
}
export function packagingFailureMessage(report) {
  const output =
    report?.outputStarted === true
      ? " Resources may have been saved in a D2R-resources subfolder inside the selected folder."
      : " No resources were exported by this attempt.";
  return `${packagingFailureSummary(report)}${output} Reload to try again. Keep key files on this device; the activity log contains no keys or filenames.`;
}
