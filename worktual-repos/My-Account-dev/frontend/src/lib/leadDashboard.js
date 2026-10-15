import {
  getChangeTypeLabel,
  getActiveProducts,
  getSubscriptionRenewsAt,
  isActivePaidSubscription,
} from "./activeProducts.js";
import { resolveModulesWithCatalogPrices, sumModulePrices } from "./ccaasModules.js";
import { getCcaasPlanLabel } from "./ccaasPlans.js";
import { isPreLivePaidProduct } from "./goLive.js";
import { getCachedPricingCatalog } from "./pricingCatalog.js";
import {
  formatBranchLabel,
  formatLeadAddresses,
  formatLeadCreatedDate,
  getLeadBranches,
} from "./leads.js";
import { getProductName, PRODUCT_CATALOG } from "./productCatalog.js";
import { getCatalog } from "./pricingRuntime.js";
import {
  shouldShowRenewalTimeline,
  summarizeSubscriptionStatus,
} from "./subscriptionStatus.js";

/** Campaign usage rows — mirrors pricing-sheet channels (CCaaS-style multi-bar layout). */
const CAMPAIGN_USAGE_CHANNELS = [
  {
    metricKey: "webPushSubscribers",
    label: "Web Push Notifications",
    unit: "subscribers",
    qtyKey: "webPushSubscribers",
    catalogKey: "webPush",
    freeAllowance: 0,
  },
  {
    metricKey: "appPushSubscribers",
    label: "App Push Notifications",
    unit: "subscribers",
    qtyKey: "appPushSubscribers",
    catalogKey: "appPush",
    freeAllowance: 0,
  },
  {
    metricKey: "emailCount",
    label: "Email Campaign",
    unit: "emails",
    qtyKey: "emailCount",
    catalogKey: "email",
    /** Pricing sheet: first 1000 free. */
    freeAllowance: 1000,
  },
  {
    metricKey: "smsCount",
    label: "SMS Campaign",
    unit: "messages",
    qtyKey: "smsCount",
    catalogKey: "sms",
    freeAllowance: 0,
  },
  {
    metricKey: "whatsappCredits",
    label: "WhatsApp Campaign",
    unit: "credits",
    qtyKey: "whatsappCredits",
    catalogKey: "whatsapp",
    /** Pricing sheet: first 1000 free. */
    freeAllowance: 1000,
  },
];

function resolveCampaignChannelAllocated(config, channelCatalog, channel) {
  return Math.max(
    toNumber(config?.[channel.qtyKey]),
    toNumber(channelCatalog?.[channel.catalogKey]?.defaultCount),
    channel.freeAllowance || 0,
  );
}

function resolveActiveProductPlanLabel(entry) {
  const config = entry?.config || {};
  const productId = entry?.productId || "";

  if (productId === "contact-center") {
    return getCcaasPlanLabel(config.licenseTier) || String(config.licenseTier || "").trim();
  }

  if (productId === "crm" && toNumber(config.userCount) > 0) {
    const users = Math.trunc(toNumber(config.userCount));
    return `${users} user license${users === 1 ? "" : "s"}`;
  }

  if (productId === "ticketing" && toNumber(config.userCount) > 0) {
    const users = Math.trunc(toNumber(config.userCount));
    return `${users} user license${users === 1 ? "" : "s"}`;
  }

  if (productId === "campaign" && config.basePlanEnabled) {
    return "Campaign base plan";
  }

  if (productId === "cdp" && config.platformEnabled !== false) {
    return "CDP platform";
  }

  if (productId === "value-management" && config.subscriptionEnabled !== false) {
    return "Value management subscription";
  }

  return "";
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfLocalDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Calendar days from asOf (local midnight) to renewsAt / period end.
 * Matches invoice remaining-days style (day count to period end), not a fixed 30-day month.
 */
export function computeCalendarDaysRemaining(renewsAt, asOf = new Date()) {
  if (!renewsAt) {
    return 0;
  }
  const due = renewsAt instanceof Date ? renewsAt : new Date(renewsAt);
  if (Number.isNaN(due.getTime())) {
    return 0;
  }
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.max(
    0,
    Math.round((startOfLocalDay(due).getTime() - startOfLocalDay(asOf).getTime()) / MS_PER_DAY),
  );
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
  const periodEnd = getSubscriptionRenewsAt(entry);
  const now = new Date();
  const daysRemaining = computeCalendarDaysRemaining(periodEnd, now);
  const daysTotal = Math.max(1, computeCalendarDaysRemaining(periodEnd, approvedAt));
  const daysElapsed = Math.min(daysTotal, Math.max(0, daysTotal - daysRemaining));

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
      String(subscription.branchId || "") ===
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
  whatsappCredits: { label: "WhatsApp Campaign", unit: "credits" },
  sessionCount: { label: "Chat sessions", unit: "sessions" },
  userCount: { label: "CRM users", unit: "users" },
  includedContacts: { label: "Included contacts", unit: "contacts" },
  webPushSubscribers: { label: "Web Push Notifications", unit: "subscribers" },
  appPushSubscribers: { label: "App Push Notifications", unit: "subscribers" },
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

function resolveMetricUsed(allocated, metricKey, realMetrics) {
  const real = realMetrics?.get(metricKey);
  if (real && Number.isFinite(Number(real.consumed))) {
    return Math.min(allocated, Math.max(0, Number(real.consumed)));
  }

  // No invented usage for live subscriptions — show 0 until DB records consumption.
  return 0;
}

export function buildProductUsageMetrics(entry, realMetrics = []) {
  const config = entry.config || {};
  const metricsByKey = indexUsageMetrics(realMetrics);
  const rows = [];
  const usedFor = (allocated, metricKey) => resolveMetricUsed(allocated, metricKey, metricsByKey);

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
    const campaignCatalog = getCatalog(config.region || "India").products?.campaign || {};
    const channelCatalog = campaignCatalog.channels || {};
    const contacts = Math.max(
      toNumber(config.campaignContacts || config.includedContacts),
      toNumber(campaignCatalog.base?.includedContacts),
    );
    if (contacts > 0) {
      pushMetric(
        rows,
        "Campaign contacts",
        contacts,
        usedFor(contacts, "includedContacts"),
        "contacts",
      );
    }

    for (const channel of CAMPAIGN_USAGE_CHANNELS) {
      const allocated = resolveCampaignChannelAllocated(config, channelCatalog, channel);
      if (allocated > 0) {
        pushMetric(
          rows,
          channel.label,
          allocated,
          usedFor(allocated, channel.metricKey),
          channel.unit,
        );
      }
    }
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

  return rows;
}

function estimateMonthlyPrice(entry) {
  const config = entry.config || {};

  if (entry.productId === "contact-center") {
    if (config.pricingMode === "ccaas" && config.modules) {
      const agentCount = Math.max(1, toNumber(config.usageDetails?.agentCount) || 0);
      const catalog = getCachedPricingCatalog();
      const region = config.region || "India";
      const pricedModules = resolveModulesWithCatalogPrices(
        config.modules,
        config.licenseTier,
        catalog,
        region,
        config.usageDetails?.agentRate,
      );
      let total = sumModulePrices(pricedModules, { agentCount });
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

  // Payment-confirmed includes OTC/implementation-only rows for purchased-product lists.
  // Commercially "active" requires product/subscription payment (see isActivePaidSubscription).
  const activeProducts = getActiveProducts(lead)
    .filter((entry) => Boolean(entry.paymentConfirmedAt))
    .map((entry) => {
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
        planLabel: resolveActiveProductPlanLabel(entry),
        branchLabel: formatBranchLabel(lead, entry.branchId),
        billingLabel: formatBranchLabel(lead, entry.billingBranchId || entry.branchId),
        changeTypeLabel: getChangeTypeLabel(entry.changeType || "new"),
        monthlyPrice: estimateMonthlyPrice(entry),
        subscription: window,
        usage,
      };
    });

  const livePaidProducts = activeProducts.filter((entry) => isActivePaidSubscription(entry));
  // OTC/paid but not live yet — implementing, UAT, UAT expired, or awaiting go-live payment.
  const uatOrImplementationProducts = activeProducts.filter((entry) =>
    isPreLivePaidProduct(entry),
  );
  const monthlyRecurring = livePaidProducts.reduce((sum, entry) => sum + entry.monthlyPrice, 0);
  const branches = getLeadBranches(lead);
  const addresses = formatLeadAddresses(lead);

  return {
    lead,
    summary: {
      activeProductCount: livePaidProducts.length,
      uatOrImplementationCount: uatOrImplementationProducts.length,
      branchCount: branches.length,
      monthlyRecurring,
      currency:
        livePaidProducts[0]?.config?.currency ||
        activeProducts[0]?.config?.currency ||
        "INR",
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
      tenantId: lead.tenantId,
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

    // Prefer open finance-pending quotations (aligns with API portfolio KPI). Lead
    // status alone misses Paid customers with a pending-finance quote.
    const openPendingQuotes = (lead.quotations || lead.openQuotations || []).filter(
      (quote) => quote?.status === "Pending Finance Review",
    );
    if (openPendingQuotes.length > 0) {
      pendingFinanceReview += openPendingQuotes.length;
    } else if (status === "Pending Finance Review") {
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

      const productStatus = summarizeSubscriptionStatus(product, lead.status || "");
      const showRenewalTimeline = shouldShowRenewalTimeline(productStatus);

      if (
        showRenewalTimeline &&
        (nextRenewalDays === null || product.subscription.daysRemaining < nextRenewalDays)
      ) {
        nextRenewalDays = product.subscription.daysRemaining;
      }

      if (showRenewalTimeline && product.subscription.daysRemaining <= 30) {
        renewals.push({
          leadId: lead.id,
          subscriptionId: product.subscriptionId,
          productId: product.productId,
          companyName: model.contact.companyName,
          productName: product.productName,
          branchLabel: product.branchLabel,
          daysRemaining: product.subscription.daysRemaining,
          renewsAt: product.subscription.renewsAt,
          canCreateRenewalQuote: productStatus.state === "active" && productStatus.isUsable,
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
