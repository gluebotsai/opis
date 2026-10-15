export const BILLING_PHASES = {
  STANDARD: "standard",
  IMPLEMENTATION: "implementation",
  GO_LIVE_PRORATION: "go_live_proration",
  MRR_ADJUSTMENT: "mrr_adjustment",
  RENEWAL_CANCEL: "renewal_cancel",
};

export const PRODUCT_LIFECYCLE = {
  AWAITING_IMPLEMENTATION: "awaiting_implementation",
  UAT: "uat",
  UAT_EXPIRED: "uat_expired",
  AWAITING_SUBSCRIPTION_PAYMENT: "awaiting_subscription_payment",
  LIVE: "live",
};

/** Default when sales does not pick a duration. */
export const UAT_DURATION_DAYS = 5;

/** Allowed UAT lengths (days) selectable on Send / Extend UAT. */
export const UAT_DURATION_OPTIONS_DAYS = [3, 5, 7, 14] as const;

export function normalizeUatDurationDays(value: any, fallback = UAT_DURATION_DAYS) {
  const days = Number(value);
  if (!Number.isFinite(days) || !Number.isInteger(days)) {
    return fallback;
  }
  if (!(UAT_DURATION_OPTIONS_DAYS as readonly number[]).includes(days)) {
    throw new Error(
      `UAT duration must be one of: ${UAT_DURATION_OPTIONS_DAYS.join(", ")} days.`,
    );
  }
  return days;
}

export function isImplementationBillingPhase(phase: any) {
  return String(phase || "") === BILLING_PHASES.IMPLEMENTATION;
}

export function isGoLiveBillingPhase(phase: any) {
  return String(phase || "") === BILLING_PHASES.GO_LIVE_PRORATION;
}

export function isMrrAdjustmentBillingPhase(phase: any) {
  return String(phase || "") === BILLING_PHASES.MRR_ADJUSTMENT;
}

export function isRenewalCancelBillingPhase(phase: any) {
  return String(phase || "") === BILLING_PHASES.RENEWAL_CANCEL;
}

/** Finance quotations that adjust recurring billing without customer payment. */
export function isBillingChangePhase(phase: any) {
  return isMrrAdjustmentBillingPhase(phase) || isRenewalCancelBillingPhase(phase);
}

export function billingChangePhaseLabel(phase: any) {
  if (isMrrAdjustmentBillingPhase(phase)) {
    return "MRR change";
  }
  if (isRenewalCancelBillingPhase(phase)) {
    return "Cancel next renewal";
  }
  return null;
}

export function assignmentHasImplementationFee(config = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (config.implementationPurchased === true) {
    return false;
  }
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (config.implementationEnabled === false) {
    return false;
  }
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const fee = Number(config.implementationFee ?? config.implementationCost ?? 0);
  return Number.isFinite(fee) && fee > 0;
}

export function quoteNeedsImplementationPhase(assignments = []) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return (assignments || []).some((entry) => assignmentHasImplementationFee(entry?.config || {}));
}
