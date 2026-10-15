import { pool } from "../db/pool.js";
import { rowToCamel, toIso } from "../db/util.js";
import {
  insertSubscriptionInvoice,
  markScheduledInvoicesGenerated,
  selectInvoiceBySubscriptionAndSequence,
  selectInvoiceRowBySubscriptionAndSequence,
  selectInvoicesBySubscription,
} from "../repositories/raw/subscriptionInvoices.repo.js";
import {
  applyGst,
  calculateFullMonthlyAmount,
  calculateProratedAmount,
  GST_RATE,
} from "./amounts.js";
import {
  countRemainingDays,
  getInvoice2GenerationDate,
  getPurchaseDateOnly,
  getServicePeriodEndForInvoice1,
  getServicePeriodForInvoice2,
  getServicePeriodStart,
  isPurchaseOnOrBefore20th,
  toDateString,
} from "./dates.js";

export const INVOICE_TYPES = {
  PRORATED_INITIAL: "prorated_initial",
  FULL_MONTHLY: "full_monthly",
};

export const INVOICE_STATUSES = {
  GENERATED: "generated",
  SCHEDULED: "scheduled",
};

function mapInvoiceRow(row) {
  const entry = rowToCamel(row);
  return {
    id: entry.id,
    subscriptionId: entry.subscriptionId,
    sequence: entry.sequence,
    invoiceType: entry.invoiceType,
    generationDate: toDateString(entry.generationDate),
    status: entry.status,
    servicePeriodStart: toDateString(entry.servicePeriodStart),
    servicePeriodEnd: toDateString(entry.servicePeriodEnd),
    remainingDays: entry.remainingDays !== null ? Number(entry.remainingDays) : null,
    monthlyPrice: Number(entry.monthlyPrice),
    subtotal: Number(entry.subtotal),
    gstRate: Number(entry.gstRate),
    grandTotal: Number(entry.grandTotal),
    createdAt: toIso(entry.createdAt),
  };
}

export function buildInitialSubscriptionInvoices({ purchaseDate, monthlyPrice }) {
  const purchase = getPurchaseDateOnly(purchaseDate);
  const serviceStart = getServicePeriodStart(purchase);
  const serviceEnd = getServicePeriodEndForInvoice1(purchase);
  const remainingDays = countRemainingDays(serviceStart, serviceEnd);
  const proratedSubtotal = calculateProratedAmount(monthlyPrice, remainingDays);
  const invoice1Amounts = applyGst(proratedSubtotal);

  const invoice2Period = getServicePeriodForInvoice2(purchase);
  const fullSubtotal = calculateFullMonthlyAmount(monthlyPrice);
  const invoice2Amounts = applyGst(fullSubtotal);
  const invoice2GenerationDate = getInvoice2GenerationDate(purchase);
  const invoice2Status = isPurchaseOnOrBefore20th(purchase)
    ? INVOICE_STATUSES.SCHEDULED
    : INVOICE_STATUSES.GENERATED;

  return [
    {
      sequence: 1,
      invoiceType: INVOICE_TYPES.PRORATED_INITIAL,
      generationDate: toDateString(purchase),
      status: INVOICE_STATUSES.GENERATED,
      servicePeriodStart: toDateString(serviceStart),
      servicePeriodEnd: toDateString(serviceEnd),
      remainingDays,
      monthlyPrice: Number(monthlyPrice),
      subtotal: invoice1Amounts.subtotal,
      gstRate: GST_RATE,
      grandTotal: invoice1Amounts.grandTotal,
    },
    {
      sequence: 2,
      invoiceType: INVOICE_TYPES.FULL_MONTHLY,
      generationDate: toDateString(invoice2GenerationDate),
      status: invoice2Status,
      servicePeriodStart: toDateString(invoice2Period.start),
      servicePeriodEnd: toDateString(invoice2Period.end),
      remainingDays: null,
      monthlyPrice: Number(monthlyPrice),
      subtotal: invoice2Amounts.subtotal,
      gstRate: GST_RATE,
      grandTotal: invoice2Amounts.grandTotal,
    },
  ];
}

function shouldCreateInitialInvoices(subscription) {
  const config = subscription.entitlementConfig || {};
  const billingCycle = config.billingCycle === "yearly" ? "yearly" : "monthly";
  const changeType = subscription.changeType || "new";
  const monthlyPrice = Number(subscription.mrr);

  return changeType === "new" && billingCycle === "monthly" && Number.isFinite(monthlyPrice) && monthlyPrice > 0;
}

export async function createInitialSubscriptionInvoices(client, subscription, { purchaseDate } = {}) {
  if (!shouldCreateInitialInvoices(subscription)) {
    return [];
  }

  const invoices = buildInitialSubscriptionInvoices({
    purchaseDate: purchaseDate || subscription.paymentConfirmedAt || subscription.approvedAt || new Date(),
    monthlyPrice: subscription.mrr,
  });

  const persisted = [];
  for (const invoice of invoices) {
    const exists = await selectInvoiceBySubscriptionAndSequence(client, subscription.id, invoice.sequence);
    if (exists) {
      const row = await selectInvoiceRowBySubscriptionAndSequence(
        client,
        subscription.id,
        invoice.sequence,
      );
      persisted.push(mapInvoiceRow(row));
      continue;
    }
    const row = await insertSubscriptionInvoice(client, [
      subscription.id,
      invoice.sequence,
      invoice.invoiceType,
      invoice.generationDate,
      invoice.status,
      invoice.servicePeriodStart,
      invoice.servicePeriodEnd,
      invoice.remainingDays,
      invoice.monthlyPrice,
      invoice.subtotal,
      invoice.gstRate,
      invoice.grandTotal,
    ]);
    persisted.push(mapInvoiceRow(row));
  }

  return persisted;
}

export async function listSubscriptionInvoices(subscriptionId, client = null) {
  const runner = client || pool;
  const rows = await selectInvoicesBySubscription(runner, subscriptionId);
  return rows.map(mapInvoiceRow);
}

export async function processScheduledSubscriptionInvoices(client = null) {
  const runner = client || pool;
  const rows = await markScheduledInvoicesGenerated(
    runner,
    INVOICE_STATUSES.GENERATED,
    INVOICE_STATUSES.SCHEDULED,
  );
  return rows.map(mapInvoiceRow);
}
