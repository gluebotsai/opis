-- Temporary contacts for one create-campaign agent session (not CRM)

CREATE TABLE "campaign_session_temp_contacts" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "first_name" TEXT NOT NULL DEFAULT '',
    "last_name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "company_name" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_session_temp_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_session_temp_contacts_session_id_idx"
  ON "campaign_session_temp_contacts"("session_id");

CREATE INDEX "campaign_session_temp_contacts_organization_id_session_id_idx"
  ON "campaign_session_temp_contacts"("organization_id", "session_id");

ALTER TABLE "campaign_session_temp_contacts"
  ADD CONSTRAINT "campaign_session_temp_contacts_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "campaign_agent_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
