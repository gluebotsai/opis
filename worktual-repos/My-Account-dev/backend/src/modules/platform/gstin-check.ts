/** Remote GSTIN validation via gstincheck.co.in (hardcoded key for POC). */

const GSTINCHECK_API_KEY = "629c77b4a43f8d2b985e6a079de2fd44";
const GSTINCHECK_BASE_URL = "https://sheet.gstincheck.co.in/check";
const GSTINCHECK_TIMEOUT_MS = 8000;

function shouldSkipRemoteGstinCheck() {
  return String(process.env.SKIP_GSTIN_REMOTE_CHECK || "").toLowerCase() === "true";
}

function messageLooksLikeCreditsExceeded(value: any) {
  const message = String(value || "").toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("credit") ||
    message.includes("quota") ||
    /limit\s*(has\s*)?exceed/.test(message) ||
    /exceed(ed)?\s*(the\s*)?(api\s*)?(limit|quota)/.test(message)
  );
}

/**
 * Detect gstincheck credit/quota exhaustion from HTTP status or payload.
 * @param {Response} response
 * @param {object|null} payload
 */
export function isGstinCreditsExceeded(response: any, payload: any) {
  if (response?.status === 402 || response?.status === 429) {
    return true;
  }
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const code = String(payload.code || payload.errorCode || payload.error_code || "").toUpperCase();
  if (code.includes("CREDIT") || code.includes("QUOTA") || code === "LIMIT_EXCEEDED") {
    return true;
  }
  return (
    messageLooksLikeCreditsExceeded(payload.message) ||
    messageLooksLikeCreditsExceeded(payload.error) ||
    messageLooksLikeCreditsExceeded(payload.msg) ||
    messageLooksLikeCreditsExceeded(payload.reason)
  );
}

/**
 * @param {string} gstin
 * @returns {Promise<{
 *   valid: boolean,
 *   reason?: string,
 *   skipped?: boolean,
 *   creditsExceeded?: boolean,
 *   data?: object|null
 * }>}
 */
export async function verifyGstinRemote(gstin: any) {
  const normalized = String(gstin || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!normalized) {
    return { valid: false, reason: "GSTIN is required." };
  }

  if (shouldSkipRemoteGstinCheck()) {
    return { valid: true, skipped: true, data: null };
  }

  const url = `${GSTINCHECK_BASE_URL}/${GSTINCHECK_API_KEY}/${encodeURIComponent(normalized)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GSTINCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      return {
        valid: false,
        reason: "GSTIN verification service returned an invalid response.",
      };
    }

    if (isGstinCreditsExceeded(response, payload)) {
      return {
        valid: false,
        creditsExceeded: true,
        reason: (payload as any)?.message || "GSTIN verification credits exceeded.",
        data: (payload as any)?.data && typeof (payload as any).data === "object" ? (payload as any).data : null,
      };
    }

    if (!response.ok) {
      return {
        valid: false,
        reason:
          (payload as any)?.message ||
          `GSTIN verification failed (HTTP ${response.status}).`,
      };
    }

    if ((payload as any)?.flag === true) {
      return {
        valid: true,
        data: (payload as any).data && typeof (payload as any).data === "object" ? (payload as any).data : null,
      };
    }

    return {
      valid: false,
      reason: (payload as any)?.message || "GSTIN not found or invalid.",
      data: (payload as any)?.data && typeof (payload as any).data === "object" ? (payload as any).data : null,
    };
  } catch (error) {
    if ((error as any)?.name === "AbortError") {
      return {
        valid: false,
        reason: "GSTIN verification timed out. Please try again.",
      };
    }
    return {
      valid: false,
      reason: "Could not verify GSTIN. Please try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}
