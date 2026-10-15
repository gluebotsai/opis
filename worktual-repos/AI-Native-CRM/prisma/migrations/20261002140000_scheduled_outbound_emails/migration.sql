-- Coworker scheduled customer email. CRM schema only.
CREATE TABLE IF NOT EXISTS "crm"."scheduled_outbound_emails" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "mailbox_user_id" BIGINT NOT NULL,
  "contact_id" TEXT,
  "draft_activity_id" TEXT,
  "to_email" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "send_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "last_error" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "scheduled_outbound_emails_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scheduled_outbound_emails_status_send_at_idx"
  ON "crm"."scheduled_outbound_emails" ("status", "send_at");

CREATE INDEX IF NOT EXISTS "scheduled_outbound_emails_draft_activity_id_idx"
  ON "crm"."scheduled_outbound_emails" ("draft_activity_id");
