-- Channel templates + per-template edit chat messages

CREATE TABLE "campaign_channel_templates" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "logo" TEXT,
    "launch_at" TEXT,
    "how_it_works" TEXT,
    "fields" JSONB NOT NULL,
    "generation_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_channel_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campaign_template_messages" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_template_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_channel_templates_session_id_created_at_idx" ON "campaign_channel_templates"("session_id", "created_at");
CREATE INDEX "campaign_channel_templates_tenant_id_branch_id_idx" ON "campaign_channel_templates"("tenant_id", "branch_id");
CREATE INDEX "campaign_template_messages_template_id_seq_idx" ON "campaign_template_messages"("template_id", "seq");

CREATE UNIQUE INDEX "campaign_template_messages_template_id_seq_key" ON "campaign_template_messages"("template_id", "seq");

ALTER TABLE "campaign_channel_templates" ADD CONSTRAINT "campaign_channel_templates_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "campaign_agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaign_template_messages" ADD CONSTRAINT "campaign_template_messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "campaign_channel_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
