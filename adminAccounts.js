function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function lockActiveSuperadmins(client, actorAccountId) {
  const { rows: superadmins } = await client.query(
    "SELECT account_id FROM accounts WHERE role='super_admin' AND status='active' ORDER BY account_id FOR UPDATE",
  );
  if (!superadmins.some((account) => account.account_id === actorAccountId)) {
    throw httpError(403, "Superadmin access is required.");
  }
}

export async function assertBfarAdminActivationAvailable(client, { actorAccountId, targetAccountId }) {
  await lockActiveSuperadmins(client, actorAccountId);

  const { rows: targetAccounts } = await client.query(
    "SELECT role FROM accounts WHERE account_id=?",
    [targetAccountId],
  );
  if (targetAccounts[0]?.role !== "admin") return;

  const { rows: activeAdmins } = await client.query(
    "SELECT account_id FROM accounts WHERE role='admin' AND status='active' AND account_id<>? ORDER BY account_id FOR UPDATE",
    [targetAccountId],
  );
  if (activeAdmins.length > 0) {
    throw httpError(409, "An active BFAR Admin already exists. Replace it through User Management before activating another account.");
  }
}

export async function disableActiveBfarAdmins(client, { actorAccountId, confirmed, audit }) {
  await lockActiveSuperadmins(client, actorAccountId);

  const { rows: activeAdmins } = await client.query(
    "SELECT account_id FROM accounts WHERE role='admin' AND status='active' ORDER BY account_id FOR UPDATE",
  );
  if (activeAdmins.length > 0 && !confirmed) {
    throw httpError(409, "Confirm replacement of the active BFAR Admin account.");
  }
  if (activeAdmins.length === 0) return;

  await client.query("UPDATE accounts SET status='disabled' WHERE role='admin' AND status='active'");
  await audit(
    actorAccountId,
    "admin_replaced",
    `Disabled active BFAR Admin account(s) ${activeAdmins.map(({ account_id }) => `#${account_id}`).join(", ")} as part of an Admin replacement.`,
    client,
  );
}

export async function purgeExpiredReplacedBfarAdmins(client) {
  return client.query(`DELETE FROM accounts
    WHERE role='admin' AND status='disabled'
      AND updated_at<=DATE_SUB(NOW(),INTERVAL 30 DAY)`);
}
