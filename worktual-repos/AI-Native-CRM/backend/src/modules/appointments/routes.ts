import type { FastifyPluginAsync } from "fastify";
import {
  cancelAppointmentBooking,
  checkAppointmentAvailability,
  createAppointmentBooking,
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  findLiveAppointmentForContactApi,
  rescheduleAppointmentBooking,
} from "@/service/appointments/appointment-service";
import { requireAppointmentAuth } from "@/service/appointments/appointment-auth";
import { withUser } from "../../middlewares/auth.js";
import { sendError, sendSuccess, errorBody } from "../../helpers/response.js";

function parseInstant(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function appointmentDto(appointment: {
  id: string;
  organizationId: string;
  contactId: string;
  hostUserId: string;
  activityId: string | null;
  source: string;
  status: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  provider: string;
  joinUrl: string | null;
  calendarEventId: string | null;
  guestEmails: string[];
  assignmentReason: string | null;
  canceledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return { appointment };
}

export const appointmentsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const auth = await requireAppointmentAuth(request, reply);
    if (!auth) {
      return reply;
    }
  });

  app.get<{
    Querystring: {
      contactId?: string;
      startsAt?: string;
      timezone?: string;
      durationMinutes?: string;
    };
  }>("/availability", async (request, reply) => {
    const auth = request.appointmentAuth!;
    const contactId = request.query.contactId?.trim();
    const startsAt = parseInstant(request.query.startsAt);
    const timezone = request.query.timezone?.trim();
    const durationRaw = Number(request.query.durationMinutes);
    const durationMinutes =
      Number.isFinite(durationRaw) && durationRaw > 0
        ? durationRaw
        : DEFAULT_APPOINTMENT_DURATION_MINUTES;

    if (!contactId || !startsAt || !timezone) {
      return sendError(
        reply,
        "contactId, startsAt, and timezone are required.",
        400,
      );
    }

    return withUser(
      auth.actorUserId,
      async () => {
        const result = await checkAppointmentAvailability({
          organizationId: auth.organizationId,
          contactId,
          startsAt,
          timezone,
          durationMinutes,
        });
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.get<{ Params: { contactId: string } }>(
    "/by-contact/:contactId",
    async (request, reply) => {
      const auth = request.appointmentAuth!;
      const contactId = request.params.contactId.trim();
      if (!contactId) {
        return sendError(reply, "contactId required.", 400);
      }

      return withUser(
        auth.actorUserId,
        async () => {
          const appointment = await findLiveAppointmentForContactApi(
            auth.organizationId,
            contactId,
          );
          if (!appointment) {
            return sendError(reply, "No live appointment.", 404);
          }
          return sendSuccess(reply, appointmentDto(appointment));
        },
        request,
      );
    },
  );

  app.post<{
    Body: {
      contactId?: string;
      title?: string;
      startsAt?: string;
      timezone?: string;
      durationMinutes?: number;
      guestEmails?: string[];
    };
  }>("/", async (request, reply) => {
    const auth = request.appointmentAuth!;
    const contactId = request.body.contactId?.trim();
    const title = request.body.title?.trim();
    const startsAt = parseInstant(request.body.startsAt);
    const timezone = request.body.timezone?.trim();
    const durationMinutes = request.body.durationMinutes;

    if (!contactId || !title || !startsAt || !timezone) {
      return sendError(
        reply,
        "contactId, title, startsAt, and timezone are required.",
        400,
      );
    }

    return withUser(
      auth.actorUserId,
      async () => {
        const result = await createAppointmentBooking({
          organizationId: auth.organizationId,
          contactId,
          title,
          startsAt,
          timezone,
          durationMinutes,
          guestEmails: request.body.guestEmails,
          source: auth.via === "internal" ? "ccaas_webchat" : "ccaas_webchat",
          createdByUserId: auth.actorUserId,
        });

        if (!result.ok) {
          const status =
            result.code === "appointment_exists" ||
            result.code === "no_slots_available"
              ? 409
              : result.code === "contact_not_found"
                ? 404
                : 400;
          return reply.code(status).send({
            ...errorBody(result.error, status),
            code: result.code,
            ...(result.needsConnect ? { needsConnect: true } : {}),
          });
        }

        return reply
          .code(201)
          .send({
            statusCode: 201,
            message: "Appointment created.",
            appointment: result.appointment,
            activityId: result.activityId,
          });
      },
      request,
    );
  });

  app.patch<{
    Params: { id: string };
    Body: {
      startsAt?: string;
      timezone?: string;
      title?: string;
      durationMinutes?: number;
    };
  }>("/:id", async (request, reply) => {
    const auth = request.appointmentAuth!;
    const startsAt = parseInstant(request.body.startsAt);
    const timezone = request.body.timezone?.trim();
    const title = request.body.title?.trim();

    if (!startsAt || !timezone) {
      return sendError(reply, "startsAt and timezone are required.", 400);
    }

    return withUser(
      auth.actorUserId,
      async () => {
        const result = await rescheduleAppointmentBooking({
          organizationId: auth.organizationId,
          appointmentId: request.params.id.trim(),
          startsAt,
          timezone,
          title: title || undefined,
          durationMinutes: request.body.durationMinutes,
          forceRescheduleSideEffects: true,
        });

        if (!result.ok) {
          const status = result.code === "not_found" ? 404 : 400;
          return reply.code(status).send({
            ...errorBody(result.error, status),
            code: result.code,
            ...(result.needsConnect ? { needsConnect: true } : {}),
          });
        }

        return sendSuccess(reply, {
          appointment: result.appointment,
          activityId: result.activityId,
        });
      },
      request,
    );
  });

  app.post<{ Params: { id: string } }>(
    "/:id/cancel",
    async (request, reply) => {
      const auth = request.appointmentAuth!;

      return withUser(
        auth.actorUserId,
        async () => {
          const result = await cancelAppointmentBooking({
            organizationId: auth.organizationId,
            appointmentId: request.params.id.trim(),
          });

          if (!result.ok) {
            const status = result.code === "not_found" ? 404 : 400;
            return sendError(reply, result.error, status, {
              code: result.code,
              needsConnect: result.needsConnect,
            });
          }

          return sendSuccess(reply, appointmentDto(result.appointment));
        },
        request,
      );
    },
  );
};
