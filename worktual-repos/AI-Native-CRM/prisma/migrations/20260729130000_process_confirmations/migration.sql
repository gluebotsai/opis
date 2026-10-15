-- B2B post-meeting process agent: owner confirmation queue
CREATE TYPE "ProcessConfirmationStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE "process_confirmations" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "activity_id" TEXT,
    "deal_id" TEXT,
    "action_kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "payload" JSONB NOT NULL,
    "status" "ProcessConfirmationStatus" NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMP(3),
    "decided_by_user_id" UUID,
    "result_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "process_confirmations_owner_user_id_status_created_at_idx"
  ON "process_confirmations"("owner_user_id", "status", "created_at" DESC);
CREATE INDEX "process_confirmations_contact_id_status_idx"
  ON "process_confirmations"("contact_id", "status");
CREATE INDEX "process_confirmations_organization_id_status_created_at_idx"
  ON "process_confirmations"("organization_id", "status", "created_at" DESC);
