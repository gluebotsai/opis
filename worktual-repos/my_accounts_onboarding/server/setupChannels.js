/**
 * Email channel setup (My Account).
 * Allowed products: contact-center (CCaaS) and campaign only.
 * Deferred channel slices: Voice, Social (Meta), Web Chat, SMS; queue↔mailbox binding later.
 */
import crypto from "node:crypto";

import nodemailer from "nodemailer";

import { EMAIL_CHANNEL_PRODUCT_IDS } from "../src/lib/productCatalog.js";
import { pool } from "./db/pool.js";
import { isOrgAdminCustomer } from "./customerAuth.js";
import { isUuid } from "./db/util.js";
import { encryptSecret } from "./msGraphCrypto.js";
import {
  buildAuthorizationUrl,
  cleanupExpiredOAuthStates,
  createOAuthState,
} from "./msGraphOAuth.js";
import { getMailOAuthConnection } from "./msGraphTokens.js";
import { isMicrosoftMailConfigured } from "./msGraphConfig.js";
import { isGoogleMailConfigured } from "./googleMailConfig.js";
import { isYahooMailConfigured } from "./yahooMailConfig.js";
import { buildGoogleAuthorizationUrl } from "./googleOAuth.js";
import { buildYahooAuthorizationUrl } from "./yahooOAuth.js";
import { listSubscriptionsByOrganization } from "./subscriptions.js";
import * as repo from "./repositories/raw/setupChannels.repo.js";
import { selectMailOAuthConnection } from "./repositories/raw/mailOAuth.repo.js";

export const EMAIL_PROVIDER_TYPES = ["third_party", "custom_domain", "hosted"];
export const EMAIL_OAUTH_PROVIDERS = ["google", "microsoft", "yahoo"];
export const EMAIL_CCAAS_HANDLERS = ["bot", "human", "bot_then_human"];
export const CUSTOMER_SETUP_ACCOUNT_TYPE = "customer_setup";
export const CUSTOMER_SETUP_MAILBOX_PROFILE = "email";

const EMAIL_ALLOWED = new Set(EMAIL_CHANNEL_PRODUCT_IDS);
const OAUTH_PROVIDER_SET = new Set(EMAIL_OAUTH_PROVIDERS);
const CCAAS_HANDLER_SET = new Set(EMAIL_CCAAS_HANDLERS);
const CCAAS_PRODUCT_ID = "contact-center";

function resolveCcaasHandler(productIds, rawHandler) {
  const hasCcaas = (productIds || []).includes(CCAAS_PRODUCT_ID);
  if (!hasCcaas) return null;
  const value = String(rawHandler || "").trim().toLowerCase();
  if (!CCAAS_HANDLER_SET.has(value)) {
    const error = new Error(
      "Choose how Contact Centre should handle this mailbox: Bot, Human agent, or Bot then Human.",
    );
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function assertOrgAdmin(customerUser) {
  if (!isOrgAdminCustomer(customerUser)) {
    const error = new Error("Only organization admins can modify setup workspace.");
    error.statusCode = 403;
    throw error;
  }
}

function assertChannelConfigId(id) {
  if (!isUuid(id)) {
    const error = new Error("Email configuration id is invalid.");
    error.statusCode = 400;
    throw error;
  }
}

async function getPurchasedProductIds(organizationId) {
  const subscriptions = await listSubscriptionsByOrganization(organizationId);
  return [
    ...new Set(
      subscriptions.filter((row) => row.status === "active").map((row) => row.productId),
    ),
  ];
}

async function assertProductIdsAllowed(organizationId, productIds = []) {
  if (!Array.isArray(productIds) || !productIds.length) {
    const error = new Error("Select at least one purchased product.");
    error.statusCode = 400;
    throw error;
  }
  for (const productId of productIds) {
    if (!EMAIL_ALLOWED.has(productId)) {
      const error = new Error(
        "Email can only be configured for Contact Centre and Campaign.",
      );
      error.statusCode = 400;
      throw error;
    }
  }
  const purchased = await getPurchasedProductIds(organizationId);
  for (const productId of productIds) {
    if (!purchased.includes(productId)) {
      const error = new Error(`Product “${productId}” is not active for this organization.`);
      error.statusCode = 400;
      throw error;
    }
  }
}

function normalizeProviderType(value) {
  const raw = String(value || "").trim();
  if (!EMAIL_PROVIDER_TYPES.includes(raw)) {
    const error = new Error("Integration method is required.");
    error.statusCode = 400;
    throw error;
  }
  return raw;
}

function mapEmailConfig(row) {
  if (!row) return null;
  const senderEmail =
    row.sender_email ||
    row.oauth_account_email ||
    (row.requested_local_part && row.hosted_domain
      ? `${row.requested_local_part}@${row.hosted_domain}`
      : "") ||
    "";
  return {
    id: row.id,
    channelType: "email",
    name: row.name,
    status: row.status || "pending",
    productIds: Array.isArray(row.product_ids) ? row.product_ids : [],
    providerType: row.provider_type,
    thirdPartyMode: row.third_party_mode || null,
    oauthProvider: row.oauth_provider || null,
    ccaasHandler: row.ccaas_handler || null,
    senderEmail,
    senderName: row.sender_name || "",
    replyTo: row.reply_to || "",
    domain: row.domain || "",
    domainVerificationStatus: row.domain_verification_status || null,
    domainVerificationToken: row.domain_verification_token || null,
    smtpHost: row.smtp_host || "",
    smtpPort: row.smtp_port ?? null,
    smtpSecure: row.smtp_secure ?? null,
    imapHost: row.imap_host || "",
    imapPort: row.imap_port ?? null,
    imapSecure: row.imap_secure ?? null,
    oauthConnected: Boolean(row.oauth_connection_id),
    oauthAccountEmail: row.oauth_account_email || "",
    oauthAccountName: row.oauth_account_name || "",
    requestedLocalPart: row.requested_local_part || "",
    hostedDomain: row.hosted_domain || "vectone.tech",
    provisioningStatus: row.provisioning_status || null,
    hasSmtpCredentials: Boolean(row.smtp_host && row.smtp_user_encrypted),
  };
}

function deriveInitialStatus(providerType, body = {}) {
  if (providerType === "hosted") return "pending";
  if (providerType === "custom_domain") return "pending";
  if (providerType === "third_party" && body.thirdPartyMode === "smtp") return "pending";
  if (providerType === "third_party") return "pending";
  return "pending";
}

function buildEmailFieldsFromBody(body, providerType) {
  const fields = {
    providerType,
    thirdPartyMode: body.thirdPartyMode || null,
    senderEmail: body.senderEmail?.trim() || null,
    senderName: body.senderName?.trim() || null,
    replyTo: body.replyTo?.trim() || null,
  };

  if (providerType === "custom_domain") {
    fields.domain = body.domain?.trim() || null;
    fields.senderEmail = body.senderEmail?.trim() || body.mailboxEmail?.trim() || null;
    fields.domainVerificationStatus = "pending";
    fields.domainVerificationToken = crypto.randomBytes(16).toString("hex");
  }

  if (providerType === "hosted") {
    fields.requestedLocalPart = body.requestedLocalPart?.trim() || body.localPart?.trim() || null;
    fields.hostedDomain = body.hostedDomain?.trim() || "vectone.tech";
    fields.provisioningStatus = "pending";
    if (fields.requestedLocalPart) {
      fields.senderEmail = `${fields.requestedLocalPart}@${fields.hostedDomain}`;
    }
  }

  if (providerType === "third_party") {
    const mode = body.thirdPartyMode === "smtp" ? "smtp" : "oauth";
    fields.thirdPartyMode = mode;
    if (mode === "smtp") {
      fields.oauthProvider = null;
      fields.smtpHost = body.smtpHost?.trim() || null;
      fields.smtpPort = body.smtpPort ? Number(body.smtpPort) : 587;
      fields.smtpSecure = Boolean(body.smtpSecure);
      fields.imapHost = body.imapHost?.trim() || null;
      fields.imapPort = body.imapPort ? Number(body.imapPort) : 993;
      fields.imapSecure = body.imapSecure !== false;
      if (body.smtpUser) fields.smtpUserEncrypted = encryptSecret(body.smtpUser);
      if (body.smtpPass) fields.smtpPassEncrypted = encryptSecret(body.smtpPass);
      if (body.imapUser) fields.imapUserEncrypted = encryptSecret(body.imapUser);
      if (body.imapPass) fields.imapPassEncrypted = encryptSecret(body.imapPass);
    } else {
      const oauthProvider = String(body.oauthProvider || "microsoft").trim().toLowerCase();
      if (!OAUTH_PROVIDER_SET.has(oauthProvider)) {
        const error = new Error("Choose Google, Microsoft, or Yahoo.");
        error.statusCode = 400;
        throw error;
      }
      fields.oauthProvider = oauthProvider;
    }
  }

  return fields;
}

function validateProviderPayload(providerType, emailFields, body) {
  if (providerType === "custom_domain") {
    if (!emailFields.domain) {
      const error = new Error("Domain is required.");
      error.statusCode = 400;
      throw error;
    }
    if (!emailFields.senderEmail) {
      const error = new Error("Mailbox email address is required.");
      error.statusCode = 400;
      throw error;
    }
  }
  if (providerType === "hosted") {
    if (!emailFields.requestedLocalPart) {
      const error = new Error("Mailbox name is required for hosted email.");
      error.statusCode = 400;
      throw error;
    }
  }
  if (providerType === "third_party" && emailFields.thirdPartyMode === "smtp") {
    if (!emailFields.smtpHost || !body.smtpUser || !body.smtpPass) {
      const error = new Error("SMTP host, username, and password are required.");
      error.statusCode = 400;
      throw error;
    }
    if (!emailFields.senderEmail) {
      const error = new Error("Sender email is required.");
      error.statusCode = 400;
      throw error;
    }
  }
}

export async function listChannelConfigs(organizationId, { type } = {}) {
  if (type === "web_chat") {
    const { listWebchatConfigs } = await import("./setupWebchat.js");
    return listWebchatConfigs(organizationId);
  }
  if (type && type !== "email") return [];
  const rows = await repo.listEmailChannelConfigs(pool, organizationId);
  return rows.map(mapEmailConfig);
}

export async function getEmailConfig(organizationId, id) {
  assertChannelConfigId(id);
  const row = await repo.getEmailChannelConfigById(pool, organizationId, id);
  if (!row) {
    const error = new Error("Email configuration not found.");
    error.statusCode = 404;
    throw error;
  }
  return mapEmailConfig(row);
}

export async function createEmailConfig(customerUser, body) {
  assertOrgAdmin(customerUser);
  const providerType = normalizeProviderType(body.providerType);
  const productIds = [
    ...new Set((body.productIds || []).map((id) => String(id).trim()).filter(Boolean)),
  ];
  await assertProductIdsAllowed(customerUser.organizationId, productIds);

  if (!body.name?.trim()) {
    const error = new Error("Configuration name is required.");
    error.statusCode = 400;
    throw error;
  }

  const emailFields = buildEmailFieldsFromBody(body, providerType);
  emailFields.ccaasHandler = resolveCcaasHandler(productIds, body.ccaasHandler);
  validateProviderPayload(providerType, emailFields, body);

  const row = await repo.insertEmailChannelConfig(
    pool,
    customerUser.organizationId,
    {
      name: body.name.trim(),
      status: deriveInitialStatus(providerType, body),
      productIds,
    },
    emailFields,
  );
  return mapEmailConfig(row);
}

export async function patchEmailConfig(customerUser, id, body) {
  assertOrgAdmin(customerUser);
  assertChannelConfigId(id);
  const existing = await repo.getEmailChannelConfigById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("Email configuration not found.");
    error.statusCode = 404;
    throw error;
  }

  if (body.providerType !== undefined && body.providerType !== existing.provider_type) {
    const error = new Error(
      "Integration method cannot be changed. Delete this configuration and create a new one.",
    );
    error.statusCode = 400;
    throw error;
  }

  const productIds =
    body.productIds !== undefined
      ? [...new Set(body.productIds.map((pid) => String(pid).trim()).filter(Boolean))]
      : undefined;
  if (productIds) {
    await assertProductIdsAllowed(customerUser.organizationId, productIds);
  }

  const resolvedProductIds =
    productIds ||
    (Array.isArray(existing.product_ids) ? existing.product_ids : []);

  const emailFields = {};
  if (body.senderEmail !== undefined) emailFields.senderEmail = body.senderEmail?.trim() || null;
  if (body.senderName !== undefined) emailFields.senderName = body.senderName?.trim() || null;
  if (body.replyTo !== undefined) emailFields.replyTo = body.replyTo?.trim() || null;
  if (body.domain !== undefined) emailFields.domain = body.domain?.trim() || null;
  if (body.requestedLocalPart !== undefined) {
    emailFields.requestedLocalPart = body.requestedLocalPart?.trim() || null;
    const domain = body.hostedDomain?.trim() || existing.hosted_domain || "vectone.tech";
    if (emailFields.requestedLocalPart) {
      emailFields.senderEmail = `${emailFields.requestedLocalPart}@${domain}`;
    }
  }
  if (body.thirdPartyMode !== undefined) emailFields.thirdPartyMode = body.thirdPartyMode;
  if (body.oauthProvider !== undefined) {
    const oauthProvider = String(body.oauthProvider || "").trim().toLowerCase();
    if (oauthProvider && !OAUTH_PROVIDER_SET.has(oauthProvider)) {
      const error = new Error("Choose Google, Microsoft, or Yahoo.");
      error.statusCode = 400;
      throw error;
    }
    emailFields.oauthProvider = oauthProvider || null;
    if (oauthProvider) emailFields.thirdPartyMode = "oauth";
  }
  if (body.smtpHost !== undefined) emailFields.smtpHost = body.smtpHost?.trim() || null;
  if (body.smtpPort !== undefined) emailFields.smtpPort = Number(body.smtpPort);
  if (body.smtpSecure !== undefined) emailFields.smtpSecure = Boolean(body.smtpSecure);
  if (body.imapHost !== undefined) emailFields.imapHost = body.imapHost?.trim() || null;
  if (body.imapPort !== undefined) emailFields.imapPort = Number(body.imapPort);
  if (body.imapSecure !== undefined) emailFields.imapSecure = Boolean(body.imapSecure);
  if (body.smtpUser) emailFields.smtpUserEncrypted = encryptSecret(body.smtpUser);
  if (body.smtpPass) emailFields.smtpPassEncrypted = encryptSecret(body.smtpPass);
  if (body.imapUser) emailFields.imapUserEncrypted = encryptSecret(body.imapUser);
  if (body.imapPass) emailFields.imapPassEncrypted = encryptSecret(body.imapPass);

  if (body.ccaasHandler !== undefined || productIds !== undefined) {
    emailFields.ccaasHandler = resolveCcaasHandler(
      resolvedProductIds,
      body.ccaasHandler !== undefined ? body.ccaasHandler : existing.ccaas_handler,
    );
  }

  const channelFields = {};
  if (body.name !== undefined) channelFields.name = body.name?.trim() || existing.name;
  if (productIds !== undefined) channelFields.productIds = productIds;
  if (body.status !== undefined) channelFields.status = body.status;

  const row = await repo.updateEmailChannelConfig(
    pool,
    customerUser.organizationId,
    id,
    channelFields,
    emailFields,
  );
  return mapEmailConfig(row);
}

export async function removeEmailConfig(customerUser, id) {
  assertOrgAdmin(customerUser);
  assertChannelConfigId(id);
  const ok = await repo.deleteEmailChannelConfig(pool, customerUser.organizationId, id);
  if (!ok) {
    const error = new Error("Email configuration not found.");
    error.statusCode = 404;
    throw error;
  }
}

async function verifySmtpCredentials(row) {
  const { decryptSecret } = await import("./msGraphCrypto.js");
  const user = decryptSecret(row.smtp_user_encrypted);
  const pass = decryptSecret(row.smtp_pass_encrypted);
  const transport = nodemailer.createTransport({
    host: row.smtp_host,
    port: row.smtp_port || 587,
    secure: Boolean(row.smtp_secure),
    auth: { user, pass },
  });
  await transport.verify();
}

export async function verifyEmailConfig(customerUser, id) {
  assertOrgAdmin(customerUser);
  assertChannelConfigId(id);
  const row = await repo.getEmailChannelConfigById(pool, customerUser.organizationId, id);
  if (!row) {
    const error = new Error("Email configuration not found.");
    error.statusCode = 404;
    throw error;
  }

  if (row.provider_type === "third_party") {
    if (row.third_party_mode === "oauth") {
      const connection = await getMailOAuthConnection(
        CUSTOMER_SETUP_ACCOUNT_TYPE,
        row.id,
        CUSTOMER_SETUP_MAILBOX_PROFILE,
      );
      if (!connection) {
        const error = new Error("Outlook is not connected yet.");
        error.statusCode = 400;
        throw error;
      }
      await repo.updateEmailChannelConfig(
        pool,
        customerUser.organizationId,
        id,
        { status: "active" },
        { oauthConnectionId: connection.id, senderEmail: connection.accountEmail },
      );
      return { ok: true, method: "oauth", email: connection.accountEmail };
    }
    if (row.third_party_mode === "smtp") {
      await verifySmtpCredentials(row);
      await repo.updateEmailChannelConfig(
        pool,
        customerUser.organizationId,
        id,
        { status: "active" },
        {},
      );
      return { ok: true, method: "smtp" };
    }
    const error = new Error("Third-party integration mode is not set.");
    error.statusCode = 400;
    throw error;
  }

  if (row.provider_type === "custom_domain") {
    const token = row.domain_verification_token || crypto.randomBytes(16).toString("hex");
    await repo.updateEmailChannelConfig(
      pool,
      customerUser.organizationId,
      id,
      { status: "pending" },
      {
        domainVerificationStatus: "pending",
        domainVerificationToken: token,
      },
    );
    return {
      ok: true,
      method: "custom_domain",
      domain: row.domain,
      verificationToken: token,
      dnsInstructions: {
        type: "TXT",
        host: `_worktual-verify.${row.domain}`,
        value: token,
      },
    };
  }

  if (row.provider_type === "hosted") {
    return {
      ok: true,
      method: "hosted",
      provisioningStatus: row.provisioning_status || "pending",
      email: row.sender_email,
    };
  }

  const error = new Error("Unsupported provider type for verification.");
  error.statusCode = 400;
  throw error;
}

export async function confirmCustomDomainVerification(customerUser, id) {
  assertOrgAdmin(customerUser);
  assertChannelConfigId(id);
  const row = await repo.getEmailChannelConfigById(pool, customerUser.organizationId, id);
  if (!row || row.provider_type !== "custom_domain") {
    const error = new Error("Custom domain configuration not found.");
    error.statusCode = 400;
    throw error;
  }
  await repo.updateEmailChannelConfig(
    pool,
    customerUser.organizationId,
    id,
    { status: "active" },
    { domainVerificationStatus: "verified" },
  );
  return { ok: true, status: "verified" };
}

export async function startEmailOAuthConnect(customerUser, id, { returnTo, provider } = {}) {
  assertOrgAdmin(customerUser);
  assertChannelConfigId(id);
  const row = await repo.getEmailChannelConfigById(pool, customerUser.organizationId, id);
  if (!row) {
    const error = new Error("Email configuration not found.");
    error.statusCode = 404;
    throw error;
  }
  if (row.provider_type !== "third_party") {
    const error = new Error("OAuth connect is only available for third-party email.");
    error.statusCode = 400;
    throw error;
  }

  const oauthProvider = String(provider || row.oauth_provider || "microsoft")
    .trim()
    .toLowerCase();
  if (!OAUTH_PROVIDER_SET.has(oauthProvider)) {
    const error = new Error("Choose Google, Microsoft, or Yahoo.");
    error.statusCode = 400;
    throw error;
  }

  if (oauthProvider === "microsoft" && !isMicrosoftMailConfigured()) {
    const error = new Error("Microsoft mail OAuth is not configured on this environment.");
    error.statusCode = 400;
    throw error;
  }
  if (oauthProvider === "google" && !isGoogleMailConfigured()) {
    const error = new Error("Google mail OAuth is not configured on this environment.");
    error.statusCode = 400;
    throw error;
  }
  if (oauthProvider === "yahoo" && !isYahooMailConfigured()) {
    const error = new Error(
      "Yahoo mail OAuth is not configured. Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in .env.",
    );
    error.statusCode = 400;
    throw error;
  }

  await repo.updateEmailChannelConfig(
    pool,
    customerUser.organizationId,
    id,
    {},
    { thirdPartyMode: "oauth", oauthProvider },
  );

  await cleanupExpiredOAuthStates();
  const returnPath =
    returnTo || `/customer/setup/communication/email/${encodeURIComponent(id)}?oauth=pending`;
  const state = await createOAuthState({
    accountType: CUSTOMER_SETUP_ACCOUNT_TYPE,
    accountId: id,
    mailboxProfile: CUSTOMER_SETUP_MAILBOX_PROFILE,
    returnPath,
  });

  let url;
  if (oauthProvider === "google") url = buildGoogleAuthorizationUrl(state);
  else if (oauthProvider === "yahoo") url = buildYahooAuthorizationUrl(state);
  else url = buildAuthorizationUrl(state);

  return { url, state, provider: oauthProvider };
}

export async function finalizeCustomerEmailOAuth(channelConfigId, accountEmail) {
  const oauthRow = await selectMailOAuthConnection(
    CUSTOMER_SETUP_ACCOUNT_TYPE,
    channelConfigId,
    CUSTOMER_SETUP_MAILBOX_PROFILE,
  );
  if (!oauthRow) return null;

  const { rows } = await pool.query(
    `SELECT organization_id FROM setup_channel_configs WHERE id = $1`,
    [channelConfigId],
  );
  const organizationId = rows[0]?.organization_id;
  if (!organizationId) return null;

  await repo.linkOAuthToEmailConfig(
    pool,
    channelConfigId,
    oauthRow.id,
    accountEmail || oauthRow.account_email,
  );
  return getEmailConfig(organizationId, channelConfigId);
}

/*
 * Phase 2 — CCaaS queues & CRM agent routing
 *
 * Stub tables: setup_ccaas_queues, setup_ccaas_queue_agents, setup_crm_channel_agents
 * See docs/setup-channels-phase2.md for wiring plan (no Phase 1 UI/API).
 */
