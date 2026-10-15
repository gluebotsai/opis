import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import {
  DEFAULT_PURCHASE_CUTOFF_DAY,
  isPurchaseOnOrBefore20th,
  isRenewalQuoteDue,
} from "../billing/dates.js";
import { applyGst, calculateFullMonthlyAmount, GST_RATE } from "../billing/amounts.js";
import { getProductName } from "../../lib/productCatalog.js";
import { CHANGE_TYPES } from "../../lib/activeProducts.js";
import { getPurchaseCutoffDay } from "../invoice-settings/store.js";
import { createQuotationsForFinance } from "../quotations/quotation-store.js";
import { getLeadById } from "../leads/lead-store.js";
import { withTiming } from "../../infra/file-logger.js";
import {
  renewalChangeTypeFields,
  resolveRenewalServicePeriod,
  withRenewalQuotationDocuments,
} from "./invoice-pdf.js";
import {
  attachRenewalQuotation as attachRenewalQuotationRow,
  completeRenewalEvents,
  insertRenewalEvent,
  markRenewalsPendingQuote,
  selectLatestOpenRenewalEvent,
  selectRenewalsReadyForAutoQuote,
  selectUpcomingRenewals,
  updateRenewalEventDueAt,
} from "../../repositories/raw/renewals.repo.js";

export async function scheduleRenewalForSubscription(client: any, subscriptionId: any, renewsAt: any) {
  const dueAt = renewsAt instanceof Date ? renewsAt : new Date(renewsAt);
  const dueAtIso = dueAt.toISOString();

  const existing = await selectLatestOpenRenewalEvent(client, subscriptionId);

  if (existing) {
    await updateRenewalEventDueAt(client, existing.id, dueAtIso);
    return existing.id;
  }

  return insertRenewalEvent(client, subscriptionId, dueAtIso);
}

export async function listUpcomingRenewals({ withinDays = 30 } = {}) {
  const rows = await selectUpcomingRenewals(pool, withinDays);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: (entry as any).id,
      subscriptionId: (entry as any).subscriptionId,
      productId: (entry as any).productId,
      organizationId: (entry as any).organizationId,
      companyName: (entry as any).companyName || "",
      dueAt: toIso((entry as any).dueAt),
      status: (entry as any).status,
      renewalQuotationId: (entry as any).renewalQuotationId || null,
    };
  });
}

/**
 * Mark renewals due within 30 days as pending_quote (pre-renewal workflow hook).
 */
export async function processUpcomingRenewals(client = null) {
  const runner = client || pool;
  const rows = await markRenewalsPendingQuote(runner);
  return rows.length;
}

export async function attachRenewalQuotation(subscriptionId: any, quotationId: any, client: any) {
  await attachRenewalQuotationRow(client, subscriptionId, quotationId);
}

export async function completeRenewal(subscriptionId: any, client: any) {
  await completeRenewalEvents(client, subscriptionId);
}

function estimateMonthlyFromConfig(config = {}) {
  if (Number.isFinite(Number((config as any).monthlyBasePrice)) && Number((config as any).monthlyBasePrice) > 0) {
    return Number((config as any).monthlyBasePrice);
  }

  if ((config as any).pricingMode === "ccaas" && (config as any).modules) {
    let total = 0;
    for (const selection of Object.values((config as any).modules)) {
      const price = Number((selection as any)?.price);
      if (Number.isFinite(price)) {
        total += price;
      }
    }
    return total;
  }

  return 0;
}

function formatMoneyLabel(amount: any, currency = "INR") {
  const value = Number(amount) || 0;
  return `${currency} ${value.toLocaleString("en-IN")}`;
}

export function buildRenewalQuotePayloadFromSubscription(
  subscription: any,
  lead: any,
  { purchaseDate = new Date() } = {},
) {
  const config = {
    ...(subscription.entitlementConfig || subscription.entitlement_config || {}),
  };
  // Drop transient renewal UI selection keys from the entitlement snapshot.
  delete config.renewalAddonSelection;

  const productId = subscription.productId || subscription.product_id;
  const branchId = subscription.branchId || subscription.branch_id || "hq";
  const currency = config.currency || "INR";
  const monthly = Number(subscription.mrr) || estimateMonthlyFromConfig(config);
  const subtotal = calculateFullMonthlyAmount(monthly);
  const taxed = applyGst(subtotal, GST_RATE);
  const productName = getProductName(productId);
  const branch =
    (lead?.additionalAddresses || []).find((entry: any) => entry.id === branchId) ||
    (branchId === "hq" || !branchId
      ? { id: "hq", label: lead?.companyName || "HQ" }
      : null);
  const branchLabel = branch?.label || branchId;
  const period = resolveRenewalServicePeriod(purchaseDate);
  const { changeType, changeTypeLabel } = renewalChangeTypeFields();

  const assignment = {
    productId,
    branchId,
    billingBranchId: branchId,
    changeType,
    config: {
      ...config,
      billingCycle: config.billingCycle === "yearly" ? "yearly" : "monthly",
      isRenewalQuote: true,
      changeType: CHANGE_TYPES.RENEWAL,
      periodStart: period.periodStartIso,
      periodEnd: period.periodEndIso,
      periodLabel: period.periodLabel,
    },
  };

  return {
    leadId: subscription.sourceLeadId || subscription.source_lead_id,
    lead: lead || null,
    assignments: [assignment],
    productSummary: [
      {
        productId,
        name: productName,
        priceLabel: formatMoneyLabel(taxed.grandTotal, currency),
        branchLabel,
        billingLabel: branchLabel,
        changeType,
        changeTypeLabel,
        periodStart: period.periodStartIso,
        periodEnd: period.periodEndIso,
        periodLabel: period.periodLabel,
      },
    ],
    invoices: [],
    invoiceMode: "consolidated",
    branchSummary: {
      productCount: 1,
      branchCount: 1,
      billingGroupCount: 1,
      branchLabels: [branchLabel],
    },
    subtotal: taxed.subtotal,
    grandTotal: taxed.grandTotal,
    currency,
    gstRate: GST_RATE,
    payment: {
      subtotal: taxed.subtotal,
      grandTotal: taxed.grandTotal,
      currency,
      gstRate: GST_RATE,
    },
    submittedBy: "Auto renewal",
    fileName: `renewal-${productId}-${branchId}-${Date.now()}.pdf`,
    pdfBase64: null,
  };
}

async function createFinanceRenewalQuotation(subscription: any, lead: any, { purchaseDate = new Date() } = {}) {
  const basePayload = buildRenewalQuotePayloadFromSubscription(subscription, lead, {
    purchaseDate,
  });
  let payload = basePayload;
  try {
    payload = await withRenewalQuotationDocuments(basePayload);
  } catch (error) {
    console.warn(
      `[renewals] PDF generation failed for ${subscription.id || subscription.productId}:`,
      error instanceof Error ? error.message : error,
    );
  }
  return createQuotationsForFinance(payload);
}

/**
 * Auto-create Finance-facing renewal quotations for subscriptions whose
 * day-20 generation date has arrived (or purchase was on/after the 20th).
 */
export async function createAutoRenewalQuotations(client = null, { asOf = new Date() } = {}) {
  return withTiming("perf", "renewals.createAutoRenewalQuotations", async () => {
    const runner = client || pool;
    const rows = await selectRenewalsReadyForAutoQuote(runner);
    const created: any[] = [];

    let blockedSubscriptionIds = new Set();
    try {
      const { listSubscriptionIdsBlockedFromAutoRenewal, listSubscriptionIdsWithApprovedRenewalCancel } =
        await import("../billing/changes.js");
      const [openChanges, cancelledRenewals] = await Promise.all([
        listSubscriptionIdsBlockedFromAutoRenewal(),
        listSubscriptionIdsWithApprovedRenewalCancel(),
      ]);
      blockedSubscriptionIds = new Set(
        [...openChanges, ...cancelledRenewals].map((id) => String(id)),
      );
    } catch (error) {
      console.warn(
        "[renewals] Could not load billing-change guards:",
        error instanceof Error ? error.message : error,
      );
    }

    const cutoffDay = await getPurchaseCutoffDay().catch(() => DEFAULT_PURCHASE_CUTOFF_DAY);

    for (const row of rows) {
      const entry = rowToCamel(row);
      if (!isRenewalQuoteDue((entry as any).dueAt, asOf, cutoffDay)) {
        continue;
      }

      if (blockedSubscriptionIds.has(String((entry as any).subscriptionId))) {
        continue;
      }

      try {
        await withTiming(
          "perf",
          "renewals.createAutoRenewalQuotation.one",
          async () => {
            const lead = await getLeadById((entry as any).sourceLeadId);
            if (!lead) {
              throw new Error(`Lead not found for subscription ${(entry as any).subscriptionId}`);
            }

            const payload = buildRenewalQuotePayloadFromSubscription(
              {
                ...entry,
                entitlementConfig:
                  typeof (entry as any).entitlementConfig === "string"
                    ? JSON.parse((entry as any).entitlementConfig)
                    : (entry as any).entitlementConfig,
              },
              lead,
              { purchaseDate: asOf },
            );

            let finalPayload = payload;
            try {
              finalPayload = await withRenewalQuotationDocuments(payload);
            } catch (pdfError) {
              console.warn(
                `[renewals] PDF generation failed for subscription ${(entry as any).subscriptionId}:`,
                pdfError instanceof Error ? pdfError.message : pdfError,
              );
            }

            const { quotations } = await createQuotationsForFinance(finalPayload);
            const quotation = quotations?.[0];
            if (!quotation?.id) {
              throw new Error("createQuotationsForFinance returned no quotation");
            }

            await attachRenewalQuotationRow(runner, (entry as any).subscriptionId, quotation.id);
            created.push({
              subscriptionId: (entry as any).subscriptionId,
              quotationId: quotation.id,
              productId: (entry as any).productId,
              dueAt: toIso((entry as any).dueAt),
            });
          },
          { subscriptionId: (entry as any).subscriptionId, productId: (entry as any).productId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[renewals] Auto renewal quote failed for subscription ${(entry as any).subscriptionId}: ${message}`,
        );
      }
    }

    return created;
  });
}

/**
 * Immediately create a renewal quotation when the first purchase happens on/after the 20th.
 */
export async function maybeCreateImmediateRenewalQuotation(
  subscription: any,
  purchaseDate: any,
  client = null,
) {
  if (!subscription?.id || isPurchaseOnOrBefore20th(purchaseDate)) {
    return null;
  }

  const runner = client || pool;
  try {
    const leadId = subscription.sourceLeadId || subscription.source_lead_id;
    const lead = await getLeadById(leadId);
    if (!lead) {
      return null;
    }

    const { quotations } = await createFinanceRenewalQuotation(subscription, lead, {
      purchaseDate,
    });
    const quotation = quotations?.[0];
    if (!quotation?.id) {
      return null;
    }

    await attachRenewalQuotationRow(runner, subscription.id, quotation.id);
    return quotation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[renewals] Immediate renewal quote failed for subscription ${subscription.id}: ${message}`,
    );
    return null;
  }
}
