import { pool } from "../db/pool.js";

export const OUTBOX_STATUSES = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
};

export async function createEmailOutboxEntry({
  jobType,
  payload,
  toEmail = null,
  subject = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO email_outbox (job_type, payload, to_email, subject, status)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     RETURNING id`,
    [jobType, JSON.stringify(payload || {}), toEmail, subject, OUTBOX_STATUSES.PENDING],
  );

  return rows[0].id;
}

export async function markEmailOutboxSent(outboxId) {
  await pool.query(
    `UPDATE email_outbox
     SET status = $2, sent_at = NOW(), updated_at = NOW(), last_error = NULL
     WHERE id = $1`,
    [outboxId, OUTBOX_STATUSES.SENT],
  );
}

export async function markEmailOutboxFailed(outboxId, error) {
  await pool.query(
    `UPDATE email_outbox
     SET status = $2,
         retry_count = retry_count + 1,
         last_error = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [outboxId, OUTBOX_STATUSES.FAILED, error instanceof Error ? error.message : String(error)],
  );
}
