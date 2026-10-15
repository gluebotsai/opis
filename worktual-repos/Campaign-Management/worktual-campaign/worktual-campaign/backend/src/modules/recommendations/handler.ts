import type { FastifyReply, FastifyRequest } from "fastify";
import {
  listRecommendationsDao,
  putRecommendationsDao,
} from "../../dao/recommendations.js";
import { RESPONSE } from "../../helpers/constants.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { requireSession } from "../../middlewares/authendication.js";

export async function listRecommendationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const items = await listRecommendationsDao(session);
  return sendSuccess(reply, RESPONSE.recommendationsSuccess, { items });
}

export async function putRecommendationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = (request.body || {}) as {
    cards?: unknown;
    replaceActive?: boolean;
  };
  if (body.cards != null && !Array.isArray(body.cards)) {
    throw new AppError("cards must be an array");
  }
  const items = await putRecommendationsDao(session, {
    cards: Array.isArray(body.cards) ? body.cards : [],
    replaceActive: body.replaceActive === true,
  });
  return sendSuccess(reply, RESPONSE.recommendationsSaved, { items });
}
