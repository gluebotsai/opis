import type { DbClient } from "../lib/rls.js";
import { serializeEntityId } from "../lib/id-schema.js";
import { resolveChannelPolicy } from "./channel-policies.js";
import { listActiveChatQueues, type ChatQueueCandidate } from "./routing.js";

function asEntityId(value: string | bigint | number | null | undefined): string | null {
  if (value == null) return null;
  return serializeEntityId(value);
}

/** Only persist queue ids that exist in ccass.queues (never setup-queue ids). */
function pickPersistedRoutingQueueId(
  ccassQueueId: string | null,
  policyDefaultQueueId: string | null,
  chatQueues: ChatQueueCandidate[],
): string | null {
  const known = new Set(chatQueues.map((queue) => queue.id));
  if (ccassQueueId && known.has(ccassQueueId)) return ccassQueueId;
  if (policyDefaultQueueId && known.has(policyDefaultQueueId)) return policyDefaultQueueId;
  return null;
}

export type OrganizationDetailsLocation = {
  label: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  workEmail: string | null;
  contactName: string | null;
  isPrimary: boolean;
  status: string;
  timezone: string | null;
};

export type OrganizationDetails = {
  organizationId: string;
  companyName: string | null;
  industryType: string | null;
  businessType: string | null;
  contactName: string | null;
  workEmail: string | null;
  adminEmail: string | null;
  phone: string | null;
  billingAddress: string | null;
  websiteUrl: string | null;
  country: string | null;
  taxNumber: string | null;
  companySize: string | null;
  locations: OrganizationDetailsLocation[];
};

type OrganizationDetailsRow = {
  organization_id: string;
  company_name: string | null;
  industry_type: string | null;
  business_type: string | null;
  contact_name: string | null;
  work_email: string | null;
  admin_email: string | null;
  mobile_country_code: string | null;
  mobile_number: string | null;
  billing_address: string | null;
  website_url: string | null;
  country: string | null;
  tax_number: string | null;
  company_size: string | null;
  locations: OrganizationDetailsLocation[] | null;
};

export type DefaultActiveWebchat = {
  webchatId: string;
  channelConfigId: string;
  title: string;
};

type DefaultActiveWebchatRow = {
  webchat_id: string;
  channel_config_id: string | bigint;
  title: string;
};

export type WebchatOrganizationContext = {
  organizationId: string;
  webchatId: string;
  channelConfigId: string;
  title: string;
  aliasTitle: string;
  description: string | null;
  greetingMessage: string;
  routingSetupQueueId: string | null;
  routingQueueId: string | null;
  routingQueueName: string | null;
  chatQueues: ChatQueueCandidate[];
  nlpEnabled: boolean;
  liveAgentEnabled: boolean;
  companyName: string | null;
  industryType: string | null;
  businessType: string | null;
  websiteUrl: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  primaryLocation: string | null;
  locations: Array<{
    label: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    timezone: string | null;
  }>;
  businessHours: {
    name: string;
    timezone: string | null;
    openTime: string | null;
    closeTime: string | null;
    workingDays: unknown;
  } | null;
  capabilities: string[];
  personalisation: Record<string, unknown>;
  approvedServiceMessage: string | null;
  confidenceThreshold: number;
};

type WebchatContextRow = {
  organization_id: string;
  channel_config_id: string;
  webchat_id: string;
  title: string;
  alias_title: string;
  description: string | null;
  greeting_message: string;
  routing_setup_queue_id: string | null;
  routing_queue_id: string | null;
  routing_queue_name: string | null;
  personalisation: Record<string, unknown> | null;
  company_name: string | null;
  industry_type: string | null;
  business_type: string | null;
  website_url: string | null;
  work_email: string | null;
  mobile_country_code: string | null;
  mobile_number: string | null;
  country: string | null;
  locations: WebchatOrganizationContext["locations"] | null;
  business_hours: WebchatOrganizationContext["businessHours"];
};

const CONTEXT_CACHE_TTL_MS = Number(process.env.WEBCHAT_CONTEXT_CACHE_TTL_MS ?? 60_000);
const contextCache = new Map<
  string,
  { context: WebchatOrganizationContext; expiresAt: number }
>();

function extractCapabilities(personalisation: Record<string, unknown> | null): string[] {
  if (!personalisation) return [];
  const raw = personalisation.capabilities ?? personalisation.services;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function buildPublicPhone(countryCode: string | null, number: string | null): string | null {
  if (!number) return null;
  return countryCode ? `${countryCode} ${number}` : number;
}

/** First active webchat widget for an org (oldest channel by created_at). */
export async function resolveDefaultActiveWebchatId(
  db: DbClient,
  organizationId: string,
): Promise<DefaultActiveWebchat | null> {
  const rows = await db.$queryRaw<DefaultActiveWebchatRow[]>`
    SELECT
      wc.webchat_id,
      wc.channel_config_id,
      wc.title
    FROM accounts.setup_webchat_configs wc
    INNER JOIN accounts.setup_channel_configs cc
      ON cc.id = wc.channel_config_id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND cc.status = 'active'
      AND cc.channel_type IN ('web_chat', 'webchat')
    ORDER BY cc.created_at ASC, wc.webchat_id ASC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    webchatId: row.webchat_id,
    channelConfigId: asEntityId(row.channel_config_id)!,
    title: row.title,
  };
}

export async function resolveWebchatContext(
  db: DbClient,
  webchatId: string,
): Promise<WebchatOrganizationContext | null> {
  const cached = contextCache.get(webchatId);
  if (cached && cached.expiresAt > Date.now()) return cached.context;
  if (cached) contextCache.delete(webchatId);

  const rows = await db.$queryRaw<WebchatContextRow[]>`
    SELECT
      cc.organization_id,
      wc.channel_config_id,
      wc.webchat_id,
      wc.title,
      wc.alias_title,
      wc.description,
      wc.greeting_message,
      wc.routing_queue_id AS routing_setup_queue_id,
      rq.id AS routing_queue_id,
      rq.name AS routing_queue_name,
      wc.personalisation,
      org.company_name,
      org.industry_type,
      org.business_type,
      org.website_url,
      org.work_email,
      org.mobile_country_code,
      org.mobile_number,
      org.country,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'label', location.label,
              'address', location.address,
              'city', location.city,
              'country', location.country,
              'timezone', location.timezone
            )
            ORDER BY location.is_primary DESC, location.label ASC
          )
          FROM accounts.organization_locations location
          WHERE location.organization_id = org.id
            AND location.status = 'active'
        ),
        '[]'::jsonb
      ) AS locations,
      CASE
        WHEN business_hours.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'name', business_hours.name,
          'timezone', business_hours.timezone,
          'openTime', to_char(business_hours.open_time, 'HH24:MI:SS'),
          'closeTime', to_char(business_hours.close_time, 'HH24:MI:SS'),
          'workingDays', business_hours.working_days
        )
      END AS business_hours
    FROM accounts.setup_webchat_configs wc
    INNER JOIN accounts.setup_channel_configs cc
      ON cc.id = wc.channel_config_id
    INNER JOIN accounts.organizations org
      ON org.id = cc.organization_id
    LEFT JOIN accounts.setup_ccaas_queues sq
      ON sq.id = wc.routing_queue_id
    LEFT JOIN ccass.queues rq
      ON rq.setup_queue_id = sq.id
    LEFT JOIN accounts.setup_business_hours business_hours
      ON business_hours.id = sq.business_hours_id
    WHERE wc.webchat_id = ${webchatId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  const personalisation = row.personalisation ?? {};
  const flags = personalisation as { nlpEnabled?: boolean; liveAgentEnabled?: boolean };

  const policy = await resolveChannelPolicy(db, asEntityId(row.organization_id)!, {
    channelConfigId: asEntityId(row.channel_config_id)!,
    channel: "webchat",
  });
  const organizationId = asEntityId(row.organization_id)!;
  const chatQueues = await listActiveChatQueues(db, organizationId);

  const context: WebchatOrganizationContext = {
    organizationId,
    webchatId: row.webchat_id,
    channelConfigId: asEntityId(row.channel_config_id)!,
    title: row.title,
    aliasTitle: row.alias_title,
    description: row.description,
    greetingMessage: row.greeting_message,
    routingSetupQueueId: asEntityId(row.routing_setup_queue_id),
    routingQueueId: pickPersistedRoutingQueueId(
      asEntityId(row.routing_queue_id),
      policy.defaultQueueId,
      chatQueues,
    ),
    routingQueueName: row.routing_queue_name,
    chatQueues,
    nlpEnabled: policy.botEnabled && flags.nlpEnabled !== false,
    liveAgentEnabled: policy.liveAgentEnabled && flags.liveAgentEnabled !== false,
    companyName: row.company_name,
    industryType: row.industry_type,
    businessType: row.business_type,
    websiteUrl: row.website_url,
    publicEmail: row.work_email,
    publicPhone: buildPublicPhone(row.mobile_country_code, row.mobile_number),
    primaryLocation: row.country,
    locations: row.locations ?? [],
    businessHours: row.business_hours,
    capabilities: extractCapabilities(personalisation),
    personalisation,
    approvedServiceMessage:
      policy.handoffMessage ??
      (typeof personalisation.approvedServiceMessage === "string"
        ? personalisation.approvedServiceMessage
        : null),
    confidenceThreshold: policy.confidenceThreshold,
  };
  contextCache.set(webchatId, {
    context,
    expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS,
  });
  return context;
}

export async function getOrganizationDetails(
  db: DbClient,
  organizationId: string,
): Promise<OrganizationDetails | null> {
  const rows = await db.$queryRaw<OrganizationDetailsRow[]>`
    SELECT
      org.id AS organization_id,
      org.company_name,
      org.industry_type,
      org.business_type,
      org.contact_name,
      org.work_email,
      org.admin_email,
      org.mobile_country_code,
      org.mobile_number,
      org.billing_address,
      org.website_url,
      org.country,
      org.tax_number,
      org.company_size,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'label', location.label,
              'address', location.address,
              'city', location.city,
              'country', location.country,
              'workEmail', location.work_email,
              'contactName', location.contact_name,
              'isPrimary', location.is_primary,
              'status', location.status,
              'timezone', location.timezone
            )
            ORDER BY location.is_primary DESC, location.label ASC
          )
          FROM accounts.organization_locations location
          WHERE location.organization_id = org.id
            AND location.status = 'active'
        ),
        '[]'::jsonb
      ) AS locations
    FROM accounts.organizations org
    WHERE org.id = ${organizationId}::bigint
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    organizationId: asEntityId(row.organization_id)!,
    companyName: row.company_name,
    industryType: row.industry_type,
    businessType: row.business_type,
    contactName: row.contact_name,
    workEmail: row.work_email,
    adminEmail: row.admin_email,
    phone: buildPublicPhone(row.mobile_country_code, row.mobile_number),
    billingAddress: row.billing_address,
    websiteUrl: row.website_url,
    country: row.country,
    taxNumber: row.tax_number,
    companySize: row.company_size,
    locations: row.locations ?? [],
  };
}

