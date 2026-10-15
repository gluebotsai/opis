import type { FastifyPluginAsync } from "fastify";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendResult, sendError } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";
import {
  listProcessConfirmationsForOwner,
  getProcessConfirmation,
} from "@/service/ai/process-confirmations";
import { decideProcessConfirmation } from "@/service/ai/post-meeting-process";

export const processConfirmationsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { status?: string; limit?: string };
  }>("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const statusRaw = request.query.status?.trim() || "pending";
        const status =
          statusRaw === "all" ||
          statusRaw === "pending" ||
          statusRaw === "approved" ||
          statusRaw === "rejected" ||
          statusRaw === "expired"
            ? statusRaw
            : "pending";
        const limit = Number(request.query.limit || 40);
        const items = await listProcessConfirmationsForOwner({
          ownerUserId: userId,
          status,
          limit: Number.isFinite(limit) ? limit : 40,
        });
        return sendSuccess(reply, {
          items: items.map((row) => ({
            id: row.id,
            contactId: row.contactId,
            dealId: row.dealId,
            activityId: row.activityId,
            actionKind: row.actionKind,
            title: row.title,
            summary: row.summary,
            payload: row.payload,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
            decidedAt: row.decidedAt?.toISOString() ?? null,
            resultNote: row.resultNote,
          })),
        });
      },
      request,
    );
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const row = await getProcessConfirmation(request.params.id);
        if (!row || row.ownerUserId !== userId) {
          return sendError(reply, RESPONSE.not_found, 404);
        }
        return sendSuccess(reply, {
          item: {
            id: row.id,
            contactId: row.contactId,
            dealId: row.dealId,
            activityId: row.activityId,
            actionKind: row.actionKind,
            title: row.title,
            summary: row.summary,
            payload: row.payload,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
            decidedAt: row.decidedAt?.toISOString() ?? null,
            resultNote: row.resultNote,
          },
        });
      },
      request,
    );
  });

  app.post<{
    Params: { id: string };
    Body: {
      decision?: string;
      selectedSlotIso?: string | null;
      note?: string | null;
    };
  }>("/:id/decide", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const decision =
          request.body?.decision === "rejected" ? "rejected" : "approved";
        const result = await decideProcessConfirmation({
          confirmationId: request.params.id,
          userId,
          decision,
          selectedSlotIso: request.body?.selectedSlotIso ?? null,
          note: request.body?.note ?? null,
        });
        if (!result.ok) {
          return sendResult(reply, result, result.status ?? 400);
        }
        return sendSuccess(reply, { ok: true });
      },
      request,
    );
  });
};
