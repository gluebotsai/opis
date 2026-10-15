/**
 * CRM Personalised CRM template prepare — structured payload, no request_text.
 */

import type {
  OnDemandPreparedTemplate,
  OnDemandPrepareResult,
} from "./on-demand-prepare.js";

export type { OnDemandPreparedTemplate };

function agentsPrepareBaseUrl(): string {
  const prepare =
    process.env.AGENTS_PREPARE_URL?.trim() ||
    process.env.A2A_INTERNAL_URL?.trim() ||
    "";
  if (prepare) return prepare.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    return "http://a2a:8040";
  }
  return "http://127.0.0.1:8040";
}

export async function preparePersonalisedCrmViaAgents(input: {
  name?: string | null;
  brief?: string | null;
  goal?: string | null;
  objective?: string | null;
  channels: string[];
  emails?: string[];
  phones?: string[];
  contact_ids?: string[];
  customer_ids?: string[];
  organization_id?: string;
}): Promise<OnDemandPrepareResult> {
  const url = `${agentsPrepareBaseUrl()}/personalised-crm/prepare`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: input.name ?? undefined,
        brief: input.brief ?? undefined,
        goal: input.goal ?? undefined,
        objective: input.objective ?? undefined,
        channels: input.channels,
        emails: input.emails,
        phones: input.phones,
        contact_ids: input.contact_ids,
        customer_ids: input.customer_ids,
        organization_id: input.organization_id,
      }),
      signal: controller.signal,
    });
    const data = (await res.json()) as OnDemandPrepareResult & {
      statusCode?: number;
      message?: string;
    };
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        error:
          data.error ||
          data.message ||
          `Agents prepare failed (${res.status})`,
        error_code: data.error_code,
        aborted: data.aborted,
        templates: data.templates,
        channels: data.channels,
        campaign: data.campaign,
      };
    }
    return data;
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : "Could not reach agents for Personalised CRM prepare";
    return {
      ok: false,
      error:
        `Could not reach Personalised CRM prepare at ${url} (${detail}). ` +
        "Ensure A2A is up on :8040 (GET /health).",
    };
  } finally {
    clearTimeout(timer);
  }
}
