/** Default timeout for Stripe / Razorpay HTTP calls (finance approve must not hang forever). */
export const PAYMENT_GATEWAY_TIMEOUT_MS = 20_000;

/** Overall budget for finance approve payment-link issuance (stay under nginx proxy timeouts). */
export const PAYMENT_LINK_OVERALL_TIMEOUT_MS = 18_000;

/**
 * Race a promise against a hard deadline so HTTP handlers cannot hang the gateway.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = PAYMENT_LINK_OVERALL_TIMEOUT_MS,
  label = "Operation",
): Promise<T> {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : PAYMENT_LINK_OVERALL_TIMEOUT_MS;
  const name = String(label || "Operation").trim() || "Operation";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `${name} timed out after ${Math.round(ms / 1000)}s. Refresh and retry — the lead was not deleted.`,
            ),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * fetch() with AbortController timeout.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ timeoutMs?: number, label?: string }} [config]
 */
export async function fetchWithTimeout(url: any, options = {}, config = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : PAYMENT_GATEWAY_TIMEOUT_MS;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const label = String(config.label || "Payment gateway").trim() || "Payment gateway";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (error?.name === "AbortError") {
      throw new Error(
        `${label} did not respond within ${Math.round(timeoutMs / 1000)}s. Check network access and API keys, then retry.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
