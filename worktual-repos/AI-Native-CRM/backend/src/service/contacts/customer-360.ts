/**
 * Customer 360 for one contact. Reads CDP only. Does not repeat name, email,
 * phone, company, title, industry, or location — those stay on the contact.
 */

import { accountQuery } from "@/dao/db/account-pool";
import { getContact } from "@/dao/contacts/contact-service";
import { loadContactCampaigns } from "@/service/contacts/customer-360-campaigns";
import {
  describeCustomerEvent,
  eventNamesForBusinessType,
  type CustomerEventFact,
} from "@/service/contacts/customer-event-brief";
import {
  filterDuplicateRecommendations,
  sanitizeCustomer360Insight,
  sanitizeCustomer360Recommendation,
} from "@/service/contacts/customer-360-ai-present";
import type { BusinessType } from "@/config/modules";
import {
  ForbiddenError,
  getCurrentBusinessType,
  getCurrentOrganizationId,
} from "@/service/auth/require-role";
import { assertRecordAccess } from "@/service/auth/ownership-scope";

export type Customer360Score = {
  churn: number | null;
  loyalty: number | null;
  value: number | null;
  purchaseProbability: number | null;
  retention: number | null;
  advocacy: number | null;
  webEngagement: number | null;
  predictedLtv: number | null;
  nextPurchaseDays: number | null;
  updatedAt: string | null;
};

export type Customer360Web = {
  sessions: number | null;
  pageViews: number | null;
  avgSessionDuration: number | null;
  bounceRate: number | null;
  scrollDepth: number | null;
  conversions: number | null;
  daysSinceLastSeen: number | null;
  metricDate: string | null;
};

export type Customer360Spend = {
  journeyStage: string | null;
  totalOrders: number | null;
  totalSpend: number | null;
  avgOrderValue: number | null;
  lastPurchaseAt: string | null;
  updatedAt: string | null;
};

export type Customer360OrderItem = {
  productId: string | null;
  quantity: number | null;
  unitPrice: number | null;
};

export type Customer360Order = {
  orderId: string;
  number: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  createdAt: string | null;
  items: Customer360OrderItem[];
};

export type Customer360Ticket = {
  ticketId: string;
  ticketNumber: string | null;
  subject: string | null;
  channel: string | null;
  category: string | null;
  priority: string | null;
  assignee: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  csat: number | null;
  summary: string | null;
  occurredAt: string | null;
};

export type Customer360Event = {
  name: string;
  channel: string | null;
  page: string | null;
  amount: number | null;
  occurredAt: string | null;
  /** Set for campaign opens so a matching Campaigns row can be skipped. */
  campaignTitle?: string | null;
};

export type FirstTouchAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  deviceType: string | null;
  country: string | null;
};

export type Customer360Insight = {
  type: string;
  score: number | null;
  summary: string | null;
  explanation: string | null;
  generatedAt: string | null;
};

export type Customer360Recommendation = {
  type: string;
  text: string | null;
  confidence: number | null;
  generatedAt: string | null;
};

export type Customer360Segment = {
  name: string;
  assignedAt: string | null;
};

export type Customer360Campaign = {
  runId: string;
  title: string;
  channel: string;
  status: string;
  sentAt: string | null;
};

export type Customer360Profile = {
  acquisitionChannel: string | null;
  acquisitionDate: string | null;
  firstReferrer: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  blocked: boolean | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  deviceType: string | null;
  country: string | null;
  consent: Array<{ key: string; value: string }>;
  preferences: Array<{ key: string; value: string }>;
};

export type Customer360View = {
  scores: Customer360Score | null;
  web: Customer360Web | null;
  spend: Customer360Spend | null;
  orders: Customer360Order[];
  tickets: Customer360Ticket[];
  events: Customer360Event[];
  insights: Customer360Insight[];
  recommendations: Customer360Recommendation[];
  nextBestAction: string | null;
  nextBestActionAt: string | null;
  segments: Customer360Segment[];
  campaigns: Customer360Campaign[];
  profile: Customer360Profile | null;
  hasContent: boolean;
};

const INSIGHT_TYPES = [
  "attrition_risk",
  "conversion_likelihood",
  "future_value",
  "product_affinity",
  "next_purchase_timing",
];

const RECOMMENDATION_TYPES = ["product_affinity", "next_purchase_timing"];

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || /^\{[^}]+\}$/.test(s)) return null;
  return s;
}

function iso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? text(value) : date.toISOString();
}

function jsonPairs(value: unknown): Array<{ key: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const pairs: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null || raw === "") continue;
    if (typeof raw === "object") {
      if (Array.isArray(raw) && raw.length === 0) continue;
      if (!Array.isArray(raw) && Object.keys(raw as object).length === 0) continue;
      pairs.push({ key, value: JSON.stringify(raw) });
    } else {
      pairs.push({ key, value: String(raw) });
    }
    if (pairs.length >= 12) break;
  }
  return pairs;
}

function scoresFrom(row: Record<string, unknown> | undefined): Customer360Score | null {
  if (!row) return null;
  const scores: Customer360Score = {
    churn: num(row.churn_score),
    loyalty: num(row.loyalty_score),
    value: num(row.value_score),
    purchaseProbability: num(row.purchase_probability),
    retention: num(row.retention_score),
    advocacy: num(row.advocacy_score),
    webEngagement: num(row.web_engagement_score),
    predictedLtv: num(row.predicted_ltv),
    nextPurchaseDays: num(row.next_purchase_days),
    updatedAt: iso(row.updated_at),
  };
  const filled = Object.entries(scores).some(
    ([key, value]) => key !== "updatedAt" && value != null,
  );
  return filled ? scores : null;
}

function webFrom(row: Record<string, unknown> | undefined): Customer360Web | null {
  if (!row) return null;
  const web: Customer360Web = {
    sessions: num(row.session_count),
    pageViews: num(row.total_page_views),
    avgSessionDuration: num(row.avg_session_duration),
    bounceRate: num(row.bounce_rate),
    scrollDepth: num(row.avg_scroll_depth),
    conversions: num(row.conversion_count),
    daysSinceLastSeen: num(row.last_seen_days),
    metricDate: text(row.metric_date),
  };
  const filled = Object.entries(web).some(
    ([key, value]) => key !== "metricDate" && value != null,
  );
  return filled ? web : null;
}

function spendFrom(row: Record<string, unknown> | undefined): Customer360Spend | null {
  if (!row) return null;
  const spend: Customer360Spend = {
    journeyStage: text(row.journey_stage),
    totalOrders: num(row.total_orders),
    totalSpend: num(row.total_spend),
    avgOrderValue: num(row.avg_order_value),
    lastPurchaseAt: iso(row.last_purchase_at),
    updatedAt: iso(row.updated_at),
  };
  const filled = Object.entries(spend).some(
    ([key, value]) => key !== "updatedAt" && value != null,
  );
  return filled ? spend : null;
}

function profileFrom(row: Record<string, unknown> | undefined): Customer360Profile | null {
  if (!row) return null;
  const profile: Customer360Profile = {
    acquisitionChannel: text(row.acquisition_channel),
    acquisitionDate: text(row.acquisition_date),
    firstReferrer: text(row.first_referrer),
    firstSeenAt: iso(row.first_seen_at),
    lastSeenAt: iso(row.last_seen_at),
    blocked: row.blocked == null ? null : Boolean(row.blocked),
    utmMedium: null,
    utmCampaign: null,
    deviceType: null,
    country: null,
    consent: jsonPairs(row.consent_json),
    preferences: jsonPairs(row.preferences_json),
  };
  const filled =
    profile.acquisitionChannel ||
    profile.acquisitionDate ||
    profile.firstReferrer ||
    profile.firstSeenAt ||
    profile.lastSeenAt ||
    profile.blocked ||
    profile.utmMedium ||
    profile.utmCampaign ||
    profile.deviceType ||
    profile.country ||
    profile.consent.length ||
    profile.preferences.length;
  return filled ? profile : null;
}

function profileWithAttribution(
  profile: Customer360Profile | null,
  touch: FirstTouchAttribution | null,
): Customer360Profile | null {
  if (!touch?.utmMedium && !touch?.utmCampaign && !touch?.deviceType && !touch?.country) {
    return profile;
  }
  const base: Customer360Profile = profile ?? {
    acquisitionChannel: null,
    acquisitionDate: null,
    firstReferrer: null,
    firstSeenAt: null,
    lastSeenAt: null,
    blocked: null,
    utmMedium: null,
    utmCampaign: null,
    deviceType: null,
    country: null,
    consent: [],
    preferences: [],
  };
  return {
    ...base,
    utmMedium: touch.utmMedium,
    utmCampaign: touch.utmCampaign,
    deviceType: touch.deviceType,
    country: touch.country,
  };
}

async function one(
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown> | undefined> {
  const result = await accountQuery<Record<string, unknown>>(sql, params);
  return result.rows[0];
}

async function many(
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  const result = await accountQuery<Record<string, unknown>>(sql, params);
  return result.rows;
}

export async function loadFirstTouchAttribution(
  organizationId: string,
  cdpId: string,
): Promise<FirstTouchAttribution | null> {
  const row = await one(
    `
    SELECT
      (ARRAY_AGG(NULLIF(BTRIM(utm_source), '') ORDER BY occurred_at)
        FILTER (WHERE NULLIF(BTRIM(utm_source), '') IS NOT NULL))[1] AS utm_source,
      (ARRAY_AGG(NULLIF(BTRIM(utm_medium), '') ORDER BY occurred_at)
        FILTER (WHERE NULLIF(BTRIM(utm_medium), '') IS NOT NULL))[1] AS utm_medium,
      (ARRAY_AGG(NULLIF(BTRIM(utm_campaign), '') ORDER BY occurred_at)
        FILTER (WHERE NULLIF(BTRIM(utm_campaign), '') IS NOT NULL))[1] AS utm_campaign,
      (ARRAY_AGG(NULLIF(BTRIM(device_type), '') ORDER BY occurred_at)
        FILTER (WHERE NULLIF(BTRIM(device_type), '') IS NOT NULL))[1] AS device_type,
      (ARRAY_AGG(NULLIF(BTRIM(country), '') ORDER BY occurred_at)
        FILTER (WHERE NULLIF(BTRIM(country), '') IS NOT NULL))[1] AS country
    FROM cdp.customer_events
    WHERE organization_id = $1::bigint AND cdp_id = $2
    `,
    [organizationId, cdpId],
  );
  if (!row) return null;
  const touch: FirstTouchAttribution = {
    utmSource: text(row.utm_source),
    utmMedium: text(row.utm_medium),
    utmCampaign: text(row.utm_campaign),
    deviceType: text(row.device_type),
    country: text(row.country),
  };
  const filled = Object.values(touch).some(Boolean);
  return filled ? touch : null;
}

export async function loadCustomer360(
  organizationId: string,
  cdpId: string,
  businessType: BusinessType,
): Promise<Customer360View> {
  const params = [organizationId, cdpId];
  const eventNames = eventNamesForBusinessType(businessType);
  const [
    scoreRow,
    webRow,
    spendRow,
    orderRows,
    ticketRows,
    eventRows,
    attribution,
    insightRows,
    recommendationRows,
    nbaRow,
    segmentRows,
    profileRow,
  ] = await Promise.all([
    one(
      `
      SELECT churn_score, loyalty_score, value_score, purchase_probability,
             retention_score, advocacy_score, web_engagement_score,
             predicted_ltv, next_purchase_days, updated_at
      FROM cdp.customer_scores
      WHERE organization_id = $1::bigint AND cdp_id = $2
      LIMIT 1
      `,
      params,
    ),
    one(
      `
      SELECT metric_date, session_count, total_page_views, avg_session_duration,
             bounce_rate, avg_scroll_depth, conversion_count, last_seen_days
      FROM cdp.customer_metrics
      WHERE organization_id = $1::bigint AND cdp_id = $2
      ORDER BY metric_date DESC
      LIMIT 1
      `,
      params,
    ),
    one(
      `
      SELECT journey_stage, total_orders, total_spend, avg_order_value,
             last_purchase_at, updated_at
      FROM cdp.gold_customer_metrics
      WHERE organization_id = $1::bigint AND cdp_id = $2
      LIMIT 1
      `,
      params,
    ),
    many(
      `
      SELECT o.order_id::text, o.order_number, o.status, o.total_amount, o.currency,
             o.payment_status, o.fulfillment_status, o.created_at,
             i.product_id, i.quantity, i.unit_price
      FROM (
        SELECT order_id, order_number, status, total_amount, currency,
               payment_status, fulfillment_status, created_at, organization_id
        FROM cdp.orders
        WHERE organization_id = $1::bigint AND cdp_id = $2
        ORDER BY created_at DESC
        LIMIT 8
      ) o
      LEFT JOIN cdp.order_items i
        ON i.order_id = o.order_id AND i.organization_id = o.organization_id
      ORDER BY o.created_at DESC, i.order_item_id
      `,
      params,
    ),
    many(
      `
      SELECT ticket_id, ticket_number, subject, channel, category, priority,
             assignee, due_at, resolved_at, csat, summary, occurred_at
      FROM (
        SELECT DISTINCT ON (properties_json->>'ticket_id')
          properties_json->>'ticket_id' AS ticket_id,
          properties_json->>'ticket_number' AS ticket_number,
          properties_json->>'subject' AS subject,
          properties_json->>'channel' AS channel,
          properties_json->>'category' AS category,
          properties_json->>'priority' AS priority,
          properties_json->>'assignee_name' AS assignee,
          properties_json->>'due_at' AS due_at,
          properties_json->>'resolved_at' AS resolved_at,
          properties_json->>'csat_score' AS csat,
          properties_json->>'ai_summary' AS summary,
          occurred_at
        FROM cdp.customer_events
        WHERE organization_id = $1::bigint
          AND cdp_id = $2
          AND event_name LIKE 'ticketing.ticket%'
          AND NULLIF(BTRIM(properties_json->>'ticket_id'), '') IS NOT NULL
        ORDER BY properties_json->>'ticket_id', occurred_at DESC
      ) tickets
      ORDER BY occurred_at DESC
      LIMIT 8
      `,
      params,
    ),
    many(
      `
      SELECT event_name, channel, page_path, page_title, amount, currency,
             occurred_at, properties_json
      FROM cdp.customer_events
      WHERE organization_id = $1::bigint
        AND cdp_id = $2
        AND event_name = ANY($3::text[])
      ORDER BY occurred_at DESC
      LIMIT 8
      `,
      [organizationId, cdpId, eventNames],
    ),
    loadFirstTouchAttribution(organizationId, cdpId).catch(() => null),
    many(
      `
      SELECT insight_type, score, summary, explanation, generated_at
      FROM (
        SELECT DISTINCT ON (insight_type)
          insight_type, score, summary, explanation, generated_at
        FROM cdp.ai_insights
        WHERE organization_id = $1::bigint
          AND cdp_id = $2
          AND insight_type = ANY($3::text[])
        ORDER BY insight_type, generated_at DESC
      ) insights
      ORDER BY generated_at DESC
      `,
      [organizationId, cdpId, INSIGHT_TYPES],
    ),
    many(
      `
      SELECT recommendation_type, recommendation, confidence, generated_at
      FROM (
        SELECT DISTINCT ON (recommendation_type)
          recommendation_type, recommendation, confidence, generated_at
        FROM cdp.customer_recommendations
        WHERE organization_id = $1::bigint
          AND cdp_id = $2
          AND recommendation_type = ANY($3::text[])
        ORDER BY recommendation_type, generated_at DESC
      ) recs
      ORDER BY generated_at DESC
      `,
      [organizationId, cdpId, RECOMMENDATION_TYPES],
    ),
    one(
      `
      SELECT nba_action, updated_at
      FROM cdp.nba_nbo
      WHERE organization_id = $1::bigint AND cdp_id = $2
        AND NULLIF(BTRIM(nba_action), '') IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
      `,
      params,
    ),
    many(
      `
      SELECT d.segment_name, s.assigned_at
      FROM cdp.customer_segments s
      JOIN cdp.segment_definitions d
        ON d.segment_id = s.segment_id
       AND d.organization_id = s.organization_id
      WHERE s.organization_id = $1::bigint AND s.cdp_id = $2
        AND NULLIF(BTRIM(d.segment_name), '') IS NOT NULL
      ORDER BY s.assigned_at DESC NULLS LAST
      LIMIT 12
      `,
      params,
    ),
    one(
      `
      SELECT acquisition_channel, acquisition_date, first_referrer,
             first_seen_at, last_seen_at, blocked, consent_json, preferences_json
      FROM cdp.customer_profile
      WHERE organization_id = $1::bigint AND cdp_id = $2
      LIMIT 1
      `,
      params,
    ),
  ]);

  const orders = new Map<string, Customer360Order>();
  for (const row of orderRows) {
    const orderId = text(row.order_id);
    if (!orderId) continue;
    let order = orders.get(orderId);
    if (!order) {
      order = {
        orderId,
        number: text(row.order_number),
        status: text(row.status),
        amount: num(row.total_amount),
        currency: text(row.currency),
        paymentStatus: text(row.payment_status),
        fulfillmentStatus: text(row.fulfillment_status),
        createdAt: iso(row.created_at),
        items: [],
      };
      orders.set(orderId, order);
    }
    if (text(row.product_id) || num(row.quantity) != null) {
      order.items.push({
        productId: text(row.product_id),
        quantity: num(row.quantity),
        unitPrice: num(row.unit_price),
      });
    }
  }

  const view: Customer360View = {
    scores: scoresFrom(scoreRow),
    web: webFrom(webRow),
    spend: spendFrom(spendRow),
    orders: [...orders.values()],
    tickets: ticketRows.flatMap((row) => {
      const ticketId = text(row.ticket_id);
      if (!ticketId) return [];
      return [
        {
          ticketId,
          ticketNumber: text(row.ticket_number),
          subject: text(row.subject),
          channel: text(row.channel),
          category: text(row.category),
          priority: text(row.priority),
          assignee: text(row.assignee),
          dueAt: iso(row.due_at),
          resolvedAt: iso(row.resolved_at),
          csat: num(row.csat),
          summary: text(row.summary),
          occurredAt: iso(row.occurred_at),
        },
      ];
    }),
    events: eventRows.flatMap((row) => {
      const eventName = text(row.event_name);
      if (!eventName) return [];
      const properties =
        row.properties_json && typeof row.properties_json === "object" && !Array.isArray(row.properties_json)
          ? (row.properties_json as Record<string, unknown>)
          : null;
      const fact: CustomerEventFact = {
        eventName,
        channel: text(row.channel),
        pagePath: text(row.page_path),
        pageTitle: text(row.page_title),
        amount: num(row.amount),
        currency: text(row.currency),
        occurredAt: iso(row.occurred_at),
        properties,
      };
      const described = describeCustomerEvent(fact);
      return described ? [described] : [];
    }),
    insights: insightRows.flatMap((row) => {
      const type = text(row.insight_type);
      if (!type) return [];
      const score = num(row.score);
      const cleaned = sanitizeCustomer360Insight({
        type,
        score,
        summary: text(row.summary),
        explanation: text(row.explanation),
      });
      if (!cleaned.summary && !cleaned.explanation && score == null) return [];
      return [
        {
          type,
          score,
          summary: cleaned.summary,
          explanation: cleaned.explanation,
          generatedAt: iso(row.generated_at),
        },
      ];
    }),
    recommendations: recommendationRows.flatMap((row) => {
      const type = text(row.recommendation_type);
      if (!type) return [];
      const body = sanitizeCustomer360Recommendation({
        type,
        text: text(row.recommendation),
      });
      if (!body) return [];
      return [
        {
          type,
          text: body,
          confidence: num(row.confidence),
          generatedAt: iso(row.generated_at),
        },
      ];
    }),
    nextBestAction: text(nbaRow?.nba_action),
    nextBestActionAt: iso(nbaRow?.updated_at),
    segments: segmentRows.flatMap((row) => {
      const name = text(row.segment_name);
      if (!name) return [];
      return [{ name, assignedAt: iso(row.assigned_at) }];
    }),
    campaigns: [],
    profile: profileWithAttribution(profileFrom(profileRow), attribution),
    hasContent: false,
  };
  view.recommendations = filterDuplicateRecommendations(
    view.insights,
    view.recommendations,
  );
  view.hasContent = Boolean(
    view.scores ||
      view.web ||
      view.spend ||
      view.orders.length ||
      view.tickets.length ||
      view.events.length ||
      view.insights.length ||
      view.recommendations.length ||
      view.nextBestAction ||
      view.segments.length ||
      view.campaigns.length ||
      view.profile,
  );
  return view;
}

export async function getCustomer360Command(contactId: string) {
  const contact = await getContact(contactId);
  if (!contact) {
    return { ok: false as const, error: "Contact not found.", status: 404 };
  }
  try {
    await assertRecordAccess(
      contact.crm.ownerUserId,
      undefined,
      contact.person.companyId,
      contact.crm.createdByUserId,
    );
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false as const, error: err.message, status: 403 };
    }
    throw err;
  }
  const organizationId =
    contact.person.organizationId?.trim() || (await getCurrentOrganizationId());
  const businessType = await getCurrentBusinessType();
  const customer360 = await loadCustomer360(organizationId, contactId, businessType);
  customer360.campaigns = await loadContactCampaigns(
    organizationId,
    contactId,
    contact.person.email?.trim() || null,
  ).catch(() => []);
  const campaignTitles = new Set(
    customer360.campaigns.map((campaign) => campaign.title.trim().toLowerCase()).filter(Boolean),
  );
  customer360.events = customer360.events.filter((event) => {
    const title = event.campaignTitle?.trim().toLowerCase();
    return !title || !campaignTitles.has(title);
  });
  if (customer360.campaigns.length || customer360.events.length) customer360.hasContent = true;
  return { ok: true as const, customer360 };
}
