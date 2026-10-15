/**
 * User-facing email delivery errors — never surface raw provider JSON in UI.
 */

export function formatEmailDeliveryFailure(
  raw: string | null | undefined,
  opts?: { needsConnect?: boolean },
): { message: string; needsConnect: boolean } {
  if (opts?.needsConnect) {
    return {
      message:
        "Connect or reconnect your email in Configuration → Email to deliver to the customer.",
      needsConnect: true,
    };
  }

  const text = (raw ?? "").trim();
  const lower = text.toLowerCase();

  if (
    !text ||
    lower.includes("401") ||
    lower.includes("unauthenticated") ||
    lower.includes("invalid credentials") ||
    lower.includes("autherror") ||
    lower.includes("invalid_grant")
  ) {
    return {
      message:
        "Your email connection expired. Reconnect in Configuration → Email, then resend or forward the quote manually.",
      needsConnect: true,
    };
  }

  if (
    lower.includes("gmail api has not been used") ||
    lower.includes("accessnotconfigured") ||
    (lower.includes("gmail.googleapis.com") && lower.includes("disabled"))
  ) {
    return {
      message:
        "Gmail API is not enabled for this Google Cloud project. Enable Gmail API in Google Cloud Console, wait a few minutes, then try again.",
      needsConnect: false,
    };
  }

  if (
    lower.includes("403") ||
    lower.includes("insufficient") ||
    lower.includes("forbidden")
  ) {
    return {
      message:
        "Gmail send permission is missing. Reconnect Google in Configuration → Email.",
      needsConnect: true,
    };
  }

  return {
    message:
      "Email could not be delivered automatically. The document was still marked sent — reconnect email in Configuration or forward it manually.",
    needsConnect: false,
  };
}
