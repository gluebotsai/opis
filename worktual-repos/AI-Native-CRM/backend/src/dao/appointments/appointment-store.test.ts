import { describe, expect, it } from "vitest";
import { isAppointmentExistsError } from "@/dao/appointments/appointment-store";
import { isApiKeyScope, normalizeApiKeyScopes } from "@/lib/api-key-scopes";

describe("appointment-store helpers", () => {
  it("detects Prisma unique constraint violations", () => {
    expect(isAppointmentExistsError({ code: "P2002" })).toBe(true);
    expect(isAppointmentExistsError(new Error("other"))).toBe(false);
  });
});

describe("api-key-scopes appointments", () => {
  it("includes appointments scope", () => {
    expect(isApiKeyScope("appointments")).toBe(true);
    expect(normalizeApiKeyScopes(["appointments", "contacts"])).toEqual([
      "appointments",
      "contacts",
    ]);
  });
});
