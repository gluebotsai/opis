import crypto from "node:crypto";

import { pool } from "../../db/pool.js";
import { resolveAssignmentMonthlyRecurring } from "../../lib/invoice.js";
import { getProductName } from "../../lib/productCatalog.js";
import { resolveSkipInvoiceProration } from "../../lib/proration.js";
import {
  buildGoLiveServiceSchedule,
  calculateCalendarProratedAmount,
} from "../billing/goLiveSchedule.js";
import { DEFAULT_PURCHASE_CUTOFF_DAY } from "../billing/dates.js";
import { calculateFullMonthlyAmount } from "../billing/amounts.js";
import { getPurchaseCutoffDay } from "../invoice-settings/store.js";
import { createQuotation } from "../quotations/quotation-store.js";
import { getLeadById } from "../leads/lead-store.js";
import {
  listGoLiveForLead,
  markGoLiveAccepted,
  PRODUCT_LIFECYCLE,
} from "./go-live-store.js";
import { BILLING_PHASES } from "../payments/billingPhases.js";
import { selectGoLiveById } from "../../repositories/raw/productGoLive.repo.js";
import { endOfMonth, startOfDay } from "date-fns";

/** @deprecated Prefer calculateCalendarProratedAmount — kept for callers/tests. */
export function prorateMonthlyAmountIst(fullMonthlyAmount: any, asOf = new Date()) {
  const start = startOfDay(asOf instanceof Date ? asOf : new Date(asOf));
  return calculateCalendarProratedAmount(fullMonthlyAmount, start, endOfMonth(start));
}

function resolveStampedMonthlyFromConfig(config: any = {}) {
  const candidates = [
    (config as any).finalMonthlyTotal,
    (config as any).coreMonthlyAmount,
    (config as any).monthlyPrice,
    (config as any).basePrice,
    (config as any).price,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return 0;
}

/** Prefer recomputed line totals; fall back to stamped scalars on assignment config. */
function resolveMonthlyFromConfig(config: any = {}, productId = "") {
  const recomputed = resolveAssignmentMonthlyRecurring(config, {
    id: productId || config.productId,
    name: getProductName(productId || config.productId),
  });
  if (recomputed > 0) {
    return recomputed;
  }
  return resolveStampedMonthlyFromConfig(config);
}

async function loadAssignmentForGoLive(client: any, goLiveRow: any) {
  const branchId = goLiveRawBranch(goLiveRow);
  const otcQuotationId = goLiveRow.otc_quotation_id || null;
  if (otcQuotationId) {
    const { rows } = await client.query(
      `SELECT pa.*
       FROM product_assignments pa
       WHERE pa.lead_id = $1
         AND pa.product_id = $2
         AND pa.branch_id = $3
         AND pa.quotation_id = $4
       LIMIT 1`,
      [goLiveRow.lead_id, goLiveRow.product_id, branchId, otcQuotationId],
    );
    if (rows[0]) {
      return rows[0];
    }
  }
  const { rows } = await client.query(
    `SELECT pa.*
     FROM product_assignments pa
     WHERE pa.lead_id = $1
       AND pa.product_id = $2
       AND pa.branch_id = $3
     ORDER BY pa.quotation_id DESC NULLS LAST
     LIMIT 1`,
    [goLiveRow.lead_id, goLiveRow.product_id, branchId],
  );
  return rows[0] || null;
}

function goLiveRawBranch(row: any) {
  return row.branch_id || "hq";
}

function formatPeriodDateIso(date: any) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Customer Accept / Go live for one or more product_go_live rows.
 * Creates a finance quotation with billing_phase = go_live_proration.
 */
export async function acceptGoLiveProducts({ leadId, goLiveIds = [], acceptedBy = "customer" }: any) {
  const ids = [...new Set((goLiveIds || []).map(String).filter(Boolean))];
  if (!ids.length) {
    throw new Error("Select at least one product to accept.");
  }

  const lead = await getLeadById(leadId);
  if (!lead) {
    throw new Error("Lead not found.");
  }

  const client = await pool.connect();
  try {
    const goLiveRows = [];
    for (const id of ids) {
      const row = await selectGoLiveById(client, id);
      if (!row || String(row.lead_id) !== String(leadId)) {
        throw new Error("Invalid go-live product for this account.");
      }
      if (
        ![PRODUCT_LIFECYCLE.UAT, PRODUCT_LIFECYCLE.UAT_EXPIRED].includes(row.lifecycle_status)
      ) {
        throw new Error(
          `Product ${row.product_id} is not in UAT (status: ${row.lifecycle_status}).`,
        );
      }
      goLiveRows.push(row);
    }

    const assignments = [];
    const productSummary = [];
    let subtotal = 0;
    const acceptedAt = new Date();
    const acceptedAtIso = formatPeriodDateIso(acceptedAt);
    const cutoffDay = await getPurchaseCutoffDay().catch(() => DEFAULT_PURCHASE_CUTOFF_DAY);

    for (const goLive of goLiveRows) {
      const assignment = await loadAssignmentForGoLive(client, goLive);
      const config = {
        ...(assignment?.config || {}),
        implementationEnabled: false,
        implementationFee: 0,
        implementationPurchased: true,
        changeType: "go_live",
        isGoLiveProration: true,
      };
      const monthly = resolveMonthlyFromConfig(config, goLive.product_id);
      if (monthly <= 0) {
        throw new Error(
          `Could not resolve monthly price for ${goLive.product_id}. Reconfigure the product.`,
        );
      }
      const skipProration = resolveSkipInvoiceProration(config);
      if (skipProration && (!config.periodStart || !config.periodEnd)) {
        throw new Error(
          `Sales must set billing period start and end for ${goLive.product_id} when prorated billing is off.`,
        );
      }

      const schedule = buildGoLiveServiceSchedule({
        anchorDate: acceptedAt,
        skipProration,
        periodStart: config.periodStart || null,
        periodEnd: config.periodEnd || null,
        cutoffDay,
      });
      const billed = skipProration
        ? calculateFullMonthlyAmount(monthly)
        : calculateCalendarProratedAmount(monthly, schedule.inv1Start, schedule.inv1End);
      if (billed <= 0) {
        throw new Error(
          `Could not resolve go-live amount for ${goLive.product_id}. Reconfigure the product.`,
        );
      }

      config.productId = config.productId || goLive.product_id;
      config.goLiveAcceptedAt = acceptedAtIso;
      config.purchaseCutoffDay = cutoffDay;
      config.goLiveProratedAmount = billed;
      config.finalMonthlyTotal = monthly;
      config.coreMonthlyAmount = monthly;
      config.proratedBilling = !skipProration;
      config.skipInvoiceProration = skipProration;
      config.periodStart = formatPeriodDateIso(schedule.inv1Start);
      config.periodEnd = formatPeriodDateIso(schedule.inv1End);
      config.periodLabel = `Billing period ${formatPeriodDateIso(schedule.inv1Start)} to ${formatPeriodDateIso(schedule.inv1End)}`;
      config.prorationNote = skipProration
        ? "Selected billing period (full price)"
        : "Prorated from Accept date to end of month";
      config.goLiveInv2PeriodStart = formatPeriodDateIso(schedule.inv2Start);
      config.goLiveInv2PeriodEnd = formatPeriodDateIso(schedule.inv2End);
      config.goLiveRenewsAt = formatPeriodDateIso(schedule.renewsAt);

      const branchId = goLiveRawBranch(goLive);
      const productName = getProductName(goLive.product_id);
      assignments.push({
        productId: goLive.product_id,
        branchId,
        billingBranchId: goLive.billing_branch_id || branchId,
        changeType: "go_live",
        config,
      });
      productSummary.push({
        productId: goLive.product_id,
        name: productName,
        branchLabel: branchId,
        billingLabel: skipProration ? "Monthly" : "Monthly (prorated)",
        changeTypeLabel: "Go live",
        priceLabel: skipProration
          ? `₹${billed.toFixed(2)}`
          : `₹${billed.toFixed(2)} (prorated)`,
      });
      subtotal += billed;
    }

    const gstRate = 0.18;
    const grandTotal = Math.round(subtotal * (1 + gstRate) * 100) / 100;

    const quotation = await createQuotation({
      leadId,
      lead,
      fileName: `Go-live-proration-${lead.companyName || leadId}.pdf`,
      pdfBase64: "",
      productSummary,
      assignments,
      invoiceMode: "consolidated",
      branchSummary: null,
      invoices: [],
      subtotal: Math.round(subtotal * 100) / 100,
      grandTotal,
      currency: "INR",
      gstRate,
      submittedBy: acceptedBy || "customer",
      billingPhase: BILLING_PHASES.GO_LIVE_PRORATION,
      submissionBatchId: crypto.randomUUID(),
    });

    const { attachPaymentToQuotation } = await import("../quotations/quotation-store.js");
    await attachPaymentToQuotation(quotation.id, {
      provider: null,
      paymentLinkUrl: null,
      paymentLinkId: null,
      subtotal: Math.round(subtotal * 100) / 100,
      grandTotal,
      currency: "INR",
      gstRate,
      amountLabel: `₹${grandTotal.toFixed(2)}`,
      status: "pending",
      dryRun: false,
    });

    for (const goLive of goLiveRows) {
      await markGoLiveAccepted(goLive.id, quotation.id);
    }

    return {
      quotation,
      goLiveIds: goLiveRows.map((row) => row.id),
      products: await listGoLiveForLead(leadId),
    };
  } finally {
    client.release();
  }
}
