// @ts-nocheck — accounts schema rows; runtime validated in mapper
import { accountQuery } from "../plugins/account-pool.js";
import { accountOrgParam } from "../helpers/account-ids.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { accountsCryptoConfigured } from "../helpers/accounts-oauth-crypto.js";
import {
  isWorktualTechEmail,
  WORKTUAL_TECH_FROM_BLOCKED,
} from "../helpers/worktual-tech-from.js";

export type AccountsEmailMailboxStatus =
  | "not_started"
  | "in_progress"
  | "ready"
  | "blocked";

export type AccountsEmailMailboxPublic = {
  channel_id: string;
  name: string;
  channel_status: string;
  provider_type: string;
  third_party_mode: string | null;
  oauth_provider: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to: string | null;
  domain: string | null;
  domain_verification_status: string | null;
  requested_local_part: string | null;
  hosted_domain: string | null;
  provisioning_status: string | null;
  oauth_account_email: string | null;
  oauth_expires_at: string | null;
  oauth_needs_reauth: boolean;
  oauth_scope: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean | null;
  has_smtp_credentials: boolean;
  has_oauth_tokens: boolean;
  display_from: string | null;
  transport: "oauth" | "smtp" | "unavailable";
  status: AccountsEmailMailboxStatus;
  send_ready: boolean;
  block_reason: string | null;
  crypto_configured: boolean;
  source: "accounts.setup_email_configs";
};

type MailboxRow = {
  channel_id: string;
  name: string;
  channel_status: string;
  provider_type: string;
  third_party_mode: string | null;
  oauth_provider: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to: string | null;
  domain: string | null;
  domain_verification_status: string | null;
  requested_local_part: string | null;
  hosted_domain: string | null;
  provisioning_status: string | null;
  oauth_connection_id: string | null;
  oauth_account_email: string | null;
  oauth_expires_at: string | null;
  oauth_needs_reauth: boolean | null;
  oauth_scope: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean | null;
  smtp_user_encrypted: string | null;
  smtp_pass_encrypted: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
};

function hostedAddress(row: MailboxRow): string | null {
  const local = String(row.requested_local_part || "").trim();
  const domain = String(row.hosted_domain || "vectone.tech").trim();
  if (local && domain) return `${local}@${domain}`;
  return null;
}

function resolveDisplayFrom(row: MailboxRow): string | null {
  const sender = String(row.sender_email || "").trim();
  if (sender) return sender;
  const oauth = String(row.oauth_account_email || "").trim();
  if (oauth) return oauth;
  return hostedAddress(row);
}

function mapTransport(row: MailboxRow): AccountsEmailMailboxPublic["transport"] {
  const pt = String(row.provider_type || "").trim().toLowerCase();
  const mode = String(row.third_party_mode || "").trim().toLowerCase();
  if (pt === "third_party" && mode === "oauth") return "oauth";
  if (pt === "third_party" && mode === "smtp") return "smtp";
  return "unavailable";
}

function evaluateMailbox(row: MailboxRow): AccountsEmailMailboxPublic {
  const transport = mapTransport(row);
  const displayFrom = resolveDisplayFrom(row);
  const cryptoOk = accountsCryptoConfigured();
  const needsReauth = Boolean(row.oauth_needs_reauth);
  const hasOAuth = Boolean(
    row.oauth_connection_id &&
      row.access_token_encrypted &&
      transport === "oauth",
  );
  const hasSmtp = Boolean(
    row.smtp_host &&
      row.smtp_user_encrypted &&
      row.smtp_pass_encrypted &&
      transport === "smtp",
  );

  let status: AccountsEmailMailboxStatus = "not_started";
  let send_ready = false;
  let block_reason: string | null = null;

  const chStatus = String(row.channel_status || "").trim().toLowerCase();
  if (chStatus && chStatus !== "active") {
    status = "in_progress";
    block_reason = `Mailbox channel status is "${row.channel_status}" (need active).`;
  } else if (transport === "unavailable") {
    const pt = String(row.provider_type || "").trim().toLowerCase();
    if (pt === "hosted") {
      status = "in_progress";
      block_reason =
        "Hosted Worktual mailbox transport is not wired in Phase 2 test send yet.";
    } else if (pt === "custom_domain") {
      status = "in_progress";
      block_reason =
        "Custom domain relay is not wired in Phase 2 test send yet — use OAuth or SMTP mailbox.";
    } else {
      status = "in_progress";
      block_reason = "Unsupported or incomplete Accounts email provider setup.";
    }
  } else if (!cryptoOk) {
    status = "blocked";
    block_reason =
      "MS_TOKEN_ENCRYPTION_KEY is not set on Campaign backend — cannot decrypt mailbox secrets.";
  } else if (needsReauth) {
    status = "blocked";
    block_reason = "OAuth mailbox needs reconnect in Setup Workspace (needs_reauth).";
  } else if (transport === "oauth" && !hasOAuth) {
    status = "in_progress";
    block_reason = "OAuth connection or tokens missing on Accounts mailbox.";
  } else if (transport === "smtp" && !hasSmtp) {
    status = "in_progress";
    block_reason = "SMTP host or encrypted credentials missing on Accounts mailbox.";
  } else if (!displayFrom) {
    status = "in_progress";
    block_reason = "No sender address on Accounts mailbox.";
  } else if (
    isWorktualTechEmail(displayFrom) ||
    isWorktualTechEmail(row.sender_email) ||
    isWorktualTechEmail(row.oauth_account_email)
  ) {
    status = "blocked";
    block_reason = WORKTUAL_TECH_FROM_BLOCKED;
  } else {
    status = "ready";
    send_ready = true;
  }

  return {
    channel_id: row.channel_id,
    name: row.name,
    channel_status: row.channel_status,
    provider_type: row.provider_type,
    third_party_mode: row.third_party_mode,
    oauth_provider: row.oauth_provider,
    sender_email: row.sender_email,
    sender_name: row.sender_name,
    reply_to: row.reply_to,
    domain: row.domain,
    domain_verification_status: row.domain_verification_status,
    requested_local_part: row.requested_local_part,
    hosted_domain: row.hosted_domain,
    provisioning_status: row.provisioning_status,
    oauth_account_email: row.oauth_account_email,
    oauth_expires_at: row.oauth_expires_at,
    oauth_needs_reauth: needsReauth,
    oauth_scope: row.oauth_scope,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_secure: row.smtp_secure,
    has_smtp_credentials: hasSmtp,
    has_oauth_tokens: hasOAuth,
    display_from: displayFrom,
    transport,
    status,
    send_ready,
    block_reason,
    crypto_configured: cryptoOk,
    source: "accounts.setup_email_configs",
  };
}

const MAILBOX_SQL = `
SELECT
  cc.id::text                 AS channel_id,
  cc.name,
  cc.status                   AS channel_status,
  ec.provider_type,
  ec.third_party_mode,
  ec.oauth_provider,
  ec.sender_email,
  ec.sender_name,
  ec.reply_to,
  ec.domain,
  ec.domain_verification_status,
  ec.requested_local_part,
  ec.hosted_domain,
  ec.provisioning_status,
  ec.oauth_connection_id::text AS oauth_connection_id,
  ec.smtp_host,
  ec.smtp_port,
  ec.smtp_secure,
  ec.smtp_user_encrypted,
  ec.smtp_pass_encrypted,
  mo.account_email            AS oauth_account_email,
  mo.expires_at::text         AS oauth_expires_at,
  COALESCE(mo.needs_reauth, false) AS oauth_needs_reauth,
  mo.scope                    AS oauth_scope,
  mo.access_token_encrypted,
  mo.refresh_token_encrypted
FROM accounts.setup_channel_configs cc
JOIN accounts.setup_email_configs ec
  ON ec.channel_config_id = cc.id
LEFT JOIN accounts.mail_oauth_connections mo
  ON mo.id = ec.oauth_connection_id
WHERE cc.organization_id::text = $1::text
  AND cc.channel_type = 'email'
  AND cc.product_ids ? 'campaign'
ORDER BY
  CASE WHEN lower(cc.status) = 'active' THEN 0
       WHEN lower(cc.status) = 'pending' THEN 1
       ELSE 2 END,
  cc.updated_at DESC NULLS LAST,
  cc.created_at DESC NULLS LAST
LIMIT 20
`;

export async function listAccountsCampaignEmailMailboxesDao(
  session: CampaignSessionUser,
): Promise<AccountsEmailMailboxPublic[]> {
  const { rows } = await accountQuery<MailboxRow>(MAILBOX_SQL, [
    accountOrgParam(session.organizationId),
  ]);
  return rows.map(evaluateMailbox);
}

export async function getAccountsCampaignEmailMailboxDao(
  session: CampaignSessionUser,
  channelId?: string | null,
): Promise<AccountsEmailMailboxPublic | null> {
  const all = await listAccountsCampaignEmailMailboxesDao(session);
  if (!all.length) return null;
  const id = String(channelId || "").trim();
  if (id) {
    return all.find((m) => m.channel_id === id) || null;
  }
  return all.find((m) => m.send_ready) || all[0];
}

/** Internal row with secrets for send — never return to API clients. */
export async function loadAccountsMailboxForSendDao(
  session: CampaignSessionUser,
  channelId?: string | null,
): Promise<(MailboxRow & { public: AccountsEmailMailboxPublic }) | null> {
  const { rows } = await accountQuery<MailboxRow>(MAILBOX_SQL, [
    accountOrgParam(session.organizationId),
  ]);
  if (!rows.length) return null;
  const id = String(channelId || "").trim();
  const row = id
    ? rows.find((r) => r.channel_id === id)
    : rows.find((r) => evaluateMailbox(r).send_ready) || rows[0];
  if (!row) return null;
  return { ...row, public: evaluateMailbox(row) };
}
