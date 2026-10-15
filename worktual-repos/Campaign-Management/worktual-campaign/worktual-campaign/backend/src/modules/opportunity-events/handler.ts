import type { FastifyReply, FastifyRequest } from "fastify";
import {
  deleteOpportunityEventDao,
  getAgentEventsSnapshotDao,
  listOpportunityEventsDao,
  putOpportunityEventsDao,
} from "../../dao/opportunity-events.js";
import { RESPONSE } from "../../helpers/constants.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { requireSession } from "../../middlewares/authendication.js";

export async function listOpportunityEventsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const items = await listOpportunityEventsDao(session);
  return sendSuccess(reply, RESPONSE.opportunityEventsSuccess, { items });
}

export async function agentEventsSnapshotHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const snapshot = await getAgentEventsSnapshotDao(session);
  return sendSuccess(reply, RESPONSE.opportunityEventsSuccess, snapshot);
}

export async function putOpportunityEventsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = (request.body || {}) as { events?: unknown };
  if (body.events != null && !Array.isArray(body.events)) {
    throw new AppError("events must be an array", 400);
  }
  const items = await putOpportunityEventsDao(session, {
    events: Array.isArray(body.events) ? body.events : [],
  });
  return sendSuccess(reply, RESPONSE.opportunityEventsSaved, { items });
}

export async function deleteOpportunityEventHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const publicId = String(
    (request.params as { publicId?: string }).publicId || "",
  ).trim();
  if (!publicId) throw new AppError("Event id is required", 400);
  const ok = await deleteOpportunityEventDao(session, publicId);
  if (!ok) throw new AppError("Event not found", 404);
  return sendSuccess(reply, RESPONSE.opportunityEventDeleted, { ok: true });
}
