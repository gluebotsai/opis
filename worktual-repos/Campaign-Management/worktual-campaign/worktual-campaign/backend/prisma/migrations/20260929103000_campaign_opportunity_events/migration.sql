-- Opportunity / events (forms, etc.) and public form submissions.
CREATE TABLE "campaign_opportunity_events" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "created_by_user_id" BIGINT NOT NULL,
    "public_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'form',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL DEFAULT '',
    "public_slug" TEXT,
    "launched_at" TIMESTAMP(3),
    "submission_count" INTEGER NOT NULL DEFAULT 0,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_opportunity_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_opportunity_events_organization_id_public_id_key"
  ON "campaign_opportunity_events"("organization_id", "public_id");

CREATE UNIQUE INDEX "campaign_opportunity_events_public_slug_key"
  ON "campaign_opportunity_events"("public_slug");

CREATE INDEX "campaign_opportunity_events_organization_id_status_updated_at_idx"
  ON "campaign_opportunity_events"("organization_id", "status", "updated_at" DESC);

CREATE TABLE "campaign_form_submissions" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "event_public_id" TEXT NOT NULL,
    "form_slug" TEXT NOT NULL,
    "public_reply_id" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_form_submissions_public_reply_id_key"
  ON "campaign_form_submissions"("public_reply_id");

CREATE INDEX "campaign_form_submissions_organization_id_event_public_id_created_at_idx"
  ON "campaign_form_submissions"("organization_id", "event_public_id", "created_at" DESC);

CREATE INDEX "campaign_form_submissions_form_slug_created_at_idx"
  ON "campaign_form_submissions"("form_slug", "created_at" DESC);
