import type { FastifyPluginAsync } from "fastify";
import {
  composeInboxEmailCommand,
  draftInboxReplyCommand,
  getInboxThreadCommand,
  listInboxCommand,
  listInboxContactsCommand,
  resolveContactForEmailCommand,
  resolveContactForPhoneCommand,
  resolveReplyAllRecipientsCommand,
  saveInboxDraftCommand,
  sendInboxEmailCommand,
  syncInboxCommand,
  updateInboxFolderCommand,
  purgeInboxTrashCommand,
} from "@/service/inbox/inbox-commands";
import {
  cancelScheduledOutboundEmailCommand,
  scheduleOutboundEmailCommand,
} from "@/service/inbox/scheduled-outbound-email";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";

type InboxFolderBody = "inbox" | "sent" | "draft" | "trash";
const INBOX_FOLDERS: InboxFolderBody[] = ["inbox", "sent", "draft", "trash"];

export const inboxRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { limit?: string } }>("/threads", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const limit = Math.max(1, Number(request.query.limit) || 80);
        const result = await listInboxCommand({ limit });
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.get("/contacts", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await listInboxContactsCommand();
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.get<{ Params: { threadId: string } }>(
    "/threads/:threadId",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await getInboxThreadCommand(request.params.threadId);
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.post("/sync", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await syncInboxCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      contactId?: string;
      to?: string;
      subject?: string;
      body?: string;
      cc?: string;
      gmailThreadId?: string | null;
      threadId?: string | null;
      inReplyToRfcMessageId?: string | null;
      inReplyToGmailMessageId?: string | null;
      attachments?: { filename: string; contentType: string; content: string }[];
      salesObjection?: {
        kind?: string;
        customerLine?: string;
        reply?: string;
        proofPoint?: string | null;
        question?: string | null;
      } | null;
    };
  }>("/send", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        if (!body.to?.trim() || !body.subject?.trim() || !body.body?.trim()) {
          return sendError(reply, "to, subject, and body are required.", 400);
        }
        const result = await sendInboxEmailCommand({
          contactId: body.contactId,
          to: body.to,
          subject: body.subject,
          body: body.body,
          cc: body.cc,
          threadId: body.threadId,
          gmailThreadId: body.gmailThreadId,
          inReplyToRfcMessageId: body.inReplyToRfcMessageId,
          inReplyToGmailMessageId: body.inReplyToGmailMessageId,
          attachments: body.attachments,
          salesObjection: body.salesObjection,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.patch<{ Params: { id: string }; Body: { folder?: string } }>(
    "/:id/folder",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const folder = request.body?.folder;
          if (!folder || !INBOX_FOLDERS.includes(folder as InboxFolderBody)) {
            return sendError(reply, "folder must be one of inbox, sent, draft, trash.", 400);
          }
          const result = await updateInboxFolderCommand(
            request.params.id,
            folder as InboxFolderBody,
          );
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await purgeInboxTrashCommand(request.params.id);
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.get<{ Params: { id: string } }>(
    "/:id/reply-all-recipients",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await resolveReplyAllRecipientsCommand(
            request.params.id,
          );
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.post<{
    Body: {
      draftId?: string | null;
      contactId?: string;
      type?: "email" | "call";
      subject?: string;
      body?: string | null;
      threadId?: string | null;
    };
  }>("/draft", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        if (!body.type) {
          return sendError(reply, "type is required.", 400);
        }
        const result = await saveInboxDraftCommand({
          draftId: body.draftId,
          contactId: body.contactId,
          type: body.type,
          subject: body.subject ?? "",
          body: body.body,
          threadId: body.threadId,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      to?: string;
      subject?: string;
      body?: string;
      contactId?: string | null;
      draftId?: string | null;
      sendAt?: string;
    };
  }>("/schedule", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        if (!body.to?.trim() || !body.subject?.trim() || !body.body?.trim() || !body.sendAt?.trim()) {
          return sendError(reply, "to, subject, body, and sendAt are required.", 400);
        }
        const result = await scheduleOutboundEmailCommand({
          to: body.to,
          subject: body.subject,
          body: body.body,
          contactId: body.contactId,
          draftId: body.draftId,
          sendAt: body.sendAt,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: { id?: string | null; draftId?: string | null };
  }>("/schedule/cancel", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await cancelScheduledOutboundEmailCommand({
          id: request.body?.id,
          draftId: request.body?.draftId,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      contactId?: string | null;
      contactName?: string;
      subject?: string;
      inboundBody?: string;
    };
  }>("/draft-reply", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const result = await draftInboxReplyCommand({
          contactId: body.contactId,
          contactName: body.contactName ?? "there",
          subject: body.subject ?? "",
          inboundBody: body.inboundBody ?? "",
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      instruction?: string;
      contactId?: string | null;
      contactName?: string | null;
      companyName?: string | null;
      subject?: string | null;
      currentBody?: string | null;
      inboundBody?: string | null;
      isReply?: boolean;
    };
  }>("/compose-assist", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const result = await composeInboxEmailCommand({
          instruction: body.instruction ?? "",
          contactId: body.contactId,
          contactName: body.contactName,
          companyName: body.companyName,
          subject: body.subject,
          currentBody: body.currentBody,
          inboundBody: body.inboundBody,
          isReply: Boolean(body.isReply),
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{ Body: { phone?: string } }>(
    "/resolve-phone",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const phone = request.body?.phone ?? "";
          const result = await resolveContactForPhoneCommand(phone);
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.post<{ Body: { email?: string } }>(
    "/resolve-email",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const email = request.body?.email ?? "";
          const result = await resolveContactForEmailCommand(email);
          return sendResult(reply, result);
        },
        request,
      );
    },
  );
};
