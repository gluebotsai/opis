import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError, sendError } from "../helpers/response-builders.js";
import { RESPONSE } from "../helpers/constants.js";

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AppError) {
    return sendError(reply, error.message, error.statusCode);
  }

  const statusCode =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;

  if (statusCode >= 500) {
    console.error("[api-error]", error);
  }

  return sendError(
    reply,
    statusCode >= 500
      ? RESPONSE.internal_error
      : error.message || RESPONSE.bad_request,
    statusCode >= 500 ? 500 : statusCode,
  );
}
