import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@ai-contact-center/db-cc";
import type Redis from "ioredis";

import { parseEntityId } from "../lib/id-schema.js";
import { createRedisClient } from "../lib/redis-client.js";
import type { DbClient } from "../lib/rls.js";
import { withStaffContext } from "../lib/rls.js";

let campaignRedis: Redis | null = null;
let campaignRedisUrl: string | null = null;

const AUTO_BOT_CALL = "AUTO_BOT_CALL";

export function campaignAcdChannel(): string {
  return process.env.CAMPAIGN_ACD_CHANNEL?.trim() || "CAMPAIGN_ACD_QA_70";
}

export function campaignAcdRedisUrl(): string | null {
  const dedicated = process.env.CAMPAIGN_ACD_REDIS_URL?.trim();
  return dedicated || null;
}

export function buildAutoBotCallMessage(input: {
  organizationId: string;
  domainName: string;
  sessionId: string;
  customerNumber: string;
  cli: string;
  data: Record<string, unknown>;
  instruction: string;
}): Record<string, unknown> {
  return {
    domainId: input.organizationId,
    domainName: input.domainName,
    session_id: input.sessionId,
    req_type: AUTO_BOT_CALL,
    ddi: input.customerNumber,
    cli: input.cli,
    data: input.data,
    instruction: input.instruction,
  };
}

async function loadSipDomainName(db: DbClient, organizationId: string): Promise<string | null> {
  const org = await db.organizations.findFirst({
    where: { id: parseEntityId(organizationId) },
    select: { sip_domain_name: true },
  });
  return org?.sip_domain_name?.trim() || null;
}

/** First active DID that is confirmed to an active queue. */
async function loadAutoBotCli(db: DbClient, organizationId: string): Promise<string | null> {
  const did = await db.setup_voice_dids.findFirst({
    where: {
      organization_id: parseEntityId(organizationId),
      status: "active",
      routing_queue_id: { not: null },
      setup_ccaas_queues: { status: "active" },
    },
    orderBy: { id: "asc" },
    select: { phone_number: true },
  });
  return did?.phone_number?.trim() || null;
}

export async function resolveCampaignRedis(fallback: Redis | null): Promise<Redis | null> {
  const url = campaignAcdRedisUrl();
  if (!url) return fallback;
  if (campaignRedis && campaignRedisUrl === url) return campaignRedis;
  campaignRedis = await createRedisClient(url);
  campaignRedisUrl = url;
  return campaignRedis;
}

export async function publishAutoBotCall(
  prisma: PrismaClient,
  redis: Redis,
  input: {
    organizationId: string;
    customerNumber: string;
    data: Record<string, unknown>;
    instruction: string;
  },
): Promise<{ sessionId: string; channel: string; cli: string; domainName: string }> {
  const organizationId = input.organizationId.trim();
  const customerNumber = input.customerNumber.trim();
  const loaded = await withStaffContext(prisma, async (db) => {
    const domainName = await loadSipDomainName(db, organizationId);
    const cli = domainName ? await loadAutoBotCli(db, organizationId) : null;
    return { domainName, cli };
  });

  if (!loaded.domainName) {
    throw Object.assign(new Error("Organization domain is not configured"), { status: 404 });
  }
  if (!loaded.cli) {
    throw Object.assign(new Error("No queued voice number is configured for this organization"), {
      status: 404,
    });
  }

  const sessionId = randomUUID();
  const channel = campaignAcdChannel();
  const message = buildAutoBotCallMessage({
    organizationId,
    domainName: loaded.domainName,
    sessionId,
    customerNumber,
    cli: loaded.cli,
    data: input.data,
    instruction: input.instruction,
  });
  await redis.publish(channel, JSON.stringify(message));
  return { sessionId, channel, cli: loaded.cli, domainName: loaded.domainName };
}
