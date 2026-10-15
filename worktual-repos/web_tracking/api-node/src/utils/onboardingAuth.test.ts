import { afterAll, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

function mockRequest(headers: Record<string, string>): FastifyRequest {
  return { headers } as FastifyRequest;
}

describe("verifyOnboardingServerSecret", () => {
  const prevInternal = process.env.INTERNAL_SERVICE_KEY;

  afterAll(() => {
    if (prevInternal === undefined) delete process.env.INTERNAL_SERVICE_KEY;
    else process.env.INTERNAL_SERVICE_KEY = prevInternal;
    vi.resetModules();
  });

  it("accepts x-internal-service-key", async () => {
    vi.resetModules();
    process.env.INTERNAL_SERVICE_KEY = "test-spoke-secret-key-32chars!!";
    const { verifyOnboardingServerSecret } = await import("./onboardingAuth.js");
    expect(
      verifyOnboardingServerSecret(
        mockRequest({ "x-internal-service-key": "test-spoke-secret-key-32chars!!" }),
      ),
    ).toBe(true);
  });

  it("rejects Authorization Bearer (Campaign-style only)", async () => {
    vi.resetModules();
    process.env.INTERNAL_SERVICE_KEY = "test-spoke-secret-key-32chars!!";
    const { verifyOnboardingServerSecret } = await import("./onboardingAuth.js");
    expect(
      verifyOnboardingServerSecret({
        headers: {
          authorization: "Bearer test-spoke-secret-key-32chars!!",
        },
      } as FastifyRequest),
    ).toBe(false);
  });

  it("rejects wrong x-internal-service-key", async () => {
    vi.resetModules();
    process.env.INTERNAL_SERVICE_KEY = "test-spoke-secret-key-32chars!!";
    const { verifyOnboardingServerSecret } = await import("./onboardingAuth.js");
    expect(
      verifyOnboardingServerSecret(mockRequest({ "x-internal-service-key": "wrong-key" })),
    ).toBe(false);
  });
});
