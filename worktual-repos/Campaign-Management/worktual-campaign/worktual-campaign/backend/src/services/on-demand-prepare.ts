/**
 * Call campaign agents HTTP to analyse on-demand request + generate templates.
 */

export type OnDemandPreparedTemplate = {
  channel: string;
  fields: Record<string, unknown>;
  how_it_works?: string;
  fallback?: boolean;
};

export type OnDemandPrepareResult = {
  ok: boolean;
  analysis?: {
    emails?: string[];
    phones?: string[];
    customer_ids?: string[];
    channels?: string[];
    campaign_name?: string;
    goal?: string;
    objective?: string;
    insight?: string;
    audience_summary?: string;
    thoughts?: string[];
    analysis_source?: string;
  };
  campaign?: {
    name?: string;
    goal?: string;
    objective?: string;
  };
  channels?: string[];
  templates?: OnDemandPreparedTemplate[];
  error?: string;
  error_code?: string;
  aborted?: boolean;
};

/** Hub on-demand template prepare — A2A spoke :8040 (does not require :8005 chat). */
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

export async function prepareOnDemandViaAgents(input: {
  request_text: string;
  channels?: string[];
  name?: string | null;
  goal?: string | null;
  objective?: string | null;
  emails?: string[];
  phones?: string[];
  contact_ids?: string[];
  customer_ids?: string[];
  organization_id?: string;
}): Promise<OnDemandPrepareResult> {
  const url = `${agentsPrepareBaseUrl()}/on-demand/prepare`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        request_text: input.request_text,
        channels: input.channels,
        name: input.name ?? undefined,
        goal: input.goal ?? undefined,
        objective: input.objective ?? undefined,
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
        analysis: data.analysis,
        templates: data.templates,
      };
    }
    return data;
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : "Could not reach agents for on-demand prepare";
    return {
      ok: false,
      error:
        `Could not reach on-demand prepare at ${url} (${detail}). ` +
        "Ensure A2A is up on :8040 (GET /health). Local: AGENTS_PREPARE_URL=http://127.0.0.1:8040 in backend/.env.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Local polish if agents are down — never send the raw operator instruction. */
export function localFallbackTemplates(input: {
  request_text: string;
  channels: string[];
  insight?: string;
}): OnDemandPreparedTemplate[] {
  let insight = (input.insight || input.request_text || "").trim();
  insight = insight
    .replace(/^(create\s+a\s+campaign\s+and\s+send\s+for\s+\S+\s*)/i, "")
    .replace(/^(email\s+\S+\s*)/i, "")
    .replace(/^because\s+/i, "")
    .trim();
  if (insight.length < 8) {
    insight = "your recent interest in our product";
  }
  return input.channels.map((channel) => {
    if (channel === "email") {
      return {
        channel,
        how_it_works: "On-demand email (local fallback)",
        fallback: true,
        fields: {
          subject: "Still exploring? Here’s a quick next step",
          greeting: "Hi {{first_name}},",
          paragraphs: [
            `We noticed ${insight}.`,
            "If you’d like help getting more value, we’re here with a short walkthrough or answers to any questions.",
          ],
          signoff: "Thanks,\nThe team",
          footer: "",
        },
      };
    }
    if (channel === "push" || channel === "web") {
      return {
        channel,
        how_it_works: `On-demand ${channel} (local fallback)`,
        fallback: true,
        fields: {
          title: "A quick follow-up for you",
          body: `Based on ${insight.slice(0, 80)}, here’s a helpful next step.`,
          cta_label: "Open",
        },
      };
    }
    return {
      channel: "whatsapp",
      how_it_works: "On-demand whatsapp (local fallback)",
      fallback: true,
      fields: {
        name: "on_demand_followup",
        language: "en",
        category: "MARKETING",
        header: "",
        body: `Hi {{first_name}}, we noticed ${insight.slice(0, 120)}. Want a quick tip to continue?`,
        footer: "",
        buttons: [],
      },
    };
  });
}
