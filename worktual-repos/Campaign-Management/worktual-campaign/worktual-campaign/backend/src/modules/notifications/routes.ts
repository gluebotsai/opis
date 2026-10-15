import type { FastifyInstance } from "fastify";
import { NOTIFICATIONS } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  createNotificationHandler,
  listNotificationsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
} from "./handler.js";

export default async function notificationsRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.get(NOTIFICATIONS.LIST, {
    schema: {
      tags: ["Notifications"],
      summary: "List in-app notifications for the current tenant/user",
    },
    handler: listNotificationsHandler,
  });

  server.post(NOTIFICATIONS.CREATE, {
    schema: {
      tags: ["Notifications"],
      summary: "Create a client-originated notification (recommendations)",
    },
    handler: createNotificationHandler,
  });

  server.post(NOTIFICATIONS.READ, {
    schema: {
      tags: ["Notifications"],
      summary: "Mark a notification as read",
    },
    handler: markNotificationReadHandler,
  });

  server.post(NOTIFICATIONS.READ_ALL, {
    schema: {
      tags: ["Notifications"],
      summary: "Mark all notifications as read",
    },
    handler: markAllNotificationsReadHandler,
  });
}
