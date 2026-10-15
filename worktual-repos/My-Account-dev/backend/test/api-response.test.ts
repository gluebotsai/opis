import { describe, expect, it } from "vitest";

import {
  RESPONSE,
  errorResponse,
  isApiEnvelope,
  successResponse,
  toApiEnvelope,
} from "../src/helpers/api-response.js";

describe("api response envelope", () => {
  it("flattens success payloads into the root", () => {
    expect(toApiEnvelope(200, { lead: { id: "1" } })).toEqual({
      statusCode: 200,
      message: RESPONSE.success,
      lead: { id: "1" },
    });
  });

  it("maps legacy error bodies to message + flat details", () => {
    expect(
      toApiEnvelope(400, { error: "GST Number is required.", code: "TAX" }),
    ).toEqual({
      statusCode: 400,
      message: "GST Number is required.",
      code: "TAX",
    });
  });

  it("leaves an existing flat envelope untouched", () => {
    const envelope = successResponse({ ok: true }, RESPONSE.created, 201);
    expect(isApiEnvelope(envelope)).toBe(true);
    expect(toApiEnvelope(200, envelope)).toEqual(envelope);
  });

  it("normalizes legacy metaResponse envelopes to flat", () => {
    expect(
      toApiEnvelope(200, {
        statusCode: 200,
        message: "Success",
        metaResponse: { users: [{ id: "1" }] },
      }),
    ).toEqual({
      statusCode: 200,
      message: "Success",
      users: [{ id: "1" }],
    });
  });

  it("builds explicit error envelopes", () => {
    expect(errorResponse(RESPONSE.unauthorized, 401)).toEqual({
      statusCode: 401,
      message: RESPONSE.unauthorized,
    });
  });

  it("remaps object-valued payload message to mailMessage", () => {
    const email = { id: "abc", subject: "Hello" };
    expect(toApiEnvelope(200, { message: email, mailbox: "admin" })).toEqual({
      statusCode: 200,
      message: RESPONSE.success,
      mailMessage: email,
      mailbox: "admin",
    });
  });

  it("does not remap string message keys into mailMessage", () => {
    expect(toApiEnvelope(200, { message: "ignored string", ok: true })).toEqual({
      statusCode: 200,
      message: RESPONSE.success,
      ok: true,
    });
  });
});
