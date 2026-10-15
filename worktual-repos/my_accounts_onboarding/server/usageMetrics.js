import { pool, withTransaction } from "./db/pool.js";
import { rowToCamel, toIso } from "./db/util.js";
import { CCAAS_USAGE_DETAIL_FIELDS } from "../src/lib/ccaasConfiguration.js";
import {
  insertUsageConsumption,
  selectUsageMetricsBySubscription,
  updateUsageConsumption,
  upsertUsageMetric,
} from "./repositories/raw/usageMetrics.repo.js";

function currentPeriodBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function metricDefinitionsForConfig(config) {
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

  return metrics;
}

export async function seedUsageMetricsForSubscription(client, subscriptionId, config) {
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

export async function getUsageMetricsForSubscription(subscriptionId, client = null) {
  const runner = client || pool;
  const rows = await selectUsageMetricsBySubscription(runner, subscriptionId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      id: entry.id,
      subscriptionId: entry.subscriptionId,
      metricKey: entry.metricKey,
      allocated: Number(entry.allocated),
      consumed: Number(entry.consumed),
      unit: entry.unit || "",
      periodStart: entry.periodStart,
      periodEnd: entry.periodEnd,
      updatedAt: toIso(entry.updatedAt),
    };
  });
}

export async function reportUsageConsumption(subscriptionId, metricKey, consumed, client = null) {
  const { periodStart, periodEnd } = currentPeriodBounds();

  const work = async (c) => {
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
