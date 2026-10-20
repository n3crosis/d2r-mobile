/** Fixed public diagnostics only. Never expose native exceptions or key/file contents. */
const workerCodes = new Set([
  "EXTRACTION_FAILED",
  "PROD_KEYS_MISSING",
  "PROD_KEYS_UNREADABLE",
  "PROD_KEYS_TOO_LARGE",
  "PROD_KEYS_EMPTY",
  "PROD_KEYS_MALFORMED",
  "TITLE_KEY_REQUIRED",
  "TITLE_KEYS_MISSING",
  "TITLE_KEYS_UNREADABLE",
  "TITLE_KEYS_TOO_LARGE",
  "TITLE_KEYS_MALFORMED",
  "KEYS_RUNTIME_FAILED",
  "PACKAGE_INDEX_INVALID",
  "CONTENT_READ_FAILED",
  "CONTENT_AUTHENTICATION_FAILED",
  "CONTENT_METADATA_INVALID",
]);
const clientCodes = new Set([
  ...workerCodes,
  "EXTRACTION_WORKER_UNAVAILABLE",
  "EXTRACTION_TRANSPORT_FAILED",
  "EXTRACTION_PROTOCOL_FAILED",
  "EXTRACTION_WORKER_FAILED",
  "EXTRACTION_TIMEOUT",
]);
export const isExtractionWorkerErrorCode = (code) => workerCodes.has(code);
export const isExtractionDiagnosticCode = (code) => clientCodes.has(code);
export const extractionWorkerErrorCode = (error) =>
  isExtractionWorkerErrorCode(error?.code) ? error.code : "EXTRACTION_FAILED";
export function extractionDiagnosticError(code) {
  const safe = isExtractionWorkerErrorCode(code) ? code : "EXTRACTION_FAILED";
  const error = new Error(safe);
  error.code = safe;
  return error;
}

const progressLabels = Object.freeze({
  "prod-keys-read": "Reading prod.keys locally",
  "title-keys-read": "Reading title.keys locally",
  "keys-load": "Loading keys into the isolated reader",
  "package-index": "Reading NSP indexes",
  "content-hash": "Hashing package content",
  "content-header": "Verifying encrypted content headers",
  "content-metadata": "Verifying package metadata",
});
export function isExtractionProgress(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.keys(value).sort().join(",") === "bytes,completed,stage,total" &&
    Object.hasOwn(progressLabels, value.stage) &&
    [value.bytes, value.completed, value.total].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    value.completed <= value.total &&
    value.total <= 4096,
  );
}
export function extractionProgressLabel(value) {
  if (!isExtractionProgress(value)) return null;
  const count = value.total > 0 ? ` (${value.completed}/${value.total})` : "";
  const size = value.bytes > 0 ? `; ${(value.bytes / 1_000_000).toFixed(1)} MB` : "";
  return `${progressLabels[value.stage]}${count}${size}`;
}
