import type { FastifyReply, FastifyRequest } from "fastify";

import {
  calendarPushWebhookUrl,
  redactCalendarPushWebhookUrl,
} from "@/service/calendar/google-calendar-push";
import { handleGooglePushMultiplex } from "@/service/webhooks/google-push-multiplex";
import { sendError, sendSuccess } from "../../helpers/response.js";

let loggedConfiguredWebhook = false;

export async function postGooglePushWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
  logLabel: string,
): Promise<FastifyReply> {
  if (!loggedConfiguredWebhook) {
    loggedConfiguredWebhook = true;
    const configured = calendarPushWebhookUrl();
    request.log.info(
      {
        configuredWebhook: configured
          ? redactCalendarPushWebhookUrl(configured)
          : null,
      },
      `${logLabel} listening (calendar HTTPS + gmail pubsub multiplex)`,
    );
  }

  const result = await handleGooglePushMultiplex({
    body: request.body,
    headers: request.headers,
    query: request.query as { token?: string } | undefined,
  });

  request.log.info(
    {
      kind: result.kind,
      ok: result.ok,
      detail: result.detail,
      path: request.url.split("?")[0],
    },
    `${logLabel} handled`,
  );

  if (result.detail === "unauthorized") {
    return sendError(reply, "Unauthorized", 401);
  }

  return sendSuccess(reply, {
    ok: result.ok,
    kind: result.kind,
    detail: result.detail,
    ...(result.imported !== undefined ? { imported: result.imported } : {}),
  });
}
