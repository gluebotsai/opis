-- Campaign-scoped contact engagement (not on shared my_account_qa.contacts)

CREATE TABLE "campaign_contact_engagement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "email_unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "email_unsubscribed_at" TIMESTAMP(3),
    "email_unsubscribe_reason" TEXT,
    "last_email_opened_at" TIMESTAMP(3),
    "last_email_clicked_at" TIMESTAMP(3),
    "email_open_count" INTEGER NOT NULL DEFAULT 0,
    "email_click_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_contact_engagement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_contact_engagement_tenant_id_contact_id_key"
  ON "campaign_contact_engagement"("tenant_id", "contact_id");
CREATE INDEX "campaign_contact_engagement_tenant_id_idx"
  ON "campaign_contact_engagement"("tenant_id");
CREATE INDEX "campaign_contact_engagement_tenant_id_email_unsubscribed_idx"
  ON "campaign_contact_engagement"("tenant_id", "email_unsubscribed");
