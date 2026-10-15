import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await db.$executeRaw`CREATE SCHEMA IF NOT EXISTS cdp`;
  await db.$executeRaw`
    CREATE TABLE IF NOT EXISTS cdp.interactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      conversation_id UUID NOT NULL,
      contact_id UUID,
      profile_id UUID,
      visitor_id VARCHAR(128),
      channel VARCHAR(32) NOT NULL,
      queue_id UUID,
      agent_id UUID,
      status VARCHAR(32) NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      outcome VARCHAR(64),
      summary TEXT,
      topics JSONB NOT NULL DEFAULT '[]',
      sentiment VARCHAR(32),
      disposition_code VARCHAR(64),
      sla_result VARCHAR(32),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT cdp_interactions_org_conversation_key UNIQUE (organization_id, conversation_id)
    )
  `;
  await db.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_cdp_interactions_org_activity
      ON cdp.interactions (organization_id, last_activity_at DESC)
  `;
  await db.$executeRaw`
    CREATE TABLE IF NOT EXISTS cdp.interaction_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      interaction_id UUID NOT NULL REFERENCES cdp.interactions(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL,
      message_id UUID,
      event_type VARCHAR(64) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_cdp_interaction_events_interaction
      ON cdp.interaction_events (interaction_id, occurred_at ASC)
  `;
});

const tables = await ccPrisma.$queryRaw<Array<{ table_name: string }>>`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'cdp'
    AND table_name IN ('interactions', 'interaction_events')
  ORDER BY table_name
`;
console.log(JSON.stringify({ created: tables }, null, 2));
await ccPrisma.$disconnect();
