import { entityIdSchema } from "@ai-contact-center/event-contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { MetaWhatsAppError } from "../providers/meta-whatsapp.js";
import { AccountsApiError } from "../services/accounts-client.js";
import { mapServiceError } from "./route-errors.js";

function fakeReply() {
  let statusCode = 0;
  let body: unknown;
  return {
    statusCode: () => statusCode,
    body: () => body,
    status(code: number) {
      statusCode = code;
      return {
        send(payload: unknown) {
          body = payload;
          return payload;
        },
      };
    },
  };
}

test("mapServiceError maps Zod errors to 400", () => {
  const reply = fakeReply();
  const parsed = z.object({ channelConfigId: entityIdSchema }).safeParse({});
  assert.equal(parsed.success, false);
  mapServiceError(reply, parsed.error);
  assert.equal(reply.statusCode(), 400);
  assert.equal((reply.body() as { error: { code: string } }).error.code, "invalid_request");
});

test("mapServiceError maps Meta errors to 502", () => {
  const reply = fakeReply();
  mapServiceError(
    reply,
    new MetaWhatsAppError("(#132001) Template name does not exist in the translation", 400, 132001, {
      error: { message: "(#132001) Template name does not exist in the translation", code: 132001 },
    }),
  );
  assert.equal(reply.statusCode(), 502);
  const body = reply.body() as {
    error: { code: string; providerCode: number | null; message: string };
  };
  assert.equal(body.error.code, "meta_provider_error");
  assert.equal(body.error.providerCode, 132001);
  assert.match(body.error.message, /132001/);
});

test("mapServiceError maps AccountsApiError status", () => {
  const reply = fakeReply();
  mapServiceError(
    reply,
    new AccountsApiError("configuration_not_found", "missing channel", 404, false),
  );
  assert.equal(reply.statusCode(), 404);
  assert.equal(
    (reply.body() as { error: { code: string } }).error.code,
    "configuration_not_found",
  );
});

test("mapServiceError maps Prisma timeout-style errors to 503", () => {
  const reply = fakeReply();
  const err = Object.assign(new Error("Error in PostgreSQL connection: Operation timed out"), {
    name: "PrismaClientUnknownRequestError",
    cause: { code: 60, message: "Operation timed out" },
  });
  mapServiceError(reply, err);
  assert.equal(reply.statusCode(), 503);
  assert.equal(
    (reply.body() as { error: { code: string; retryable: boolean } }).error.code,
    "database_unavailable",
  );
  assert.equal(
    (reply.body() as { error: { retryable: boolean } }).error.retryable,
    true,
  );
});
