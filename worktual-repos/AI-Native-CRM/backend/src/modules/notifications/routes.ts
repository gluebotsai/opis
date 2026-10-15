import type { FastifyPluginAsync } from "fastify";
import {
  clearAllNotificationsCommand,
  listMyNotificationsCommand,
  markAllNotificationsReadCommand,
  markNotificationReadCommand,
} from "@/service/notifications/notification-commands";
import { countUnreadNotifications } from "@/dao/notifications/notification-store";
import { subscribeUserNotifications } from "@/service/notifications/notification-events";
import { resolveSessionUserId, requireSession, withUser, replyStaleCrmSession } from "../../middlewares/auth.js";
import { sendError, sendResult } from "../../helpers/response.js";

const MAX_WAIT_MS = 10 * 60_000;
const HEARTBEAT_MS = 25_000;
const POLL_MS = 15_000;

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { limit?: string } }>("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listMyNotificationsCommand({
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/:id/read", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await markNotificationReadCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post("/read-all", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await markAllNotificationsReadCommand();
      return sendResult(reply, result);
    });
  });

  app.post("/clear", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await clearAllNotificationsCommand();
      return sendResult(reply, result);
    });
  });

  /**
   * Live unread badge for the signed-in user. Pushes when an event fans out
   * to this recipient (assigned-lead owner, sales rep, admin escalation).
   */
  app.get("/events", async (request, reply) => {
    const userId = await resolveSessionUserId(request);
    if (!userId) {
      if (request.crmStaleAuthSession) return replyStaleCrmSession(reply);
      return sendError(reply, "Not signed in.", 401);
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    reply.hijack();

    let closed = false;
    let lastUnread = -1;

    const send = (event: string, data: unknown) => {
      if (closed) return;
      try {
        reply.raw.write(sseLine(event, data));
      } catch {
        closed = true;
      }
    };

    const pushUnread = async () => {
      try {
        const unreadCount = await countUnreadNotifications(userId);
        if (unreadCount !== lastUnread) {
          lastUnread = unreadCount;
          send("unread", { unreadCount });
        }
      } catch (err) {
        app.log.error({ err }, "notification SSE unread poll failed");
      }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
      clearTimeout(deadline);
      unsub();
      try {
        reply.raw.end();
      } catch {
        /* already closed */
      }
    };

    send("ready", { userId });
    void pushUnread();

    const unsub = subscribeUserNotifications(userId, () => {
      void pushUnread();
      send("refresh", { at: Date.now() });
    });

    const heartbeat = setInterval(() => send("ping", Date.now()), HEARTBEAT_MS);
    const poll = setInterval(() => void pushUnread(), POLL_MS);
    const deadline = setTimeout(close, MAX_WAIT_MS);
    request.raw.on("close", close);
  });
};
