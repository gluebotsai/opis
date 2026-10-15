import type { FastifyPluginAsync } from "fastify";
import {
  getCalendarIntegrationsCommand,
  listCalendarContactsCommand,
  listCalendarEventsCommand,
  scheduleCalendarMeetingCommand,
} from "@/service/calendar/calendar-commands";
import { createActivityCommand } from "@/service/contacts/contact-commands";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      timeMin?: string;
      timeMax?: string;
      ownerScope?: string;
    };
  }>("/events", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!request.query.timeMin || !request.query.timeMax) {
          return sendError(reply, "timeMin and timeMax are required.", 400);
        }
        const result = await listCalendarEventsCommand({
          timeMin: request.query.timeMin,
          timeMax: request.query.timeMax,
          ownerScope:
            request.query.ownerScope === "all" ? "all" : "mine",
        });
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.get("/integrations", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getCalendarIntegrationsCommand();
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
        const result = await listCalendarContactsCommand();
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      contactId?: string;
      when?: string;
      whenIso?: string;
      timeZone?: string;
      topic?: string;
      durationMinutes?: number;
      participants?: string;
      participantEmails?: string[];
      meetingProvider?: string;
    };
  }>("/meetings", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        if (!body.contactId || !body.when) {
          return sendError(reply, "contactId and when are required.", 400);
        }
        const result = await scheduleCalendarMeetingCommand({
          contactId: body.contactId,
          when: body.when,
          whenIso: body.whenIso,
          timeZone: body.timeZone,
          topic: body.topic,
          durationMinutes: body.durationMinutes,
          participants: body.participants,
          participantEmails: body.participantEmails,
          meetingProvider: body.meetingProvider as never,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      contactId?: string;
      type?: string;
      subject?: string;
      body?: string | null;
      dueAt?: string | null;
    };
  }>("/activities", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        if (!body.contactId || !body.type || !body.subject) {
          return sendError(reply, "contactId, type, and subject are required.", 400);
        }
        const result = await createActivityCommand(body.contactId, {
          type: body.type,
          subject: body.subject,
          body: body.body,
          dueAt: body.dueAt,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });
};
