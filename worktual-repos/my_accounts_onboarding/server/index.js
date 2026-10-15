import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import "./load-env.js";
import cors from "cors";
import express from "express";

import { migrateDatabase } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { shouldRunMigrationsOnBoot } from "./infra/env.js";
import { createCorsOriginValidator } from "./infra/cors.js";
import { pingRedis } from "./infra/redis.js";
import { handleEventsStream } from "./infra/sse.js";
import {
  queuePaymentReceivedEmail,
  queueQuotationApprovedEmail,
  queueQuotationRejectedEmail,
  queueSupportTicketCreatedEmails,
} from "./infra/notify.js";
import {
  QUEUE_NAMES,
  setInlineProcessors,
} from "./infra/queues.js";
import {
  processBillingSweepJob,
  processEmailJob,
  processMailSyncJob,
  processPaymentFulfillmentJob,
} from "./jobs/handlers.js";
import { handleGraphWebhookNotification } from "./msGraphSubscriptions.js";
import {
  checkLoginRateLimit,
  getRequestBearerToken,
  loginUser,
  logoutUser,
  recordFailedLoginAttempt,
  requireAdminAuth,
  requireAuth,
  requireFinanceAuth,
  requireMailAuth,
  requireSalesAdminWriteAuth,
  requireSalesOversightAuth,
  requireSalesWorkspaceAuth,
  signInAccount,
} from "./auth.js";
import {
  fetchAttachmentByUid,
  fetchInboxMessages,
  fetchMailboxMessages,
  fetchMailWorkspace,
  fetchMessageByUid,
  getMailConfigStatus,
  getMailRuntimeStatus,
  normalizeMailProfile,
  sendEmail,
  verifySmtpConnection,
} from "./mail.js";
import { getMailAccountFromRequest } from "./mailAccount.js";
import { getAppUrl, getMicrosoftOAuthDiagnostics, formatMicrosoftOAuthError, getMicrosoftAdminConsentUrl, isMicrosoftMailConfigured } from "./msGraphConfig.js";
import {
  buildAuthorizationUrl,
  cleanupExpiredOAuthStates,
  completeOAuthConnection,
  createOAuthState,
} from "./msGraphOAuth.js";
import { deleteMailOAuthConnection, getMailOAuthStatus } from "./msGraphTokens.js";
import { preloadImapSessions } from "./imapSession.js";
import { createQuotationPaymentLink, getPaymentConfig } from "./payments/index.js";
import { logPayment, logPaymentError } from "./logger.js";
import { getPricingCatalog, savePricingCatalog } from "./pricingCatalog.js";
import {
  authorizeLeadModify,
  authorizeLeadView,
  authorizeOrganizationView,
  authorizeSubscriptionModify,
  authorizeSubscriptionView,
  rejectUnlessAuthorized,
} from "./accessControl.js";
import {
  createLead,
  canUserModifyLead,
  canUserViewLead,
  getLeadById,
  getLeadOwnership,
  listLeads,
  updateLead,
} from "./leads.js";
import {
  clearQuoteSession,
  getQuoteSession,
  saveQuoteSession,
} from "./quoteSessions.js";
import {
  createUser,
  getUserById,
  listUsers,
  sanitizeUser,
  updateAdminProfile,
  updateUserByAdmin,
  updateUserProfile,
} from "./users.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
  getApprovedQuotationPayment,
  getQuotation,
  issueQuotationPaymentLink,
  listQuotationStatuses,
  listQuotations,
  QUOTATION_STATUSES,
  rejectQuotation,
  revertQuotationApproval,
} from "./quotations.js";
import {
  getOversightAgentDetail,
  getOversightDashboard,
  getOversightLeadDetail,
  listOversightAgents,
  listUnassignedLeads,
  logExportAudit,
  reassignLead,
} from "./salesOversight.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const app = express();
const port = Number(process.env.MAIL_API_PORT || 3002);

app.set("trust proxy", 1);

app.use(
  cors({
    origin: createCorsOriginValidator(),
    credentials: true,
  }),
);

app.post(
  "/api/payments/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (request, response) => {
    try {
      const { handleStripeWebhookRequest } = await import("./payments/stripeWebhook.js");
      const result = await handleStripeWebhookRequest(
        request.body,
        request.headers["stripe-signature"],
      );
      response.json({ received: true, ...result });
    } catch (error) {
      logPaymentError("stripe.webhook.failed", error);
      response.status(400).json({
        error: error instanceof Error ? error.message : "Stripe webhook failed.",
      });
    }
  },
);

app.post(
  "/api/payments/webhook/razorpay",
  express.raw({ type: "application/json" }),
  async (request, response) => {
    try {
      const { handleRazorpayWebhookRequest } = await import("./payments/razorpayWebhook.js");
      const result = await handleRazorpayWebhookRequest(
        request.body,
        request.headers["x-razorpay-signature"],
      );
      response.json({ received: true, ...result });
    } catch (error) {
      logPaymentError("razorpay.webhook.failed", error);
      response.status(400).json({
        error: error instanceof Error ? error.message : "Razorpay webhook failed.",
      });
    }
  },
);

app.use(express.json({ limit: "20mb" }));

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    const redis = await pingRedis();
    response.json({
      ok: true,
      fulfillment: "v2-customer-hub",
      database: { ok: true },
      redis,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Health check failed.",
    });
  }
});

app.get("/api/events/stream", async (request, response) => {
  try {
    await handleEventsStream(request, response);
  } catch (error) {
    if (!response.headersSent) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Event stream failed.",
      });
    }
  }
});

app.post("/api/mail/graph/webhook", async (request, response) => {
  const validationToken = request.query.validationToken;
  if (validationToken) {
    response.type("text/plain").send(validationToken);
    return;
  }

  try {
    const result = await handleGraphWebhookNotification(request.body || {});
    response.json({ received: true, ...result });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Graph webhook failed.",
    });
  }
});

function resolveRequestMailbox(request, fallback = "finance") {
  if (request.mailboxProfile) {
    return request.mailboxProfile;
  }

  const value = String(
    request.query.mailbox || request.body?.mailbox || request.body?.profile || fallback,
  ).toLowerCase();
  return normalizeMailProfile(value);
}

app.get("/api/mail/config", requireMailAuth, async (request, response) => {
  try {
    const mailbox = resolveRequestMailbox(request);
    const mailContext = getMailAccountFromRequest(request);
    const status = await getMailRuntimeStatus(mailbox, mailContext);
    response.json(status);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load mail config.",
    });
  }
});

app.get("/api/mail/oauth/status", requireMailAuth, async (request, response) => {
  try {
    const mailContext = getMailAccountFromRequest(request);
    if (!mailContext?.accountId) {
      response.status(400).json({ error: "Mail account context is missing for this session." });
      return;
    }

    const status = await getMailOAuthStatus(
      mailContext.accountType,
      mailContext.accountId,
      mailContext.mailboxProfile,
    );

    response.json({
      microsoftConfigured: isMicrosoftMailConfigured(),
      adminConsentUrl: getMicrosoftAdminConsentUrl(),
      setup: getMicrosoftOAuthDiagnostics(),
      ...status,
      mailboxProfile: mailContext.mailboxProfile,
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load Outlook connection status.",
    });
  }
});

app.get("/api/mail/oauth/connect", requireMailAuth, async (request, response) => {
  try {
    if (!isMicrosoftMailConfigured()) {
      response.status(400).json({
        error: "Microsoft mail OAuth is not configured. Set MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_REDIRECT_URI in .env.",
      });
      return;
    }

    const mailContext = getMailAccountFromRequest(request);
    if (!mailContext?.accountId) {
      response.status(400).json({ error: "Mail account context is missing for this session." });
      return;
    }

    const returnPath = String(request.query.returnTo || "/mail").trim() || "/mail";
    await cleanupExpiredOAuthStates();
    const state = await createOAuthState({
      accountType: mailContext.accountType,
      accountId: mailContext.accountId,
      mailboxProfile: mailContext.mailboxProfile,
      returnPath,
    });

    const url = buildAuthorizationUrl(state);
    if (request.query.redirect === "true") {
      response.redirect(url);
      return;
    }

    response.json({ url, state });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to start Outlook connection.",
    });
  }
});

function shortenOAuthRedirectMessage(message = "") {
  const text = String(message || "").trim();
  if (!text) {
    return "Outlook connection failed.";
  }

  if (text.length <= 280) {
    return text;
  }

  return `${text.slice(0, 277)}...`;
}

async function handleMicrosoftOAuthCallback(request, response) {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const returnPath = String(request.query.returnTo || "/mail").trim() || "/mail";

  try {
    const adminConsent = String(request.query.admin_consent || "").trim();
    if (adminConsent === "True") {
      let resolvedReturnPath = returnPath;
      const state = String(request.query.state || "").trim();
      if (state) {
        try {
          const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
          if (parsed?.returnTo) {
            resolvedReturnPath = parsed.returnTo;
          }
        } catch {
          // Ignore malformed admin-consent state.
        }
      }

      const redirectUrl = new URL(`${appUrl}${resolvedReturnPath}`);
      redirectUrl.searchParams.set("oauth", "admin_consent_success");
      response.redirect(redirectUrl.toString());
      return;
    }

    const error = String(request.query.error || "").trim();
    const errorDescription = String(request.query.error_description || "").trim();
    if (error) {
      const redirectUrl = new URL(`${appUrl}${returnPath}`);
      redirectUrl.searchParams.set("oauth", "error");
      redirectUrl.searchParams.set("message", shortenOAuthRedirectMessage(formatMicrosoftOAuthError(errorDescription || error)));
      response.redirect(redirectUrl.toString());
      return;
    }

    const code = String(request.query.code || "").trim();
    const state = String(request.query.state || "").trim();
    const result = await completeOAuthConnection({ code, state });
    console.log(`[mail oauth] Connected ${result.accountEmail} (${result.mailboxProfile})`);
    if (result.accountType === "customer_setup") {
      const { finalizeCustomerEmailOAuth } = await import("./setupChannels.js");
      await finalizeCustomerEmailOAuth(result.accountId, result.accountEmail);
    } else {
      void import("./msGraphSubscriptions.js")
        .then(({ createGraphMailSubscription }) => createGraphMailSubscription(result.mailboxProfile))
        .catch((subscriptionError) => {
          console.warn(
            "[mail oauth] Graph subscription setup failed:",
            subscriptionError instanceof Error ? subscriptionError.message : subscriptionError,
          );
        });
    }
    const redirectUrl = new URL(`${appUrl}${result.returnPath || returnPath}`);
    redirectUrl.searchParams.set("oauth", "success");
    redirectUrl.searchParams.set("email", result.accountEmail);
    response.redirect(redirectUrl.toString());
  } catch (callbackError) {
    const message = formatMicrosoftOAuthError(
      callbackError instanceof Error ? callbackError.message : "Outlook connection failed.",
    );
    console.error("[mail oauth] Callback failed:", message);
    const redirectUrl = new URL(`${appUrl}${returnPath}`);
    redirectUrl.searchParams.set("oauth", "error");
    redirectUrl.searchParams.set("message", shortenOAuthRedirectMessage(message));
    response.redirect(redirectUrl.toString());
  }
}

app.get("/api/mail/oauth/admin-consent", (request, response) => {
  try {
    const adminConsentUrl = getMicrosoftAdminConsentUrl();
    if (!adminConsentUrl) {
      response.status(400).send(
        "Admin consent URL is not configured. Set MS_APP_TENANT_ID (or MS_TENANT_ID) to your app registration Directory (tenant) ID in .env.",
      );
      return;
    }

    const returnTo = String(request.query.returnTo || "/mail").trim() || "/mail";
    const url = new URL(adminConsentUrl);
    url.searchParams.set("state", Buffer.from(JSON.stringify({ returnTo })).toString("base64url"));
    response.redirect(url.toString());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Admin consent redirect failed.");
  }
});

app.get("/api/mail/oauth/callback", handleMicrosoftOAuthCallback);
// Alias for Azure redirect URIs registered as /auth/microsoft/callback
app.get("/auth/microsoft/callback", handleMicrosoftOAuthCallback);

async function handleGoogleOAuthCallback(request, response) {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const returnPath = String(request.query.returnTo || "/customer/setup/communication").trim();
  try {
    const error = String(request.query.error || "").trim();
    if (error) {
      const redirectUrl = new URL(`${appUrl}${returnPath}`);
      redirectUrl.searchParams.set("oauth", "error");
      redirectUrl.searchParams.set(
        "message",
        shortenOAuthRedirectMessage(request.query.error_description || error),
      );
      response.redirect(redirectUrl.toString());
      return;
    }
    const { completeGoogleOAuthConnection } = await import("./googleOAuth.js");
    const result = await completeGoogleOAuthConnection({
      code: String(request.query.code || "").trim(),
      state: String(request.query.state || "").trim(),
    });
    console.log(`[mail oauth] Google connected ${result.accountEmail}`);
    if (result.accountType === "customer_setup") {
      const { finalizeCustomerEmailOAuth } = await import("./setupChannels.js");
      await finalizeCustomerEmailOAuth(result.accountId, result.accountEmail);
    }
    const redirectUrl = new URL(`${appUrl}${result.returnPath || returnPath}`);
    redirectUrl.searchParams.set("oauth", "success");
    redirectUrl.searchParams.set("email", result.accountEmail);
    response.redirect(redirectUrl.toString());
  } catch (callbackError) {
    const message =
      callbackError instanceof Error ? callbackError.message : "Google connection failed.";
    console.error("[mail oauth] Google callback failed:", message);
    const redirectUrl = new URL(`${appUrl}${returnPath}`);
    redirectUrl.searchParams.set("oauth", "error");
    redirectUrl.searchParams.set("message", shortenOAuthRedirectMessage(message));
    response.redirect(redirectUrl.toString());
  }
}

async function handleYahooOAuthCallback(request, response) {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const returnPath = String(request.query.returnTo || "/customer/setup/communication").trim();
  try {
    const error = String(request.query.error || "").trim();
    if (error) {
      const redirectUrl = new URL(`${appUrl}${returnPath}`);
      redirectUrl.searchParams.set("oauth", "error");
      redirectUrl.searchParams.set(
        "message",
        shortenOAuthRedirectMessage(request.query.error_description || error),
      );
      response.redirect(redirectUrl.toString());
      return;
    }
    const { completeYahooOAuthConnection } = await import("./yahooOAuth.js");
    const result = await completeYahooOAuthConnection({
      code: String(request.query.code || "").trim(),
      state: String(request.query.state || "").trim(),
    });
    console.log(`[mail oauth] Yahoo connected ${result.accountEmail}`);
    if (result.accountType === "customer_setup") {
      const { finalizeCustomerEmailOAuth } = await import("./setupChannels.js");
      await finalizeCustomerEmailOAuth(result.accountId, result.accountEmail);
    }
    const redirectUrl = new URL(`${appUrl}${result.returnPath || returnPath}`);
    redirectUrl.searchParams.set("oauth", "success");
    redirectUrl.searchParams.set("email", result.accountEmail);
    response.redirect(redirectUrl.toString());
  } catch (callbackError) {
    const message =
      callbackError instanceof Error ? callbackError.message : "Yahoo connection failed.";
    console.error("[mail oauth] Yahoo callback failed:", message);
    const redirectUrl = new URL(`${appUrl}${returnPath}`);
    redirectUrl.searchParams.set("oauth", "error");
    redirectUrl.searchParams.set("message", shortenOAuthRedirectMessage(message));
    response.redirect(redirectUrl.toString());
  }
}

app.get("/auth/google/callback", handleGoogleOAuthCallback);
app.get("/api/mail/oauth/google/callback", handleGoogleOAuthCallback);
app.get("/auth/yahoo/callback", handleYahooOAuthCallback);
app.get("/api/mail/oauth/yahoo/callback", handleYahooOAuthCallback);

app.post("/api/mail/oauth/disconnect", requireMailAuth, async (request, response) => {
  try {
    const mailContext = getMailAccountFromRequest(request);
    if (!mailContext?.accountId) {
      response.status(400).json({ error: "Mail account context is missing for this session." });
      return;
    }

    await deleteMailOAuthConnection(
      mailContext.accountType,
      mailContext.accountId,
      mailContext.mailboxProfile,
    );
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to disconnect Outlook.",
    });
  }
});

app.get("/api/mail/workspace", requireMailAuth, async (request, response) => {
  try {
    const folder = String(request.query.folder || "inbox").toLowerCase();
    const limit = Number(request.query.limit || 30);
    const forceRefresh = request.query.refresh === "true";

    if (!["inbox", "sent", "spam"].includes(folder)) {
      response.status(400).json({ error: "Invalid mail folder." });
      return;
    }

    const mailbox = resolveRequestMailbox(request);
    const mailContext = getMailAccountFromRequest(request);
    const workspace = await fetchMailWorkspace(folder, limit, mailbox, { forceRefresh, mailContext });
    response.json(workspace);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load mail workspace.",
    });
  }
});

app.get("/api/mail/verify", requireMailAuth, async (request, response) => {
  try {
    const result = await verifySmtpConnection(resolveRequestMailbox(request));
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "SMTP verification failed.",
    });
  }
});

app.post("/api/mail/send", requireMailAuth, async (request, response) => {
  const mailbox = resolveRequestMailbox(request, "sales");
  const mailContext = getMailAccountFromRequest(request);
  response.status(202).json({ queued: true });

  void sendEmail(request.body, mailbox, mailContext).catch((error) => {
    console.error(
      "[mail] Background send failed:",
      error instanceof Error ? error.message : error,
    );
  });
});

app.get("/api/mail/inbox", requireMailAuth, async (request, response) => {
  try {
    const limit = Number(request.query.limit || 20);
    const forceRefresh = request.query.refresh === "true";
    const mailbox = resolveRequestMailbox(request);
    const mailContext = getMailAccountFromRequest(request);
    const messages = await fetchInboxMessages(limit, mailbox, { forceRefresh, mailContext });
    response.json({ messages, folder: "inbox", mailbox });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch inbox.",
    });
  }
});

app.get("/api/mail/messages", requireMailAuth, async (request, response) => {
  try {
    const folder = String(request.query.folder || "inbox").toLowerCase();
    const limit = Number(request.query.limit || 30);
    const forceRefresh = request.query.refresh === "true";

    if (!["inbox", "sent", "spam"].includes(folder)) {
      response.status(400).json({ error: "Invalid mail folder." });
      return;
    }

    const mailbox = resolveRequestMailbox(request);
    const mailContext = getMailAccountFromRequest(request);
    const result = await fetchMailboxMessages(folder, limit, mailbox, { forceRefresh, mailContext });
    response.json({
      messages: result.messages,
      folder,
      mailbox,
      cached: result.cached,
      source: result.source,
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch messages.",
    });
  }
});

app.get("/api/mail/messages/:uid/attachments/:attachmentId", requireMailAuth, async (request, response) => {
  try {
    const folder = String(request.query.folder || "inbox").toLowerCase();

    if (!["inbox", "sent", "spam"].includes(folder)) {
      response.status(400).json({ error: "Invalid mail folder." });
      return;
    }

    const mailbox = resolveRequestMailbox(request);
    const mailContext = getMailAccountFromRequest(request);
    const attachment = await fetchAttachmentByUid(
      folder,
      request.params.uid,
      request.params.attachmentId,
      mailbox,
      mailContext,
    );
    response.json({ attachment });
  } catch (error) {
    response.status(error instanceof Error && /not found/i.test(error.message) ? 404 : 500).json({
      error: error instanceof Error ? error.message : "Failed to fetch attachment.",
    });
  }
});

app.get("/api/mail/messages/:uid", requireMailAuth, async (request, response) => {
  try {
    const folder = String(request.query.folder || "inbox").toLowerCase();

    if (!["inbox", "sent", "spam"].includes(folder)) {
      response.status(400).json({ error: "Invalid mail folder." });
      return;
    }

    const mailbox = resolveRequestMailbox(request);
    const mailContext = getMailAccountFromRequest(request);
    const message = await fetchMessageByUid(folder, request.params.uid, mailbox, mailContext);
    response.json({ message, mailbox });
  } catch (error) {
    response.status(error instanceof Error && error.message === "Message not found." ? 404 : 500).json({
      error: error instanceof Error ? error.message : "Failed to fetch message.",
    });
  }
});

app.post("/api/auth/login", async (request, response) => {
  if (!(await checkLoginRateLimit(request))) {
    response.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }

  try {
    const { email, password } = request.body || {};
    const result = await loginUser(String(email || ""), String(password || ""));
    response.json(result);
  } catch (error) {
    recordFailedLoginAttempt(request);
    response.status(401).json({
      error: error instanceof Error ? error.message : "Login failed.",
    });
  }
});

app.post("/api/auth/sign-in", async (request, response) => {
  if (!(await checkLoginRateLimit(request))) {
    response.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }

  try {
    const { email, password } = request.body || {};
    const result = await signInAccount(String(email || ""), String(password || ""));
    response.json(result);
  } catch (error) {
    recordFailedLoginAttempt(request);
    response.status(401).json({
      error: error instanceof Error ? error.message : "Login failed.",
    });
  }
});

app.post("/api/auth/logout", requireAuth, async (request, response) => {
  try {
    await logoutUser(getRequestBearerToken(request));
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Logout failed.",
    });
  }
});

app.get("/api/auth/me", requireAuth, async (request, response) => {
  const session = request.authUser;

  if (!session.userId) {
    response.json({
      user: {
        email: session.email,
        role: session.role,
        displayName: session.displayName || "",
      },
    });
    return;
  }

  const user = await getUserById(session.userId);
  if (!user) {
    response.status(404).json({ error: "User profile not found." });
    return;
  }

  response.json({ user: sanitizeUser(user) });
});

app.put("/api/auth/profile", requireAuth, async (request, response) => {
  try {
    const session = request.authUser;

    if (session.role === "admin") {
      if (!session.userId) {
        response.status(400).json({
          error: "This account is not linked to a managed user profile yet.",
        });
        return;
      }

      const user = await updateAdminProfile(session.userId, request.body || {});
      response.json({ user });
      return;
    }

    if (session.role !== "sales" && session.role !== "finance" && session.role !== "sales_admin") {
      response.status(403).json({ error: "Only sales, finance, and sales admin users can update their profile." });
      return;
    }

    if (!session.userId) {
      response.status(400).json({
        error: "This account is not linked to a managed user profile yet. Ask admin to create credentials.",
      });
      return;
    }

    const user = await updateUserProfile(session.userId, request.body || {});
    response.json({ user });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not update profile.",
    });
  }
});

app.get("/api/admin/users", requireAdminAuth, async (_request, response) => {
  const users = await listUsers();
  response.json({ users });
});

app.post("/api/admin/users", requireAdminAuth, async (request, response) => {
  try {
    const user = await createUser(request.body || {}, request.adminUser.email);
    response.status(201).json({ user });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not create user.",
    });
  }
});

app.post("/api/admin/users/bulk/preview", requireAdminAuth, async (request, response) => {
  try {
    const { previewBulkUserCsv } = await import("./userBulkUpload.js");
    const csv = String(request.body?.csv || "");
    if (!csv.trim()) {
      response.status(400).json({ error: "CSV content is required." });
      return;
    }

    const result = await previewBulkUserCsv(csv);
    response.json(result);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not preview bulk upload.",
    });
  }
});

app.post("/api/admin/users/bulk/import", requireAdminAuth, async (request, response) => {
  try {
    const { importBulkUserCsv } = await import("./userBulkUpload.js");
    const csv = String(request.body?.csv || "");
    if (!csv.trim()) {
      response.status(400).json({ error: "CSV content is required." });
      return;
    }

    const result = await importBulkUserCsv(csv, { actorEmail: request.adminUser.email });
    response.json(result);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not import bulk users.",
    });
  }
});

app.put("/api/admin/users/:id", requireAdminAuth, async (request, response) => {
  try {
    const user = await updateUserByAdmin(
      request.params.id,
      request.body || {},
      request.adminUser.email,
    );
    response.json({ user });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not update user.",
    });
  }
});

app.delete("/api/admin/users/:id", requireAdminAuth, async (request, response) => {
  try {
    const { deleteUserByAdmin } = await import("./users.js");
    const result = await deleteUserByAdmin(request.params.id);
    response.json(result);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not delete user.",
    });
  }
});

app.get("/api/admin/cancellation-requests", requireAdminAuth, async (request, response) => {
  try {
    const { listAdminCancellationRequests } = await import("./branchCancellationRequests.js");
    const status = request.query.status ? String(request.query.status) : null;
    const requests = await listAdminCancellationRequests({ status });
    response.json({ requests });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load cancellation requests.",
    });
  }
});

app.get("/api/admin/cancellation-requests/:id", requireAdminAuth, async (request, response) => {
  try {
    const { getCancellationRequest } = await import("./branchCancellationRequests.js");
    const requestRecord = await getCancellationRequest(request.params.id);
    if (!requestRecord) {
      response.status(404).json({ error: "Cancellation request not found." });
      return;
    }
    response.json({ request: requestRecord });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load cancellation request.",
    });
  }
});

app.post("/api/admin/cancellation-requests/:id/approve", requireAdminAuth, async (request, response) => {
  try {
    const { approveCancellationRequest } = await import("./branchCancellationRequests.js");
    const { queueBranchCancellationResolvedEmail } = await import("./infra/notify.js");

    const result = await approveCancellationRequest(request.params.id, {
      adminUser: request.adminUser.email,
      adminNote: request.body?.adminNote || "",
      effectiveTiming: request.body?.effectiveTiming || null,
    });

    void queueBranchCancellationResolvedEmail(result.request, "approved").catch((error) => {
      console.error(
        "[mail] Cancellation resolved notification failed:",
        error instanceof Error ? error.message : error,
      );
    });

    response.json(result);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not approve cancellation request.",
    });
  }
});

app.post("/api/admin/cancellation-requests/:id/reject", requireAdminAuth, async (request, response) => {
  try {
    const { rejectCancellationRequest } = await import("./branchCancellationRequests.js");
    const { queueBranchCancellationResolvedEmail } = await import("./infra/notify.js");

    const requestRecord = await rejectCancellationRequest(request.params.id, {
      adminUser: request.adminUser.email,
      adminNote: request.body?.adminNote || "",
    });

    void queueBranchCancellationResolvedEmail(requestRecord, "rejected").catch((error) => {
      console.error(
        "[mail] Cancellation resolved notification failed:",
        error instanceof Error ? error.message : error,
      );
    });

    response.json({ request: requestRecord });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not reject cancellation request.",
    });
  }
});

app.post(
  "/api/admin/organizations/:orgId/locations/:locationId/drop",
  requireAdminAuth,
  async (request, response) => {
    try {
      const { adminDropBranchDirect } = await import("./branchCancellationRequests.js");
      const result = await adminDropBranchDirect({
        organizationId: request.params.orgId,
        locationId: request.params.locationId,
        adminUser: request.adminUser.email,
        reason: request.body?.reason || "Branch dropped by Worktual admin",
        effectiveTiming: request.body?.effectiveTiming || null,
      });
      response.json(result);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Could not drop branch.",
      });
    }
  },
);

app.get("/api/leads", requireAuth, async (request, response) => {
  try {
    const scope = String(request.query.scope || "").toLowerCase();
    let createdByUserId = null;

    if (request.authUser.role === "sales") {
      createdByUserId = request.authUser.userId || null;
      if (!createdByUserId) {
        response.json({ leads: [] });
        return;
      }
    } else if (request.authUser.role === "sales_admin" && scope === "mine") {
      createdByUserId = request.authUser.userId || null;
      if (!createdByUserId) {
        response.json({ leads: [] });
        return;
      }
    }

    const pipelineOnly = String(request.query.pipelineOnly || "").toLowerCase() === "true";

    const leads = await listLeads({ createdByUserId, pipelineOnly });
    response.json({ leads });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load leads.",
    });
  }
});

app.get("/api/leads/:id", requireAuth, async (request, response) => {
  try {
    const ownership = await getLeadOwnership(request.params.id);
    if (!ownership) {
      response.status(404).json({ error: "Lead not found." });
      return;
    }

    if (!canUserViewLead(request.authUser, ownership)) {
      response.status(403).json({ error: "You do not have permission to view this lead." });
      return;
    }

    const { syncLeadCustomerFulfillment } = await import("./payments/leadFulfillment.js");
    await syncLeadCustomerFulfillment(request.params.id);

    const lead = await getLeadById(request.params.id);
    if (!lead) {
      response.status(404).json({ error: "Lead not found." });
      return;
    }
    response.json({ lead });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load lead.",
    });
  }
});

app.post("/api/leads/:id/customer-portal-access", requireAuth, async (request, response) => {
  try {
    const access = await authorizeLeadView(request.authUser, request.params.id);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const lead = await getLeadById(request.params.id);
    if (!lead) {
      response.status(404).json({ error: "Lead not found." });
      return;
    }

    if (lead.status !== "Paid") {
      response.status(400).json({
        error: "Customer portal access is available after payment is recorded.",
      });
      return;
    }

    const { pool } = await import("./db/pool.js");
    const { ensureOrganizationForPaidLead } = await import("./organizations.js");
    const { regenerateCustomerPortalPassword } = await import("./customerAuth.js");

    const client = await pool.connect();
    try {
      const { organization } = await ensureOrganizationForPaidLead(request.params.id, client);
      if (!organization) {
        response.status(404).json({ error: "Organization not found for this lead." });
        return;
      }

      const portalAccess = await regenerateCustomerPortalPassword(client, organization.id, {
        workEmail: lead.workEmail,
        adminEmail: lead.adminEmail,
        contactName: lead.contactName,
      });

      if (!portalAccess) {
        response.status(400).json({
          error: "Lead must have a work email or admin email for customer portal access.",
        });
        return;
      }

      const loginUrl = `${String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "")}/`;
      response.json({
        loginUrl,
        email: portalAccess.email,
        role: portalAccess.role || "org_admin",
        temporaryPassword: portalAccess.temporaryPassword,
        organizationId: organization.id,
        userCreated: portalAccess.created,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not provision customer portal access.",
    });
  }
});

app.get("/api/leads/:id/customer-portal-users", requireAuth, async (request, response) => {
  try {
    const access = await authorizeLeadView(request.authUser, request.params.id);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const lead = await getLeadById(request.params.id);
    if (!lead) {
      response.status(404).json({ error: "Lead not found." });
      return;
    }

    if (lead.status !== "Paid") {
      response.status(400).json({
        error: "Customer portal access is available after payment is recorded.",
      });
      return;
    }

    const { pool } = await import("./db/pool.js");
    const { ensureOrganizationForPaidLead, refreshOrganizationLocationsFromLead, getOrganizationById } =
      await import("./organizations.js");
    const { listOrganizationCustomerUsers } = await import("./customerAuth.js");

    const client = await pool.connect();
    try {
      const { organization } = await ensureOrganizationForPaidLead(request.params.id, client);
      if (!organization) {
        response.status(404).json({ error: "Organization not found for this lead." });
        return;
      }

      const locations = await refreshOrganizationLocationsFromLead(
        client,
        request.params.id,
        organization.id,
      );
      const users = await listOrganizationCustomerUsers(organization.id, client);

      response.json({
        organizationId: organization.id,
        locations,
        users,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load customer portal users.",
    });
  }
});

app.post(
  "/api/leads/:id/customer-portal-access/branches/:locationId",
  requireAuth,
  async (request, response) => {
    try {
      const access = await authorizeLeadView(request.authUser, request.params.id);
      if (!rejectUnlessAuthorized(response, access)) {
        return;
      }

      const lead = await getLeadById(request.params.id);
      if (!lead) {
        response.status(404).json({ error: "Lead not found." });
        return;
      }

      if (lead.status !== "Paid") {
        response.status(400).json({
          error: "Customer portal access is available after payment is recorded.",
        });
        return;
      }

      const { pool } = await import("./db/pool.js");
      const {
        ensureOrganizationForPaidLead,
        refreshOrganizationLocationsFromLead,
      } = await import("./organizations.js");
      const { regenerateBranchPortalPassword, CUSTOMER_ROLES } = await import("./customerAuth.js");

      const client = await pool.connect();
      try {
        const { organization } = await ensureOrganizationForPaidLead(request.params.id, client);
        if (!organization) {
          response.status(404).json({ error: "Organization not found for this lead." });
          return;
        }

        const locations = await refreshOrganizationLocationsFromLead(
          client,
          request.params.id,
          organization.id,
        );
        const location = locations.find((entry) => entry.id === request.params.locationId);

        if (!location) {
          response.status(404).json({ error: "Branch location not found for this customer." });
          return;
        }

        if (location.isPrimary) {
          response.status(400).json({
            error: "Use company admin credentials for head office. Branch access is for non-HQ locations.",
          });
          return;
        }

        if (!String(location.workEmail || "").trim()) {
          response.status(400).json({
            error: "This branch has no work email. Add it in onboarding before enabling portal access.",
          });
          return;
        }

        const portalAccess = await regenerateBranchPortalPassword(client, organization.id, {
          locationId: location.id,
          email: location.workEmail,
          displayName: location.contactName || location.label || "",
        });

        const loginUrl = `${String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "")}/`;
        response.json({
          loginUrl,
          email: portalAccess.email,
          role: CUSTOMER_ROLES.BRANCH_USER,
          locationId: location.id,
          locationLabel: location.label || "Branch",
          temporaryPassword: portalAccess.temporaryPassword,
          organizationId: organization.id,
          userCreated: portalAccess.created,
        });
      } finally {
        client.release();
      }
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Could not provision branch portal access.",
      });
    }
  },
);

app.post("/api/leads", requireAuth, async (request, response) => {
  try {
    if (request.authUser.role !== "sales" && request.authUser.role !== "sales_admin") {
      response.status(403).json({ error: "Only sales and sales admin users can create leads." });
      return;
    }

    const lead = await createLead(request.body || {}, {
      createdByUserId: request.authUser.userId || null,
    });
    response.status(201).json({ lead });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not create lead.",
    });
  }
});

app.put("/api/leads/:id", requireAuth, async (request, response) => {
  try {
    const ownership = await getLeadOwnership(request.params.id);
    if (!ownership) {
      response.status(404).json({ error: "Lead not found." });
      return;
    }

    if (!canUserModifyLead(request.authUser, ownership)) {
      response.status(403).json({ error: "You do not have permission to update this lead." });
      return;
    }

    const lead = await updateLead(request.params.id, request.body || {});
    if (!lead) {
      response.status(404).json({ error: "Lead not found." });
      return;
    }
    response.json({ lead });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not update lead.",
    });
  }
});

function resolveCustomerScopeUserId(authUser, scope) {
  if (authUser.role === "sales") {
    return authUser.userId || null;
  }
  if (authUser.role === "sales_admin" && String(scope || "").toLowerCase() === "mine") {
    return authUser.userId || null;
  }
  return null;
}

app.get("/api/customers", requireAuth, async (request, response) => {
  try {
    const { listCustomersWithSubscriptions } = await import("./customerHub.js");
    const createdByUserId = resolveCustomerScopeUserId(
      request.authUser,
      request.query.scope,
    );
    const customers = await listCustomersWithSubscriptions({ createdByUserId });
    response.json({ customers });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load customers.",
    });
  }
});

app.get("/api/customers/portfolio", requireAuth, async (request, response) => {
  try {
    const { buildCustomerPortfolio } = await import("./customerHub.js");
    const createdByUserId = resolveCustomerScopeUserId(
      request.authUser,
      request.query.scope,
    );
    const portfolio = await buildCustomerPortfolio({ createdByUserId });
    response.json({ portfolio });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load customer portfolio.",
    });
  }
});

app.get("/api/v1/organizations/:id", requireAuth, async (request, response) => {
  try {
    const access = await authorizeOrganizationView(request.authUser, request.params.id);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const { getOrganizationById } = await import("./organizations.js");
    const organization = await getOrganizationById(request.params.id);
    if (!organization) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }
    response.json({ organization });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load organization.",
    });
  }
});

app.get("/api/v1/organizations/:id/subscriptions", requireAuth, async (request, response) => {
  try {
    const access = await authorizeOrganizationView(request.authUser, request.params.id);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const { listSubscriptionsByOrganization } = await import("./subscriptions.js");
    const subscriptions = await listSubscriptionsByOrganization(request.params.id);
    response.json({ subscriptions });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load subscriptions.",
    });
  }
});

app.get("/api/v1/subscriptions/:id/invoices", requireAuth, async (request, response) => {
  try {
    const access = await authorizeSubscriptionView(request.authUser, request.params.id);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const { getSubscriptionById } = await import("./subscriptions.js");
    const subscription = await getSubscriptionById(request.params.id);
    if (!subscription) {
      response.status(404).json({ error: "Subscription not found." });
      return;
    }

    const { listSubscriptionInvoices } = await import("./billing/subscriptionInvoices.js");
    const invoices = await listSubscriptionInvoices(request.params.id);
    response.json({ invoices });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load subscription invoices.",
    });
  }
});

app.get("/api/v1/subscriptions/:id/entitlements", requireAuth, async (request, response) => {
  try {
    const access = await authorizeSubscriptionView(request.authUser, request.params.id);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const { getSubscriptionEntitlements } = await import("./subscriptions.js");
    const entitlements = await getSubscriptionEntitlements(request.params.id);
    if (!entitlements) {
      response.status(404).json({ error: "Subscription not found." });
      return;
    }
    response.json({ entitlements });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load entitlements.",
    });
  }
});

app.get("/api/v1/subscriptions/:id/usage", requireAuth, async (request, response) => {
  try {
    const access = await authorizeSubscriptionView(request.authUser, request.params.id);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const { getUsageMetricsForSubscription } = await import("./usageMetrics.js");
    const usage = await getUsageMetricsForSubscription(request.params.id);
    response.json({ usage });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load usage metrics.",
    });
  }
});

app.post("/api/v1/subscriptions/:id/usage", requireAuth, async (request, response) => {
  try {
    const access = await authorizeSubscriptionModify(request.authUser, request.params.id);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const { reportUsageConsumption } = await import("./usageMetrics.js");
    const { metricKey, consumed } = request.body || {};
    if (!metricKey) {
      response.status(400).json({ error: "metricKey is required." });
      return;
    }
    const metric = await reportUsageConsumption(
      request.params.id,
      metricKey,
      Number(consumed) || 0,
    );
    response.json({ metric });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not report usage.",
    });
  }
});

app.post("/api/v1/customer/login", async (request, response) => {
  if (!(await checkLoginRateLimit(request))) {
    response.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }

  try {
    const { loginCustomerUser } = await import("./customerAuth.js");
    const { email, password } = request.body || {};
    const session = await loginCustomerUser(email, password);
    response.json(session);
  } catch (error) {
    recordFailedLoginAttempt(request);
    response.status(401).json({
      error: error instanceof Error ? error.message : "Login failed.",
    });
  }
});

app.get("/api/v1/invite/setup-user", async (request, response) => {
  try {
    const { getInvitePreview } = await import("./setupUserInvite.js");
    const token = String(request.query.token || "").trim();
    if (!token) {
      response.status(400).json({ error: "Invite token is required." });
      return;
    }
    response.json({ invite: await getInvitePreview(token) });
  } catch (error) {
    const status = error.statusCode || 400;
    response.status(status).json({
      error: error instanceof Error ? error.message : "Invalid invite.",
    });
  }
});

app.post("/api/v1/invite/setup-user/set-password", async (request, response) => {
  try {
    const { completeSetupUserInvite } = await import("./setupUserInvite.js");
    const body = request.body || {};
    const result = await completeSetupUserInvite({
      token: body.token,
      password: body.password,
      confirmPassword: body.confirmPassword,
    });
    response.json(result);
  } catch (error) {
    const status = error.statusCode || 400;
    response.status(status).json({
      error: error instanceof Error ? error.message : "Could not set password.",
    });
  }
});

app.get("/api/v1/me/entitlements", async (request, response, next) => {
  const { requireCustomerAuth, getCustomerEntitlements } = await import("./customerAuth.js");
  requireCustomerAuth(request, response, async () => {
    try {
      const entitlements = await getCustomerEntitlements(request.customerUser.customerUserId);
      response.json({ entitlements });
    } catch (error) {
      next(error);
    }
  });
});

app.put("/api/v1/me/password", async (request, response, next) => {
  const { requireCustomerAuth, changeCustomerPassword } = await import("./customerAuth.js");
  requireCustomerAuth(request, response, async () => {
    try {
      const { currentPassword, password } = request.body || {};
      await changeCustomerPassword(
        request.customerUser.customerUserId,
        String(currentPassword || ""),
        String(password || ""),
      );
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Could not update password.",
      });
    }
  });
});

app.get("/api/v1/me/subscriptions/:id/usage", async (request, response, next) => {
  const { requireCustomerAuth, assertCustomerSubscriptionAccess } = await import(
    "./customerAuth.js"
  );
  requireCustomerAuth(request, response, async () => {
    try {
      const allowed = await assertCustomerSubscriptionAccess(
        request.customerUser.customerUserId,
        request.params.id,
      );

      if (!allowed) {
        response.status(403).json({ error: "You do not have access to this subscription." });
        return;
      }

      const { getUsageMetricsForSubscription } = await import("./usageMetrics.js");
      const usage = await getUsageMetricsForSubscription(request.params.id);
      response.json({ usage });
    } catch (error) {
      next(error);
    }
  });
});

function withCustomerAuth(handler) {
  return async (request, response, next) => {
    const { requireCustomerAuth } = await import("./customerAuth.js");
    requireCustomerAuth(request, response, async () => {
      try {
        await handler(request, response, next);
      } catch (error) {
        next(error);
      }
    });
  };
}

app.get(
  "/api/v1/me/support/tickets",
  withCustomerAuth(async (request, response) => {
    const { listSupportTicketsForOrganization } = await import("./supportTickets.js");
    const { getCustomerSubscriptionScope } = await import("./customerAuth.js");
    const subscriptionIds = await getCustomerSubscriptionScope(request.customerUser);
    const tickets = await listSupportTicketsForOrganization(request.customerUser.organizationId, {
      status: request.query.status,
      productId: request.query.productId,
      days: request.query.days === "all" ? 0 : request.query.days,
      subscriptionIds,
      customerUserId: request.customerUser.customerUserId,
    });
    response.json({ tickets });
  }),
);

app.get(
  "/api/v1/me/support/tickets/:id",
  withCustomerAuth(async (request, response) => {
    const { getSupportTicketForOrganization } = await import("./supportTickets.js");
    const detail = await getSupportTicketForOrganization(
      request.params.id,
      request.customerUser.organizationId,
    );

    if (!detail) {
      response.status(404).json({ error: "Ticket not found." });
      return;
    }

    response.json(detail);
  }),
);

app.post(
  "/api/v1/me/support/tickets",
  withCustomerAuth(async (request, response) => {
    const { createSupportTicket } = await import("./supportTickets.js");
    const { publishTicketEvent } = await import("./infra/events.js");
    const { assertCustomerSubscriptionAccess } = await import("./customerAuth.js");
    const body = request.body || {};

    if (!body.subject?.trim() || !body.description?.trim() || !body.category) {
      response.status(400).json({ error: "Subject, description, and category are required." });
      return;
    }

    if (
      body.subscriptionId &&
      !(await assertCustomerSubscriptionAccess(
        request.customerUser.customerUserId,
        body.subscriptionId,
      ))
    ) {
      response.status(403).json({ error: "You do not have access to that product subscription." });
      return;
    }

    const detail = await createSupportTicket({
      organizationId: request.customerUser.organizationId,
      customerUserId: request.customerUser.customerUserId,
      subscriptionId: body.subscriptionId || null,
      productId: body.productId || null,
      subscriptionKey: body.subscriptionKey || null,
      productLabel: body.productLabel || "",
      category: body.category,
      priority: body.priority || "medium",
      subject: body.subject.trim(),
      description: body.description.trim(),
      unableToUse: body.unableToUse === true,
      startedAfterChange: body.startedAfterChange === true,
      domainId: body.domainId || "",
      companyName: body.companyName || "",
      contactEmail: body.contactEmail || request.customerUser.email,
      authorLabel: request.customerUser.displayName || request.customerUser.email,
    });

    try {
      await queueSupportTicketCreatedEmails(detail.ticket, detail.messages?.[0]);
      await publishTicketEvent("ticket.created", {
        ticketId: detail.ticket.id,
        organizationId: detail.ticket.organizationId,
      });
    } catch (error) {
      console.error(
        "[mail] Support ticket notification failed:",
        error instanceof Error ? error.message : error,
      );
    }

    try {
      const { notifySalesSupportTicketCreated } = await import("./notifications.js");
      await notifySalesSupportTicketCreated(detail.ticket, detail.messages?.[0]);
    } catch (error) {
      console.error(
        "[mail] Sales support ticket notification failed:",
        error instanceof Error ? error.message : error,
      );
    }

    response.status(201).json(detail);
  }),
);

app.post(
  "/api/v1/me/support/tickets/:id/replies",
  withCustomerAuth(async (request, response) => {
    const { addCustomerTicketReply } = await import("./supportTickets.js");
    const body = request.body?.body?.trim();

    if (!body) {
      response.status(400).json({ error: "Reply body is required." });
      return;
    }

    const detail = await addCustomerTicketReply({
      ticketId: request.params.id,
      organizationId: request.customerUser.organizationId,
      body,
      authorLabel: request.customerUser.displayName || request.customerUser.email,
    });

    if (!detail) {
      response.status(404).json({ error: "Ticket not found." });
      return;
    }

    response.json(detail);
  }),
);

app.get(
  "/api/support/tickets",
  requireSalesWorkspaceAuth,
  async (request, response, next) => {
    try {
      const { listSupportTicketsForSalesUser } = await import("./supportTickets.js");
      const tickets = await listSupportTicketsForSalesUser(request.authUser, {
        status: request.query.status,
        productId: request.query.productId,
        days: request.query.days === "all" ? 0 : request.query.days,
        search: request.query.search,
      });
      response.json({ tickets });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/support/tickets/:id",
  requireSalesWorkspaceAuth,
  async (request, response, next) => {
    try {
      const { getSupportTicketForSalesUser } = await import("./supportTickets.js");
      const detail = await getSupportTicketForSalesUser(request.params.id, request.authUser);

      if (!detail) {
        response.status(404).json({ error: "Ticket not found." });
        return;
      }

      response.json(detail);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/support/tickets/:id/replies",
  requireSalesWorkspaceAuth,
  async (request, response, next) => {
    try {
      const { addSalesTicketReply } = await import("./supportTickets.js");
      const body = request.body?.body?.trim();

      if (!body) {
        response.status(400).json({ error: "Reply body is required." });
        return;
      }

      const detail = await addSalesTicketReply({
        ticketId: request.params.id,
        authUser: request.authUser,
        body,
        authorLabel: request.authUser.displayName || request.authUser.email,
        status: request.body?.status || null,
      });

      if (!detail) {
        response.status(404).json({ error: "Ticket not found." });
        return;
      }

      response.json(detail);
    } catch (error) {
      if (error instanceof Error && error.message.includes("closed")) {
        response.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

app.patch(
  "/api/support/tickets/:id/status",
  requireSalesWorkspaceAuth,
  async (request, response, next) => {
    try {
      const { updateSalesTicketStatus } = await import("./supportTickets.js");
      const status = request.body?.status;

      if (!status) {
        response.status(400).json({ error: "Status is required." });
        return;
      }

      const detail = await updateSalesTicketStatus({
        ticketId: request.params.id,
        authUser: request.authUser,
        status,
      });

      if (!detail) {
        response.status(404).json({ error: "Ticket not found." });
        return;
      }

      response.json(detail);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid")) {
        response.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

app.get(
  "/api/v1/me/product-requests",
  withCustomerAuth(async (request, response) => {
    const { listCustomerProductRequests } = await import("./customerProductRequests.js");
    const requests = await listCustomerProductRequests(request.customerUser.organizationId);
    response.json({ requests });
  }),
);

app.post(
  "/api/v1/me/product-requests",
  withCustomerAuth(async (request, response) => {
    const { createCustomerProductRequest } = await import("./customerProductRequests.js");
    const { getCustomerEntitlements } = await import("./customerAuth.js");
    const { notifyCustomerProductRequest } = await import("./notifications.js");

    const body = request.body || {};
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];

    if (!assignments.length) {
      response.status(400).json({ error: "At least one product configuration is required." });
      return;
    }

    const entitlements = await getCustomerEntitlements(request.customerUser.customerUserId);
    const organization = entitlements?.organization;
    const sourceLeadId = organization?.sourceLeadId;

    if (!sourceLeadId) {
      response.status(400).json({ error: "No linked sales account found for this customer." });
      return;
    }

    const { isOrgAdminCustomer } = await import("./customerAuth.js");
    if (!isOrgAdminCustomer(entitlements.user)) {
      const branchId = entitlements.user.locationId;
      const invalidAssignment = assignments.some(
        (entry) => String(entry.branchId || "hq") !== String(branchId),
      );

      if (invalidAssignment) {
        response.status(403).json({
          error: "Branch portal users can only request products for their assigned branch.",
        });
        return;
      }
    }

    const requestRecord = await createCustomerProductRequest({
      organizationId: request.customerUser.organizationId,
      customerUserId: request.customerUser.customerUserId,
      sourceLeadId,
      requestType: body.requestType || "new",
      assignments,
      productSummary: body.productSummary || [],
      branchSummary: body.branchSummary || null,
      customerNote: body.customerNote || "",
      domainId: body.domainId || organization?.domainId || "",
      companyName: body.companyName || organization?.companyName || "",
      contactEmail: body.contactEmail || request.customerUser.email,
    });

    try {
      await notifyCustomerProductRequest(requestRecord);
    } catch (error) {
      console.error(
        "[mail] Customer product request notification failed:",
        error instanceof Error ? error.message : error,
      );
    }

    response.status(201).json({ request: requestRecord });
  }),
);

app.post(
  "/api/v1/me/product-requests/:id/cancel",
  withCustomerAuth(async (request, response) => {
    const { cancelCustomerProductRequest } = await import("./customerProductRequests.js");
    const { notifyCustomerProductRequestCancelled } = await import("./notifications.js");

    const cancelled = await cancelCustomerProductRequest({
      requestId: request.params.id,
      organizationId: request.customerUser.organizationId,
      customerUserId: request.customerUser.customerUserId,
    });

    if (!cancelled) {
      response.status(404).json({
        error: "Request not found or it can no longer be withdrawn.",
      });
      return;
    }

    try {
      await notifyCustomerProductRequestCancelled(cancelled);
    } catch (error) {
      console.error(
        "[mail] Customer product request cancellation notification failed:",
        error instanceof Error ? error.message : error,
      );
    }

    response.json({ request: cancelled });
  }),
);

function setupWriteError(response, error) {
  const status = error?.statusCode || 500;
  response.status(status).json({ error: error?.message || "Setup request failed." });
}

app.get(
  "/api/v1/me/setup/business-profile",
  withCustomerAuth(async (request, response) => {
    const { getBusinessProfile } = await import("./setupOrganization.js");
    response.json({ profile: await getBusinessProfile(request.customerUser.organizationId) });
  }),
);

app.put(
  "/api/v1/me/setup/business-profile",
  withCustomerAuth(async (request, response) => {
    try {
      const { saveBusinessProfile } = await import("./setupOrganization.js");
      response.json({ profile: await saveBusinessProfile(request.customerUser, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/branches",
  withCustomerAuth(async (request, response) => {
    const { getBranches } = await import("./setupOrganization.js");
    response.json({ branches: await getBranches(request.customerUser.organizationId) });
  }),
);

app.post(
  "/api/v1/me/setup/branches",
  withCustomerAuth(async (request, response) => {
    try {
      const { createBranch } = await import("./setupOrganization.js");
      response.status(201).json({ branch: await createBranch(request.customerUser, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.patch(
  "/api/v1/me/setup/branches/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { patchBranch } = await import("./setupOrganization.js");
      response.json({
        branch: await patchBranch(request.customerUser, request.params.id, request.body || {}),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/branches/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeBranch } = await import("./setupOrganization.js");
      await removeBranch(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/holiday-calendars",
  withCustomerAuth(async (request, response) => {
    const { getHolidayCalendars } = await import("./setupOrganization.js");
    response.json({ calendars: await getHolidayCalendars(request.customerUser.organizationId) });
  }),
);

app.post(
  "/api/v1/me/setup/holiday-calendars",
  withCustomerAuth(async (request, response) => {
    try {
      const { createHolidayCalendar } = await import("./setupOrganization.js");
      response
        .status(201)
        .json({ calendar: await createHolidayCalendar(request.customerUser, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/holiday-calendars/:id/holidays",
  withCustomerAuth(async (request, response) => {
    try {
      const { addHolidaysToCalendar } = await import("./setupOrganization.js");
      response.status(201).json({
        holidays: await addHolidaysToCalendar(
          request.customerUser,
          request.params.id,
          request.body?.holidays || [],
        ),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/business-hours",
  withCustomerAuth(async (request, response) => {
    const { getBusinessHoursList } = await import("./setupOrganization.js");
    response.json({ businessHours: await getBusinessHoursList(request.customerUser.organizationId) });
  }),
);

app.post(
  "/api/v1/me/setup/business-hours",
  withCustomerAuth(async (request, response) => {
    try {
      const { createBusinessHours } = await import("./setupOrganization.js");
      response
        .status(201)
        .json({ businessHours: await createBusinessHours(request.customerUser, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.patch(
  "/api/v1/me/setup/business-hours/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { patchBusinessHours } = await import("./setupOrganization.js");
      response.json({
        businessHours: await patchBusinessHours(
          request.customerUser,
          request.params.id,
          request.body || {},
        ),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/business-hours/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeBusinessHours } = await import("./setupOrganization.js");
      await removeBusinessHours(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/teams",
  withCustomerAuth(async (request, response) => {
    const { getTeams } = await import("./setupOrganization.js");
    response.json({ teams: await getTeams(request.customerUser.organizationId) });
  }),
);

app.get(
  "/api/v1/me/setup/teams/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { getTeam } = await import("./setupOrganization.js");
      response.json({ team: await getTeam(request.customerUser.organizationId, request.params.id) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/teams",
  withCustomerAuth(async (request, response) => {
    try {
      const { createTeam } = await import("./setupOrganization.js");
      response.status(201).json({ team: await createTeam(request.customerUser, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.patch(
  "/api/v1/me/setup/teams/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { patchTeam } = await import("./setupOrganization.js");
      response.json({ team: await patchTeam(request.customerUser, request.params.id, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/teams/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeTeam } = await import("./setupOrganization.js");
      await removeTeam(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/ccaas/queues",
  withCustomerAuth(async (request, response) => {
    try {
      const { listQueues } = await import("./setupQueues.js");
      response.json({ queues: await listQueues(request.customerUser) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/ccaas/eligible-agents",
  withCustomerAuth(async (request, response) => {
    try {
      const { listCcaasEligibleUsers } = await import("./setupQueues.js");
      response.json({ users: await listCcaasEligibleUsers(request.customerUser) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/ccaas/queues/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { getQueue } = await import("./setupQueues.js");
      response.json({ queue: await getQueue(request.customerUser, request.params.id) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/ccaas/queues",
  withCustomerAuth(async (request, response) => {
    try {
      const { createQueue } = await import("./setupQueues.js");
      response
        .status(201)
        .json({ queue: await createQueue(request.customerUser, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.patch(
  "/api/v1/me/setup/ccaas/queues/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { patchQueue } = await import("./setupQueues.js");
      response.json({
        queue: await patchQueue(request.customerUser, request.params.id, request.body || {}),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/ccaas/queues/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeQueue } = await import("./setupQueues.js");
      await removeQueue(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.put(
  "/api/v1/me/setup/ccaas/queues/:id/agents",
  withCustomerAuth(async (request, response) => {
    try {
      const { replaceQueueAgents } = await import("./setupQueues.js");
      response.json({
        queue: await replaceQueueAgents(
          request.customerUser,
          request.params.id,
          request.body || {},
        ),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/roles",
  withCustomerAuth(async (request, response) => {
    const { getRoles } = await import("./setupOrganization.js");
    response.json({ roles: await getRoles(request.customerUser.organizationId) });
  }),
);

app.post(
  "/api/v1/me/setup/roles",
  withCustomerAuth(async (request, response) => {
    try {
      const { createRole } = await import("./setupOrganization.js");
      response.status(201).json({ role: await createRole(request.customerUser, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.patch(
  "/api/v1/me/setup/roles/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { patchRole } = await import("./setupOrganization.js");
      response.json({ role: await patchRole(request.customerUser, request.params.id, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/roles/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeRole } = await import("./setupOrganization.js");
      await removeRole(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/users",
  withCustomerAuth(async (request, response) => {
    const { getUsers } = await import("./setupOrganization.js");
    const users = await getUsers(request.customerUser.organizationId);
    const productId = String(request.query.productId || "").trim();
    if (!productId) {
      response.json({ users });
      return;
    }
    response.json({
      users: users.filter((user) =>
        (user.productAccess || []).some((grant) => grant.productId === productId),
      ),
    });
  }),
);

app.post(
  "/api/v1/me/setup/users",
  withCustomerAuth(async (request, response) => {
    try {
      const { createUser } = await import("./setupOrganization.js");
      const result = await createUser(request.customerUser, request.body || {});
      response.status(201).json(result);
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.patch(
  "/api/v1/me/setup/users/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { patchUser } = await import("./setupOrganization.js");
      response.json(await patchUser(request.customerUser, request.params.id, request.body || {}));
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/users/:id/resend-invite",
  withCustomerAuth(async (request, response) => {
    try {
      const { resendUserInvite } = await import("./setupOrganization.js");
      response.json(await resendUserInvite(request.customerUser, request.params.id));
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/users/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeUser } = await import("./setupOrganization.js");
      await removeUser(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/knowledge-documents",
  withCustomerAuth(async (request, response) => {
    try {
      const { listKnowledgeDocuments } = await import("./setupKnowledge.js");
      response.json({
        documents: await listKnowledgeDocuments(
          request.customerUser.organizationId,
          request.query.category,
        ),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/channels",
  withCustomerAuth(async (request, response) => {
    try {
      const { listChannelConfigs } = await import("./setupChannels.js");
      response.json({
        channels: await listChannelConfigs(request.customerUser.organizationId, {
          type: request.query.type,
        }),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/channels/email/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { getEmailConfig } = await import("./setupChannels.js");
      response.json({
        config: await getEmailConfig(request.customerUser.organizationId, request.params.id),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/channels/email",
  withCustomerAuth(async (request, response) => {
    try {
      const { createEmailConfig } = await import("./setupChannels.js");
      response
        .status(201)
        .json({ config: await createEmailConfig(request.customerUser, request.body || {}) });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.patch(
  "/api/v1/me/setup/channels/email/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { patchEmailConfig } = await import("./setupChannels.js");
      response.json({
        config: await patchEmailConfig(
          request.customerUser,
          request.params.id,
          request.body || {},
        ),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/channels/email/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeEmailConfig } = await import("./setupChannels.js");
      await removeEmailConfig(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/channels/email/:id/verify",
  withCustomerAuth(async (request, response) => {
    try {
      const { verifyEmailConfig } = await import("./setupChannels.js");
      response.json({
        result: await verifyEmailConfig(request.customerUser, request.params.id),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/channels/email/:id/confirm-domain",
  withCustomerAuth(async (request, response) => {
    try {
      const { confirmCustomDomainVerification } = await import("./setupChannels.js");
      response.json({
        result: await confirmCustomDomainVerification(request.customerUser, request.params.id),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/channels/email/:id/oauth/connect",
  withCustomerAuth(async (request, response) => {
    try {
      const { startEmailOAuthConnect } = await import("./setupChannels.js");
      const result = await startEmailOAuthConnect(request.customerUser, request.params.id, {
        returnTo: request.query.returnTo,
        provider: request.query.provider,
      });
      if (request.query.redirect === "true") {
        response.redirect(result.url);
        return;
      }
      response.json(result);
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/channels/web-chat/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { getWebchatConfig } = await import("./setupWebchat.js");
      response.json({
        config: await getWebchatConfig(request.customerUser.organizationId, request.params.id),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/channels/web-chat",
  withCustomerAuth(async (request, response) => {
    try {
      const { createWebchatConfig } = await import("./setupWebchat.js");
      response.status(201).json({
        config: await createWebchatConfig(request.customerUser, request.body || {}),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.patch(
  "/api/v1/me/setup/channels/web-chat/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { patchWebchatConfig } = await import("./setupWebchat.js");
      response.json({
        config: await patchWebchatConfig(
          request.customerUser,
          request.params.id,
          request.body || {},
        ),
      });
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/channels/web-chat/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeWebchatConfig } = await import("./setupWebchat.js");
      await removeWebchatConfig(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/channels/web-chat/:id/assets",
  withCustomerAuth(async (request, response, next) => {
    try {
      const multer = (await import("multer")).default;
      const { WEBCHAT_ASSET_MAX_BYTES, uploadWebchatAsset } = await import("./setupWebchat.js");
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: WEBCHAT_ASSET_MAX_BYTES, files: 1 },
      }).single("file");

      upload(request, response, async (uploadError) => {
        if (uploadError) {
          const message =
            uploadError.code === "LIMIT_FILE_SIZE"
              ? "Image must be under 5 MB."
              : uploadError.message || "Upload failed.";
          response.status(400).json({ error: message });
          return;
        }
        try {
          const result = await uploadWebchatAsset(
            request.customerUser,
            request.params.id,
            request.body?.kind || request.query?.kind,
            request.file,
          );
          response.status(201).json(result);
        } catch (error) {
          setupWriteError(response, error);
        }
      });
    } catch (error) {
      next(error);
    }
  }),
);

app.get(
  "/api/v1/me/setup/channels/web-chat/:id/assets/:assetKey",
  withCustomerAuth(async (request, response) => {
    try {
      const { getWebchatAsset } = await import("./setupWebchat.js");
      const asset = await getWebchatAsset(
        request.customerUser,
        request.params.id,
        request.params.assetKey,
      );
      response.setHeader("Content-Type", asset.contentType);
      response.setHeader("Cache-Control", "private, max-age=3600");
      response.send(asset.data);
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.post(
  "/api/v1/me/setup/knowledge-documents",
  withCustomerAuth(async (request, response, next) => {
    try {
      const multer = (await import("multer")).default;
      const { KNOWLEDGE_MAX_BYTES, uploadKnowledgeDocument } = await import("./setupKnowledge.js");
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: KNOWLEDGE_MAX_BYTES, files: 1 },
      }).single("file");

      upload(request, response, async (uploadError) => {
        if (uploadError) {
          const message =
            uploadError.code === "LIMIT_FILE_SIZE"
              ? "File exceeds the 15MB limit."
              : uploadError.message || "File upload failed.";
          response.status(400).json({ error: message });
          return;
        }

        try {
          const document = await uploadKnowledgeDocument(
            request.customerUser,
            request.body || {},
            request.file,
          );
          response.status(201).json({ document });
        } catch (error) {
          setupWriteError(response, error);
        }
      });
    } catch (error) {
      next(error);
    }
  }),
);

app.delete(
  "/api/v1/me/setup/knowledge-documents/:id",
  withCustomerAuth(async (request, response) => {
    try {
      const { removeKnowledgeDocument } = await import("./setupKnowledge.js");
      await removeKnowledgeDocument(request.customerUser, request.params.id);
      response.status(204).end();
    } catch (error) {
      setupWriteError(response, error);
    }
  }),
);

app.get(
  "/api/v1/me/cancellation-requests",
  withCustomerAuth(async (request, response) => {
    const { listCustomerCancellationRequests } = await import("./branchCancellationRequests.js");
    const { getCustomerEntitlements, isOrgAdminCustomer } = await import("./customerAuth.js");

    const entitlements = await getCustomerEntitlements(request.customerUser.customerUserId);
    const locationId = isOrgAdminCustomer(entitlements?.user)
      ? null
      : entitlements?.user?.locationId || null;

    const requests = await listCustomerCancellationRequests(
      request.customerUser.organizationId,
      { locationId },
    );
    response.json({ requests });
  }),
);

app.post(
  "/api/v1/me/cancellation-requests",
  withCustomerAuth(async (request, response) => {
    const { createCustomerCancellationRequest, REQUEST_KINDS } = await import(
      "./branchCancellationRequests.js"
    );
    const { getCustomerEntitlements } = await import("./customerAuth.js");
    const { queueBranchCancellationRequestedEmail } = await import("./infra/notify.js");
    const { isBranchInactive } = await import("./branchLifecycle.js");

    const body = request.body || {};
    const requestKind = String(body.requestKind || "").trim();
    const locationId = String(body.locationId || "").trim();

    if (!Object.values(REQUEST_KINDS).includes(requestKind)) {
      response.status(400).json({ error: "Invalid cancellation request kind." });
      return;
    }

    if (!locationId) {
      response.status(400).json({ error: "Branch location is required." });
      return;
    }

    if (
      await isBranchInactive(null, request.customerUser.organizationId, locationId)
    ) {
      response.status(400).json({ error: "This branch is inactive." });
      return;
    }

    const entitlements = await getCustomerEntitlements(request.customerUser.customerUserId);
    const organization = entitlements?.organization;
    const sourceLeadId = organization?.sourceLeadId;

    if (!sourceLeadId) {
      response.status(400).json({ error: "No linked sales account found for this customer." });
      return;
    }

    try {
      const requestRecord = await createCustomerCancellationRequest({
        organizationId: request.customerUser.organizationId,
        customerUserId: request.customerUser.customerUserId,
        customerUser: entitlements.user,
        sourceLeadId,
        requestKind,
        locationId,
        productId: body.productId || null,
        subscriptionId: body.subscriptionId || null,
        customerNote: body.customerNote || "",
        effectiveTiming: body.effectiveTiming || null,
        domainId: body.domainId || organization?.domainId || "",
        companyName: body.companyName || organization?.companyName || "",
        contactEmail: body.contactEmail || request.customerUser.email,
      });

      try {
        await queueBranchCancellationRequestedEmail(requestRecord);
      } catch (notificationError) {
        console.error(
          "[mail] Cancellation request notification failed:",
          notificationError instanceof Error ? notificationError.message : notificationError,
        );
      }

      response.status(201).json({ request: requestRecord });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Could not submit cancellation request.",
      });
    }
  }),
);

app.post(
  "/api/v1/me/cancellation-requests/:id/withdraw",
  withCustomerAuth(async (request, response) => {
    const { withdrawCancellationRequest } = await import("./branchCancellationRequests.js");

    const withdrawn = await withdrawCancellationRequest(
      request.params.id,
      request.customerUser.organizationId,
      request.customerUser.customerUserId,
    );

    if (!withdrawn) {
      response.status(404).json({ error: "Request not found or it can no longer be withdrawn." });
      return;
    }

    response.json({ request: withdrawn });
  }),
);

app.get("/api/sales-oversight/dashboard", requireSalesOversightAuth, async (request, response) => {
  try {
    const dashboard = await getOversightDashboard({ days: request.query.days });
    response.json(dashboard);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load sales dashboard.",
    });
  }
});

app.get("/api/sales-oversight/agents", requireSalesOversightAuth, async (request, response) => {
  try {
    const agents = await listOversightAgents({ days: request.query.days });
    response.json({ agents });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load sales agents.",
    });
  }
});

app.get("/api/sales-oversight/agents/:userId", requireSalesOversightAuth, async (request, response) => {
  try {
    const detail = await getOversightAgentDetail(request.params.userId, {
      days: request.query.days,
    });
    if (!detail) {
      response.status(404).json({ error: "Sales agent not found." });
      return;
    }
    response.json(detail);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load agent detail.",
    });
  }
});

app.get("/api/sales-oversight/leads/:leadId", requireSalesOversightAuth, async (request, response) => {
  try {
    const detail = await getOversightLeadDetail(request.params.leadId);
    if (!detail) {
      response.status(404).json({ error: "Lead not found." });
      return;
    }
    response.json(detail);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load lead detail.",
    });
  }
});

app.get("/api/sales-oversight/unassigned-leads", requireSalesOversightAuth, async (_request, response) => {
  try {
    const leads = await listUnassignedLeads();
    response.json({ leads });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load unassigned leads.",
    });
  }
});

app.put("/api/sales-oversight/leads/:leadId/assign", requireSalesAdminWriteAuth, async (request, response) => {
  try {
    const { toUserId, reason = "" } = request.body || {};
    if (!toUserId) {
      response.status(400).json({ error: "toUserId is required." });
      return;
    }

    const lead = await reassignLead(request.params.leadId, toUserId, {
      assignedByUserId: request.salesAdminUser.userId,
      reason: String(reason || "").trim(),
    });
    response.json({ lead });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not reassign lead.",
    });
  }
});

app.post("/api/sales-oversight/export-audit", requireSalesOversightAuth, async (request, response) => {
  try {
    const body = request.body || {};
    const format = String(body.format || "").trim();
    const scope = String(body.scope || "").trim();
    if (!format || !scope) {
      response.status(400).json({ error: "format and scope are required." });
      return;
    }

    const actor = request.oversightUser || request.authUser;
    const entry = await logExportAudit({
      exportedByUserId: actor.userId || null,
      exportedByEmail: actor.email,
      exportedByRole: actor.role,
      agentUserId: body.agentUserId || null,
      agentEmail: body.agentEmail || "",
      agentName: body.agentName || "",
      format,
      scope,
      rowCount: body.rowCount,
      fileName: body.fileName || "",
    });
    response.status(201).json({ entry });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not log export audit.",
    });
  }
});

app.get("/api/quote-sessions/:leadId", requireAuth, async (request, response) => {
  try {
    const access = await authorizeLeadView(request.authUser, request.params.leadId);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const session = await getQuoteSession(request.params.leadId);
    response.json({ session });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load quote session.",
    });
  }
});

app.put("/api/quote-sessions/:leadId", requireAuth, async (request, response) => {
  try {
    const access = await authorizeLeadModify(request.authUser, request.params.leadId);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const session = await saveQuoteSession(request.params.leadId, request.body || {});
    response.json({ session });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not save quote session.",
    });
  }
});

app.delete("/api/quote-sessions/:leadId", requireAuth, async (request, response) => {
  try {
    const access = await authorizeLeadModify(request.authUser, request.params.leadId);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    await clearQuoteSession(request.params.leadId);
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not clear quote session.",
    });
  }
});

app.get("/api/payments/config", (_request, response) => {
  response.json(getPaymentConfig());
});

app.post("/api/quotations/:id/mark-paid", requireFinanceAuth, async (request, response) => {
  try {
    const { markQuotationPaymentPaid } = await import("./payments/fulfillment.js");
    const { notifyPaymentReceived } = await import("./notifications.js");
    const body = request.body || {};
    const paymentMethod = String(body.paymentMethod || "manual").trim() || "manual";
    const reference =
      body.providerPaymentId ||
      body.reference ||
      `${paymentMethod}_${request.financeUser.email}_${Date.now()}`;

    const result = await markQuotationPaymentPaid({
      quotationId: request.params.id,
      source: paymentMethod,
      providerPaymentId: reference,
      paidAt: body.paidAt || new Date(),
      sendNotifications: body.notify !== false,
      deferNotifications: body.notify !== false,
    });
    const quotation = await getQuotation(request.params.id);
    response.json({
      ...result,
      quotation,
      notificationQueued: Boolean(result.notificationQueued),
    });

    if (result.notificationQueued && quotation) {
      void queuePaymentReceivedEmail(quotation, {
        source: paymentMethod,
        portalAccess: result.productSync?.portalAccess
          ? {
              email: result.productSync.portalAccess.user?.email,
              temporaryPassword: result.productSync.portalAccess.temporaryPassword,
            }
          : null,
      }).catch((notificationError) => {
        console.error(
          "[mail] Deferred payment notification failed:",
          notificationError instanceof Error ? notificationError.message : notificationError,
        );
      });
    }
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not mark quotation as paid.",
    });
  }
});

app.post("/api/quotations/:id/sync-payment", requireFinanceAuth, async (request, response) => {
  try {
    const quotation = await getQuotation(request.params.id);
    if (!quotation) {
      response.status(404).json({ error: "Quotation not found." });
      return;
    }

    if (quotation.payment?.provider === "razorpay") {
      const { syncRazorpayQuotationPayment } = await import("./payments/razorpay.js");
      const result = await syncRazorpayQuotationPayment(quotation);
      const refreshed = await getQuotation(request.params.id);
      response.json({ ...result, quotation: refreshed });
      return;
    }

    response.status(400).json({
      error: "Payment sync is only available for Razorpay payment links.",
    });
  } catch (error) {
    logPaymentError("quotation.sync_payment.failed", error, { quotationId: request.params.id });
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not sync payment status.",
    });
  }
});

app.get("/api/quotations/payment/:leadId", async (request, response) => {
  try {
    const { syncLeadCustomerFulfillment } = await import("./payments/leadFulfillment.js");
    await syncLeadCustomerFulfillment(request.params.leadId);

    const quotation = await getApprovedQuotationPayment(request.params.leadId);

    if (!quotation?.payment) {
      response.status(404).json({ error: "No payment link found for this customer." });
      return;
    }

    response.json({
      leadId: quotation.leadId,
      quotationId: quotation.id,
      companyName: quotation.lead?.companyName || "",
      payment: quotation.payment,
      fileName: quotation.fileName,
      hasInvoice: Boolean(quotation.pdfBase64),
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load payment.",
    });
  }
});

app.post("/api/quotations", requireAuth, async (request, response) => {
  try {
    const body = request.body || {};
    const leadId = body.leadId;
    if (!leadId) {
      response.status(400).json({ error: "leadId is required." });
      return;
    }

    const access = await authorizeLeadModify(request.authUser, leadId);
    if (!rejectUnlessAuthorized(response, access)) {
      return;
    }

    const quotation = await createQuotation(body);
    response.status(201).json(quotation);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not create quotation.",
    });
  }
});

app.get("/api/quotations/statuses", requireAuth, async (_request, response) => {
  try {
    const statuses = await listQuotationStatuses();
    response.json({ statuses });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load quotation statuses.",
    });
  }
});

app.get("/api/quotations", requireFinanceAuth, async (_request, response) => {
  try {
    const quotations = await listQuotations();
    response.json({ quotations });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load quotations.",
    });
  }
});

app.get("/api/quotations/:id", requireFinanceAuth, async (request, response) => {
  try {
    const quotation = await getQuotation(request.params.id);
    if (!quotation) {
      response.status(404).json({ error: "Quotation not found." });
      return;
    }

    response.json(quotation);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load quotation.",
    });
  }
});

app.post("/api/quotations/:id/approve", requireFinanceAuth, async (request, response) => {
  const quotationId = request.params.id;
  const note = request.body?.note || "";
  const paymentProvider = String(request.body?.paymentProvider || "").trim().toLowerCase() || null;

  if (paymentProvider && paymentProvider !== "stripe" && paymentProvider !== "razorpay") {
    response.status(400).json({ error: "Payment provider must be stripe or razorpay." });
    return;
  }

  try {
    logPayment("quotation.approve.start", {
      quotationId,
      reviewer: request.financeUser.email,
      paymentProvider,
    });

    let quotation = await getQuotation(quotationId);
    if (!quotation) {
      response.status(404).json({ error: "Quotation not found." });
      return;
    }

    const hasPaymentLink = Boolean(quotation.payment?.paymentLinkUrl);

    if (quotation.status === QUOTATION_STATUSES.APPROVED && hasPaymentLink) {
      response.json({
        quotation,
        payment: quotation.payment,
        notificationQueued: false,
        paymentLinkSent: true,
        alreadyApproved: true,
      });
      return;
    }

    if (quotation.status === QUOTATION_STATUSES.APPROVED && !hasPaymentLink) {
      try {
        const issued = await issueQuotationPaymentLink(quotationId, { provider: paymentProvider });
        if (!issued) {
          response.status(404).json({ error: "Quotation not found." });
          return;
        }

        logPayment("quotation.approve.payment_link_retry.success", {
          quotationId,
          paymentLinkId: issued.payment?.paymentLinkId || null,
        });

        response.json({
          quotation: issued.quotation,
          payment: issued.payment,
          notificationQueued: true,
          paymentLinkSent: Boolean(issued.payment?.paymentLinkUrl),
          retriedPaymentLink: true,
        });

        void queueQuotationApprovedEmail(issued.quotation).catch((notificationError) => {
          logPaymentError("quotation.approve.notification_failed", notificationError, {
            quotationId,
          });
        });
      } catch (paymentError) {
        logPaymentError("quotation.approve.payment_link_retry_failed", paymentError, {
          quotationId,
          status: quotation.status,
        });
        response.status(400).json({
          error:
            paymentError instanceof Error
              ? paymentError.message
              : "Could not create payment link.",
        });
      }
      return;
    }

    if (quotation.status !== QUOTATION_STATUSES.PENDING) {
      response.status(400).json({
        error: `Cannot approve quotation in status "${quotation.status}". Refresh the queue and try again.`,
      });
      return;
    }

    quotation = await approveQuotation(quotationId, request.financeUser.email, note);

    try {
      const issued = await issueQuotationPaymentLink(quotationId, { provider: paymentProvider });
      quotation = issued.quotation;
      const payment = issued.payment;

      logPayment("quotation.approve.success", {
        quotationId,
        paymentLinkId: payment?.paymentLinkId || null,
        paymentLinkUrl: payment?.paymentLinkUrl || null,
        grandTotal: payment?.grandTotal || null,
        currency: payment?.currency || null,
      });

      response.json({
        quotation,
        payment,
        notificationQueued: true,
        paymentLinkSent: Boolean(payment?.paymentLinkUrl),
      });

      void queueQuotationApprovedEmail(quotation).catch((notificationError) => {
        logPaymentError("quotation.approve.notification_failed", notificationError, {
          quotationId,
        });
      });
    } catch (paymentError) {
      await revertQuotationApproval(quotationId);
      logPaymentError("quotation.approve.payment_link_failed", paymentError, {
        quotationId,
        revertedToPending: true,
      });
      response.status(400).json({
        error:
          paymentError instanceof Error
            ? paymentError.message
            : "Could not create payment link.",
      });
    }
  } catch (error) {
    logPaymentError("quotation.approve.failed", error, { quotationId });
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not approve quotation.",
    });
  }
});

app.post("/api/quotations/:id/reject", requireFinanceAuth, async (request, response) => {
  try {
    const quotation = await rejectQuotation(
      request.params.id,
      request.financeUser.email,
      request.body?.note || "",
    );

    if (!quotation) {
      response.status(404).json({ error: "Quotation not found." });
      return;
    }

    response.json({ quotation, notificationQueued: true });

    void queueQuotationRejectedEmail(quotation).catch((notificationError) => {
      console.error(
        "[mail] Rejection notification failed:",
        notificationError instanceof Error
          ? notificationError.message
          : notificationError,
      );
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not reject quotation.",
    });
  }
});

app.get("/api/pricing-catalog", async (_request, response) => {
  try {
    const catalog = await getPricingCatalog();
    response.json({ catalog });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load pricing catalog.",
    });
  }
});

app.put("/api/admin/pricing-catalog", requireAdminAuth, async (request, response) => {
  try {
    const catalog = await savePricingCatalog(request.body?.catalog || {}, request.adminUser.email);
    response.json({ catalog });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not save pricing catalog.",
    });
  }
});

const distDir = path.join(projectRoot, "dist");
const serveFrontend =
  process.env.SERVE_FRONTEND !== "false" && fs.existsSync(path.join(distDir, "index.html"));

if (serveFrontend) {
  app.use(express.static(distDir));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api")) {
      next();
      return;
    }

    response.sendFile(path.join(distDir, "index.html"));
  });
}

async function startServer() {
  setInlineProcessors({
    [QUEUE_NAMES.EMAIL]: processEmailJob,
    [QUEUE_NAMES.PAYMENT]: processPaymentFulfillmentJob,
    [QUEUE_NAMES.BILLING]: processBillingSweepJob,
    [QUEUE_NAMES.MAIL]: processMailSyncJob,
  });

  if (shouldRunMigrationsOnBoot()) {
    try {
      await migrateDatabase();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[db] Migration failed:", message);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  } else {
    console.log("[db] Skipping migrations on boot (SKIP_MIGRATE_ON_BOOT=true).");
  }

  const server = app.listen(port, async () => {
    console.log(`Mail API listening on http://localhost:${port}`);
    if (serveFrontend) {
      console.log(`Serving frontend from ${distDir}`);
    }

    if (isMicrosoftMailConfigured()) {
      const setup = getMicrosoftOAuthDiagnostics();
      console.log("[mail oauth] Microsoft Graph OAuth enabled — users connect Outlook from the Inbox.");
      console.log(`[mail oauth] Tenant mode: ${setup.tenantMode} (${setup.tenantId})`);
      console.log(`[mail oauth] Authorize endpoint: ${setup.authorizeEndpoint}`);
      if (setup.hints.length) {
        for (const hint of setup.hints) {
          console.warn(`[mail oauth] ${hint}`);
        }
      }
      await cleanupExpiredOAuthStates();
    }

    for (const profile of ["sales", "finance", "sales_admin"]) {
      const status = getMailConfigStatus(profile);
      for (const warning of status.warnings || []) {
        console.warn(`[mail config:${profile}] ${warning}`);
      }

      if (!status.smtpConfigured) {
        console.warn(`[mail config:${profile}] SMTP is not configured.`);
        continue;
      }

      try {
        await verifySmtpConnection(profile);
        console.log(`[mail config:${profile}] SMTP connection verified (${status.mailboxEmail}).`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[mail config:${profile}] SMTP verification failed: ${message}`);
      }
    }

    void preloadImapSessions();
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      const underSystemd = Boolean(process.env.INVOCATION_ID);
      if (underSystemd) {
        console.error(
          `Port ${port} is already in use. systemd cannot start a second mail API — stop the conflicting process.`,
        );
        process.exit(1);
      }

      console.warn(
        `Port ${port} is already in use. Mail API is probably already running — continuing without starting a new server.`,
      );
      process.exit(0);
    }

    console.error("Mail API failed to start:", error);
    process.exit(1);
  });
}

startServer();
