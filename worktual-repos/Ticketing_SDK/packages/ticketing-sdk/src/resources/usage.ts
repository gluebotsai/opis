import type { HttpClient } from "../http.js";
import type { UsageEventList, UsageLogin, UsageRange, UsageSummary } from "../types.js";

export function createUsageResource(http: HttpClient) {
  return {
    /** Counts for the partner org. Requires the org API key, not a user session. */
    summary(range: UsageRange = {}): Promise<UsageSummary> {
      return http.request({
        method: "GET",
        path: "/api/sdk/usage/summary",
        auth: "partnerKey",
        query: {
          from: range.from,
          to: range.to,
          tenantId: range.tenantId,
        },
      });
    },

    logins(range: UsageRange = {}): Promise<{ organizationId: string; logins: UsageLogin[] }> {
      return http.request({
        method: "GET",
        path: "/api/sdk/usage/logins",
        auth: "partnerKey",
        query: {
          from: range.from,
          to: range.to,
          tenantId: range.tenantId,
        },
      });
    },

    events(range: UsageRange = {}): Promise<UsageEventList> {
      return http.request({
        method: "GET",
        path: "/api/sdk/usage/events",
        auth: "partnerKey",
        query: {
          from: range.from,
          to: range.to,
          tenantId: range.tenantId,
          limit: range.limit,
        },
      });
    },
  };
}

export type UsageResource = ReturnType<typeof createUsageResource>;
