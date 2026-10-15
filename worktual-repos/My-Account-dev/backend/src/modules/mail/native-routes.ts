import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  getSession,
  resolveMailboxForRole,
} from "../auth/session-auth.js";
import { getCustomerSession } from "../customer-portal/customer-auth.js";
import { assertMailRecipients } from "../../lib/email-validation-runtime.js";
import { getMailAccountFromRequest } from "./account.js";
import {
  fetchAttachmentByUid,
  fetchInboxMessages,
  fetchMailboxMessages,
  fetchMailWorkspace,
  fetchMessageByUid,
  getMailRuntimeStatus,
  moveMailMessage,
  normalizeMailProfile,
  sendEmail,
  setMailMessageFlag,
} from "./mail-runtime.js";
import { isValidMailFolder } from "./folders.js";
import {
  createMailTemplate,
  listMailTemplates,
  patchMailTemplate,
  removeMailTemplate,
} from "./templates-store.js";
import {
  formatMicrosoftOAuthError,
  getAppUrl,
  getMicrosoftAdminConsentUrl,
  getMicrosoftOAuthDiagnostics,
  isMicrosoftMailConfigured,
} from "./ms-graph/config.js";
import {
  buildAuthorizationUrl,
  cleanupExpiredOAuthStates,
  completeOAuthConnection,
  createOAuthState,
} from "./ms-graph/oauth.js";
import { handleGraphWebhookNotification } from "./ms-graph/subscriptions.js";
import {
  deleteMailOAuthConnection,
  getMailOAuthStatus,
} from "./ms-graph/tokens.js";
import {
  selectMailSignature,
  upsertMailSignature,
} from "../../repositories/raw/mailSignature.repo.js";

type AnyBody = Record<string, any>;
type AnyQuery = Record<string, any>;
type IdParams = { id: string };
type MessageParams = { uid: string };
type AttachmentParams = MessageParams & { attachmentId: string };
type MailPrincipal = {
  email?: string;
  role?: string;
  userId?: string | null;
  displayName?: string;
};
type MailRequest = FastifyRequest & {
  authUser?: MailPrincipal;
  mailboxProfile?: string;
};

/** Prefer query `uid` / `messageId` so Graph ids with `/` survive proxies. */
function resolveMessageUid(request: {
  params?: { uid?: string };
  query?: AnyQuery;
}): string {
  const query = request.query || {};
  const fromQuery = query.uid ?? query.messageId;
  if (fromQuery !== undefined && fromQuery !== null && String(fromQuery).trim()) {
    return String(fromQuery);
  }
  const fromParams = request.params?.uid;
  return fromParams !== undefined && fromParams !== null ? String(fromParams) : "";
}

/**
 * Prefer query `attachmentId` so long Graph attachment ids (often 150+ chars,
 * sometimes containing `/`) never hit Fastify's default `maxParamLength`
 * (100) on the `:attachmentId` path param, which fails with
 * "... is exceeding the max param length".
 */
function resolveAttachmentId(request: {
  params?: { attachmentId?: string };
  query?: AnyQuery;
}): string {
  const query = request.query || {};
  const fromQuery = query.attachmentId;
  if (fromQuery !== undefined && fromQuery !== null && String(fromQuery).trim()) {
    return String(fromQuery);
  }
  const fromParams = request.params?.attachmentId;
  return fromParams !== undefined && fromParams !== null ? String(fromParams) : "";
}

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function requireMailAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const token = bearerToken(request);
    let session = await getSession(token);

    if (!session) {
      const customerSession = await getCustomerSession(token);
      if (customerSession) {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        session = {
          email: customerSession.email,
          role: "customer",
          userId: customerSession.customerUserId,
          displayName: customerSession.displayName || "",
        };
      }
    }

    if (!session) {
      return reply.code(401).send({ error: "Authentication required." });
    }

    const mailboxProfile = resolveMailboxForRole(session.role);
    if (!mailboxProfile) {
      return reply
        .code(403)
        .send({ error: "Mail access is not available for this role." });
    }

    const mailRequest = request as MailRequest;
    mailRequest.authUser = session;
    mailRequest.mailboxProfile = mailboxProfile;
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

function bodyOf(request: FastifyRequest): AnyBody {
  return (request.body || {}) as AnyBody;
}

function queryOf(request: FastifyRequest): AnyQuery {
  return (request.query || {}) as AnyQuery;
}

function resolveRequestMailbox(
  request: FastifyRequest,
  fallback = "finance",
): string {
  const mailRequest = request as MailRequest;
  if (mailRequest.mailboxProfile) return mailRequest.mailboxProfile;
  const query = queryOf(request);
  const body = bodyOf(request);
  const value = String(
    query.mailbox || body.mailbox || body.profile || fallback,
  ).toLowerCase();
  return normalizeMailProfile(value);
}

function mailContext(request: FastifyRequest) {
  return getMailAccountFromRequest(request as MailRequest);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function shortenOAuthRedirectMessage(message = ""): string {
  const text = String(message || "").trim();
  if (!text) return "Outlook connection failed.";
  return text.length <= 280 ? text : `${text.slice(0, 277)}...`;
}

async function handleMicrosoftOAuthCallback(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const query = queryOf(request);
  const appUrl = getAppUrl().replace(/\/$/, "");
  const returnPath = String(query.returnTo || "/mail").trim() || "/mail";

  try {
    if (String(query.admin_consent || "").trim() === "True") {
      let resolvedReturnPath = returnPath;
      const state = String(query.state || "").trim();
      if (state) {
        try {
          const parsed = JSON.parse(
            Buffer.from(state, "base64url").toString("utf8"),
          );
          if (parsed?.returnTo) resolvedReturnPath = parsed.returnTo;
        } catch {
          // Preserve legacy behavior for malformed admin-consent state.
        }
      }
      const redirectUrl = new URL(`${appUrl}${resolvedReturnPath}`);
      redirectUrl.searchParams.set("oauth", "admin_consent_success");
      return reply.redirect(redirectUrl.toString());
    }

    const oauthError = String(query.error || "").trim();
    const description = String(query.error_description || "").trim();
    if (oauthError) {
      const redirectUrl = new URL(`${appUrl}${returnPath}`);
      redirectUrl.searchParams.set("oauth", "error");
      redirectUrl.searchParams.set(
        "message",
        shortenOAuthRedirectMessage(
          formatMicrosoftOAuthError(description || oauthError),
        ),
      );
      return reply.redirect(redirectUrl.toString());
    }

    const result = await completeOAuthConnection({
      code: String(query.code || "").trim(),
      state: String(query.state || "").trim(),
    });
    console.log(
      `[mail oauth] Connected ${result.accountEmail} (${result.mailboxProfile})`,
    );
    void import("./ms-graph/subscriptions.js")
      .then(({ createGraphMailSubscription }) =>
        createGraphMailSubscription(result.mailboxProfile),
      )
      .catch((error) => {
        console.warn(
          "[mail oauth] Graph subscription setup failed:",
          error instanceof Error ? error.message : error,
        );
      });

    const redirectUrl = new URL(
      `${appUrl}${result.returnPath || returnPath}`,
    );
    redirectUrl.searchParams.set("oauth", "success");
    redirectUrl.searchParams.set("email", result.accountEmail);
    return reply.redirect(redirectUrl.toString());
  } catch (error) {
    const message = formatMicrosoftOAuthError(
      error instanceof Error ? error.message : "Outlook connection failed.",
    );
    console.error("[mail oauth] Callback failed:", message);
    const redirectUrl = new URL(`${appUrl}${returnPath}`);
    redirectUrl.searchParams.set("oauth", "error");
    redirectUrl.searchParams.set(
      "message",
      shortenOAuthRedirectMessage(message),
    );
    return reply.redirect(redirectUrl.toString());
  }
}

export const nativeMailRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.post<{ Querystring: AnyQuery; Body: AnyBody }>(
    "/api/mail/graph/webhook",
    async (request, reply) => {
      const validationToken = request.query.validationToken;
      if (validationToken) {
        return reply.type("text/plain").send(String(validationToken));
      }
      try {
        const result = await handleGraphWebhookNotification(request.body || {});
        return reply.send({ received: true, ...result });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Graph webhook failed."),
        });
      }
    },
  );

  app.get(
    "/api/mail/config",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const status = await getMailRuntimeStatus(
          resolveRequestMailbox(request),
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          mailContext(request),
        );
        return reply.send(status);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to load mail config."),
        });
      }
    },
  );

  app.get(
    "/api/mail/oauth/status",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const context = mailContext(request);
        if (!context?.accountId) {
          return reply.code(400).send({
            error: "Mail account context is missing for this session.",
          });
        }
        const status = await getMailOAuthStatus(
          context.accountType,
          context.accountId,
          context.mailboxProfile,
        );
        return reply.send({
          microsoftConfigured: isMicrosoftMailConfigured(),
          adminConsentUrl: getMicrosoftAdminConsentUrl(),
          setup: getMicrosoftOAuthDiagnostics(),
          ...status,
          mailboxProfile: context.mailboxProfile,
        });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(
            error,
            "Failed to load Outlook connection status.",
          ),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/mail/oauth/connect",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        if (!isMicrosoftMailConfigured()) {
          return reply.code(400).send({
            error:
              "Microsoft mail OAuth is not configured. Set MS_CLIENT_ID, MS_REDIRECT_URI, and certificate auth (MS_CERT_THUMBPRINT + MS_PRIVATE_KEY_PATH) or MS_CLIENT_SECRET in .env.",
          });
        }
        const context = mailContext(request);
        if (!context?.accountId) {
          return reply.code(400).send({
            error: "Mail account context is missing for this session.",
          });
        }
        const returnPath =
          String(request.query.returnTo || "/mail").trim() || "/mail";
        await cleanupExpiredOAuthStates();
        const state = await createOAuthState({
          accountType: context.accountType,
          accountId: context.accountId,
          mailboxProfile: context.mailboxProfile,
          returnPath,
        });
        const url = await buildAuthorizationUrl(state);
        return request.query.redirect === "true"
          ? reply.redirect(url)
          : reply.send({ url, state });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to start Outlook connection."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/mail/oauth/admin-consent",
    async (request, reply) => {
      try {
        const adminConsentUrl = getMicrosoftAdminConsentUrl();
        if (!adminConsentUrl) {
          return reply
            .code(400)
            .type("text/plain")
            .send(
              "Admin consent URL is not configured. Set MS_APP_TENANT_ID (or MS_TENANT_ID) to your app registration Directory (tenant) ID in .env.",
            );
        }
        const returnTo =
          String(request.query.returnTo || "/mail").trim() || "/mail";
        const url = new URL(adminConsentUrl);
        url.searchParams.set(
          "state",
          Buffer.from(JSON.stringify({ returnTo })).toString("base64url"),
        );
        return reply.redirect(url.toString());
      } catch (error) {
        return reply
          .code(500)
          .type("text/plain")
          .send(errorMessage(error, "Admin consent redirect failed."));
      }
    },
  );

  app.get("/api/mail/oauth/callback", handleMicrosoftOAuthCallback);
  app.get("/auth/microsoft/callback", handleMicrosoftOAuthCallback);

  app.post(
    "/api/mail/oauth/disconnect",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const context = mailContext(request);
        if (!context?.accountId) {
          return reply.code(400).send({
            error: "Mail account context is missing for this session.",
          });
        }
        await deleteMailOAuthConnection(
          context.accountType,
          context.accountId,
          context.mailboxProfile,
        );
        return reply.send({ ok: true });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to disconnect Outlook."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/mail/workspace",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const folder = String(request.query.folder || "inbox").toLowerCase();
        if (!isValidMailFolder(folder)) {
          return reply.code(400).send({ error: "Invalid mail folder." });
        }
        const workspace = await fetchMailWorkspace(
          folder,
          Number(request.query.limit || 30),
          resolveRequestMailbox(request),
          {
            forceRefresh: request.query.refresh === "true",
            // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
            mailContext: mailContext(request),
            // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
            view: request.query.view
              ? String(request.query.view).toLowerCase()
              : null,
          },
        );
        return reply.send(workspace);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to load mail workspace."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/mail/send",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      const mailbox = resolveRequestMailbox(request, "sales");
      const context = mailContext(request);
      let recipients;
      try {
        recipients = assertMailRecipients(request.body);
      } catch (error) {
        return reply
          .code((error as { status?: number })?.status || 400)
          .send({ error: errorMessage(error, "Invalid recipients.") });
      }
      try {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        const status = await getMailRuntimeStatus(mailbox, context);
        if (
          status.microsoftConfigured &&
          (status.needsOutlookConnect || status.needsReauth)
        ) {
          return reply.code(409).send({
            error:
              "Connect your Microsoft Outlook account before sending mail.",
            needsOutlookConnect: true,
            needsReauth: Boolean(status.needsReauth),
          });
        }
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not verify mail connection."),
        });
      }

      void sendEmail(
        { ...request.body, ...recipients },
        mailbox,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        context,
      ).catch((error: unknown) => {
        console.error(
          "[mail] Background send failed:",
          error instanceof Error ? error.message : error,
        );
      });
      return reply.code(202).send({ queued: true });
    },
  );

  app.get(
    "/api/mail/verify",
    { preHandler: requireMailAuth },
    async (_request, reply) =>
      reply.send({
        ok: false,
        deprecated: true,
        error:
          "SMTP verification is disabled. Sign in with Microsoft Outlook to send and receive mail.",
      }),
  );

  app.get(
    "/api/mail/signature",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const context = mailContext(request);
        if (!context?.accountId) {
          return reply
            .code(401)
            .send({ error: "Mail account context is required." });
        }
        const signature = await selectMailSignature(
          context.accountType,
          context.accountId,
          context.mailboxProfile,
        );
        return reply.send({
          signature: signature
            ? {
                htmlBody: signature.html_body,
                updatedAt: signature.updated_at,
              }
            : null,
        });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to load mail signature."),
        });
      }
    },
  );

  app.put<{ Body: { htmlBody?: string } }>(
    "/api/mail/signature",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const context = mailContext(request);
        if (!context?.accountId) {
          return reply
            .code(401)
            .send({ error: "Mail account context is required." });
        }
        const signature = await upsertMailSignature(
          context.accountType,
          context.accountId,
          context.mailboxProfile,
          String(request.body?.htmlBody || ""),
        );
        return reply.send({
          signature: {
            // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
            htmlBody: signature.html_body,
            // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
            updatedAt: signature.updated_at,
          },
        });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to save mail signature."),
        });
      }
    },
  );

  app.get(
    "/api/mail/templates",
    { preHandler: requireMailAuth },
    async (_request, reply) => {
      try {
        return reply.send({ templates: await listMailTemplates() });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to load mail templates."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/mail/templates",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const actor = (request as MailRequest).authUser?.email || "";
        const template = await createMailTemplate(request.body || {}, actor);
        return reply.code(201).send({ template });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Failed to create mail template."),
        });
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/mail/templates/:id",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const actor = (request as MailRequest).authUser?.email || "";
        const template = await patchMailTemplate(
          request.params.id,
          request.body || {},
          actor,
        );
        return reply.send({ template });
      } catch (error) {
        const message = errorMessage(error, "Failed to update mail template.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/mail/templates/:id",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        await removeMailTemplate(request.params.id);
        return reply.send({ ok: true });
      } catch (error) {
        const message = errorMessage(error, "Failed to delete mail template.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/mail/inbox",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const mailbox = resolveRequestMailbox(request);
        const messages = await fetchInboxMessages(
          Number(request.query.limit || 20),
          mailbox,
          {
            forceRefresh: request.query.refresh === "true",
            mailContext: mailContext(request),
          },
        );
        return reply.send({ messages, folder: "inbox", mailbox });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to fetch inbox."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/mail/messages",
    { preHandler: requireMailAuth },
    async (request, reply) => {
      try {
        const folder = String(request.query.folder || "inbox").toLowerCase();
        if (!isValidMailFolder(folder)) {
          return reply.code(400).send({ error: "Invalid mail folder." });
        }
        const mailbox = resolveRequestMailbox(request);
        const result = await fetchMailboxMessages(
          folder,
          Number(request.query.limit || 30),
          mailbox,
          {
            forceRefresh: request.query.refresh === "true",
            // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
            mailContext: mailContext(request),
            // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
            view: request.query.view
              ? String(request.query.view).toLowerCase()
              : null,
          },
        );
        return reply.send({
          messages: result.messages,
          folder,
          mailbox,
          cached: result.cached,
          source: result.source,
          folderUnavailable: result.folderUnavailable,
        });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Failed to fetch messages."),
        });
      }
    },
  );

  async function handleGetMailAttachment(request: any, reply: FastifyReply) {
    try {
      const folder = String(request.query.folder || "inbox").toLowerCase();
      if (!isValidMailFolder(folder)) {
        return reply.code(400).send({ error: "Invalid mail folder." });
      }
      const uid = resolveMessageUid(request);
      const attachmentId = resolveAttachmentId(request);
      if (!uid || !attachmentId) {
        return reply.code(400).send({ error: "Message id and attachment id are required." });
      }
      const attachment = await fetchAttachmentByUid(
        folder,
        uid,
        attachmentId,
        resolveRequestMailbox(request),
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        mailContext(request),
      );
      return reply.send({ attachment });
    } catch (error) {
      return reply
        .code(error instanceof Error && /not found/i.test(error.message) ? 404 : 500)
        .send({ error: errorMessage(error, "Failed to fetch attachment.") });
    }
  }

  async function handleGetMailMessage(request: any, reply: FastifyReply) {
    try {
      const folder = String(request.query.folder || "inbox").toLowerCase();
      if (!isValidMailFolder(folder)) {
        return reply.code(400).send({ error: "Invalid mail folder." });
      }
      const uid = resolveMessageUid(request);
      if (!uid) {
        return reply.code(400).send({ error: "Message id is required." });
      }
      const mailbox = resolveRequestMailbox(request);
      const message = await fetchMessageByUid(
        folder,
        uid,
        mailbox,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        mailContext(request),
      );
      // Use mailMessage — envelope `message` is reserved for the status string.
      return reply.send({ mailMessage: message, mailbox });
    } catch (error) {
      return reply
        .code(
          error instanceof Error && error.message === "Message not found."
            ? 404
            : 500,
        )
        .send({ error: errorMessage(error, "Failed to fetch message.") });
    }
  }

  async function handleMoveMailMessage(request: any, reply: FastifyReply) {
    try {
      const folder = String(
        request.query.folder || request.body?.folder || "inbox",
      ).toLowerCase();
      const destinationFolder = String(
        request.body?.destinationFolder || "",
      ).toLowerCase();
      if (
        !isValidMailFolder(folder) ||
        !isValidMailFolder(destinationFolder)
      ) {
        return reply.code(400).send({ error: "Invalid mail folder." });
      }
      const uid = resolveMessageUid(request);
      if (!uid) {
        return reply.code(400).send({ error: "Message id is required." });
      }
      const result = await moveMailMessage(
        folder,
        uid,
        destinationFolder,
        resolveRequestMailbox(request),
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        mailContext(request),
      );
      return reply.send(result);
    } catch (error) {
      return reply.code(500).send({
        error: errorMessage(error, "Failed to move message."),
      });
    }
  }

  async function handleFlagMailMessage(request: any, reply: FastifyReply) {
    try {
      const folder = String(
        request.query.folder || request.body?.folder || "inbox",
      ).toLowerCase();
      if (!isValidMailFolder(folder)) {
        return reply.code(400).send({ error: "Invalid mail folder." });
      }
      const uid = resolveMessageUid(request);
      if (!uid) {
        return reply.code(400).send({ error: "Message id is required." });
      }
      const result = await setMailMessageFlag(
        folder,
        uid,
        Boolean(request.body?.flagged),
        resolveRequestMailbox(request),
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        mailContext(request),
      );
      return reply.send(result);
    } catch (error) {
      return reply.code(500).send({
        error: errorMessage(error, "Failed to update message flag."),
      });
    }
  }

  // Prefer fixed `/item` paths + query `uid` (Graph ids often contain `/`).
  // Register before `:uid` routes so "item" is not captured as a message id.
  app.get<{ Querystring: AnyQuery }>(
    "/api/mail/messages/item",
    { preHandler: requireMailAuth },
    handleGetMailMessage,
  );
  // Fixed `/item` attachment path + query `attachmentId` (Graph attachment ids
  // routinely exceed Fastify's default `maxParamLength` of 100 chars).
  // Register before the `:attachmentId` route so "item" is not captured as one.
  app.get<{ Querystring: AnyQuery }>(
    "/api/mail/messages/item/attachments/item",
    { preHandler: requireMailAuth },
    handleGetMailAttachment,
  );
  app.get<{ Params: { attachmentId: string }; Querystring: AnyQuery }>(
    "/api/mail/messages/item/attachments/:attachmentId",
    { preHandler: requireMailAuth },
    handleGetMailAttachment,
  );
  app.post<{ Querystring: AnyQuery; Body: AnyBody }>(
    "/api/mail/messages/item/move",
    { preHandler: requireMailAuth },
    handleMoveMailMessage,
  );
  app.post<{ Querystring: AnyQuery; Body: AnyBody }>(
    "/api/mail/messages/item/flag",
    { preHandler: requireMailAuth },
    handleFlagMailMessage,
  );

  // Legacy path-param routes (still accept query uid/messageId when present).
  app.get<{ Params: AttachmentParams; Querystring: AnyQuery }>(
    "/api/mail/messages/:uid/attachments/:attachmentId",
    { preHandler: requireMailAuth },
    handleGetMailAttachment,
  );
  app.get<{ Params: MessageParams; Querystring: AnyQuery }>(
    "/api/mail/messages/:uid",
    { preHandler: requireMailAuth },
    handleGetMailMessage,
  );
  app.post<{
    Params: MessageParams;
    Querystring: AnyQuery;
    Body: AnyBody;
  }>(
    "/api/mail/messages/:uid/move",
    { preHandler: requireMailAuth },
    handleMoveMailMessage,
  );
  app.post<{
    Params: MessageParams;
    Querystring: AnyQuery;
    Body: AnyBody;
  }>(
    "/api/mail/messages/:uid/flag",
    { preHandler: requireMailAuth },
    handleFlagMailMessage,
  );
};
