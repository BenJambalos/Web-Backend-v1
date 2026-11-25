import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBfarAdminActivationAvailable,
  disableActiveBfarAdmins,
  purgeExpiredReplacedBfarAdmins,
} from "./adminAccounts.js";

function createClient({
  superadmins = [{ account_id: 7 }],
  activeAdmins = [],
  targetAccounts = [],
} = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push(sql);
      if (sql.includes("role='super_admin'")) return { rows: superadmins };
      if (sql.startsWith("SELECT role FROM accounts")) return { rows: targetAccounts };
      if (sql.includes("role='admin'")) return { rows: activeAdmins };
      if (sql.startsWith("DELETE FROM accounts")) return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
  };
}

test("requires confirmation before disabling the active BFAR Admin", async () => {
  const client = createClient({ activeAdmins: [{ account_id: 12 }] });

  await assert.rejects(
    disableActiveBfarAdmins(client, {
      actorAccountId: 7,
      confirmed: false,
      audit: async () => {},
    }),
    { status: 409 },
  );
  assert.equal(client.queries.some((sql) => sql.startsWith("UPDATE accounts")), false);
});

test("disables and audits existing active BFAR Admin accounts after confirmation", async () => {
  const client = createClient({ activeAdmins: [{ account_id: 12 }] });
  const audit = async (...args) => {
    assert.equal(args[0], 7);
    assert.equal(args[1], "admin_replaced");
    assert.match(args[2], /#12/);
    assert.equal(args[3], client);
  };

  await disableActiveBfarAdmins(client, { actorAccountId: 7, confirmed: true, audit });

  assert.equal(
    client.queries.includes("UPDATE accounts SET status='disabled' WHERE role='admin' AND status='active'"),
    true,
  );
});

test("does not disable anything when no BFAR Admin is active", async () => {
  const client = createClient();
  const audit = async () => assert.fail("Should not audit a replacement when there is no active admin.");

  await disableActiveBfarAdmins(client, { actorAccountId: 7, confirmed: true, audit });

  assert.equal(client.queries.some((sql) => sql.startsWith("UPDATE accounts")), false);
});

test("rejects activating a BFAR Admin while another one is active", async () => {
  const client = createClient({
    activeAdmins: [{ account_id: 13 }],
    targetAccounts: [{ role: "admin" }],
  });

  await assert.rejects(
    assertBfarAdminActivationAvailable(client, { actorAccountId: 7, targetAccountId: 12 }),
    { status: 409 },
  );
});

test("purges BFAR Admin accounts that have remained disabled for 30 days", async () => {
  const client = createClient();

  await purgeExpiredReplacedBfarAdmins(client);

  assert.match(client.queries[0], /role='admin' AND status='disabled'/);
  assert.match(client.queries[0], /updated_at<=DATE_SUB\(NOW\(\),INTERVAL 30 DAY\)/);
});
