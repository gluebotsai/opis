import { env } from "../config/env.js";
import { fallbackNarrative } from "./insightsNarrative.js";
export async function fetchInsightsNarrative(snapshot, tenant) {
    const url = env.AI_CHAT_INSIGHTS_URL;
    if (!url || !env.INSIGHTS_INTERNAL_KEY) {
        return fallbackNarrative(snapshot);
    }
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Insights-Key": env.INSIGHTS_INTERNAL_KEY,
            },
            body: JSON.stringify({
                website_id: snapshot.website_id,
                period: snapshot.period,
                snapshot,
                organization_id: tenant?.organizationId ?? undefined,
                user_id: tenant?.userId ?? undefined,
            }),
            signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
            console.error("Insights LLM failed:", res.status, await res.text());
            return fallbackNarrative(snapshot);
        }
        const data = (await res.json());
        if (!data?.diagnostic || !data?.prescriptive) {
            return fallbackNarrative(snapshot);
        }
        return data;
    }
    catch (err) {
        console.error("Insights LLM request error:", err);
        return fallbackNarrative(snapshot);
    }
}
