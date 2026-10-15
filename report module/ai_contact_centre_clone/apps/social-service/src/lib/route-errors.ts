import { z } from "zod";

import { MetaWhatsAppError } from "../providers/meta-whatsapp.js";
import { AccountsApiError } from "../services/accounts-client.js";

function isDatabaseConnectivityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    name?: string;
    code?: string;
    message?: string;
    cause?: { code?: string | number; message?: string };
  };
  const name = err.name ?? "";
  const code = String(err.code ?? err.cause?.code ?? "");
  const message = `${err.message ?? ""} ${err.cause?.message ?? ""}`.toLowerCase();

  if (
    name === "PrismaClientInitializationError" ||
    name === "PrismaClientRustPanicError" ||
    name === "PrismaClientKnownRequestError" ||
    name === "PrismaClientUnknownRequestError"
  ) {
    return (
      code === "P1001" ||
      code === "P1002" ||
      code === "P1008" ||
      code === "P1017" ||
      message.includes("timed out") ||
      message.includes("can't reach database") ||
      message.includes("connection") ||
      message.includes("econnrefused") ||
      message.includes("econnreset")
    );
  }

  return (
    message.includes("operation timed out") ||
    message.includes("postgresql connection") ||
    code === "60" // macOS ETIMEDOUT
  );
}

export function mapServiceError(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: {
        code: "invalid_request",
        message: error.issues[0]?.message ?? "Invalid request",
        retryable: false,
      },
    });
  }
  if (error instanceof AccountsApiError) {
    return reply.status(error.status).send({
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    });
  }
  if (error instanceof MetaWhatsAppError) {
    const details =
      error.details && typeof error.details === "object"
        ? (error.details as { error?: Record<string, unknown> }).error ?? error.details
        : undefined;
    return reply.status(502).send({
      error: {
        code: "meta_provider_error",
        message: error.message,
        retryable: error.status >= 500 || error.status === 429,
        providerCode: error.providerCode ?? null,
        providerStatus: error.status,
        details: details ?? null,
      },
    });
  }
  if (isDatabaseConnectivityError(error)) {
    return reply.status(503).send({
      error: {
        code: "database_unavailable",
        message: "Database temporarily unavailable while loading channel credentials",
        retryable: true,
      },
    });
  }
  throw error;
}
