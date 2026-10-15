/**
 * Single gate for campaign email send: env + org mailbox.
 * Used at batch plan time (chat / on-demand / Personalised CRM) and in the worker.
 */

import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "./response-builders.js";
import {
  env,
  isGoogleOAuthConfigured,
  isMicrosoftOAuthConfigured,
  reloadBackendEnv,
} from "../config/env.js";
import { accountsCryptoConfigured } from "./accounts-oauth-crypto.js";
import {
  accountsLaunchFailReason,
  isAccountsLaunchReady,
  type LaunchMailboxGate,
} from "./email-launch-transport.js";
import {
  loadAccountsMailboxForSendDao,
  type AccountsEmailMailboxPublic,
} from "../dao/accounts-email-mailbox.js";

export const EMAIL_CRYPTO_ENV_MISSING = "email_crypto_env_missing";
export const EMAIL_OAUTH_ENV_MISSING = "email_oauth_env_missing";

export type EmailSendPipelineSnapshot = {
  ready: boolean;
  code: string | null;
  message: string;
  skip_fail_reason: string | null;
  remedy: string;
  google_oauth_configured: boolean;
  microsoft_oauth_configured: boolean;
  ms_token_encryption_configured: boolean;
  mailbox_send_ready: boolean;
  oauth_provider: string | null;
  transport: string | null;
};

function restartHint(): string {
  if (env.nodeEnv === "production") {
    return (
      "Set the variables in backend/.env on the Campaign API host, then restart the backend " +
      "(e.g. docker compose up -d --force-recreate backend). Confirm GET /health on the API " +
      "shows googleOAuthConfigured and msTokenEncryptionConfigured true."
    );
  }
  return (
    "Keys belong in backend/.env; restart the API so they load " +
    "(npm run dev:lan:stop && npm run dev:lan). Confirm GET /health shows googleOAuthConfigured true."
  );
}

function oauthEnvMissingReason(provider: "google" | "microsoft"): string {
  const vars =
    provider === "microsoft"
      ? "MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET"
      : "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET";
  return `${EMAIL_OAUTH_ENV_MISSING}: ${vars} not loaded in this Campaign API process — ${restartHint()}`;
}

function cryptoEnvMissingReason(): string {
  return (
    `${EMAIL_CRYPTO_ENV_MISSING}: MS_TOKEN_ENCRYPTION_KEY not loaded in this Campaign API process ` +
    `(must match My Accounts Setup Workspace) — ${restartHint()}`
  );
}

function oauthProviderFromPublic(
  pub: LaunchMailboxGate | AccountsEmailMailboxPublic | null | undefined,
): "google" | "microsoft" | null {
  if (!pub || String(pub.transport || "").toLowerCase() !== "oauth") return null;
  const p = String(
    ("oauth_provider" in pub ? pub.oauth_provider : null) || "google",
  )
    .trim()
    .toLowerCase();
  if (p === "microsoft") return "microsoft";
  return "google";
}

export function evaluateEmailSendPipelineForMailbox(
  mailbox: { public?: LaunchMailboxGate } | LaunchMailboxGate | null | undefined,
): EmailSendPipelineSnapshot {
  reloadBackendEnv();
  const googleOk = isGoogleOAuthConfigured();
  const microsoftOk = isMicrosoftOAuthConfigured();
  const cryptoOk = accountsCryptoConfigured();

  const pub =
    mailbox && typeof mailbox === "object" && "public" in mailbox && mailbox.public
      ? mailbox.public
      : (mailbox as LaunchMailboxGate | undefined);

  const transport = pub ? String(pub.transport || "").trim().toLowerCase() : null;
  const provider = oauthProviderFromPublic(pub ?? null);
  const mailboxReady = isAccountsLaunchReady(mailbox);

  const base: EmailSendPipelineSnapshot = {
    ready: false,
    code: null,
    message: "",
    skip_fail_reason: null,
    remedy: "",
    google_oauth_configured: googleOk,
    microsoft_oauth_configured: microsoftOk,
    ms_token_encryption_configured: cryptoOk,
    mailbox_send_ready: mailboxReady,
    oauth_provider: provider,
    transport,
  };

  if (!cryptoOk) {
    const reason = cryptoEnvMissingReason();
    return {
      ...base,
      code: EMAIL_CRYPTO_ENV_MISSING,
      message: reason,
      skip_fail_reason: reason.slice(0, 500),
      remedy: restartHint(),
    };
  }

  if (!mailboxReady) {
    const detail = accountsLaunchFailReason(mailbox);
    return {
      ...base,
      code: "email_mailbox_not_ready",
      message: detail,
      skip_fail_reason: `email_mailbox_not_ready: ${detail}`.slice(0, 500),
      remedy:
        "Connect a send-ready Google, Microsoft, or SMTP mailbox in Setup (My Accounts → Email for campaigns).",
    };
  }

  if (transport === "oauth") {
    const needMicrosoft = provider === "microsoft";
    const oauthOk = needMicrosoft ? microsoftOk : googleOk;
    if (!oauthOk) {
      const reason = oauthEnvMissingReason(needMicrosoft ? "microsoft" : "google");
      return {
        ...base,
        code: EMAIL_OAUTH_ENV_MISSING,
        message: reason,
        skip_fail_reason: reason.slice(0, 500),
        remedy: restartHint(),
      };
    }
  }

  return {
    ...base,
    ready: true,
    code: null,
    message: "Email send pipeline ready (mailbox + backend env).",
    skip_fail_reason: null,
    remedy: "",
  };
}

export async function evaluateEmailSendPipelineReady(
  session: CampaignSessionUser,
): Promise<EmailSendPipelineSnapshot> {
  reloadBackendEnv();
  let mailbox: Awaited<ReturnType<typeof loadAccountsMailboxForSendDao>> = null;
  try {
    mailbox = await loadAccountsMailboxForSendDao(session);
  } catch {
    mailbox = null;
  }
  return evaluateEmailSendPipelineForMailbox(mailbox);
}

/** Throws AppError when email must not be queued or sent. */
export async function assertEmailSendPipelineReady(
  session: CampaignSessionUser,
): Promise<EmailSendPipelineSnapshot> {
  const snap = await evaluateEmailSendPipelineReady(session);
  if (!snap.ready) {
    throw new AppError(
      snap.message,
      400,
      snap.code || "EMAIL_SEND_PIPELINE_NOT_READY",
    );
  }
  return snap;
}

const PIPELINE_ERROR_CODES = new Set([
  EMAIL_CRYPTO_ENV_MISSING,
  EMAIL_OAUTH_ENV_MISSING,
  "email_mailbox_not_ready",
  "EMAIL_SEND_PIPELINE_NOT_READY",
]);

/** Hard failures — must not soft-launch with email_send_warning. */
export function isEmailSendPipelineFailure(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  const code = String(err.code || "").trim();
  if (PIPELINE_ERROR_CODES.has(code)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes(EMAIL_OAUTH_ENV_MISSING) ||
    msg.includes(EMAIL_CRYPTO_ENV_MISSING) ||
    msg.includes("email_mailbox_not_ready") ||
    msg.includes("ms_token_encryption_key") ||
    msg.includes("google_oauth_client") ||
    msg.includes("microsoft_oauth_client") ||
    msg.includes("my accounts campaign mailbox")
  );
}

export function pipelineHealthFlags(): {
  googleOAuthConfigured: boolean;
  microsoftOAuthConfigured: boolean;
  msTokenEncryptionConfigured: boolean;
} {
  reloadBackendEnv();
  return {
    googleOAuthConfigured: isGoogleOAuthConfigured(),
    microsoftOAuthConfigured: isMicrosoftOAuthConfigured(),
    msTokenEncryptionConfigured: accountsCryptoConfigured(),
  };
}
