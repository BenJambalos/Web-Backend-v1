import assert from "node:assert/strict";
import test from "node:test";
import { auditValuesEqual, formatAuditChanges } from "./auditDescriptions.js";

test("formats old and new user-provided values in an audit description", () => {
  assert.equal(
    formatAuditChanges("profile for account #12", [
      { field: "user name", from: "Jane Doe", to: "Jane Smith" },
      { field: "street", from: null, to: "12 Bay Road" },
    ]),
    'profile for account #12: changed user name from "Jane Doe" to "Jane Smith"; added street "12 Bay Road".',
  );
});

test("describes clearing fields and normalizes database boolean and numeric values", () => {
  assert.equal(auditValuesEqual(0, false), true);
  assert.equal(auditValuesEqual(null, ""), true);
  assert.equal(
    formatAuditChanges("pond #4", [
      { field: "volume", from: "120.0", to: 120 },
      { field: "recommended action", from: "Check aeration", to: "" },
    ]),
    'pond #4: cleared recommended action (was "Check aeration").',
  );
});

test("sanitizes and bounds values in audit descriptions", () => {
  const description = formatAuditChanges("farm #2", [
    { field: "farm name", from: null, to: `Pond\n${"x".repeat(400)}` },
  ]);

  assert.ok(description.startsWith('farm #2: added farm name "Pond '));
  assert.ok(description.length < 400);
  assert.equal(description.includes("\n"), false);
});
