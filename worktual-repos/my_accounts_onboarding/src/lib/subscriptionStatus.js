import { getSubscriptionRenewsAt, isActivePaidSubscription } from "./activeProducts.js";
import { formatDashboardDate } from "./leadDashboard.js";

export function summarizeSubscriptionStatus(entry, leadStatus = "") {
  const now = new Date();
  const hasPayment = Boolean(entry?.paymentConfirmedAt);
  const startedAt = entry?.approvedAt ? new Date(entry.approvedAt) : null;
  const renewsAt = entry?.renewsAt
    ? new Date(entry.renewsAt)
    : getSubscriptionRenewsAt(entry);

  if (leadStatus === "Rejected") {
    return {
      state: "cancelled",
      label: "Cancelled",
      description: "The latest quotation was rejected. This product is not active.",
      isUsable: false,
    };
  }

  if (entry?.status === "cancelled") {
    return {
      state: "cancelled",
      label: "Cancelled",
      description: "This product subscription at this branch has been cancelled.",
      isUsable: false,
    };
  }

  if (entry?.cancelAtPeriodEnd && entry?.cancelEffectiveAt) {
    return {
      state: "cancelling",
      label: "Cancels at period end",
      description: `Active until ${formatDashboardDate(entry.cancelEffectiveAt)}. Will not renew after that date.`,
      renewsAt: formatDashboardDate(entry.cancelEffectiveAt),
      isUsable: isActivePaidSubscription(entry, now),
    };
  }

  if (entry?.branchStatus === "inactive") {
    return {
      state: "branch_inactive",
      label: "Branch inactive",
      description: "This branch is inactive. Product access at this location is disabled.",
      isUsable: false,
    };
  }

  if (leadStatus === "Pending Finance Review") {
    return {
      state: "pending_review",
      label: "Pending review",
      description: "Waiting for finance approval before this product can go live.",
      activatesWhen: "After finance approval and payment",
      isUsable: false,
    };
  }

  if (leadStatus === "Approved" && !hasPayment) {
    return {
      state: "awaiting_payment",
      label: "Awaiting payment",
      description: "Quote is approved. The product activates once payment is confirmed.",
      activatesWhen: "When payment is recorded",
      isUsable: false,
    };
  }

  if (!hasPayment) {
    return {
      state: "inactive",
      label: "Not active",
      description: "No confirmed payment yet for this product.",
      activatesWhen: "After quote approval and payment",
      isUsable: false,
    };
  }

  if (renewsAt <= now) {
    return {
      state: "expired",
      label: "Expired",
      description: "The current billing period has ended.",
      expiredOn: formatDashboardDate(renewsAt.toISOString()),
      reactivatesWhen: "After a renewal quote is paid",
      isUsable: false,
    };
  }

  if (startedAt && startedAt > now) {
    return {
      state: "scheduled",
      label: "Scheduled",
      description: "Payment is recorded. Access starts on the start date.",
      activatesOn: formatDashboardDate(startedAt.toISOString()),
      renewsAt: formatDashboardDate(renewsAt.toISOString()),
      isUsable: false,
    };
  }

  const daysRemaining = Math.max(
    0,
    Math.ceil((renewsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );

  return {
    state: "active",
    label: "Active",
    description: "Product is live for the current billing period.",
    startedOn: startedAt ? formatDashboardDate(startedAt.toISOString()) : "—",
    renewsAt: formatDashboardDate(renewsAt.toISOString()),
    daysRemaining,
    isUsable: isActivePaidSubscription(entry, now),
  };
}

export function subscriptionStatusTone(state) {
  switch (state) {
    case "active":
      return "qualified";
    case "awaiting_payment":
    case "pending_review":
    case "scheduled":
      return "in-progress";
    case "expired":
      return "inactive";
    case "branch_inactive":
    case "cancelled":
      return "inactive";
    case "cancelling":
      return "in-progress";
    default:
      return "new";
  }
}
