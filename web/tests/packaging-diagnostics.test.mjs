import test from "node:test";
import assert from "node:assert/strict";
import {
  packagingActivity,
  packagingFailureMessage,
  packagingFailureSummary,
  sanitizeResourceOutcome,
} from "../packaging-diagnostics.mjs";

test("activity log accepts only fixed stages, bounded counts and public codes", () => {
  assert.equal(packagingActivity({ stage: "PRIVATE-PATH", label: "PRIVATE-KEY" }), null);
  assert.equal(
    packagingActivity({ stage: "secrets", label: "PRIVATE-KEY" }),
    "Verifying local keys and packages: running",
  );
  assert.equal(
    packagingActivity({
      stage: "secrets",
      diagnostic: { stage: "content-hash", completed: 1, total: 3, bytes: 2000000 },
    }),
    "Hashing package content (1/3); 2.0 MB",
  );
  assert.equal(
    packagingActivity({
      diagnostic: { stage: "content-hash", completed: 1, total: 3, bytes: 2, private: "CANARY" },
    }),
    null,
  );
  assert.doesNotMatch(
    packagingFailureSummary({ stage: "PRIVATE-PATH", detailCode: "PRIVATE-KEY" }),
    /PRIVATE/,
  );
  assert.equal(
    packagingActivity({
      stage: "extraction",
      diagnostic: { stage: "romfs-merged", completed: 50, total: 100, bytes: 4500000000 },
    }),
    "Verifying merged update RomFS: 50% (4500.0 MB verified)",
  );
});

test("resource recovery details stay out of activity logs and copied failure summaries", () => {
  const directoryName = "D2R-resources-12345678-1234-4123-8123-123456789abc";
  const resources = sanitizeResourceOutcome({
    status: "complete",
    directoryName,
    private: "PRIVATE-KEY",
  });
  assert.deepEqual(resources, { status: "complete", directoryName });
  assert.equal(Object.isFrozen(resources), true);
  const report = { stage: "archive", outputStarted: true, resources };
  assert.match(packagingFailureMessage(report), /Complete game resources remain in D2R-resources-/);
  assert.doesNotMatch(packagingFailureSummary(report), /D2R-resources|PRIVATE/);
  assert.doesNotMatch(packagingActivity({ stage: "archive", resources }), /D2R-resources|PRIVATE/);
  assert.doesNotMatch(
    packagingFailureMessage({
      ...report,
      resources: { status: "complete", directoryName: "PRIVATE-PATH" },
    }),
    /PRIVATE/,
  );
  const incomplete = {
    status: "incomplete",
    directoryName,
    cleanupComplete: false,
    incompleteMarkerPresent: true,
  };
  assert.match(
    packagingFailureMessage({ ...report, resources: incomplete }),
    /Do not use this as a finished resource set/,
  );
  assert.match(
    packagingFailureMessage({ ...report, resources: incomplete }),
    /warning marker remains/,
  );
  assert.match(
    packagingFailureMessage({
      ...report,
      resources: { ...incomplete, cleanupComplete: true, incompleteMarkerPresent: false },
    }),
    /no resource folder from this attempt remains/,
  );
  assert.equal(sanitizeResourceOutcome({ ...incomplete, cleanupComplete: "true" }), undefined);
});
test("early failure never suggests resource exports; key code is actionable", () => {
  const message = packagingFailureMessage({
    stage: "secrets",
    detailCode: "PROD_KEYS_UNREADABLE",
    outputStarted: false,
  });
  assert.match(message, /PROD_KEYS_UNREADABLE/);
  assert.match(message, /No resources were exported/);
  assert.doesNotMatch(message, /may have been saved/);
  assert.match(
    packagingFailureMessage({ stage: "output", outputStarted: true }),
    /may have been saved/,
  );
});

test("ticket diagnostics are specific and counters never expose input details", () => {
  for (const [stage, label] of [
    ["ticket-found", "Embedded tickets found"],
    ["ticket-key-added", "Title keys added from tickets"],
    ["ticket-key-reused", "Existing title keys reused"],
  ]) {
    assert.equal(
      packagingActivity({ diagnostic: { stage, completed: 2, total: 2, bytes: 0 } }),
      `${label}: 2`,
    );
    assert.equal(
      packagingActivity({
        diagnostic: { stage, completed: 2, total: 2, bytes: 0, filename: "PRIVATE" },
      }),
      null,
    );
  }
  for (const detailCode of [
    "TICKET_UNSUPPORTED",
    "TICKET_INVALID",
    "TICKET_RIGHTS_ID_MISMATCH",
    "TICKET_KEY_CONFLICT",
    "TICKET_LIMIT_EXCEEDED",
  ]) {
    const message = packagingFailureSummary({ stage: "secrets", detailCode });
    assert.match(message, new RegExp(`\\[${detailCode}\\]`));
    assert.doesNotMatch(message, /undefined/);
  }
  assert.doesNotMatch(
    packagingFailureSummary({ stage: "secrets", detailCode: "TITLE_KEY_REQUIRED" }),
    /does not import NSP tickets/,
  );
});
