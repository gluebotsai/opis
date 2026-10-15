import { prisma } from "@/dao/db/prisma";
import { getContact, promoteContactToLeadIfEligible } from "@/dao/contacts/contact-service";
import {
  acronymMatchesEntityText,
  companyIdentityAllowsDomain,
  companyNameMatchesDomain,
  emailDomain,
  enrichmentFieldsBelongToCompany,
  isFreeMailDomain,
  isGenericLocationLabel,
  isShortCompanyAcronym,
  isSyntheticCompanyLogoUrl,
  logoUrlBelongsToCompany,
  type EnrichmentFieldKey,
  type LeadEnrichmentContext,
  type LeadEnrichmentPayload,
} from "@/service/ai/lead-enrichment-types";
import { persistLeadEnrichment } from "@/dao/ai/lead-enrichment-persist";
import {
  getDomainEnrichmentCache,
  upsertDomainEnrichmentCache,
  normalizeEnrichmentDomain,
} from "@/dao/ai/domain-enrichment-cache";
import { enrichLeadLocally } from "@/service/ai/lead-enrichment-local";
import { publishEnrichmentEvent } from "@/service/ai/lead-enrichment-events";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
import { recordLoadContextStep } from "@/dao/ai/agent-step-events";
import {
  claimEnrichmentJob,
  findEnrichmentJobById,
  findEnrichmentJobByOrgContact,
  listCdpCustomersMissingEnrichmentJob,
  listContactProfilesMissingEnrichmentJob,
  listDueEnrichmentJobs,
  listDueEnrichmentOrganizationIds,
  updateEnrichmentJob,
  upsertEnrichmentJob,
  type EnrichmentJobRow,
} from "@/dao/ai/lead-enrichment-store";
import {
  getContactProfileByAccountId,
  upsertContactProfile,
} from "@/dao/contacts/contact-profile-repository";
import { findLeadEnrichmentSnapshot } from "@/dao/ai/lead-enrichment-snapshot";
import type { LeadEnrichmentStatus } from "@prisma/client";
import { getCurrentOrganizationId, resolveRequestOrganizationId } from "@/service/auth/require-role";
import { AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { lookupLeadEnrichmentViaZoominfo } from "@/service/zoominfo/zoominfo-enrich";

const MAX_ATTEMPTS = 5;
/** Align with shared job agent budget (slow LLM + search). */
const AI_SERVICE_TIMEOUT_MS = AI_SERVICE_JOB_TIMEOUT_MS;
/** Must exceed AI_SERVICE_TIMEOUT_MS or the job marks skipped while Python is still persisting. */
const JOB_BUDGET_MS = AI_SERVICE_TIMEOUT_MS + 30_000;

function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export type EnrichmentIdentitySnapshot = {
  email: string | null;
  phone: string | null;
  companyName: string | null;
  companyId?: string | null;
};

function normalizeEnrichmentEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeEnrichmentPhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function normalizeEnrichmentCompany(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeEnrichmentCompanyId(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** True when email, phone, company name, or linked company id changed. */
export function enrichmentIdentityFieldsChanged(
  before: EnrichmentIdentitySnapshot,
  after: EnrichmentIdentitySnapshot,
): boolean {
  return (
    normalizeEnrichmentEmail(before.email) !==
      normalizeEnrichmentEmail(after.email) ||
    normalizeEnrichmentPhone(before.phone) !==
      normalizeEnrichmentPhone(after.phone) ||
    normalizeEnrichmentCompany(before.companyName) !==
      normalizeEnrichmentCompany(after.companyName) ||
    normalizeEnrichmentCompanyId(before.companyId) !==
      normalizeEnrichmentCompanyId(after.companyId)
  );
}

async function notifyEnrichmentPending(job: EnrichmentJobRow): Promise<void> {
  publishEnrichmentEvent({
    contactId: job.contactId,
    status: "pending",
    lastError: null,
    resultSummary: null,
  });
}

/** Re-queue enrichment after identity fields arrive or change (fire-and-forget). */
export async function reenqueueLeadEnrichmentOnIdentityUpdate(input: {
  contactId: string;
  organizationId?: string | null;
  companyId?: string | null;
}): Promise<void> {
  try {
    const contact = await getContact(input.contactId);
    if (!contact) return;

    const organizationId = await resolveRequestOrganizationId(
      input.organizationId ??
        contact.person.organizationId ??
        undefined,
    );
    const companyId =
      input.companyId ?? contact.person.companyId ?? null;

    const job = await upsertEnrichmentJob({
      organizationId,
      contactId: input.contactId,
      companyId,
      maxAttempts: MAX_ATTEMPTS,
    });
    await notifyEnrichmentPending(job);

    void processLeadEnrichmentJob(job.id).catch((err) => {
      console.error("lead enrichment immediate process failed", err);
    });
  } catch (err) {
    console.error("reenqueueLeadEnrichmentOnIdentityUpdate failed", err);
  }
}

function isSoftAbortError(message: string): boolean {
  return /enrichment_budget|timed?\s*out|aborted|AbortError|ECONNREFUSED|fetch failed/i.test(
    message,
  );
}

/** Cache only under a real company domain — never gmail.com / free mail. */
function enrichmentCacheDomain(input: {
  companyName: string | null;
  companyDomain: string | null;
  email: string | null;
  payloadDomain?: string | number | null;
}): string | null {
  const fromPayload =
    typeof input.payloadDomain === "string"
      ? normalizeEnrichmentDomain(input.payloadDomain)
      : null;
  const fromCompany = normalizeEnrichmentDomain(input.companyDomain);
  const fromEmail = normalizeEnrichmentDomain(emailDomain(input.email));
  for (const candidate of [fromPayload, fromCompany, fromEmail]) {
    if (
      candidate &&
      !isFreeMailDomain(candidate) &&
      companyNameMatchesDomain(input.companyName, candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export async function buildLeadEnrichmentContext(
  contactId: string,
  organizationId?: string | null,
): Promise<LeadEnrichmentContext | null> {
  const contact = await getContact(contactId);
  if (!contact) return null;

  const orgId = await resolveRequestOrganizationId(
    organizationId ?? contact.person.organizationId,
  );
  let employeeCount: number | null = null;
  let linkedinUrl: string | null = null;
  let logoUrl: string | null = null;
  let city: string | null = contact.person.city;
  let address: string | null = contact.person.addressLine;
  let companyDomain = contact.person.company?.domain ?? null;
  let companyIndustry = contact.person.company?.industry ?? null;
  let companyName = contact.person.company?.name ?? null;

  if (contact.person.companyId) {
    let company = await prisma.company.findFirst({
      where: { id: contact.person.companyId, organizationId: orgId },
      include: { locations: { where: { type: "hq" }, take: 1 } },
    });
    if (!company) {
      const orphan = await prisma.company.findFirst({
        where: { id: contact.person.companyId },
        include: { locations: { where: { type: "hq" }, take: 1 } },
      });
      if (orphan) {
        await prisma.company.update({
          where: { id: orphan.id },
          data: { organizationId: orgId },
        });
        company = { ...orphan, organizationId: orgId };
      }
    }
    if (company) {
      companyName = company.name;
      // Prefer the company record domain. Fall back to a contact projection
      // only when it plausibly belongs to this company (not a consultant's
      // employer mailbox like tcs.com on an Aadhya account).
      const projectedDomain = companyDomain;
      companyDomain =
        company.domain ||
        (projectedDomain &&
        companyNameMatchesDomain(companyName, projectedDomain)
          ? projectedDomain
          : null);
      companyIndustry = company.industry ?? companyIndustry;
      employeeCount = company.employeeCount;
      const hq = company.locations[0];
      if (hq) {
        city = hq.city || city;
        address = hq.address || address;
      }
      const extraRows = await prisma.$queryRawUnsafe<
        Array<{ linkedin_url: string | null; logo_url: string | null }>
      >(
        `SELECT linkedin_url, logo_url FROM companies WHERE id = $1 LIMIT 1`,
        company.id,
      );
      linkedinUrl = extraRows[0]?.linkedin_url ?? null;
      logoUrl = extraRows[0]?.logo_url ?? null;
    }
  }

  const snap = await findLeadEnrichmentSnapshot(orgId, contactId).catch(
    () => null,
  );
  const snapStr = (key: string) => {
    const v = snap?.[key];
    return v == null || String(v).trim() === "" ? null : String(v).trim();
  };
  const companyDescription = snapStr("company_description");
  const products = snapStr("products");

  const blanks: EnrichmentFieldKey[] = [];
  const domainBelongs =
    Boolean(companyDomain) &&
    (companyNameMatchesDomain(companyName, companyDomain) ||
      companyIdentityAllowsDomain(companyName, companyDomain, {
        evidenceText: companyDescription,
        sourceUrl: snapStr("enrichment_source"),
      }) ||
      (isShortCompanyAcronym(companyName) &&
        acronymMatchesEntityText(companyName, companyDescription)));
  if (!companyDomain || !domainBelongs) blanks.push("domain");
  if (!companyIndustry) blanks.push("industry");
  if (employeeCount == null) blanks.push("employeeCount");
  if (!linkedinUrl) blanks.push("linkedinUrl");
  if (
    !logoUrl ||
    isSyntheticCompanyLogoUrl(logoUrl) ||
    !logoUrlBelongsToCompany(companyName, logoUrl, {
      companyDomain,
    })
  ) {
    blanks.push("logoUrl");
  }
  if (!city || isGenericLocationLabel(city)) blanks.push("city");
  if (!address || isGenericLocationLabel(address)) blanks.push("address");
  if (!contact.person.title) blanks.push("title");
  if (!companyName) blanks.push("companyName");
  if (!companyDescription) blanks.push("companyDescription");
  if (!products) blanks.push("products");
  if (
    employeeCount != null &&
    !blanks.includes("employeeCount") &&
    blanks.some((b) => b !== "companyName")
  ) {
    blanks.push("employeeCount");
  }

  return {
    contactId,
    organizationId: orgId,
    firstName: contact.person.firstName,
    lastName: contact.person.lastName,
    email: contact.person.email,
    phone: contact.person.phone,
    title: contact.person.title,
    companyId: contact.person.companyId,
    locationId: contact.person.locationId,
    companyName,
    companyDomain,
    companyIndustry,
    companyDescription,
    products,
    employeeCount,
    linkedinUrl,
    logoUrl,
    city,
    address,
    blanks,
  };
}

/**
 * Idempotent enqueue: one active job per org+contact.
 * Re-queues when new contact data arrives.
 */
async function resolveEnrichmentCompanyName(
  contact: Awaited<ReturnType<typeof getContact>>,
): Promise<string | null> {
  if (!contact) return null;
  const fromPerson = contact.person.company?.name?.trim();
  if (fromPerson) return fromPerson;
  const companyId = contact.person.companyId?.trim();
  if (!companyId) return null;
  const company = await prisma.company.findFirst({
    where: { id: companyId },
    select: { name: true },
  });
  return company?.name?.trim() || null;
}

export async function enqueueLeadEnrichment(input: {
  contactId: string;
  organizationId?: string | null;
  companyId?: string | null;
  processImmediately?: boolean;
}): Promise<EnrichmentJobRow | null> {
  const contact = await promoteContactToLeadIfEligible(input.contactId);
  if (!contact) return null;

  const companyName = await resolveEnrichmentCompanyName(contact);
  if (!companyName) return null;

  const organizationId = await resolveRequestOrganizationId(
    input.organizationId ?? contact.person.organizationId,
  );
  const companyId = input.companyId ?? contact.person.companyId;

  let job: EnrichmentJobRow;
  try {
    job = await upsertEnrichmentJob({
      organizationId,
      contactId: input.contactId,
      companyId,
      maxAttempts: MAX_ATTEMPTS,
    });
  } catch (err) {
    console.error("lead enrichment enqueue failed", err);
    return null;
  }

  if (input.processImmediately !== false) {
    void processLeadEnrichmentJob(job.id).catch((err) => {
      console.error("lead enrichment immediate process failed", err);
    });
  }

  return job;
}

export async function getLeadEnrichmentStatus(contactId: string): Promise<{
  status: LeadEnrichmentStatus | "none";
  attempts: number;
  lastError: string | null;
  resultSummary: unknown;
  updatedAt: string | null;
  completedAt: string | null;
} | null> {
  const none = {
    status: "none" as const,
    attempts: 0,
    lastError: null,
    resultSummary: null,
    updatedAt: null,
    completedAt: null,
  };
  try {
    const organizationId = await getCurrentOrganizationId();
    const job = await findEnrichmentJobByOrgContact(organizationId, contactId);
    if (!job) return none;
    // Legacy: UI used to surface wait timeouts as "failed". Treat those as skipped.
    const timedOut =
      job.status === "failed" &&
      typeof job.lastError === "string" &&
      /timed?\s*out|enrichment_budget|wait_budget/i.test(job.lastError);
    return {
      status: timedOut ? "skipped" : job.status,
      attempts: job.attempts,
      lastError: timedOut ? null : job.lastError,
      resultSummary: timedOut
        ? { reason: "wait_budget", filled: [] }
        : job.resultSummary,
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  } catch (err) {
    console.warn("getLeadEnrichmentStatus unavailable", err);
    return none;
  }
}

/**
 * Re-trigger processing when a job is still pending/failed (SSE mid-wait kick).
 */
export async function kickLeadEnrichmentIfActive(
  contactId: string,
): Promise<void> {
  try {
    const organizationId = await getCurrentOrganizationId();
    const job = await findEnrichmentJobByOrgContact(organizationId, contactId);
    if (!job) return;
    if (job.status !== "pending" && job.status !== "failed") return;
    await processLeadEnrichmentJob(job.id);
  } catch (err) {
    console.warn("kickLeadEnrichmentIfActive failed", err);
  }
}

/**
 * Mark an in-flight job as skipped so the UI never hangs on a timeout failure.
 */
export async function softCompleteLeadEnrichment(
  contactId: string,
  reason = "wait_budget",
): Promise<EnrichmentJobRow | null> {
  try {
    const organizationId = await getCurrentOrganizationId();
    const job = await findEnrichmentJobByOrgContact(organizationId, contactId);
    if (!job) return null;
    if (
      job.status === "enriched" ||
      job.status === "skipped" ||
      job.status === "failed"
    ) {
      return job;
    }
    const updated = await updateEnrichmentJob(job.id, {
      status: "skipped",
      lastError: null,
      nextRetryAt: null,
      completedAt: new Date(),
      resultSummary: { reason, filled: [] },
    });
    notifyJob(updated);
    return updated;
  } catch (err) {
    console.warn("softCompleteLeadEnrichment failed", err);
    return null;
  }
}

async function callAiService(
  contactId: string,
  organizationId?: string | null,
): Promise<LeadEnrichmentPayload | null> {
  const base = process.env.AI_SERVICE_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) return null;
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  try {
    const res = await fetch(`${base}/ai/v1/agents/enrich-lead/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-internal-secret": secret } : {}),
      },
      body: JSON.stringify({ contactId, organizationId: organizationId ?? null }),
      signal: AbortSignal.timeout(AI_SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("ai-service enrich failed", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as LeadEnrichmentPayload & {
      ok?: boolean;
    };
    if (!data?.contactId) return null;
    return data;
  } catch (err) {
    console.error("ai-service enrich error", err);
    return null;
  }
}

export async function processLeadEnrichmentJob(
  jobId: string,
): Promise<EnrichmentJobRow | null> {
  const claimed = await claimEnrichmentJob(jobId);
  if (!claimed) {
    // Job already running or terminal — do not re-notify (concurrent kicks
    // from SSE, LISTEN drain, and immediate enqueue would duplicate bells).
    return findEnrichmentJobById(jobId);
  }

  const job = await findEnrichmentJobById(jobId);
  if (!job) return null;

  const attempts = job.attempts + 1;
  let settled = false;

  async function finish(
    data: Parameters<typeof updateEnrichmentJob>[1],
  ): Promise<EnrichmentJobRow> {
    if (settled) {
      const existing = await findEnrichmentJobById(jobId);
      if (existing) return existing;
    }
    settled = true;
    const updated = await updateEnrichmentJob(jobId, data);
    notifyJob(updated);
    return updated;
  }

  try {
    const lead = await promoteContactToLeadIfEligible(job.contactId);
    if (!lead) {
      await recordLoadContextStep({
        organizationId: job.organizationId,
        agent: "lead_enrichment",
        jobId,
        contactId: job.contactId,
        status: "skipped",
        label: "Lead pipeline eligibility",
        errorReason: "not_a_lead",
      });
      return finish({
        status: "skipped",
        attempts,
        lastError: null,
        completedAt: new Date(),
        resultSummary: { reason: "not_a_lead" },
      });
    }

    const ctx = await buildLeadEnrichmentContext(
      job.contactId,
      job.organizationId,
    );
    if (!ctx) {
      await recordLoadContextStep({
        organizationId: job.organizationId,
        agent: "lead_enrichment",
        jobId,
        contactId: job.contactId,
        status: "skipped",
        label: "Loading contact & company context",
        errorReason: "contact_not_found",
      });
      return finish({
        status: "skipped",
        attempts,
        lastError: "contact_not_found",
        completedAt: new Date(),
        resultSummary: { reason: "contact_not_found" },
      });
    }

    const run = async () => {
      // ZoomInfo is the primary source. Company name/domain, full email, and
      // phone are sent together when present. The prior enrichment chain below
      // remains the fallback when ZoomInfo is unavailable or returns no fields.
      const zoominfo = await lookupLeadEnrichmentViaZoominfo(ctx);
      const cacheDomain = enrichmentCacheDomain({
        companyName: ctx.companyName,
        companyDomain: ctx.companyDomain,
        email: ctx.email,
      });
      let payload: LeadEnrichmentPayload | null = zoominfo?.payload ?? null;
      let fromCache = false;

      if (!payload && !ctx.companyName) {
        return finish({
          status: "skipped",
          attempts,
          lastError: null,
          completedAt: new Date(),
          resultSummary: { reason: "no_company_name" },
        });
      }

      if (
        !payload &&
        ctx.blanks.filter((b) => b !== "companyName").length === 0
      ) {
        return finish({
          status: "skipped",
          attempts,
          completedAt: new Date(),
          resultSummary: { reason: "nothing_to_fill" },
        });
      }

      if (!payload && cacheDomain) {
        const cached = await getDomainEnrichmentCache(
          job.organizationId,
          cacheDomain,
        );
        if (
          cached?.payload &&
          typeof cached.payload === "object" &&
          !Array.isArray(cached.payload)
        ) {
          const cachedFields = (cached.payload as { fields?: LeadEnrichmentPayload["fields"] })
            .fields;
          if (
            cachedFields &&
            Object.keys(cachedFields).length > 0 &&
            enrichmentFieldsBelongToCompany(ctx.companyName, cachedFields)
          ) {
            payload = {
              contactId: job.contactId,
              fields: cachedFields,
              status: "enriched",
              reason: "domain_cache",
            };
            fromCache = true;
          }
        }
      }

      if (!payload) {
        payload = await callAiService(job.contactId, job.organizationId);
      }
      let persistResult: Awaited<ReturnType<typeof persistLeadEnrichment>>;

      if (payload) {
        const already = (
          payload as {
            persistResult?: {
              filled?: string[];
              companyId?: string | null;
              conflictFlags?: string[];
            };
          }
        ).persistResult;
        if (already && Array.isArray(already.filled)) {
          persistResult = {
            ok: true as const,
            filled: already.filled as Awaited<
              ReturnType<typeof persistLeadEnrichment>
            >["filled"],
            companyId: already.companyId ?? job.companyId,
            conflictFlags: already.conflictFlags ?? [],
          };
        } else {
          persistResult = await persistLeadEnrichment(payload, {
            organizationId: job.organizationId,
          });
        }
      } else {
        payload = await enrichLeadLocally(ctx);
        persistResult = await persistLeadEnrichment(payload, {
          organizationId: job.organizationId,
        });
      }

      const writeDomain = enrichmentCacheDomain({
        companyName: ctx.companyName,
        companyDomain: ctx.companyDomain,
        email: ctx.email,
        payloadDomain:
          typeof payload.fields?.domain?.value === "string" ||
          typeof payload.fields?.domain?.value === "number"
            ? payload.fields.domain.value
            : null,
      });
      if (
        !fromCache &&
        writeDomain &&
        payload.fields &&
        Object.keys(payload.fields).length > 0 &&
        enrichmentFieldsBelongToCompany(ctx.companyName, payload.fields)
      ) {
        await upsertDomainEnrichmentCache({
          organizationId: job.organizationId,
          domain: writeDomain,
          payload: { fields: payload.fields },
          source: payload.reason ?? "enrichment",
        }).catch((err) =>
          console.error("domain enrichment cache write failed", err),
        );
      }

      if (settled) {
        const existing = await findEnrichmentJobById(jobId);
        if (existing) return existing;
      }

      const terminal =
        payload.status === "failed"
          ? "skipped"
          : persistResult.filled.length > 0 || payload.status === "enriched"
            ? "enriched"
            : "skipped";

      return finish({
        status: terminal,
        attempts,
        companyId: persistResult.companyId ?? job.companyId,
        lastError: null,
        completedAt: new Date(),
        nextRetryAt: null,
        resultSummary: {
          filled: persistResult.filled,
          reason: payload.reason ?? null,
          fields: payload.fields,
          fromCache,
          conflictFlags: persistResult.conflictFlags,
          ...(zoominfo
            ? {
                provider: "zoominfo",
                requestId: zoominfo.requestId,
                summary: zoominfo.summary,
              }
            : {}),
        },
      });
    };

    const raced = await Promise.race([
      run().then((row) => ({ kind: "ok" as const, row })),
      new Promise<{ kind: "budget" }>((resolve) => {
        setTimeout(() => resolve({ kind: "budget" }), JOB_BUDGET_MS);
      }),
    ]);

    if (raced.kind === "budget") {
      return finish({
        status: "skipped",
        attempts,
        lastError: null,
        nextRetryAt: null,
        completedAt: new Date(),
        resultSummary: { reason: "enrichment_budget", filled: [] },
      });
    }
    return raced.row;
  } catch (err) {
    const message = err instanceof Error ? err.message : "enrichment_failed";
    // Soft outcomes: never leave the UI waiting on a hard "failed" timeout.
    if (isSoftAbortError(message) || attempts >= job.maxAttempts) {
      return finish({
        status: "skipped",
        attempts,
        lastError: null,
        nextRetryAt: null,
        completedAt: new Date(),
        resultSummary: {
          reason: isSoftAbortError(message) ? "enrichment_budget" : message,
          filled: [],
        },
      });
    }
    return finish({
      status: "pending",
      attempts,
      lastError: message,
      nextRetryAt: new Date(Date.now() + backoffMs(attempts)),
      completedAt: null,
    });
  }
}

function notifyJob(job: EnrichmentJobRow): void {
  const summary = job.resultSummary as { filled?: string[] } | null;
  publishEnrichmentEvent({
    contactId: job.contactId,
    status: job.status,
    filled: summary?.filled,
    lastError: job.lastError,
    resultSummary: job.resultSummary,
  });
  if (job.status === "enriched") {
    const filled = summary?.filled?.filter(Boolean) ?? [];
    notifyAdminsOfLeadEventAsync({
      kind: "lead_enriched",
      organizationId: job.organizationId,
      contactId: job.contactId,
      detail: filled.length
        ? `Filled: ${filled.join(", ")}`
        : "Enrichment complete.",
      excludeUserId: null,
      metadata: { filled, status: job.status },
    });
  }
  // Sequential pipeline: score only after enrichment fully settles.
  if (job.status === "enriched" || job.status === "skipped") {
    void enqueueLeadScoring({
      contactId: job.contactId,
      organizationId: job.organizationId,
      triggerReason:
        job.status === "enriched"
          ? "enrichment_complete"
          : "enrichment_skipped",
      processImmediately: true,
    }).catch((err) => {
      console.error("scoring enqueue after enrichment failed", err);
    });
  }
  // Exhausted failures also continue the pipeline.
  if (job.status === "failed" && job.completedAt) {
    void enqueueLeadScoring({
      contactId: job.contactId,
      organizationId: job.organizationId,
      triggerReason: "enrichment_failed",
      processImmediately: true,
    }).catch((err) => {
      console.error("scoring enqueue after enrichment failed", err);
    });
  }
}

export async function processDueLeadEnrichmentJobs(
  limit?: number,
): Promise<{
  processed: number;
  results: Array<{ id: string; status: string }>;
}> {
  const batchLimit = clampEnvInt("ENRICH_DRAIN_LIMIT", limit ?? 50, 1, 200);
  const concurrency = clampEnvInt("ENRICH_DRAIN_CONCURRENCY", 5, 1, 20);
  try {
    const orgIds = await listDueEnrichmentOrganizationIds(MAX_ATTEMPTS);
    const due = (
      await Promise.all(
        orgIds.map((organizationId) =>
          listDueEnrichmentJobs(batchLimit, MAX_ATTEMPTS, organizationId),
        ),
      )
    ).flat();
    if (due.length === 0) {
      return { processed: 0, results: [] };
    }
    const results = await mapWithConcurrency(due, concurrency, async (job) => {
      const updated = await processLeadEnrichmentJob(job.id);
      return { id: job.id, status: updated?.status ?? "unknown" };
    });
    return { processed: results.length, results };
  } catch (err) {
    console.error("processDueLeadEnrichmentJobs failed", err);
    return { processed: 0, results: [] };
  }
}

function clampEnvInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Safety net: enqueue pending enrichment for recent CDP customers / CRM
 * profiles missing a job row (missed trigger / legacy data). Ensures a thin
 * contact_profiles overlay when only CDP was written.
 */
export async function reconcileMissingLeadEnrichmentJobs(
  limit = 100,
): Promise<{ enqueued: number }> {
  try {
    const half = Math.max(1, Math.floor(limit / 2));
    const [missingProfiles, missingCdp] = await Promise.all([
      listContactProfilesMissingEnrichmentJob(half),
      listCdpCustomersMissingEnrichmentJob(limit),
    ]);
    const seen = new Set<string>();
    const queue: Array<{
      organizationId: string;
      contactId: string;
      companyId: string | null;
      ensureProfile: boolean;
      acquisitionChannel: string | null;
    }> = [];

    for (const row of missingCdp) {
      const key = `${row.organizationId}:${row.contactId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({
        organizationId: row.organizationId,
        contactId: row.contactId,
        companyId: null,
        ensureProfile: true,
        acquisitionChannel: row.acquisitionChannel,
      });
    }
    for (const row of missingProfiles) {
      const key = `${row.organizationId}:${row.contactId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ ...row, ensureProfile: false, acquisitionChannel: null });
    }

    let enqueued = 0;
    for (const row of queue.slice(0, limit)) {
      try {
        if (row.ensureProfile) {
          const existing = await getContactProfileByAccountId(row.contactId);
          if (existing?.status === "archived") continue;
          if (!existing) {
            await upsertContactProfile(row.contactId, {
              organizationId: row.organizationId,
              leadSource: row.acquisitionChannel,
            });
          }
        }
        await upsertEnrichmentJob({
          organizationId: row.organizationId,
          contactId: row.contactId,
          companyId: row.companyId,
          maxAttempts: MAX_ATTEMPTS,
        });
        enqueued += 1;
      } catch (err) {
        console.error(
          "reconcileMissingLeadEnrichmentJobs upsert failed",
          row.contactId,
          err,
        );
      }
    }
    if (enqueued > 0) {
      // Kick drain without waiting for the next LISTEN/cron tick.
      void processDueLeadEnrichmentJobs().catch((err) =>
        console.error("reconcile drain kick failed", err),
      );
    }
    return { enqueued };
  } catch (err) {
    console.error("reconcileMissingLeadEnrichmentJobs failed", err);
    return { enqueued: 0 };
  }
}
