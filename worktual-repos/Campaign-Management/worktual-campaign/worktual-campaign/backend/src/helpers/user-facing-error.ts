/** Short, chat-safe error text. Never return HTML, Prisma dumps, or stack traces. */

export function sanitizeUserFacingError(
  raw: unknown,
  fallback = "Something went wrong",
): string {
  let s =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? raw.message
        : fallback;
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return fallback;

  const looksHtml =
    /<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(s) || /^\s*</.test(s);
  if (looksHtml) {
    const status = s.match(/\((\d{3})\)/)?.[1];
    if (/social-service|whatsapp|meta/i.test(s) || status) {
      return status
        ? `WhatsApp Meta submit failed (service ${status})`
        : "WhatsApp Meta submit failed (service unavailable)";
    }
    return "External service returned an error page";
  }

  if (
    /Unique constraint failed/i.test(s) ||
    /campaignSendBatch\.create/i.test(s) ||
    /\('campaign_id',\s*'seq'\)/i.test(s)
  ) {
    return "Push/send queue failed (duplicate batch). Try launch again.";
  }

  if (/Invalid `prisma\./i.test(s) || /\/[\w./-]+\.ts:\d+/i.test(s)) {
    return "Send queue error. Try launch again.";
  }

  if (/unauthorized|401/i.test(s) && /social-service|whatsapp/i.test(s)) {
    return (
      "WhatsApp CCaaS rejected the internal service key. Set INTERNAL_SERVICE_KEY to match rebuild CCaaS (see deploy/server/backend.env) and restart the Campaign backend."
    );
  }

  if (/configuration_not_found|configuration not found/i.test(s)) {
    return (
      "WhatsApp channel configuration was not found on CCaaS for this channelConfigId. " +
      "Connect WhatsApp in My Account (Channel Setup) for this org, or set WHATSAPP_CHANNEL_CONFIG_ID to a valid accounts.setup_channel_configs id and restart the Campaign backend."
    );
  }

  if (s.length > 180) return `${s.slice(0, 180).trim()}…`;
  return s;
}
