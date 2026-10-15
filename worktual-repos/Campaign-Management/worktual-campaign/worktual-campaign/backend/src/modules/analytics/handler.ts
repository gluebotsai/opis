import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { askCampaignAnalyticsDao } from "../../dao/analytics-ask.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { requireSession } from "../../middlewares/authendication.js";

const metricEnum = z.enum([
  "status_counts",
  "monitoring_tab_counts",
  "status_pie",
  "campaigns_ran",
  "sent",
  "failed",
  "opens",
  "clicks",
  "open_rate",
  "click_rate",
  "delivery_rate",
  "portfolio",
]);

const askBodySchema = z.object({
  query: z.string().min(1),
  metrics: z.array(metricEnum).min(1).optional(),
  period: z
    .object({
      relative: z
        .enum([
          "today",
          "yesterday",
          "last_7_days",
          "last_30_days",
          "last_month",
        ])
        .nullable()
        .optional(),
      fromDate: z.string().nullable().optional(),
      toDate: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function analyticsAskHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = askBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "Bad request");
  }
  const result = await askCampaignAnalyticsDao(session, {
    query: parsed.data.query,
    period: parsed.data.period ?? null,
    metrics: parsed.data.metrics ?? null,
  });
  const plan =
    result.plan && typeof result.plan === "object" ? result.plan : {};
  return sendSuccess(reply, "Campaign analytics", {
    ok: result.ok,
    query: result.query,
    plan: result.plan,
    results: result.results,
    usable: result.results,
    source: result.source,
    error: result.error ?? null,
    scope_applied: (plan as { scope_applied?: string }).scope_applied ?? null,
    scope_label: (plan as { scope_label?: string }).scope_label ?? null,
  });
}
