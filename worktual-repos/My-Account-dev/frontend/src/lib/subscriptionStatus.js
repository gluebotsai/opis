import { getSubscriptionRenewsAt, isActivePaidSubscription } from "./activeProducts.js";
import {
  goLiveStatusDescription,
  goLiveStatusLabel,
  isPreLiveLifecycleStatus,
  isPreLivePaidProduct,
} from "./goLive.js";
import { computeCalendarDaysRemaining, formatDashboardDate } from "./leadDashboard.js";

const RENEWAL_TIMELINE_STATES = new Set([
  "active",
  "cancelling",
  "cancellation_pending",
  "expired",
]);

/**
 * Show Started / Renews / N days left only for post-purchase live subscriptions.
 * Hide during implementation, UAT, awaiting payment, and other pre-live phases.
 */
export function shouldShowRenewalTimeline(productStatus) {
  const state = typeof productStatus === "string" ? productStatus : productStatus?.state;
  return RENEWAL_TIMELINE_STATES.has(state);
}

export function summarizeSubscriptionStatus(entry, leadStatus = "", options = {}) {
  const paymentStatus = options.paymentStatus || "";
  const now = new Date();
  const hasPayment = Boolean(entry?.paymentConfirmedAt);
  const startedAt = entry?.approvedAt ? new Date(entry.approvedAt) : null;
  const renewsAt = entry?.renewsAt
    ? new Date(entry.renewsAt)
    : getSubscriptionRenewsAt(entry);

  if (entry?.status === "cancelled") {
    return {
      state: "cancelled",
      label: "Cancelled",
      description: "This product subscription at this branch has been cancelled.",
      isUsable: false,
    };
  }

  if (entry?.cancelAtPeriodEnd || entry?.scheduledCancellationStatus === "approved_scheduled") {
    const effectiveAt = entry.cancelEffectiveAt || entry.scheduledCancelEffectiveAt || null;
    const dropDate = effectiveAt ? formatDashboardDate(effectiveAt) : null;
    return {
      state: "cancelling",
      label: dropDate ? `Cancels on ${dropDate}` : "Cancels at period end",
      description: dropDate
        ? `Cancellation approved. Access continues until ${dropDate}; this product will not renew after that date.`
        : "Cancellation approved. Access continues until the end of the current billing period; this product will not renew.",
      renewsAt: dropDate || undefined,
      isUsable: isActivePaidSubscription(entry, now),
    };
  }

  if (
    entry?.scheduledCancellationStatus === "submitted" ||
    entry?.scheduledCancellationStatus === "auto_escalated"
  ) {
    return {
      state: "cancellation_pending",
      label: "Cancellation pending",
      description:
        "Cancellation request submitted. Waiting for Worktual admin approval before the plan is cancelled.",
      renewsAt: formatDashboardDate(renewsAt.toISOString()),
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

  // OTC paid → implementing / UAT / awaiting go-live — never label as Active.
  if (isPreLiveLifecycleStatus(entry?.lifecycleStatus)) {
    return {
      state: entry.lifecycleStatus,
      label: goLiveStatusLabel(entry.lifecycleStatus),
      description: goLiveStatusDescription(entry.lifecycleStatus),
      isUsable: false,
    };
  }

  if (isPreLivePaidProduct(entry)) {
    return {
      state: "awaiting_implementation",
      label: goLiveStatusLabel("awaiting_implementation"),
      description: goLiveStatusDescription("awaiting_implementation"),
      isUsable: false,
    };
  }

  // Lead-level quote pipeline only applies to products that are not already paid.
  // A new pending/approved quote must not mark existing live subscriptions as pending.
  if (!hasPayment) {
    if (leadStatus === "Rejected") {
      return {
        state: "cancelled",
        label: "Cancelled",
        description: "The latest quotation was rejected. This product is not active.",
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

    if (leadStatus === "Approved" && paymentStatus === "reported") {
      return {
        state: "payment_reported",
        label: "Payment reported",
        description:
          "Payment reported (usually bank/cash). Waiting for finance to confirm before activation. Stripe/Razorpay payments auto-confirm and skip this state.",
        activatesWhen: "After finance confirms payment",
        isUsable: false,
      };
    }

    if (leadStatus === "Approved") {
      return {
        state: "awaiting_payment",
        label: "Awaiting payment",
        description: "Quote is approved. The product activates once payment is confirmed.",
        activatesWhen: "When payment is recorded",
        isUsable: false,
      };
    }

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

  return {
    state: "active",
    label: "Active",
    description: "Product is live for the current billing period.",
    startedOn: startedAt ? formatDashboardDate(startedAt.toISOString()) : "—",
    renewsAt: formatDashboardDate(renewsAt.toISOString()),
    daysRemaining: computeCalendarDaysRemaining(renewsAt, now),
    isUsable: isActivePaidSubscription(entry, now),
  };
}

export function productPaymentBadge(entry) {
  return entry?.paymentConfirmedAt
    ? { label: "Paid", tone: "qualified" }
    : { label: "Pending", tone: "in-progress" };
}

export function subscriptionStatusTone(state) {
  switch (state) {
    case "active":
      return "qualified";
    case "awaiting_implementation":
    case "uat":
    case "uat_expired":
    case "awaiting_subscription_payment":
    case "awaiting_payment":
    case "payment_reported":
    case "pending_review":
    case "scheduled":
      return "in-progress";
    case "expired":
      return "inactive";
    case "branch_inactive":
    case "cancelled":
      return "inactive";
    case "cancellation_pending":
    case "cancelling":
      return "in-progress";
    default:
      return "new";
  }
}
