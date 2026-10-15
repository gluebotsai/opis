import { pool } from "../../db/pool.js";
import { logPayment, logPaymentError } from "../../infra/file-logger.js";
import { PAYMENT_PROVIDERS } from "./constants.js";
import { confirmFinancePaymentWithRetry } from "./fulfillment.js";
import { paymentLogDetails } from "./logContext.js";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_INITIAL_DELAY_MS = 20_000;
const MAX_BATCH_SIZE = 10;
const MIN_REPORTED_AGE_SECONDS = 15;
const MAX_FAILURE_BACKOFF_MS = 15 * 60_000;

let recoveryRunning = false;
const failures = new Map();

function recoveryKey(candidate: any) {
  return `${candidate.quotation_id}:${candidate.billing_branch_id || "parent"}`;
}

function shouldAttempt(candidate: any, now = Date.now()) {
  const failure = failures.get(recoveryKey(candidate));
  return !failure || failure.nextAttemptAt <= now;
}

function recordFailure(candidate: any, error: any) {
  const key = recoveryKey(candidate);
  const previous = failures.get(key);
  const attempts = (previous?.attempts || 0) + 1;
  const delayMs = Math.min(30_000 * 2 ** (attempts - 1), MAX_FAILURE_BACKOFF_MS);
  failures.set(key, {
    attempts,
    nextAttemptAt: Date.now() + delayMs,
    message: error instanceof Error ? error.message : String(error),
  });
}

function clearFailure(candidate: any) {
  failures.delete(recoveryKey(candidate));
}

async function selectReportedGatewayPayments() {
  const { rows } = await pool.query(
    `SELECT
       p.quotation_id,
       NULL::varchar AS billing_branch_id,
       p.provider,
       p.provider_payment_id,
       p.provider_customer_id,
       p.payment_reported_at
     FROM payments p
     WHERE p.status = 'reported'
       AND p.provider IN ('stripe', 'razorpay')
       AND p.payment_reported_at < NOW() - ($1::text || ' seconds')::interval
       AND NOT EXISTS (
         SELECT 1
         FROM quotation_branch_payments bp
         WHERE bp.quotation_id = p.quotation_id
       )

     UNION ALL

     SELECT
       bp.quotation_id,
       bp.billing_branch_id,
       bp.provider,
       bp.provider_payment_id,
       bp.provider_customer_id,
       bp.payment_reported_at
     FROM quotation_branch_payments bp
     WHERE bp.status = 'reported'
       AND bp.provider IN ('stripe', 'razorpay')
       AND bp.payment_reported_at < NOW() - ($1::text || ' seconds')::interval

     ORDER BY payment_reported_at ASC
     LIMIT $2`,
    [String(MIN_REPORTED_AGE_SECONDS), MAX_BATCH_SIZE],
  );
  return rows;
}

export async function recoverReportedGatewayPayments() {
  if (recoveryRunning) {
    // Idle overlap is common — stay silent; only log if a sweep is already mid-flight
    // and we have candidates waiting (avoid console spam).
    return { skipped: true, reason: "already_running" };
  }

  recoveryRunning = true;
  let recovered = 0;
  let failed = 0;
  let deferred = 0;

  try {
    const candidates = await selectReportedGatewayPayments();
    if (candidates.length === 0) {
      return { recovered: 0, failed: 0, scanned: 0 };
    }

    logPayment(
      "payment.recovery.start",
      paymentLogDetails({
        source: "recovery",
        scanned: candidates.length,
      }),
    );

    for (const candidate of candidates) {
      if (!shouldAttempt(candidate)) {
        deferred += 1;
        logPayment(
          "payment.recovery.deferred",
          paymentLogDetails({
            source: "recovery",
            quotationId: candidate.quotation_id,
            billingBranchId: candidate.billing_branch_id || null,
            provider: candidate.provider,
            reason: "backoff",
          }),
        );
        continue;
      }

      const provider =
        candidate.provider === PAYMENT_PROVIDERS.RAZORPAY
          ? PAYMENT_PROVIDERS.RAZORPAY
          : PAYMENT_PROVIDERS.STRIPE;

      try {
        await confirmFinancePaymentWithRetry(
          {
            quotationId: candidate.quotation_id,
            billingBranchId: candidate.billing_branch_id || null,
            providerPaymentId: candidate.provider_payment_id || null,
            providerCustomerId: candidate.provider_customer_id || null,
            source: provider,
            financeConfirmedBy: `recovery:${provider}`,
          },
          { attempts: 2, baseDelayMs: 1_000 },
        );
        clearFailure(candidate);
        recovered += 1;
        logPayment(
          "payment.recovery.success",
          paymentLogDetails({
            source: "recovery",
            provider,
            quotationId: candidate.quotation_id,
            billingBranchId: candidate.billing_branch_id || null,
            providerPaymentId: candidate.provider_payment_id || null,
          }),
        );
      } catch (error) {
        failed += 1;
        recordFailure(candidate, error);
        logPaymentError("payment.recovery.failed", error, {
          source: "recovery",
          provider,
          quotationId: candidate.quotation_id,
          billingBranchId: candidate.billing_branch_id || null,
          providerPaymentId: candidate.provider_payment_id || null,
        });
      }
    }

    logPayment(
      "payment.recovery.complete",
      paymentLogDetails({
        source: "recovery",
        recovered,
        failed,
        deferred,
        scanned: candidates.length,
      }),
    );

    return { recovered, failed, scanned: candidates.length };
  } finally {
    recoveryRunning = false;
  }
}

export function startGatewayPaymentRecovery({
  intervalMs = Number(process.env.PAYMENT_RECOVERY_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
} = {}) {
  const run = () => {
    void recoverReportedGatewayPayments().catch((error) => {
      logPaymentError("payment.recovery.sweep_failed", error, { source: "recovery" });
    });
  };

  const initialTimer = setTimeout(run, initialDelayMs);
  const intervalTimer = setInterval(run, intervalMs);
  initialTimer.unref?.();
  intervalTimer.unref?.();

  logPayment(
    "payment.recovery.enabled",
    paymentLogDetails({ source: "recovery", intervalMs, initialDelayMs }),
  );
  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
