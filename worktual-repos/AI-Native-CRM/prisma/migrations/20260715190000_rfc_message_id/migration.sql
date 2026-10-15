-- RFC Message-ID for proper reply threading in customer mail clients

ALTER TABLE "contact_activities"
  ADD COLUMN "rfc_message_id" TEXT;

CREATE INDEX "contact_activities_rfc_message_id_idx"
  ON "contact_activities" ("rfc_message_id");
