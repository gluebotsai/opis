import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createAppNotificationFromClientDao,
  listAppNotificationsDao,
  markAllAppNotificationsReadDao,
  markAppNotificationReadDao,
} from "../../dao/notifications.js";
import { RESPONSE } from "../../helpers/constants.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { requireSession } from "../../middlewares/authendication.js";

export async function listNotificationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q = (request.query || {}) as { limit?: string; unreadOnly?: string };
  const limit = q.limit ? Number(q.limit) : 40;
  const unreadOnly =
    q.unreadOnly === "1" || q.unreadOnly === "true" || q.unreadOnly === "yes";
  const items = await listAppNotificationsDao(session, {
    limit: Number.isFinite(limit) ? limit : 40,
    unreadOnly,
  });
  return sendSuccess(reply, RESPONSE.notificationsSuccess, {
    items,
    unread: items.filter((i) => !i.readAt).length,
  });
}

export async function markNotificationReadHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const id = String((request.params as { id?: string })?.id || "").trim();
  if (!id) throw new AppError("Notification id required");
  const row = await markAppNotificationReadDao(session, id);
  if (!row) throw new AppError("Notification not found", 404);
  return sendSuccess(reply, RESPONSE.notificationRead, { notification: row });
}

export async function markAllNotificationsReadHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const result = await markAllAppNotificationsReadDao(session);
  return sendSuccess(reply, RESPONSE.notificationsReadAll, result);
}

export async function createNotificationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = (request.body || {}) as {
    kind?: string;
    title?: string;
    body?: string;
    href?: string | null;
    sourceKey?: string;
  };
  const kind = String(body.kind || "system").trim() || "system";
  const title = String(body.title || "").trim();
  const text = String(body.body || "").trim();
  const sourceKey = String(body.sourceKey || "").trim();
  if (!title || !text || !sourceKey) {
    throw new AppError("title, body, and sourceKey are required");
  }
  const allowed = new Set([
    "recommendation_ready",
    "recommendation_expiry",
    "recommendation_edit",
    "system",
  ]);
  if (!allowed.has(kind)) {
    throw new AppError(
      "This notification kind must be created by the server",
      400,
    );
  }
  const row = await createAppNotificationFromClientDao(session, {
    kind,
    title,
    body: text,
    href: body.href,
    sourceKey,
  });
  return sendSuccess(
    reply,
    RESPONSE.notificationCreated,
    { notification: row },
    201,
  );
}
