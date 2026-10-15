import type { HttpClient } from "../http.js";
import { resolveLocale } from "../locale.js";
import type { CreateSessionInput, SdkSession } from "../types.js";

export function createSessionsResource(http: HttpClient) {
  return {
    /**
     * Mint a short-lived staff session for an existing Ticketing user.
     * Records a login. Requires `partnerApiKey` or `apiKey` on the server.
     */
    createSession(input: CreateSessionInput): Promise<SdkSession> {
      const locale = resolveLocale(input.locale, http.config.locale);
      return http.request<SdkSession>({
        method: "POST",
        path: "/api/sdk/sessions",
        auth: "partnerKey",
        body: {
          tenantId: input.tenantId,
          actor: input.actor,
          locale,
        },
      });
    },

    /** Revoke the partner session. */
    endSession(sessionToken?: string): Promise<{ ok: true }> {
      return http.request({
        method: "POST",
        path: "/api/sdk/sessions/end",
        auth: "accessToken",
        accessToken: sessionToken,
      });
    },

    /** Issue a new JWT for the same session id. */
    refreshSession(sessionToken?: string): Promise<SdkSession> {
      return http.request({
        method: "POST",
        path: "/api/sdk/sessions/refresh",
        auth: "accessToken",
        accessToken: sessionToken,
      });
    },
  };
}

export type SessionsResource = ReturnType<typeof createSessionsResource>;
