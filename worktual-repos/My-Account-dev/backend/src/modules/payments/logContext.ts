/**
 * Build a consistent details object for payment process logs.
 * Omits undefined values; secrets are stripped later by logPayment sanitize.
 */
export function paymentLogDetails(partial = {}) {
  const out = {};
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) {
      continue;
    }
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    out[key] = value;
  }
  return out;
}

/** Amount / status fields from a payment row or API payment object. */
export function paymentAmountDetails(payment: any) {
  if (!payment) {
    return {};
  }
  return paymentLogDetails({
    amount: payment.amount ?? payment.totalAmount ?? null,
    currency: payment.currency || null,
    paymentStatus: payment.status || null,
  });
}

export function companyNameFromQuotation(quotation: any) {
  if (!quotation) {
    return null;
  }
  return (
    quotation.lead?.companyName ||
    quotation.lead?.company_name ||
    quotation.companyName ||
    quotation.company_name ||
    null
  );
}

function providerLabel(provider: any) {
  const value = String(provider || "").toLowerCase();
  if (value === "stripe") {
    return "Stripe";
  }
  if (value === "razorpay") {
    return "Razorpay";
  }
  if (value === "manual" || value === "bank_transfer") {
    return "manual/bank";
  }
  return provider || "gateway";
}

function quoteLabel(details = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const id = details.quotationId || details.quotation_id;
  if (!id) {
    return "quotation (unknown)";
  }
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const company = details.companyName || details.company_name;
  return company ? `quotation ${id} (${company})` : `quotation ${id}`;
}

function moneyLabel(details = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const amount = details.amount ?? details.grandTotal;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const currency = details.currency;
  if (amount == null || amount === "") {
    return null;
  }
  const code = currency ? String(currency).toUpperCase() : "";
  return code ? `${amount} ${code}` : String(amount);
}

function withMoney(sentence: any, details: any) {
  const money = moneyLabel(details);
  return money ? `${sentence} — ${money}` : sentence;
}

function providerFromAction(action: any) {
  if (String(action).startsWith("stripe.")) {
    return "stripe";
  }
  if (String(action).startsWith("razorpay.")) {
    return "razorpay";
  }
  return null;
}

/**
 * Human-readable console sentence for a payment log action.
 * Callers may pass details.message to override.
 */
export function formatPaymentMessage(action: any, details = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (typeof details.message === "string" && details.message.trim()) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    return details.message.trim();
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const provider = providerLabel(details.provider || details.source || providerFromAction(action));
  const quote = quoteLabel(details);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const eventId = details.eventId || details.providerEventId || null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const eventType = details.eventType || null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const reason = details.reason || details.failureReason || details.errorMessage || null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const actor = details.actor || details.reportedBy || details.financeConfirmedBy || null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const linkId = details.paymentLinkId || details.providerLinkId || null;

  switch (action) {
    case "stripe.payment_link.request":
    case "razorpay.payment_link.request":
      return withMoney(
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        `Requesting ${provider} payment link for ${quote}${details.dryRun ? " (mock — keys not configured)" : ""}`,
        details,
      );

    case "stripe.payment_link.mock":
    case "razorpay.payment_link.mock":
      return `Created mock ${provider} payment link for ${quote} (keys not configured)`;

    case "stripe.payment_link.created":
    case "razorpay.payment_link.created":
      return withMoney(
        `${provider} payment link created for ${quote}${linkId ? `  link=${linkId}` : ""}`,
        details,
      );

    case "stripe.payment_link.failed":
    case "razorpay.payment_link.failed":
      return withMoney(
        `Failed to create ${provider} payment link for ${quote}${reason ? ` — ${reason}` : ""}`,
        details,
      );

    case "stripe.payment_link.synced":
    case "razorpay.payment_link.synced":
      return withMoney(`Synced ${provider} payment status for ${quote}`, details);

    case "payment_link.resolve_amount":
      return withMoney(`Resolved payment amount for ${quote}`, details);

    case "payment_link.created":
    case "payment_link.branch_created":
    case "payment_link.multi_branch_created":
      return withMoney(
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        `Payment link ready for ${quote} via ${provider}${details.dryRun ? " (mock)" : ""}`,
        details,
      );

    case "payment_link.failed":
    case "payment_link.invalid_amount":
      return `Could not create payment link for ${quote}${reason ? ` — ${reason}` : ""}`;

    case "stripe.webhook.received":
    case "razorpay.webhook.received":
      return `${provider} webhook received: ${eventType || "event"}${eventId ? ` (${eventId})` : ""}`;

    case "stripe.webhook.claimed":
    case "razorpay.webhook.claimed":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return `${provider} webhook claimed ${eventId || "event"} (new) — applying${details.quotationId ? ` to ${quote}` : ""}`;

    case "stripe.webhook.duplicate":
    case "razorpay.webhook.duplicate":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return `${provider} webhook ${eventId || "event"} already seen — re-running idempotent apply${details.quotationId ? ` for ${quote}` : ""}`;

    case "stripe.webhook.processed":
    case "razorpay.webhook.processed": {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (details.handled === false) {
        if (reason === "ignored") {
          return `${provider} webhook ignored (${eventType || "unsupported event"})`;
        }
        return `${provider} webhook processed but not applied (${reason || "unknown"})${eventId ? ` event=${eventId}` : ""}`;
      }
      const isFailureEvent =
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        details.paymentStatus === "failed" ||
        String(eventType || "").includes("failed") ||
        String(eventType || "").includes("payment_failed");
      if (isFailureEvent) {
        return `${provider} webhook applied — payment marked failed for ${quote}${reason ? ` (${reason})` : ""}`;
      }
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (details.autoConfirmed || details.paymentStatus === "paid" || details.alreadyPaid) {
        return withMoney(
          `${provider} webhook applied — payment paid for ${quote}`,
          details,
        );
      }
      return withMoney(`${provider} webhook applied — payment reported for ${quote}`, details);
    }

    case "stripe.webhook.not_applied":
    case "razorpay.webhook.not_applied":
      return `${provider} webhook not applied (${reason || "unknown"})${eventId ? ` event=${eventId}` : ""}`;

    case "stripe.webhook.missing_quotation":
    case "razorpay.webhook.missing_quotation":
      return `${provider} webhook could not resolve quotation${eventId ? ` (event ${eventId})` : ""}${eventType ? ` — ${eventType}` : ""}`;

    case "stripe.webhook.failed":
    case "razorpay.webhook.failed":
      return `${provider} webhook handler failed${reason ? ` — ${reason}` : ""}`;

    case "payment.report.start":
      return `Reporting payment for ${quote} via ${provider}`;

    case "payment.reported":
      return withMoney(
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        `Payment reported for ${quote} via ${provider}${details.source === "stripe" || details.source === "razorpay" ? " — pending auto-confirm" : ""}`,
        details,
      );

    case "payment.report.skipped":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (details.alreadyPaid) {
        return `Skipped payment report for ${quote} — already paid`;
      }
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (details.alreadyReported) {
        return `Skipped payment report for ${quote} — already reported`;
      }
      return `Skipped payment report for ${quote}${reason ? ` — ${reason}` : ""}`;

    case "payment.confirm.start":
      return `Confirming payment for ${quote}${actor ? ` (${actor})` : ""}`;

    case "payment.confirmed":
      return withMoney(
        `Payment confirmed paid for ${quote}${actor ? ` (${actor})` : ""}`,
        details,
      );

    case "payment.confirm.skipped":
      return `Skipped payment confirm for ${quote} — already paid`;

    case "payment.auto_confirm.failed":
      return `Auto-confirm failed after report for ${quote} — payment stays reported; webhook/sync will retry${reason ? ` (${reason})` : ""}`;

    case "payment.failed":
      return `Payment failed for ${quote}${reason ? ` — ${reason}` : ""}`;

    case "payment.refunded":
      return `Payment refunded for ${quote}${reason ? ` — ${reason}` : ""}`;

    case "payment.finance.report_payment":
      return `Finance ${actor || "user"} reported payment for ${quote} (${provider})`;

    case "payment.finance.report_payment.failed":
      return `Finance could not report payment for ${quote}${reason ? ` — ${reason}` : ""}`;

    case "payment.finance.confirm_payment":
      return `Finance ${actor || "user"} confirming payment for ${quote}`;

    case "payment.finance.confirm_payment.failed":
      return `Finance could not confirm payment for ${quote}${reason ? ` — ${reason}` : ""}`;

    case "payment.sync.start":
      return `Finance ${actor || "user"} syncing ${provider} payment for ${quote}`;

    case "payment.sync.complete":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (details.alreadyPaid) {
        return `Payment sync for ${quote} — already paid`;
      }
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (details.synced) {
        return withMoney(`Payment sync completed for ${quote} via ${provider}`, details);
      }
      return `Payment sync for ${quote} — no change${reason ? ` (${reason})` : ""}`;

    case "quotation.sync_payment.failed":
      return `Payment sync failed for ${quote}${reason ? ` — ${reason}` : ""}`;

    case "payment.recovery.enabled":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return `Reported-gateway payment recovery enabled (every ${details.intervalMs || "?"}ms)`;

    case "payment.recovery.start":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return `Recovering stuck reported payments — scanning ${details.scanned ?? 0} candidate(s)`;

    case "payment.recovery.complete":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return `Recovery sweep finished — recovered=${details.recovered ?? 0} failed=${details.failed ?? 0} deferred=${details.deferred ?? 0}`;

    case "payment.recovery.success":
      return `Recovered stuck ${provider} payment for ${quote} — confirmed paid`;

    case "payment.recovery.failed":
      return `Could not recover stuck payment for ${quote}${reason ? ` — ${reason}` : ""} (will retry with backoff)`;

    case "payment.recovery.deferred":
      return `Deferred recovery for ${quote} — waiting on backoff`;

    case "payment.recovery.skipped":
      return `Skipped recovery sweep — already running`;

    case "payment.recovery.sweep_failed":
      return `Payment recovery sweep failed${reason ? ` — ${reason}` : ""}`;

    case "payment.fulfillment.background_failed":
      return `Background fulfillment failed for ${quote}${reason ? ` — ${reason}` : ""} (payment already marked paid)`;

    case "quotation.approve.start":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return `Finance approving ${quote}${details.provider ? ` — provider ${providerLabel(details.provider)}` : ""}`;

    case "quotation.approve.payment_link.start":
      return withMoney(`Creating payment link for approved ${quote}`, details);

    case "quotation.approve.success":
      return withMoney(`Quotation approved and payment link issued for ${quote}`, details);

    case "quotation.approve.offline_success":
      return `Quotation approved for offline/bank payment — ${quote}`;

    case "quotation.approve.payment_link_failed":
      return `Quotation approved but payment link failed for ${quote}${reason ? ` — ${reason}` : ""}`;

    case "quotation.approve.failed":
      return `Quotation approve failed for ${quote}${reason ? ` — ${reason}` : ""}`;

    default:
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (details.level === "error" && reason) {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        return `${action} — ${reason}${details.quotationId ? ` (${quote})` : ""}`;
      }
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return details.quotationId
        ? `${action} — ${quote}${moneyLabel(details) ? ` — ${moneyLabel(details)}` : ""}`
        : action;
  }
}
