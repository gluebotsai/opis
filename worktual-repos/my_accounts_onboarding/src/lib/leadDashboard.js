import { getChangeTypeLabel, getActiveProducts } from "./activeProducts.js";
import { sumModulePrices } from "./ccaasModules.js";
import {
  formatBranchLabel,
  formatLeadAddresses,
  formatLeadCreatedDate,
  getLeadBranches,
} from "./leads.js";
import { getProductName, PRODUCT_CATALOG } from "./productCatalog.js";

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashSeed(value) {
  let hash = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pseudoUsed(allocated, seed, daysElapsed) {
  if (allocated <= 0) {
    return 0;
  }

  const ratio = 0.42 + (hashSeed(seed) % 28) / 100;
  const ramp = Math.min(1, Math.max(0.15, daysElapsed / 30));
  return Math.min(allocated, Math.max(0, Math.round(allocated * ratio * ramp)));
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

export function formatDashboardDate(value) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function getSubscriptionWindow(entry) {
  const approvedAt = entry.approvedAt ? new Date(entry.approvedAt) : new Date();
  const billingCycle = entry.config?.billingCycle === "yearly" ? "yearly" : "monthly";
  const periodEnd = entry.renewsAt
    ? new Date(entry.renewsAt)
    : billingCycle === "yearly"
      ? addYears(approvedAt, 1)
      : addMonths(approvedAt, 1);
  const now = new Date();
  const totalMs = periodEnd.getTime() - approvedAt.getTime();
  const elapsedMs = Math.max(0, now.getTime() - approvedAt.getTime());
  const daysTotal = Math.max(1, Math.ceil(totalMs / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.min(daysTotal, Math.ceil(elapsedMs / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);

  return {
    billingCycle,
    startedAt: approvedAt.toISOString(),
    renewsAt: periodEnd.toISOString(),
    daysTotal,
    daysElapsed,
    daysRemaining,
    periodProgress: Math.min(100, Math.round((daysElapsed / daysTotal) * 100)),
  };
}

function pushMetric(rows, label, allocated, used, unit) {
  const safeAllocated = Math.max(0, allocated);
  const safeUsed = Math.min(safeAllocated, Math.max(0, used));
  const remaining = Math.max(0, safeAllocated - safeUsed);

  rows.push({
    label,
    allocated: safeAllocated,
    used: safeUsed,
    remaining,
    unit,
    percentUsed: safeAllocated > 0 ? Math.round((safeUsed / safeAllocated) * 100) : 0,
  });
}

function findSubscriptionForEntry(lead, entry) {
  return (lead?.subscriptions || []).find(
    (subscription) =>
      subscription.productId === entry.productId &&
      String(subscription.locationId || subscription.branchId || "") ===
        String(entry.branchId || ""),
  );
}

const USAGE_METRIC_LABELS = {
  agentCount: { label: "Agents", unit: "seats" },
  voiceMinutes: { label: "Voice minutes", unit: "min" },
  smsCount: { label: "SMS", unit: "messages" },
  emailCount: { label: "Email", unit: "messages" },
  botSessions: { label: "Bot sessions", unit: "sessions" },
  voiceBotMinutes: { label: "VoiceBot minutes", unit: "min" },
  webChatCount: { label: "Web chat", unit: "sessions" },
  socialMediaCount: { label: "Social media", unit: "messages" },
  whatsAppCount: { label: "WhatsApp", unit: "messages" },
  sessionCount: { label: "Chat sessions", unit: "sessions" },
  userCount: { label: "CRM users", unit: "users" },
  includedContacts: { label: "Included contacts", unit: "contacts" },
  customerProfiles: { label: "Customer profiles", unit: "profiles" },
  dataSources: { label: "Data sources", unit: "sources" },
};

function indexUsageMetrics(metrics = []) {
  const byKey = new Map();

  for (const metric of metrics) {
    if (!metric?.metricKey || byKey.has(metric.metricKey)) {
      continue;
    }

    byKey.set(metric.metricKey, metric);
  }

  return byKey;
}

function resolveMetricUsed(allocated, metricKey, realMetrics, seed, daysElapsed) {
  const real = realMetrics?.get(metricKey);
  if (real && Number.isFinite(real.consumed)) {
    return Math.min(allocated, Math.max(0, real.consumed));
  }

  return pseudoUsed(allocated, `${seed}-${metricKey}`, daysElapsed);
}

export function buildProductUsageMetrics(entry, realMetrics = []) {
  const config = entry.config || {};
  const window = getSubscriptionWindow(entry);
  const seed = `${entry.key}-${entry.approvedAt || "new"}`;
  const metricsByKey = indexUsageMetrics(realMetrics);
  const rows = [];
  const usedFor = (allocated, metricKey) =>
    resolveMetricUsed(allocated, metricKey, metricsByKey, seed, window.daysElapsed);

  if (entry.productId === "contact-center") {
    if (config.pricingMode === "ccaas") {
      const usageDetails = config.usageDetails || {};
      const detailMetrics = [
        ["agentCount", "Agents", "seats"],
        ["voiceMinutes", "Voice minutes", "min"],
        ["smsCount", "SMS", "messages"],
        ["emailCount", "Email", "messages"],
        ["botSessions", "Bot sessions", "sessions"],
        ["voiceBotMinutes", "VoiceBot minutes", "min"],
        ["webChatCount", "Web chat", "sessions"],
        ["socialMediaCount", "Social media", "messages"],
        ["whatsAppCount", "WhatsApp", "messages"],
      ];

      for (const [key, label, unit] of detailMetrics) {
        const allocated = toNumber(usageDetails[key]);
        if (allocated > 0) {
          pushMetric(rows, label, allocated, usedFor(allocated, key), unit);
        }
      }

      const sessionBundle = config.addons?.sessionBundle;
      if (sessionBundle && sessionBundle !== "none") {
        const allocated =
          sessionBundle === "custom"
            ? toNumber(config.addons?.sessionCount)
            : toNumber(sessionBundle);
        if (allocated > 0) {
          pushMetric(rows, "Chat sessions", allocated, usedFor(allocated, "sessionCount"), "sessions");
        }
      }

      return rows;
    }

    const minutes = toNumber(config.voiceIncludedMinutes);
    pushMetric(
      rows,
      "Voice minutes",
      minutes,
      usedFor(minutes, "voiceMinutes"),
      "min",
    );

    if (config.chatbotEnabled) {
      const sessions = toNumber(config.customChatbotSessions || config.chatbotBundle);
      const bundleSessions =
        config.chatbotBundle && config.chatbotBundle !== "none" && config.chatbotBundle !== "custom"
          ? toNumber(config.chatbotBundle)
          : sessions;
      const allocated = bundleSessions > 0 ? bundleSessions : 300;
      pushMetric(
        rows,
        "Chat sessions",
        allocated,
        usedFor(allocated, "sessionCount"),
        "sessions",
      );
    }

    if (config.liveAgentEnabled) {
      const agents = toNumber(config.liveAgentCount || config.additionalLiveAgentCount || 1);
      pushMetric(
        rows,
        "Live agents",
        Math.max(agents, 1),
        usedFor(Math.max(agents, 1), "agentCount"),
        "seats",
      );
    }
  }

  if (entry.productId === "cdp") {
    const profiles = toNumber(config.customerProfiles);
    pushMetric(
      rows,
      "Customer profiles",
      profiles,
      usedFor(profiles, "customerProfiles"),
      "profiles",
    );

    const sources = toNumber(config.dataSources);
    pushMetric(
      rows,
      "Data sources",
      Math.max(sources, 1),
      usedFor(Math.max(sources, 1), "dataSources"),
      "sources",
    );
  }

  if (entry.productId === "crm") {
    const users = toNumber(config.userCount || 1);
    pushMetric(
      rows,
      "CRM users",
      users,
      usedFor(users, "userCount"),
      "users",
    );

    const contacts = toNumber(config.includedContacts);
    if (contacts > 0) {
      pushMetric(
        rows,
        "Included contacts",
        contacts,
        usedFor(contacts, "includedContacts"),
        "contacts",
      );
    }
  }

  if (entry.productId === "value-management") {
    const mau = toNumber(config.monthlyActiveUsers);
    pushMetric(
      rows,
      "Monthly active users",
      mau,
      usedFor(mau, "monthlyActiveUsers"),
      "users",
    );
  }

  if (entry.productId === "campaign") {
    const contacts = toNumber(config.campaignContacts || config.includedContacts);
    pushMetric(
      rows,
      "Campaign contacts",
      contacts,
      usedFor(contacts, "includedContacts"),
      "contacts",
    );
  }

  if (entry.productId === "ticketing") {
    const users = toNumber(config.userCount || 1);
    pushMetric(
      rows,
      "Agent seats",
      users,
      usedFor(users, "userCount"),
      "users",
    );

    const tickets = toNumber(config.includedTickets);
    if (tickets > 0) {
      pushMetric(
        rows,
        "Included tickets",
        tickets,
        usedFor(tickets, "includedTickets"),
        "tickets",
      );
    }
  }

  if (rows.length === 0 && metricsByKey.size > 0) {
    for (const [metricKey, metric] of metricsByKey.entries()) {
      const allocated = toNumber(metric.allocated);
      if (allocated <= 0) {
        continue;
      }

      const labels = USAGE_METRIC_LABELS[metricKey] || {
        label: metricKey,
        unit: metric.unit || "units",
      };
      pushMetric(rows, labels.label, allocated, usedFor(allocated, metricKey), labels.unit);
    }
  }

  if (rows.length === 0) {
    pushMetric(rows, "Committed package", 100, pseudoUsed(100, seed, window.daysElapsed), "units");
  }

  return rows;
}

function estimateMonthlyPrice(entry) {
  const config = entry.config || {};

  if (entry.productId === "contact-center") {
    if (config.pricingMode === "ccaas" && config.modules) {
      const agentCount = Math.max(1, toNumber(config.usageDetails?.agentCount) || 0);
      let total = sumModulePrices(config.modules, { agentCount });
      const addons = config.addons || {};
      if (addons.sessionBundle && addons.sessionBundle !== "none") {
        total += toNumber(addons.sessionPrice);
      }
      if (addons.multilingualOption === "addon") {
        total += toNumber(addons.multilingualPrice);
      }
      return total;
    }

    return (
      toNumber(config.voiceMonthlyPrice) +
      toNumber(config.chatbotMonthlyPrice) +
      toNumber(config.liveAgentRate) * toNumber(config.liveAgentCount || 0)
    );
  }

  if (entry.productId === "cdp") {
    return toNumber(config.monthlyBasePrice);
  }

  if (entry.productId === "crm") {
    return toNumber(config.userCount || 1) * toNumber(config.userLicenseRate || 15000);
  }

  if (entry.productId === "value-management") {
    return toNumber(config.monthlyBasePrice);
  }

  if (entry.productId === "campaign") {
    return toNumber(config.monthlyBasePrice);
  }

  if (entry.productId === "ticketing") {
    return toNumber(config.monthlyBasePrice);
  }

  return toNumber(config.basePrice || config.monthlyBasePrice);
}

export function buildLeadDashboardModel(lead, usageBySubscriptionId = {}) {
  if (!lead) {
    return null;
  }

  const activeProducts = getActiveProducts(lead).map((entry) => {
    const window = getSubscriptionWindow(entry);
    const subscription = findSubscriptionForEntry(lead, entry);
    const subscriptionId = subscription?.id || entry.subscriptionId || null;
    const usage = buildProductUsageMetrics(
      entry,
      usageBySubscriptionId[subscriptionId] || [],
    );

    return {
      ...entry,
      subscriptionId,
      productName: getProductName(entry.productId),
      branchLabel: formatBranchLabel(lead, entry.branchId),
      billingLabel: formatBranchLabel(lead, entry.billingTargetId || entry.branchId),
      changeTypeLabel: getChangeTypeLabel(entry.changeType || "new"),
      monthlyPrice: estimateMonthlyPrice(entry),
      subscription: window,
      usage,
    };
  });

  const monthlyRecurring = activeProducts.reduce((sum, entry) => sum + entry.monthlyPrice, 0);
  const branches = getLeadBranches(lead);
  const addresses = formatLeadAddresses(lead);

  return {
    lead,
    summary: {
      activeProductCount: activeProducts.length,
      branchCount: branches.length,
      monthlyRecurring,
      currency: activeProducts[0]?.config?.currency || "INR",
      status: lead.status || "New",
      customerSince: lead.convertedAt
        ? formatLeadCreatedDate(lead.convertedAt)
        : formatLeadCreatedDate(lead.createdAt),
    },
    contact: {
      companyName: lead.companyName,
      contactName: lead.contactName,
      designation: lead.designation,
      workEmail: lead.workEmail,
      mobile: `${lead.mobileCountryCode || ""} ${lead.mobileNumber || ""}`.trim(),
      industryType: lead.industryType,
      websiteUrl: lead.websiteUrl,
      adminEmail: lead.adminEmail,
      taxNumber: lead.taxNumber,
      domainId: lead.domainId,
    },
    finance: {
      status: lead.status,
      note: lead.financeNote || "",
      reviewedAt: lead.financeReviewedAt,
      reviewedBy: lead.financeReviewedBy,
    },
    locations: addresses,
    activeProducts,
  };
}

export function buildPortfolioDashboardModel(leads) {
  const customers = [];
  const statusCounts = {};
  const productAdoption = {};
  const renewals = [];
  let totalMonthlyRecurring = 0;
  let totalActiveProducts = 0;
  let pendingFinanceReview = 0;
  let currency = "INR";

  for (const lead of leads || []) {
    const model = buildLeadDashboardModel(lead);
    if (!model) {
      continue;
    }

    currency = model.summary.currency || currency;
    const status = model.summary.status || "New";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (status === "Pending Finance Review") {
      pendingFinanceReview += 1;
    }

    totalMonthlyRecurring += model.summary.monthlyRecurring;
    totalActiveProducts += model.summary.activeProductCount;

    let usageTotal = 0;
    let usageCount = 0;
    let nextRenewalDays = null;

    for (const product of model.activeProducts) {
      productAdoption[product.productId] = (productAdoption[product.productId] || 0) + 1;

      for (const metric of product.usage) {
        usageTotal += metric.percentUsed;
        usageCount += 1;
      }

      if (
        nextRenewalDays === null ||
        product.subscription.daysRemaining < nextRenewalDays
      ) {
        nextRenewalDays = product.subscription.daysRemaining;
      }

      if (product.subscription.daysRemaining <= 30) {
        renewals.push({
          leadId: lead.id,
          subscriptionId: product.subscriptionId,
          companyName: model.contact.companyName,
          productName: product.productName,
          branchLabel: product.branchLabel,
          daysRemaining: product.subscription.daysRemaining,
          renewsAt: product.subscription.renewsAt,
        });
      }
    }

    customers.push({
      leadId: lead.id,
      companyName: model.contact.companyName,
      contactName: model.contact.contactName,
      industryType: model.contact.industryType,
      status,
      activeProductCount: model.summary.activeProductCount,
      locationCount: model.summary.branchCount,
      monthlyRecurring: model.summary.monthlyRecurring,
      avgUsagePercent: usageCount > 0 ? Math.round(usageTotal / usageCount) : 0,
      nextRenewalDays,
      customerSince: model.summary.customerSince,
      isActive: lead.isActive !== false,
    });
  }

  customers.sort((left, right) => right.monthlyRecurring - left.monthlyRecurring);
  renewals.sort((left, right) => left.daysRemaining - right.daysRemaining);

  const productAdoptionRows = PRODUCT_CATALOG.map((product) => ({
    productId: product.id,
    productName: product.name,
    count: productAdoption[product.id] || 0,
  })).sort(
    (left, right) =>
      right.count - left.count || left.productName.localeCompare(right.productName),
  );

  const statusRows = Object.entries(statusCounts)
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count);

  return {
    summary: {
      totalCustomers: customers.length,
      activeCustomers: customers.filter((entry) => entry.isActive).length,
      totalActiveProducts,
      totalMonthlyRecurring,
      pendingFinanceReview,
      renewalsSoon: renewals.length,
      currency,
    },
    statusRows,
    productAdoptionRows,
    customers,
    renewals,
  };
}

export function formatCurrency(amount, currency = "INR") {
  if (!Number.isFinite(amount) || amount <= 0) {
    return `${currency} 0`;
  }

  return `${currency} ${amount.toLocaleString("en-IN")}`;
}
