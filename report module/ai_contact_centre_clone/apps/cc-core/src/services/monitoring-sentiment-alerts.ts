import { createLogger } from "@ai-contact-center/observability";

import { serializeEntityId } from "../lib/id-schema.js";
import { formatPersonDisplayName } from "../lib/person-display-name.js";
import type { DbClient } from "../lib/rls.js";

const logger = createLogger({ service: "cc-core-monitoring" });

export type SentimentSupervisorAlert = {
  id: string;
  type: "sentiment_very_negative";
  severity: "critical";
  title: string;
  detail: string;
  conversationId: string;
  channel: string;
  customerName: string;
  agentName: string;
  queueName: string | null;
  subject: string | null;
  side: "customer" | "agent";
  createdAt: string;
};

type SentimentAlertRow = {
  conversation_id: bigint;
  channel: string;
  subject: string | null;
  queue_name: string | null;
  customer_name: string | null;
  visitor_id: string | null;
  agent_name: string | null;
  customer_label: string;
  agent_label: string;
  created_at: Date;
};

const CHANNEL_LABELS: Record<string, string> = {
  voice: "Voice",
  webchat: "Web Chat",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
};

export function sentimentChannelLabel(channel: string): string {
  const key = channel.trim().toLowerCase();
  return CHANNEL_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Conversation");
}

export function sentimentAlertCopy(input: {
  side: "customer" | "agent";
  customerName: string;
  agentName: string;
  channelLabel: string;
}): { title: string; detail: string } {
  if (input.side === "customer") {
    return {
      title: `customer ${input.customerName}'s sentiment score went very negative`,
      detail: `Agent ${input.agentName} is handling this ${input.channelLabel} conversation.`,
    };
  }
  return {
    title: `Agent ${input.agentName}'s sentiment score went very negative`,
    detail: `While handling customer ${input.customerName} on ${input.channelLabel}.`,
  };
}

function displayCustomer(row: SentimentAlertRow): string {
  return formatPersonDisplayName({
    fullName: row.customer_name,
    visitorId: row.visitor_id,
    fallback: "Customer",
  });
}

function displayAgent(row: SentimentAlertRow): string {
  const name = row.agent_name?.trim();
  return name || "Agent";
}

export async function listVeryNegativeSentimentAlerts(
  db: DbClient,
  organizationId: string,
): Promise<SentimentSupervisorAlert[]> {
  let rows: SentimentAlertRow[];
  try {
    rows = await db.$queryRaw<SentimentAlertRow[]>`
      SELECT
        c.id AS conversation_id,
        c.channel,
        c.subject,
        q.name AS queue_name,
        COALESCE(
          NULLIF(TRIM(CONCAT(NULLIF(TRIM(cp.first_name), ''), ' ', NULLIF(TRIM(cp.last_name), ''))), ''),
          NULLIF(TRIM(cp.first_name), ''),
          NULLIF(TRIM(cp.last_name), ''),
          NULLIF(c.subject, '')
        ) AS customer_name,
        c.visitor_id,
        NULLIF(TRIM(a.display_name), '') AS agent_name,
        latest.customer_label,
        latest.agent_label,
        latest.created_at
      FROM ccass.conversations c
      JOIN LATERAL (
        SELECT customer_label, agent_label, created_at
        FROM ccass.conversation_sentiment_turns
        WHERE organization_id = c.organization_id
          AND conversation_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON TRUE
      LEFT JOIN ccass.queues q ON q.id = c.queue_id
      LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
      LEFT JOIN cdp.customer_profile cp
        ON cp.cdp_id = c.contact_id
       AND cp.organization_id = c.organization_id
      WHERE c.organization_id = ${organizationId}::bigint
        AND c.status IN ('assigned', 'active')
        AND c.assigned_agent_id IS NOT NULL
        AND (
          latest.customer_label = 'very_negative'
          OR latest.agent_label = 'very_negative'
        )
      ORDER BY latest.created_at DESC
      LIMIT 20
    `;
  } catch (error) {
    logger.warn({ err: error }, "sentiment supervisor alerts skipped");
    return [];
  }

  const alerts: SentimentSupervisorAlert[] = [];
  for (const row of rows) {
    const conversationId = serializeEntityId(row.conversation_id);
    const customerName = displayCustomer(row);
    const agentName = displayAgent(row);
    const channelLabel = sentimentChannelLabel(row.channel);
    const createdAt = row.created_at.toISOString();
    const shared = {
      severity: "critical" as const,
      conversationId,
      channel: row.channel,
      customerName,
      agentName,
      queueName: row.queue_name,
      subject: row.subject,
      createdAt,
    };

    if (row.customer_label === "very_negative") {
      const copy = sentimentAlertCopy({
        side: "customer",
        customerName,
        agentName,
        channelLabel,
      });
      alerts.push({
        ...shared,
        id: `sentiment-customer-${conversationId}`,
        type: "sentiment_very_negative",
        side: "customer",
        title: copy.title,
        detail: copy.detail,
      });
    }

    if (row.agent_label === "very_negative") {
      const copy = sentimentAlertCopy({
        side: "agent",
        customerName,
        agentName,
        channelLabel,
      });
      alerts.push({
        ...shared,
        id: `sentiment-agent-${conversationId}`,
        type: "sentiment_very_negative",
        side: "agent",
        title: copy.title,
        detail: copy.detail,
      });
    }
  }

  return alerts;
}
