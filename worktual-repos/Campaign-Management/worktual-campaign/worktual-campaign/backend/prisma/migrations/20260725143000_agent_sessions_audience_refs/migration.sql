-- CreateTable
CREATE TABLE "campaign_agent_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "module" TEXT NOT NULL DEFAULT 'create_campaign',
    "stage" TEXT NOT NULL DEFAULT 'intake',
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_audience_refs" (
    "session_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,

    CONSTRAINT "campaign_audience_refs_pkey" PRIMARY KEY ("session_id","contact_id")
);

-- CreateIndex
CREATE INDEX "campaign_agent_sessions_tenant_id_branch_id_idx" ON "campaign_agent_sessions"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "campaign_agent_sessions_tenant_id_created_by_user_id_idx" ON "campaign_agent_sessions"("tenant_id", "created_by_user_id");

-- CreateIndex
CREATE INDEX "campaign_audience_refs_contact_id_idx" ON "campaign_audience_refs"("contact_id");

-- AddForeignKey
ALTER TABLE "campaign_agent_sessions" ADD CONSTRAINT "campaign_agent_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_audience_refs" ADD CONSTRAINT "campaign_audience_refs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "campaign_agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
