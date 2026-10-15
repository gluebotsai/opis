import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { CCAAS_USAGE_DETAIL_FIELDS } from "../../lib/ccaasConfiguration.js";
import { DEFAULT_PRICING_CATALOG } from "../../lib/pricingCatalogDefaults.js";
import {
  insertUsageConsumption,
  selectUsageMetricsBySubscription,
  updateUsageConsumption,
  upsertUsageMetric,
} from "../../repositories/raw/usageMetrics.repo.js";
import {
  insertUsageMetricsMonthly,
  resetUsageConsumed,
  selectCurrentUsageMetricsForArchive,
} from "../../repositories/raw/usageMetricsMonthly.repo.js";

const CAMPAIGN_USAGE_CHANNELS = [
  {
    metricKey: "webPushSubscribers",
    qtyKey: "webPushSubscribers",
    catalogKey: "webPush",
    unit: "subscribers",
    freeAllowance: 0,
  },
  {
    metricKey: "appPushSubscribers",
    qtyKey: "appPushSubscribers",
    catalogKey: "appPush",
    unit: "subscribers",
    freeAllowance: 0,
  },
  {
    metricKey: "emailCount",
    qtyKey: "emailCount",
    catalogKey: "email",
    unit: "emails",
    freeAllowance: 1000,
  },
  {
    metricKey: "smsCount",
    qtyKey: "smsCount",
    catalogKey: "sms",
    unit: "messages",
    freeAllowance: 0,
  },
  {
    metricKey: "whatsappCredits",
    qtyKey: "whatsappCredits",
    catalogKey: "whatsapp",
    unit: "credits",
    freeAllowance: 1000,
  },
];

function toAllocated(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveCampaignChannelAllocated(config: any, channelCatalog: any, channel: any) {
  return Math.max(
    toAllocated(config?.[channel.qtyKey]),
    toAllocated(channelCatalog?.[channel.catalogKey]?.defaultCount),
    channel.freeAllowance || 0,
  );
}

function currentPeriodBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function metricDefinitionsForConfig(config: any) {
  const metrics = [];
  const productId = config?.productId;

  if (productId === "contact-center" || config?.pricingMode === "ccaas") {
    const usageDetails = config?.usageDetails || {};
    for (const field of CCAAS_USAGE_DETAIL_FIELDS) {
      const allocated = Number(usageDetails[field.id]);
      if (Number.isFinite(allocated) && allocated > 0) {
        metrics.push({
          metricKey: field.id,
          allocated,
          unit: field.id.includes("Minutes") ? "minutes" : "count",
        });
      }
    }

    const sessionBundle = config?.addons?.sessionBundle;
    if (sessionBundle && sessionBundle !== "none" && sessionBundle !== "custom") {
      metrics.push({
        metricKey: "sessionCount",
        allocated: Number(sessionBundle) || 0,
        unit: "sessions",
      });
    } else if (sessionBundle === "custom") {
      const count = Number(config?.addons?.sessionCount);
      if (Number.isFinite(count) && count > 0) {
        metrics.push({
          metricKey: "sessionCount",
          allocated: count,
          unit: "sessions",
        });
      }
    }
  }

  if (productId === "crm" || config?.pricingMode === "crm") {
    const users = Number(config?.userCount);
    if (Number.isFinite(users) && users > 0) {
      metrics.push({ metricKey: "userCount", allocated: users, unit: "users" });
    }
    const contacts = Number(config?.includedContacts);
    if (Number.isFinite(contacts) && contacts > 0) {
      metrics.push({ metricKey: "includedContacts", allocated: contacts, unit: "contacts" });
    }
  }

  if (productId === "cdp" || config?.pricingMode === "cdp") {
    const profiles = Number(config?.customerProfiles);
    if (Number.isFinite(profiles) && profiles > 0) {
      metrics.push({ metricKey: "customerProfiles", allocated: profiles, unit: "profiles" });
    }
    const sources = Number(config?.dataSources);
    if (Number.isFinite(sources) && sources > 0) {
      metrics.push({ metricKey: "dataSources", allocated: sources, unit: "sources" });
    }
  }

  if (productId === "campaign" || config?.pricingMode === "campaign") {
    const campaignCatalog = DEFAULT_PRICING_CATALOG.products?.campaign || {};
    const channelCatalog = campaignCatalog.channels || {};
    const contacts = Math.max(
      toAllocated(config?.campaignContacts || config?.includedContacts),
      toAllocated(campaignCatalog.base?.includedContacts),
    );
    if (contacts > 0) {
      metrics.push({ metricKey: "includedContacts", allocated: contacts, unit: "contacts" });
    }

    for (const channel of CAMPAIGN_USAGE_CHANNELS) {
      const allocated = resolveCampaignChannelAllocated(config, channelCatalog, channel);
      if (allocated > 0) {
        metrics.push({
          metricKey: channel.metricKey,
          allocated,
          unit: channel.unit,
        });
      }
    }
  }

  return metrics;
}

export async function seedUsageMetricsForSubscription(client: any, subscriptionId: any, config: any) {
  const { periodStart, periodEnd } = currentPeriodBounds();
  const definitions = metricDefinitionsForConfig({
    ...config,
    productId: config?.productId,
  });

  for (const metric of definitions) {
    await upsertUsageMetric(client, [
      subscriptionId,
      metric.metricKey,
      metric.allocated,
      metric.unit,
      periodStart,
      periodEnd,
    ]);
  }
}

export async function getUsageMetricsForSubscription(subscriptionId: any, client: any = null) {
  const runner = client || pool;
  const rows = await selectUsageMetricsBySubscription(runner, subscriptionId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: entry!.id,
      subscriptionId: entry!.subscriptionId,
      metricKey: entry!.metricKey,
      allocated: Number(entry!.allocated),
      consumed: Number(entry!.consumed),
      unit: entry!.unit || "",
      periodStart: entry!.periodStart,
      periodEnd: entry!.periodEnd,
      updatedAt: toIso(entry!.updatedAt),
    };
  });
}

export async function reportUsageConsumption(subscriptionId: any, metricKey: any, consumed: any, client: any = null) {
  const { periodStart, periodEnd } = currentPeriodBounds();

  const work = async (c: any) => {
    const updated = await updateUsageConsumption(
      c,
      subscriptionId,
      metricKey,
      consumed,
      periodStart,
    );

    if (updated) {
      return updated;
    }

    return insertUsageConsumption(
      c,
      subscriptionId,
      metricKey,
      consumed,
      periodStart,
      periodEnd,
    );
  };

  if (client) {
    return work(client);
  }

  return withTransaction(work);
}

/**
 * Archive current-month usage into usage_metrics_monthly and reset consumed for the new month.
 * Idempotent per (subscription, metric, year_month) via upsert.
 */
export async function archiveAndResetMonthlyUsage(asOf = new Date()) {
  // Close the previous calendar month (IST-approx via local server date; ops run near month boundary).
  const previous = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
  const yearMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
  const { periodStart, periodEnd } = currentPeriodBounds(asOf);

  return withTransaction(async (client: any) => {
    const rows = await selectCurrentUsageMetricsForArchive(client);
    const subscriptionIds = new Set();
    let archived = 0;

    for (const row of rows) {
      await insertUsageMetricsMonthly(client, [
        row.subscription_id,
        row.organization_id || null,
        row.product_id || null,
        row.branch_id || null,
        yearMonth,
        row.metric_key,
        Number(row.allocated || 0),
        Number(row.consumed || 0),
        row.unit || null,
        {
          periodStart: row.period_start,
          periodEnd: row.period_end,
          archivedFrom: "usage_metrics",
        },
      ]);
      subscriptionIds.add(row.subscription_id);
      archived += 1;
    }

    for (const subscriptionId of subscriptionIds) {
      await resetUsageConsumed(client, subscriptionId, periodStart, periodEnd);
    }

    return { archived, subscriptionsReset: subscriptionIds.size, yearMonth };
  });
}
