/**
 * Email batches wait in this status. The retired Worktual ESP worker only
 * claims `status = queued` and `channel = email`, so it never sees these rows.
 * Push and WhatsApp stay on `queued`.
 */
export const EMAIL_BATCH_QUEUED = "queued_accounts";

/** Max send attempts per recipient before permanent failure. */
export const MAX_EMAIL_SEND_ATTEMPTS = 3;
export const MAX_PUSH_SEND_ATTEMPTS = 3;
export const MAX_WHATSAPP_SEND_ATTEMPTS = 3;
