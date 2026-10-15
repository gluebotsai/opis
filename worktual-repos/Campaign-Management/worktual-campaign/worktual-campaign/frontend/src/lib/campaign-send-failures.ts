/** Map worker skip_fail_reason → user-facing launch/send guidance. */

export type CampaignSendFailureRow = {
  recipient_id: string;
  campaign_id: string;
  batch_id?: string;
  channel?: string | null;
  status?: string | null;
  skip_fail_reason: string | null;
  email?: string | null;
  destination?: string | null;
};

export function parseSendFailureRow(raw: Record<string, unknown>): CampaignSendFailureRow {
  return {
    recipient_id: String(raw.recipient_id ?? ""),
    campaign_id: String(raw.campaign_id ?? ""),
    batch_id: raw.batch_id != null ? String(raw.batch_id) : undefined,
    channel: raw.channel != null ? String(raw.channel) : null,
    status: raw.status != null ? String(raw.status) : null,
    skip_fail_reason:
      raw.skip_fail_reason != null ? String(raw.skip_fail_reason) : null,
    email: raw.email != null ? String(raw.email) : null,
    destination: raw.destination != null ? String(raw.destination) : null,
  };
}

export function formatSendFailureReason(raw: string | null | undefined): string {
  const reason = String(raw ?? "").trim();
  if (!reason) return "Send failed (no detail recorded).";
  return reason;
}

export function sendFailureRemedy(raw: string | null | undefined): string | null {
  const r = String(raw ?? "").trim().toLowerCase();
  if (!r) return null;
  if (r.includes("email_mailbox_not_ready") || r.includes("my accounts")) {
    return "Connect a send-ready Google, Microsoft, or SMTP mailbox in Setup (My Accounts → Email for campaigns).";
  }
  if (r.includes("email_crypto_env_missing") || r.includes("ms_token_encryption")) {
    return "Set MS_TOKEN_ENCRYPTION_KEY in backend/.env on the Campaign API host (must match My Accounts Setup Workspace), restart the backend, then confirm GET /health shows msTokenEncryptionConfigured true.";
  }
  if (
    r.includes("email_oauth_env_missing") ||
    r.includes("google_oauth_client") ||
    r.includes("microsoft_oauth") ||
    (r.includes("google") && r.includes("oauth") && r.includes("backend"))
  ) {
    return "Set GOOGLE_OAUTH_CLIENT_ID/SECRET (and MICROSOFT_OAUTH_* for Microsoft mailboxes) in backend/.env on the Campaign API host, restart the backend, and confirm GET /health shows googleOAuthConfigured true. Reconnect the mailbox in Setup → Email if sends still fail.";
  }
  if (r.includes("email_images_not_public") || r.includes("local host")) {
    return "Re-upload images so they are stored on the public media host (rebuild URL), then regenerate or update the email template and retry send.";
  }
  if (r.includes("web_tracking_hmac_secret") || r.includes("missing_wt_tracking")) {
    return "Set WEB_TRACKING_HMAC_SECRET on the campaign backend, or remove/fix outbound CTA links that require tracking tokens.";
  }
  if (r.includes("email_html_missing_wt_token")) {
    return "Email has a clickable link that could not be wrapped with tracking. Fix the CTA URL or tracking configuration, then retry.";
  }
  if (r.includes("email_suppressed")) {
    return "Recipient is on the suppression list. Remove the address from suppressions or choose another contact.";
  }
  if (r.includes("email_template_empty") || r.includes("email_template_missing")) {
    return "Email body was empty at send time. Regenerate the template with subject and body, then launch again.";
  }
  if (r.includes("missing_email")) {
    return "Recipient has no email address on file.";
  }
  return null;
}
