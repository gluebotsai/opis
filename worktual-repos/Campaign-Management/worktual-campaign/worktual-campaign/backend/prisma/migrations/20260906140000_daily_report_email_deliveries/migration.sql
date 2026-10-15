-- Daily campaign report email delivery tracking (duplicate prevention).
CREATE TABLE "daily_report_email_deliveries" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "report_date" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "recipient_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "provider_id" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_report_email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_report_email_deliveries_organization_id_user_id_report_date_key"
ON "daily_report_email_deliveries"("organization_id", "user_id", "report_date");

CREATE INDEX "daily_report_email_deliveries_organization_id_report_date_idx"
ON "daily_report_email_deliveries"("organization_id", "report_date");

CREATE INDEX "daily_report_email_deliveries_sent_at_idx"
ON "daily_report_email_deliveries"("sent_at" DESC);
