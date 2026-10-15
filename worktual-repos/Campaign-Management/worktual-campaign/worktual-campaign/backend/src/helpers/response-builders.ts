import type { FastifyReply } from "fastify";

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code = "BAD_REQUEST",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in again.") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export type ApiSuccessBody<T extends Record<string, unknown> = Record<string, never>> = {
  statusCode: number;
  message: string;
} & T;

export type ApiErrorBody = {
  statusCode: number;
  message: string;
};

/**
 * Legacy Channel-style success:
 * res.status(200).send({ statusCode: 200, message: RESPONSE.xxx, ...data })
 */
export function sendSuccess<T extends Record<string, unknown>>(
  reply: FastifyReply,
  message: string,
  data?: T,
  statusCode = 200,
) {
  return reply.status(statusCode).send({
    statusCode,
    message,
    ...(data ?? {}),
  } as ApiSuccessBody<T>);
}

/**
 * Legacy Channel-style error body (HTTP status matches statusCode).
 */
export function sendError(
  reply: FastifyReply,
  message: string,
  statusCode = 400,
) {
  return reply.status(statusCode).send({
    statusCode,
    message,
  } satisfies ApiErrorBody);
}

export function missingAuthenticationToken(message: string): ApiErrorBody {
  return {
    message,
    statusCode: 401,
  };
}

export function invalidCredentials(message: string): ApiErrorBody {
  return {
    message,
    statusCode: 403,
  };
}
