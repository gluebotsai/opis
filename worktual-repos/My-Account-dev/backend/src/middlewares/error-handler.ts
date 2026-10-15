import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../helpers/errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Route not found" },
      requestId: request.id,
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.flatten(),
        },
        requestId: request.id,
      });
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        requestId: request.id,
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    const httpError =
      typeof error === "object" && error !== null
        ? (error as { message?: unknown; statusCode?: unknown })
        : {};
    const statusCode =
      typeof httpError.statusCode === "number" && httpError.statusCode >= 400
        ? httpError.statusCode
        : 500;
    return reply.status(statusCode).send({
      error: {
        code: statusCode < 500 ? "REQUEST_ERROR" : "INTERNAL_ERROR",
        message:
          statusCode < 500 && typeof httpError.message === "string"
            ? httpError.message
            : "An unexpected error occurred",
      },
      requestId: request.id,
    });
  });
}
