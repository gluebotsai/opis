import { ccPrisma } from "@ai-contact-center/db-cc";

import { CcCoreClient } from "./cc-core-client.js";
import { loadE2eConfig } from "./e2e-config.js";

export type PreflightResult = {
  ok: boolean;
  errors: string[];
  organizationId?: string;
  webchatId?: string;
  whatsappChannelConfigId?: string;
  whatsappPhoneNumberId?: string;
};

async function checkHttp(name: string, url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      return `${name} unhealthy (${response.status}) at ${url}`;
    }
    return null;
  } catch (error) {
    return `${name} unreachable at ${url}: ${error instanceof Error ? error.message : error}`;
  }
}

export async function runPreflight(options: { requireStack?: boolean } = {}): Promise<PreflightResult> {
  const config = loadE2eConfig();
  const errors: string[] = [];
  const requireStack = options.requireStack ?? true;

  if (requireStack) {
    for (const [name, url] of [
      ["cc-core", `${config.ccCoreUrl}/health`],
      ["chat-service", `${config.chatServiceUrl}/health`],
      ["social-service", `${config.socialServiceUrl}/health`],
      ["nlp", `${config.nlpUrl}/health`],
    ] as const) {
      const error = await checkHttp(name, url);
      if (error) errors.push(error);
    }
  }

  let organizationId: string | undefined;
  let webchatId: string | undefined;
  let whatsappChannelConfigId: string | undefined;
  let whatsappPhoneNumberId: string | undefined;

  try {
    await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    let orgId = process.env.ORGANIZATION_ID;
    if (!orgId) {
      const org = await ccPrisma.organizations.findFirst({
        where: { lifecycle_status: "active" },
        orderBy: { created_at: "desc" },
        select: { id: true },
      });
      orgId = org?.id;
    }
    organizationId = orgId;

    if (organizationId) {
      const webchatRows = await ccPrisma.$queryRaw<Array<{ webchat_id: string }>>`
        SELECT config.webchat_id
        FROM accounts.setup_webchat_configs config
        INNER JOIN accounts.setup_channel_configs channel ON channel.id = config.channel_config_id
        WHERE channel.organization_id = ${organizationId}::bigint
          AND channel.status = 'active'
        LIMIT 1
      `;
      webchatId = webchatRows[0]?.webchat_id;

      const waRows = await ccPrisma.$queryRaw<
        Array<{ channel_config_id: string; phone_number_id: string | null }>
      >`
        SELECT channel.id AS channel_config_id, NULL::text AS phone_number_id
        FROM accounts.setup_channel_configs channel
        WHERE channel.organization_id = ${organizationId}::bigint
          AND channel.channel_type = 'whatsapp'
          AND channel.status = 'active'
        LIMIT 1
      `.catch(() => [] as Array<{ channel_config_id: string; phone_number_id: string | null }>);
      whatsappChannelConfigId = waRows[0]?.channel_config_id;
      whatsappPhoneNumberId = waRows[0]?.phone_number_id ?? undefined;
    }
  } catch (error) {
    errors.push(`Database preflight failed: ${error instanceof Error ? error.message : error}`);
  }

  if (requireStack && organizationId) {
    try {
      await new CcCoreClient(config).loginAgent();
    } catch (error) {
      const message = `Agent login failed: ${error instanceof Error ? error.message : error}`;
      if (process.env.E2E_REQUIRE_AGENT_LOGIN === "true") {
        errors.push(message);
      } else {
        console.warn(`Preflight warning: ${message}`);
      }
    }
  }

  if (!organizationId) {
    errors.push("No active organization found in database");
  }

  return {
    ok: errors.length === 0,
    errors,
    organizationId,
    webchatId,
    whatsappChannelConfigId,
    whatsappPhoneNumberId,
  };
}
