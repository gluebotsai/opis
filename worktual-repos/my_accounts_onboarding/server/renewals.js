import { pool } from "./db/pool.js";
import { rowToCamel, toIso } from "./db/util.js";
import {
  attachRenewalQuotation as attachRenewalQuotationRow,
  completeRenewalEvents,
  insertRenewalEvent,
  markRenewalsPendingQuote,
  selectLatestOpenRenewalEvent,
  selectUpcomingRenewals,
  updateRenewalEventDueAt,
} from "./repositories/raw/renewals.repo.js";

export async function scheduleRenewalForSubscription(client, subscriptionId, renewsAt) {
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

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      id: entry.id,
      subscriptionId: entry.subscriptionId,
      productId: entry.productId,
      organizationId: entry.organizationId,
      companyName: entry.companyName || "",
      dueAt: toIso(entry.dueAt),
      status: entry.status,
      renewalQuotationId: entry.renewalQuotationId || null,
    };
  });
}

/**
 * Mark renewals due within 30 days as pending_quote (pre-renewal workflow hook).
 * Actual quotation creation remains a sales action; this flags them for follow-up.
 */
export async function processUpcomingRenewals(client = null) {
  const runner = client || pool;
  const rows = await markRenewalsPendingQuote(runner);
  return rows.length;
}

export async function attachRenewalQuotation(subscriptionId, quotationId, client) {
  await attachRenewalQuotationRow(client, subscriptionId, quotationId);
}

export async function completeRenewal(subscriptionId, client) {
  await completeRenewalEvents(client, subscriptionId);
}
