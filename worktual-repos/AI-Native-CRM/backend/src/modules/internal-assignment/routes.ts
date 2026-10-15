import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  isSalesRepRoleName,
  listAssignmentCandidates,
  loadLeadAssignmentContext,
  resolveRegionalSalesOwner,
} from "@/dao/sales/territory-assignment";
import type { BusinessType } from "@/config/modules";
import { recordAgentStep } from "@/dao/ai/agent-step-events";
import { sendError, sendSuccess } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";

function isInternalAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers["x-internal-secret"] === secret;
}

function orgFromRequest(request: FastifyRequest): string | null {
  const header = request.headers["x-organization-id"];
  return typeof header === "string" && header.trim() ? header.trim() : null;
}

export const internalAssignmentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  /**
   * Candidate pool for the Python assign-sales agent.
   * GET /api/internal/assignment/candidates
   */
  app.get<{
    Querystring: {
      businessType?: string;
      country?: string;
      city?: string;
      contactId?: string;
      companyId?: string;
      locationId?: string;
      estimatedAmount?: string;
    };
  }>("/candidates", async (request, reply) => {
    const organizationId = orgFromRequest(request);
    if (!organizationId) {
      return sendError(reply, "x-organization-id required", 400);
    }

    const { candidates, seniorAmountThreshold } = await listAssignmentCandidates({
      organizationId,
    });
    const salesReps = candidates.filter((row) => isSalesRepRoleName(row.role));
    const contactId = request.query.contactId?.trim() || null;
    const companyId = request.query.companyId?.trim() || null;
    const locationId = request.query.locationId?.trim() || null;
    const amountRaw = request.query.estimatedAmount
      ? Number(request.query.estimatedAmount)
      : null;
    const context = await loadLeadAssignmentContext({
      organizationId,
      contactId,
      companyId,
      locationId,
    });

    return sendSuccess(reply, {
      organizationId,
      businessType: request.query.businessType ?? null,
      country: request.query.country ?? null,
      city: request.query.city ?? null,
      contactId,
      companyId,
      locationId,
      estimatedAmount:
        amountRaw != null && Number.isFinite(amountRaw) ? amountRaw : null,
      seniorAmountThreshold,
      relationship: context.relationship,
      lead: context.lead,
      candidates: salesReps,
    });
  });

  /**
   * Optional CRM-side resolve (same algorithm as local fallback).
   * GET /api/internal/assignment/resolve
   */
  app.get<{
    Querystring: {
      businessType?: string;
      country?: string;
      city?: string;
      contactId?: string;
      companyId?: string;
      locationId?: string;
      estimatedAmount?: string;
    };
  }>("/resolve", async (request, reply) => {
    const organizationId = orgFromRequest(request);
    if (!organizationId) {
      return sendError(reply, "x-organization-id required", 400);
    }
    const bt = request.query.businessType?.trim().toLowerCase();
    const businessType =
      bt === "b2b" || bt === "b2c" || bt === "b2b2c"
        ? (bt as BusinessType)
        : null;
    const amountRaw = request.query.estimatedAmount
      ? Number(request.query.estimatedAmount)
      : null;

    const decision = await resolveRegionalSalesOwner({
      organizationId,
      businessType,
      country: request.query.country ?? null,
      city: request.query.city ?? null,
      contactId: request.query.contactId ?? null,
      companyId: request.query.companyId ?? null,
      locationId: request.query.locationId ?? null,
      estimatedAmount:
        amountRaw != null && Number.isFinite(amountRaw) ? amountRaw : null,
    });

    return sendSuccess(reply, {
      owner: decision.status === "assigned" ? decision.owner : null,
      reason: decision.status === "unassigned" ? decision.reason : decision.owner.reason,
    });
  });

  /**
   * Curated step trace for sales_assignment. No per-call URL entity —
   * a target may be company-only (no contactId) — so this is a flat route
   * keyed purely by the ephemeral `jobId` ai-service generates per run.
   */
  app.post<{
    Body: {
      step?: string;
      label?: string;
      status?: "started" | "ok" | "failed" | "skipped";
      detail?: unknown;
      errorReason?: string | null;
      contactId?: string | null;
      companyId?: string | null;
      jobId?: string;
    };
  }>("/steps", async (request, reply: FastifyReply) => {
    const organizationId = orgFromRequest(request);
    const step = String(request.body?.step || "").trim();
    const label = String(request.body?.label || "").trim();
    const status = request.body?.status;
    const jobId = String(request.body?.jobId || "").trim();
    if (!organizationId || !step || !label || !status || !jobId) {
      return sendError(
        reply,
        "step, label, status, jobId, organizationId required",
        400,
      );
    }

    const contactId = request.body?.contactId?.trim() || null;
    const companyId = request.body?.companyId?.trim() || null;
    const detail =
      !contactId && companyId
        ? { ...(request.body?.detail as Record<string, unknown> | null), companyId }
        : request.body?.detail;

    await recordAgentStep({
      organizationId,
      agent: "sales_assignment",
      jobId,
      contactId,
      step,
      label,
      status,
      detail,
      errorReason: request.body?.errorReason ?? null,
    });

    return sendSuccess(reply, { ok: true });
  });
};
