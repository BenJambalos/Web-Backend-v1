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

  await client.query(
    "UPDATE accounts SET status='disabled', replacement_disabled_at=NOW() WHERE role='admin' AND status='active'",
  );
  await audit(
    actorAccountId,
    "admin_replaced",
    `Disabled active BFAR Admin account(s) ${activeAdmins.map(({ account_id }) => `#${account_id}`).join(", ")} as part of an Admin replacement.`,
    client,
  );
}

export async function getReactivatableBfarAdmins(client) {
  const { rows } = await client.query(`SELECT a.account_id,a.username,a.role,a.status,a.last_seen,
    a.replacement_disabled_at,DATE_ADD(a.replacement_disabled_at,INTERVAL 30 DAY) AS reactivation_expires_at,
    p.first_name,p.middle_name,p.last_name,p.email,p.phone
    FROM accounts a JOIN user_profiles p ON p.account_id=a.account_id
    WHERE a.role='admin' AND a.status='disabled'
      AND a.replacement_disabled_at>DATE_SUB(NOW(),INTERVAL 30 DAY)
    ORDER BY a.replacement_disabled_at DESC`);
  return rows;
}

export async function reactivateReplacedBfarAdmin(client, {
  actorAccountId,
  targetAccountId,
  audit,
}) {
  await lockActiveSuperadmins(client, actorAccountId);
  const { rows } = await client.query(`SELECT account_id,role,status,replacement_disabled_at,
    replacement_disabled_at>DATE_SUB(NOW(),INTERVAL 30 DAY) AS is_reactivatable
    FROM accounts WHERE account_id=? FOR UPDATE`, [targetAccountId]);
  const target = rows[0];
  if (!target || target.role !== "admin" || target.status !== "disabled" || !target.replacement_disabled_at) {
    throw httpError(404, "This replaced BFAR Admin account is no longer available.");
  }
  if (!target.is_reactivatable) {
    throw httpError(410, "The reactivation window for this BFAR Admin account has expired.");
  }

  await disableActiveBfarAdmins(client, {
    actorAccountId,
    confirmed: true,
    audit,
  });
  await client.query(
    "UPDATE accounts SET status='active',replacement_disabled_at=NULL WHERE account_id=?",
    [targetAccountId],
  );
  await audit(
    actorAccountId,
    "admin_reactivated",
    `Reactivated replaced BFAR Admin account #${targetAccountId}.`,
    client,
  );
}

export async function purgeExpiredReplacedBfarAdmins(client) {
  return client.query(`DELETE FROM accounts
    WHERE role='admin' AND status='disabled'
      AND replacement_disabled_at IS NOT NULL
      AND replacement_disabled_at<=DATE_SUB(NOW(),INTERVAL 30 DAY)`);
}
