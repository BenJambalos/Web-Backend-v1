import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBfarAdminActivationAvailable,
  disableActiveBfarAdmins,
  getReactivatableBfarAdmins,
  purgeExpiredReplacedBfarAdmins,
  reactivateReplacedBfarAdmin,
} from "./adminAccounts.js";

function createClient({
  superadmins = [{ account_id: 7 }],
  activeAdmins = [],
  targetAccounts = [],
  reactivationTarget,
  reactivatableAdmins = [],
} = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push(sql);
      if (sql.includes("role='super_admin'")) return { rows: superadmins };
      if (sql.startsWith("SELECT account_id,role,status,replacement_disabled_at")) {
        return { rows: reactivationTarget ? [reactivationTarget] : [] };
      }
      if (sql.startsWith("SELECT a.account_id")) return { rows: reactivatableAdmins };
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
    client.queries.includes("UPDATE accounts SET status='disabled', replacement_disabled_at=NOW() WHERE role='admin' AND status='active'"),
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

test("lists only replaced BFAR Admins still within the reactivation window", async () => {
  const client = createClient();

  await getReactivatableBfarAdmins(client);

  assert.match(client.queries[0], /role='admin' AND a\.status='disabled'/);
  assert.match(client.queries[0], /replacement_disabled_at>DATE_SUB\(NOW\(\),INTERVAL 30 DAY\)/);
});

test("reactivates an eligible replaced Admin after disabling and auditing the current Admin", async () => {
  const client = createClient({
    activeAdmins: [{ account_id: 13 }],
    reactivationTarget: {
      account_id: 12,
      role: "admin",
      status: "disabled",
      replacement_disabled_at: new Date(),
      is_reactivatable: 1,
    },
  });
  const actions = [];
  const audit = async (...args) => actions.push(args);

  await reactivateReplacedBfarAdmin(client, {
    actorAccountId: 7,
    targetAccountId: 12,
    audit,
  });

  assert.ok(client.queries.includes(
    "UPDATE accounts SET status='disabled', replacement_disabled_at=NOW() WHERE role='admin' AND status='active'",
  ));
  assert.ok(client.queries.includes(
    "UPDATE accounts SET status='active',replacement_disabled_at=NULL WHERE account_id=?",
  ));
  assert.deepEqual(actions.map((action) => action[1]), ["admin_replaced", "admin_reactivated"]);
});

test("rejects reactivation after the 30-day window", async () => {
  const client = createClient({
    reactivationTarget: {
      account_id: 12,
      role: "admin",
      status: "disabled",
      replacement_disabled_at: new Date(),
      is_reactivatable: 0,
    },
  });

  await assert.rejects(
    reactivateReplacedBfarAdmin(client, {
      actorAccountId: 7,
      targetAccountId: 12,
      audit: async () => {},
    }),
    { status: 410 },
  );
  assert.equal(client.queries.some((sql) => sql.startsWith("UPDATE accounts")), false);
});

test("purges only expired replaced BFAR Admin accounts", async () => {
  const client = createClient();

  await purgeExpiredReplacedBfarAdmins(client);

  assert.match(client.queries[0], /role='admin' AND status='disabled'/);
  assert.match(client.queries[0], /replacement_disabled_at IS NOT NULL/);
  assert.match(client.queries[0], /replacement_disabled_at<=DATE_SUB\(NOW\(\),INTERVAL 30 DAY\)/);
});
