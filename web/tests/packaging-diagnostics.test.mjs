import test from "node:test";
import assert from "node:assert/strict";
import {
  packagingActivity,
  packagingFailureMessage,
  packagingFailureSummary,
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
