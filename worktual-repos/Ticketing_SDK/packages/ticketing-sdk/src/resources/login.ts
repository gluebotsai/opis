import type { HttpClient } from "../http.js";
import { TicketingApiError } from "../http.js";

export type StaffLoginResult = {
  sessionToken: string;
  user: Record<string, unknown>;
};

export type PortalOtpRequest = {
  ok: true;
  channel?: string;
  masked?: string;
};

export type PortalLoginResult = {
  sessionToken: string;
  customer: Record<string, unknown>;
};

function tokenFrom(payload: unknown, label: string): { token: string; rest: Record<string, unknown> } {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const token = String(row.token || row.sessionToken || "").trim();
  if (!token) throw new TicketingApiError(`${label} did not return a token`, 502, payload);
  return { token, rest: row };
}

export function createLoginResource(http: HttpClient) {
  return {
    /** Staff email and password. The browser receives the session token, not the org API key. */
    async login(input: { email: string; password: string; force?: boolean }): Promise<StaffLoginResult> {
      const payload = await http.request<unknown>({
        method: "POST",
        path: "/api/auth/login",
        auth: "none",
        body: {
          email: input.email,
          password: input.password,
          ...(input.force ? { force: true } : {}),
        },
      });
      const { token, rest } = tokenFrom(payload, "Staff login");
      const user = rest.user && typeof rest.user === "object" ? (rest.user as Record<string, unknown>) : {};
      return { sessionToken: token, user };
    },

    portal: {
      requestOtp(input: { slug: string; identifier: string }): Promise<PortalOtpRequest> {
        return http.request({
          method: "POST",
          path: `/api/public/support/${encodeURIComponent(input.slug)}/otp/request`,
          auth: "none",
          body: { identifier: input.identifier },
        });
      },

      async verifyOtp(input: { slug: string; identifier: string; code: string }): Promise<PortalLoginResult> {
        const payload = await http.request<unknown>({
          method: "POST",
          path: `/api/public/support/${encodeURIComponent(input.slug)}/otp/verify`,
          auth: "none",
          body: { identifier: input.identifier, code: input.code },
        });
        const { token, rest } = tokenFrom(payload, "Portal verification");
        const customer =
          rest.customer && typeof rest.customer === "object" ? (rest.customer as Record<string, unknown>) : {};
        return { sessionToken: token, customer };
      },

      async login(input: { slug: string; email: string; password: string }): Promise<PortalLoginResult> {
        const payload = await http.request<unknown>({
          method: "POST",
          path: `/api/public/support/${encodeURIComponent(input.slug)}/login`,
          auth: "none",
          body: { email: input.email, password: input.password },
        });
        const { token, rest } = tokenFrom(payload, "Portal login");
        const customer =
          rest.customer && typeof rest.customer === "object" ? (rest.customer as Record<string, unknown>) : {};
        return { sessionToken: token, customer };
      },
    },
  };
}
