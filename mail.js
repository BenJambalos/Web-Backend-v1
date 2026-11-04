import "./env.js";
import nodemailer from "nodemailer";
import process from "node:process";
import { pool, withTransaction } from "./db.js";

export function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    const error = new Error("SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM are required for email delivery.");
    error.status = 503;
    throw error;
  }
  if (!Number.isInteger(Number(SMTP_PORT)) || Number(SMTP_PORT) < 1 || Number(SMTP_PORT) > 65535) {
    const error = new Error("SMTP_PORT must be a valid TCP port.");
    error.status = 503;
    throw error;
  }

  return {
    from: SMTP_FROM,
    transport: nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    }),
  };
}

export async function sendPasswordResetEmail(recipient, resetUrl) {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL } = process.env;

  if (RESEND_API_KEY) {
    if (!RESEND_FROM_EMAIL) {
      const error = new Error("RESEND_FROM_EMAIL is required when RESEND_API_KEY is configured.");
      error.status = 503;
      throw error;
    }

    let response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          from: RESEND_FROM_EMAIL,
          to: [recipient],
          subject: "HyQual password reset",
          text: `Use this link to reset your HyQual password:\n\n${resetUrl}\n\nThis link expires in one hour.`,
          html: `<p>Use this link to reset your HyQual password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in one hour.</p>`,
        }),
      });
    } catch (cause) {
      const error = new Error(`Unable to connect to Resend email API: ${cause.message}`);
      error.status = 502;
      throw error;
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result && typeof result.message === "string"
        ? result.message
        : "provider rejected the request.";
      const error = new Error(`Resend email request failed (${response.status}): ${message}`);
      error.status = 502;
      throw error;
    }

    console.info("Password reset email accepted by Resend.");
    return;
  }

  const { transport, from } = createTransport();
  try {
    await transport.sendMail({
      from,
      to: recipient,
      subject: "HyQual password reset",
      text: `Use this link to reset your HyQual password:\n\n${resetUrl}\n\nThis link expires in one hour.`,
      html: `<p>Use this link to reset your HyQual password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in one hour.</p>`,
    });
  } catch (cause) {
    const error = new Error(`SMTP delivery failed: ${cause.message}`);
    error.status = 502;
    throw error;
  }
  console.info("Password reset email accepted by SMTP server.");
}

export async function queueEmail(recipient, subject, body) {
  createTransport();
  await pool.query(
    "INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)",
    [recipient, subject, body]
  );
}

export async function deliverQueuedEmails() {
  const { transport, from } = createTransport();
  const rows = await withTransaction(async (client) => {
    const { rows: queued } = await client.query(
      `SELECT id, recipient, subject, body, attempts FROM mail_outbox
       WHERE sent_at IS NULL AND next_attempt_at <= now()
       ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED`
    );
    for (const message of queued) {
      await client.query(
        `UPDATE mail_outbox
         SET attempts = attempts + 1, next_attempt_at = DATE_ADD(now(), INTERVAL 10 MINUTE)
         WHERE id = $1`,
        [message.id]
      );
      message.attempts += 1;
    }
    return queued;
  });

  for (const message of rows) {
    try {
      await transport.sendMail({
        from,
        to: message.recipient,
        subject: message.subject,
        text: message.body,
      });
      await pool.query(
        "UPDATE mail_outbox SET sent_at = now(), last_error = NULL WHERE id = $1",
        [message.id]
      );
    } catch (error) {
      const delayMinutes = Math.min(60, 2 ** Math.min(message.attempts, 6));
      console.error(`Unable to deliver queued email ${message.id}:`, error);
      await pool.query(
        `UPDATE mail_outbox
         SET next_attempt_at = DATE_ADD(now(), INTERVAL $2 MINUTE),
             last_error = $3
         WHERE id = $1`,
        [message.id, delayMinutes, String(error.message || error).slice(0, 1000)]
      );
    }
  }
}
