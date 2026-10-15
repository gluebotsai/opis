/** Human labels for agent job lastError / skip-reason codes. */
const AGENT_REASON_LABELS: Record<string, string> = {
  contact_not_found: "Contact not found",
  no_company_name: "Company name missing at run time",
  nothing_to_fill: "Nothing blank to fill",
  enrichment_budget: "Enrichment timed out",
  job_budget_exceeded: "Timed out (job budget)",
  no_email: "No email address",
  no_nurture_mailbox: "No nurture mailbox configured",
  no_crm_bot_mailbox: "No CRM bot email channel in Accounts",
  crm_bot_mailbox_unavailable: "CRM bot mailbox unavailable in Accounts",
  crm_bot_gmail_reauth:
    "CRM bot Gmail needs re-auth in Accounts — Google rejected the stored refresh token",
  crm_bot_token_decrypt_failed:
    "CRM API MS_TOKEN_ENCRYPTION_KEY does not match Accounts — cannot decrypt bot mailbox tokens",
  needs_connect: "Reconnect the CRM bot mailbox in Accounts",
  ai_service_unavailable: "AI service unavailable",
  no_notification_recipient: "No notification recipient",
  scoring_failed: "Scoring failed",
  nurture_failed: "Nurture failed",
  auto_reply_failed: "Auto-reply failed",
};

const FAILURE_STATUSES = new Set(["failed"]);
const SKIP_STATUSES = new Set([
  "skipped",
  "waited",
  "awaiting_demo",
  "escalated",
]);

export function humanizeAgentReason(code: string | null | undefined): string {
  const key = (code ?? "").trim();
  if (!key) return "";
  if (AGENT_REASON_LABELS[key]) return AGENT_REASON_LABELS[key];
  if (
    /google token refresh failed/i.test(key) &&
    /unauthorized_client|invalid_client|invalid_grant/i.test(key)
  ) {
    return AGENT_REASON_LABELS.crm_bot_gmail_reauth;
  }
  if (
    /unable to authenticate data|unsupported state|failed to decrypt accounts/i.test(
      key,
    )
  ) {
    return AGENT_REASON_LABELS.crm_bot_token_decrypt_failed;
  }
  return humanizeAgentStatus(key);
}

export function humanizeAgentStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function isAgentFailureStatus(status: string): boolean {
  return FAILURE_STATUSES.has(status.toLowerCase());
}

export function isAgentSkipStatus(status: string): boolean {
  return SKIP_STATUSES.has(status.toLowerCase());
}

/** Inline reason under a run row: skip reasons are caption, failures are danger. */
export function agentReasonTextClass(status: string): string {
  if (isAgentFailureStatus(status)) return "text-text-danger";
  if (isAgentSkipStatus(status)) return "text-text-caption";
  return "text-text-warning";
}
