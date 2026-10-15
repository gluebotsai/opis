import { pool } from "../db/pool.js";
import { QUOTATION_STATUSES } from "../statuses.js";
import { loadDuplicatePurchaseContext } from "../repositories/functions/duplicatePurchase.repo.js";

const CHANGE_TYPE_NEW = "new";

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

function subscriptionRenewsAt(entry) {
  const approvedAt = entry.approvedAt ? new Date(entry.approvedAt) : new Date();
  const billingCycle = entry.config?.billingCycle === "yearly" ? "yearly" : "monthly";
  return billingCycle === "yearly" ? addYears(approvedAt, 1) : addMonths(approvedAt, 1);
}

function isActivePaidProduct(entry, now = new Date()) {
  if (!entry?.productId || !entry?.branchId) {
    return false;
  }

  if (!entry.paymentConfirmedAt) {
    return false;
  }

  return subscriptionRenewsAt(entry) > now;
}

async function loadValidationContext(runner, leadId, excludeQuotationId = null) {
  return loadDuplicatePurchaseContext(runner, leadId, excludeQuotationId, [
    QUOTATION_STATUSES.PENDING,
    QUOTATION_STATUSES.APPROVED,
  ]);
}

/**
 * Validate assignments do not duplicate an active paid subscription.
 * Finance override skips duplicate-active checks when overrideNote is provided.
 */
export async function validateAssignmentsForDuplicatePurchase(
  leadId,
  assignments,
  { excludeQuotationId = null, financeOverride = false, overrideNote = "" } = {},
  client = null,
) {
  const runner = client || pool;
  const list = Array.isArray(assignments) ? assignments : [];
  const errors = [];

  if (financeOverride) {
    if (!String(overrideNote || "").trim()) {
      throw new Error("A finance override note is required to allow duplicate new purchases.");
    }
    return { valid: true, overridden: true, warnings: [] };
  }

  const { activeProducts, pendingLines } = await loadValidationContext(
    runner,
    leadId,
    excludeQuotationId,
  );
  const now = new Date();

  for (const assignment of list) {
    const changeType = assignment.changeType || CHANGE_TYPE_NEW;
    if (changeType !== CHANGE_TYPE_NEW) {
      continue;
    }

    const productId = assignment.productId;
    const branchId = assignment.branchId || "hq";

    const activeAtBranch = activeProducts.find(
      (entry) =>
        entry.productId === productId &&
        entry.branchId === branchId &&
        isActivePaidProduct(entry, now),
    );

    if (activeAtBranch) {
      const renewsAt = subscriptionRenewsAt(activeAtBranch).toISOString();
      errors.push(
        `${productId} is already an active paid subscription at this location until ${renewsAt}. Use upgrade, downgrade, or add-on instead.`,
      );
      continue;
    }

    const pendingDuplicate = pendingLines.find(
      (line) =>
        line.productId === productId &&
        line.branchId === branchId &&
        (line.changeType || CHANGE_TYPE_NEW) === CHANGE_TYPE_NEW,
    );

    if (pendingDuplicate) {
      errors.push(
        `${productId} already has a pending or approved quotation (ID ${pendingDuplicate.id}) for this location. Complete or reject it before creating another new purchase.`,
      );
    }
  }

  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.code = "DUPLICATE_PURCHASE";
    error.details = errors;
    throw error;
  }

  return { valid: true, overridden: false, warnings: [] };
}
