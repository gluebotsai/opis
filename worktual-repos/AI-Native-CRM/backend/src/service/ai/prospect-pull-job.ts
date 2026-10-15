/**
 * Prospect pull orchestration: search → qualify → personnel → ready_for_review.
 */

import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";
import {
  claimProspectPullJob,
  createProspectPullJob,
  findProspectPullJob,
  listProspectPullCandidates,
  listRecentProspectIdentityKeys,
  markCandidateImported,
  replaceProspectPullCandidates,
  setProspectCandidateSelection,
  updateProspectPullJob,
  type ProspectCandidateInput,
  type ProspectCriteria,
  type ProspectPullCandidateRow,
  type ProspectPullJobRow,
} from "@/dao/ai/prospect-pull-store";
import {
  listEnabledResearchProviderSecrets,
  getOrgCompetitorStacks,
  RESEARCH_PROVIDERS,
  type ResearchProviderId,
} from "@/dao/ai/research-provider-config";
import { getOrCreateOrgAssignmentSettings } from "@/dao/sales/assignment-settings";
import { listProductsForSelect } from "@/dao/products/product-service";
import { upsertLeadContact } from "@/dao/contacts/inbound-lead-upsert";
import { findDuplicateContacts } from "@/dao/contacts/contact-duplicate-service";
import {
  crmNameIsSamePerson,
  prospectIdentityKeys,
  rememberProspectIdentity,
  sharesProspectIdentity,
} from "@/lib/prospect-already-known";
import { onLeadCreated } from "@/service/ai/lead-pipeline";
import { getCurrentBusinessType } from "@/service/auth/require-role";
import { recordLoadContextStep } from "@/dao/ai/agent-step-events";
import { persistLeadEnrichment } from "@/dao/ai/lead-enrichment-persist";
import { isZoominfoGatewayConfigured } from "@/service/zoominfo/zoominfo-gateway";
import {
  searchZoominfoContacts,
  zoominfoSearchFailureMessage,
} from "@/service/zoominfo/zoominfo-search";

function normalizeSources(
  requested: string[] | null | undefined,
  enabled: ResearchProviderId[],
): ResearchProviderId[] {
  const allowed = new Set(RESEARCH_PROVIDERS);
  const fromUser = (requested ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ResearchProviderId => allowed.has(s as ResearchProviderId));
  if (fromUser.length > 0) {
    return fromUser.filter((s) => enabled.includes(s));
  }
  return enabled;
}

function toCandidateInput(
  c: Record<string, unknown>,
): ProspectCandidateInput {
  const sources = Array.isArray(c.sourcesFoundIn)
    ? (c.sourcesFoundIn as string[]).filter((s): s is ResearchProviderId =>
        (RESEARCH_PROVIDERS as readonly string[]).includes(s),
      )
    : [];
  return {
    firstName: typeof c.firstName === "string" ? c.firstName : null,
    lastName: typeof c.lastName === "string" ? c.lastName : null,
    email: typeof c.email === "string" ? c.email : null,
    phone: typeof c.phone === "string" ? c.phone : null,
    title: typeof c.title === "string" ? c.title : null,
    companyName: typeof c.companyName === "string" ? c.companyName : null,
    companyDomain:
      typeof c.companyDomain === "string" ? c.companyDomain : null,
    linkedinUrl: typeof c.linkedinUrl === "string" ? c.linkedinUrl : null,
    industry: typeof c.industry === "string" ? c.industry : null,
    employeeCount:
      typeof c.employeeCount === "number" ? c.employeeCount : null,
    city: typeof c.city === "string" ? c.city : null,
    country: typeof c.country === "string" ? c.country : null,
    technographics: Array.isArray(c.technographics)
      ? (c.technographics as string[])
      : null,
    sourcesFoundIn: sources,
    qualifyReasons: Array.isArray(c.qualifyReasons)
      ? (c.qualifyReasons as string[])
      : null,
    qualifyScore:
      typeof c.qualifyScore === "number" ? c.qualifyScore : null,
    providerPayload:
      c.providerPayload && typeof c.providerPayload === "object"
        ? (c.providerPayload as ProspectCandidateInput["providerPayload"])
        : null,
    rank: typeof c.rank === "number" ? c.rank : null,
    selected: true,
  };
}

/** Dedupe + hard-cap to requested limit before persisting review list. */
function finalizeProspectCandidates(
  rows: ProspectCandidateInput[],
  limitN: number,
): ProspectCandidateInput[] {
  const seen = new Set<string>();
  const out: ProspectCandidateInput[] = [];
  const cap = Math.min(25, Math.max(1, Math.floor(limitN)));
  for (const c of rows) {
    const email = (c.email || "").trim().toLowerCase();
    const key = email
      ? `e:${email}`
      : `p:${(c.companyDomain || "").toLowerCase()}:${(c.firstName || "").toLowerCase()}:${(c.lastName || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, rank: out.length + 1, selected: true });
    if (out.length >= cap) break;
  }
  return out;
}

const ZOOMINFO_PAGE_SIZE = 25;
const ZOOMINFO_MAX_PAGES = 5;

function textField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function alreadyInCrm(
  row: Record<string, unknown>,
  organizationId: string,
): Promise<boolean> {
  const firstName = textField(row, "firstName");
  const lastName = textField(row, "lastName");
  const email = textField(row, "email");
  const companyName = textField(row, "companyName");
  if (!email && !(firstName && lastName)) return false;
  try {
    const matches = await findDuplicateContacts({
      organizationId,
      firstName,
      lastName,
      email,
      companyName,
      limit: 5,
    });
    return matches.some((match) =>
      crmNameIsSamePerson({
        firstName,
        lastName,
        companyName,
        email,
        matchName: match.displayName,
        matchCompany: match.companyName,
        matchEmail: match.email,
      }),
    );
  } catch {
    return false;
  }
}

/** Drop people already shown or already stored, and remember who we keep. */
async function takeFreshProspects(input: {
  rows: Record<string, unknown>[];
  organizationId: string;
  known: Set<string>;
  wanted: number;
}): Promise<{ fresh: Record<string, unknown>[]; skipped: number }> {
  const fresh: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const row of input.rows) {
    if (fresh.length >= input.wanted) break;
    const seen = sharesProspectIdentity(row, input.known);
    const inCrm = seen
      ? false
      : await alreadyInCrm(row, input.organizationId);
    if (seen || inCrm) {
      skipped += 1;
      rememberProspectIdentity(row, input.known);
      continue;
    }
    rememberProspectIdentity(row, input.known);
    fresh.push(row);
  }
  return { fresh, skipped };
}

export async function enqueueProspectPull(input: {
  organizationId: string;
  requestedByUserId: string;
  limit: number;
  sources?: string[] | null;
  criteria?: ProspectCriteria | null;
  processImmediately?: boolean;
}): Promise<ProspectPullJobRow> {
  const secrets = await listEnabledResearchProviderSecrets(
    input.organizationId,
  );
  const enabled = secrets.map((s) => s.provider);
  const sourcesRequested = normalizeSources(input.sources, enabled);
  // Keep requested list for audit even if none configured yet
  const requestedForJob =
    (input.sources ?? []).length > 0
      ? normalizeSources(input.sources, [...RESEARCH_PROVIDERS])
      : sourcesRequested.length > 0
        ? sourcesRequested
        : [...RESEARCH_PROVIDERS];

  const job = await createProspectPullJob({
    organizationId: input.organizationId,
    requestedByUserId: input.requestedByUserId,
    limitN: input.limit,
    sourcesRequested: requestedForJob,
    criteria: input.criteria ?? {},
  });

  if (input.processImmediately !== false) {
    void processProspectPullJob(job.id).catch((err) =>
      console.error("prospect pull job failed", err),
    );
  }
  return job;
}

export async function processProspectPullJob(
  jobId: string,
): Promise<ProspectPullJobRow | null> {
  const existing = await findProspectPullJob(jobId);
  if (!existing) return null;
  if (
    existing.status === "ready_for_review" ||
    existing.status === "imported" ||
    existing.status === "cancelled"
  ) {
    return existing;
  }
  // Mid-flight: another worker owns this job — do not re-run (avoids dupes).
  if (
    existing.status === "searching" ||
    existing.status === "qualifying" ||
    existing.status === "personnel"
  ) {
    return existing;
  }

  const job = await claimProspectPullJob(jobId);
  if (!job) {
    return findProspectPullJob(jobId);
  }

  try {
    const secrets = await listEnabledResearchProviderSecrets(
      job.organizationId,
    );
    const enabled = secrets.map((s) => s.provider);
    let sources = normalizeSources(job.sourcesRequested, enabled);

    // Dev/test: if none configured, use fixture keys for requested sources
    const credentials =
      secrets.length > 0
        ? secrets.map((s) => ({
            provider: s.provider,
            apiKey: s.apiKey,
            settings: s.settings,
          }))
        : job.sourcesRequested.map((p) => ({
            provider: p,
            apiKey: "__fixture__",
            settings: null as Record<string, unknown> | null,
          }));
    if (secrets.length === 0) {
      sources = job.sourcesRequested.length
        ? job.sourcesRequested
        : [...RESEARCH_PROVIDERS];
    }

    await recordLoadContextStep({
      organizationId: job.organizationId,
      agent: "prospect_search",
      jobId,
      contactId: null,
      status: "ok",
      label: "Searching research providers",
    });

    // ZoomInfo search runs on the API process. The AI service was returning an
    // empty list in milliseconds and the chat reported "0 leads".
    const zoominfoDirect =
      sources.includes("zoominfo") && isZoominfoGatewayConfigured();
    const pythonSources = zoominfoDirect
      ? sources.filter((source) => source !== "zoominfo")
      : sources;
    const known = await listRecentProspectIdentityKeys(job.organizationId);
    let skippedExisting = 0;
    let zoominfoCandidates: Record<string, unknown>[] = [];
    if (zoominfoDirect) {
      try {
        const seenThisSearch = new Set<string>();
        for (
          let page = 1;
          page <= ZOOMINFO_MAX_PAGES &&
          zoominfoCandidates.length < job.limitN;
          page += 1
        ) {
          const batch = await searchZoominfoContacts({
            organizationId: job.organizationId,
            criteria: job.criteria,
            limit: ZOOMINFO_PAGE_SIZE,
            page,
          });
          if (batch.length === 0) break;
          const stamps = batch.map((row) =>
            prospectIdentityKeys({
              email: textField(row, "email"),
              firstName: textField(row, "firstName"),
              lastName: textField(row, "lastName"),
              companyName: textField(row, "companyName"),
              providerPayload: row.providerPayload,
            }).join("|"),
          );
          if (stamps.every((stamp) => seenThisSearch.has(stamp))) break;
          for (const stamp of stamps) seenThisSearch.add(stamp);
          const picked = await takeFreshProspects({
            rows: batch,
            organizationId: job.organizationId,
            known,
            wanted: job.limitN - zoominfoCandidates.length,
          });
          skippedExisting += picked.skipped;
          zoominfoCandidates.push(...picked.fresh);
          if (batch.length < ZOOMINFO_PAGE_SIZE) break;
        }
      } catch (err) {
        throw new Error(zoominfoSearchFailureMessage(err));
      }
    }

    const providerErrors: unknown[] = [];
    let otherCandidates: Record<string, unknown>[] = [];
    let otherSourcesUsed: ResearchProviderId[] = [];
    if (pythonSources.length > 0) {
      const pythonCredentials = credentials.filter((row) =>
        pythonSources.includes(row.provider),
      );
      const search = await callAiServiceAgent<{
        candidates?: Record<string, unknown>[];
        sourcesUsed?: string[];
        errors?: unknown[];
      }>(
        "prospect-search",
        {
          jobId,
          organizationId: job.organizationId,
          sources: pythonSources,
          criteria: job.criteria,
          credentials: pythonCredentials,
          fetchLimit: Math.min(100, Math.max(job.limitN * 4, 20)),
          limit: job.limitN,
        },
        { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
      );
      if (!search && zoominfoCandidates.length === 0) {
        throw new Error("prospect_search_unreachable");
      }
      if (search) {
        otherCandidates = Array.isArray(search.candidates)
          ? search.candidates
          : [];
        otherSourcesUsed = Array.isArray(search.sourcesUsed)
          ? (search.sourcesUsed as ResearchProviderId[])
          : pythonSources;
        if (Array.isArray(search.errors)) providerErrors.push(...search.errors);
      }
    }

    const otherFresh = await takeFreshProspects({
      rows: otherCandidates,
      organizationId: job.organizationId,
      known,
      wanted: Math.max(job.limitN - zoominfoCandidates.length, 0),
    });
    skippedExisting += otherFresh.skipped;
    const rawCandidates = [...zoominfoCandidates, ...otherFresh.fresh];
    const sourcesUsed: ResearchProviderId[] = [
      ...(zoominfoDirect ? (["zoominfo"] as ResearchProviderId[]) : []),
      ...otherSourcesUsed.filter((source) => source !== "zoominfo"),
    ];

    // No matches — skip qualify/personnel LLM (avoids long empty waits / chat timeouts).
    if (rawCandidates.length === 0) {
      const errorText = providerErrors
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const row = item as { provider?: string; error?: string };
          const detail = String(row.error || "").trim();
          if (!detail) return "";
          return row.provider ? `${row.provider}: ${detail}` : detail;
        })
        .filter(Boolean)
        .join("; ");
      await replaceProspectPullCandidates(jobId, job.organizationId, []);
      return updateProspectPullJob(jobId, {
        status: errorText ? "failed" : "ready_for_review",
        sourcesUsed,
        completedAt: new Date(),
        resultSummary: {
          candidateCount: 0,
          sourcesUsed,
          providerErrors,
          qualifySource: null,
          skippedExisting,
        } as import("@prisma/client").Prisma.InputJsonValue,
        lastError: errorText || null,
      });
    }

    await updateProspectPullJob(jobId, {
      status: "qualifying",
      sourcesUsed,
    });

    const orgSettings = await getOrCreateOrgAssignmentSettings(
      job.organizationId,
    );
    const competitors = await getOrgCompetitorStacks(job.organizationId);
    let catalogProducts: string[] = [];
    try {
      const products = await listProductsForSelect(40);
      catalogProducts = products
        .map((p) => p.name)
        .filter((n): n is string => Boolean(n));
    } catch {
      catalogProducts = [];
    }

    await recordLoadContextStep({
      organizationId: job.organizationId,
      agent: "prospect_qualify",
      jobId,
      contactId: null,
      status: "ok",
      label: "Qualifying candidates",
    });

    const qualify = await callAiServiceAgent<{
      candidates?: Record<string, unknown>[];
      source?: string;
    }>(
      "prospect-qualify",
      {
        jobId,
        organizationId: job.organizationId,
        candidates: rawCandidates,
        limit: job.limitN,
        icp: orgSettings.leadIcp,
        competitors,
        catalogProducts,
        criteria: job.criteria,
        productFitHint: job.criteria.productFitHint ?? null,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    const qualified = Array.isArray(qualify?.candidates)
      ? qualify!.candidates
      : rawCandidates.slice(0, job.limitN).map((c, i) => ({
          ...c,
          rank: i + 1,
          qualifyScore: 50,
          qualifyReasons: ["Fallback rank"],
        }));

    await updateProspectPullJob(jobId, { status: "personnel" });

    await recordLoadContextStep({
      organizationId: job.organizationId,
      agent: "prospect_personnel",
      jobId,
      contactId: null,
      status: "ok",
      label: "Filling personnel",
    });

    const personnel = await callAiServiceAgent<{
      candidates?: Record<string, unknown>[];
    }>(
      "prospect-personnel",
      {
        jobId,
        organizationId: job.organizationId,
        candidates: qualified,
        credentials,
        criteria: job.criteria,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    const finalRows = Array.isArray(personnel?.candidates)
      ? personnel!.candidates
      : qualified;

    const stored = await replaceProspectPullCandidates(
      jobId,
      job.organizationId,
      finalizeProspectCandidates(
        finalRows.map(toCandidateInput),
        job.limitN,
      ),
    );

    const updated = await updateProspectPullJob(jobId, {
      status: "ready_for_review",
      sourcesUsed,
      completedAt: new Date(),
      resultSummary: {
        candidateCount: stored.length,
        sourcesUsed,
        providerErrors,
        qualifySource: qualify?.source ?? null,
        skippedExisting,
      } as import("@prisma/client").Prisma.InputJsonValue,
      lastError: null,
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "prospect_pull_failed";
    return updateProspectPullJob(jobId, {
      status: "failed",
      lastError: message,
      completedAt: new Date(),
    });
  }
}

export async function getProspectPullReview(input: {
  jobId: string;
  organizationId: string;
}): Promise<{
  job: ProspectPullJobRow;
  candidates: ProspectPullCandidateRow[];
} | null> {
  const job = await findProspectPullJob(input.jobId, input.organizationId);
  if (!job) return null;
  const candidates = await listProspectPullCandidates(
    input.jobId,
    input.organizationId,
  );
  return { job, candidates };
}

export async function importProspectPullSelection(input: {
  jobId: string;
  organizationId: string;
  actorUserId: string;
  selectedIds?: string[] | null;
}): Promise<{
  imported: Array<{ candidateId: string; contactId: string }>;
  skipped: number;
}> {
  const job = await findProspectPullJob(input.jobId, input.organizationId);
  if (!job) {
    throw new Error("Prospect pull job not found.");
  }
  if (job.status !== "ready_for_review" && job.status !== "imported") {
    throw new Error(`Job is not ready for import (status=${job.status}).`);
  }

  if (input.selectedIds && input.selectedIds.length > 0) {
    await setProspectCandidateSelection({
      jobId: input.jobId,
      organizationId: input.organizationId,
      selectedIds: input.selectedIds,
    });
  }

  await updateProspectPullJob(input.jobId, { status: "importing" });

  const businessType = await getCurrentBusinessType();
  const candidates = await listProspectPullCandidates(
    input.jobId,
    input.organizationId,
  );
  const selected = candidates.filter((c) => c.selected);
  const imported: Array<{ candidateId: string; contactId: string }> = [];
  let skipped = 0;
  // Search does not include email. Import enriches each selected ZoomInfo
  // lead (1 credit each), up to 25.
  const enrichMax = Math.min(
    25,
    selected.filter(
      (c) =>
        c.sourcesFoundIn.includes("zoominfo") && !c.importedContactId,
    ).length,
  );
  let zoominfoEnriched = 0;

  for (const c of selected) {
    if (c.importedContactId) {
      skipped += 1;
      continue;
    }

    let firstName = c.firstName;
    let lastName = c.lastName;
    let email = c.email;
    let phone = c.phone;
    let title = c.title;
    let companyName = c.companyName;
    let linkedinUrl = c.linkedinUrl;
    const payload =
      c.providerPayload && typeof c.providerPayload === "object"
        ? (c.providerPayload as Record<string, unknown>)
        : null;
    const zoominfoId =
      payload && typeof payload.zoominfoId === "string"
        ? payload.zoominfoId
        : payload && payload.zoominfoId != null
          ? String(payload.zoominfoId)
          : null;

    if (
      zoominfoId &&
      c.sourcesFoundIn.includes("zoominfo") &&
      zoominfoEnriched < enrichMax
    ) {
      const { enrichProspectCandidateViaZoominfo } = await import(
        "@/service/zoominfo/zoominfo-enrich"
      );
      const enriched = await enrichProspectCandidateViaZoominfo({
        organizationId: input.organizationId,
        personId: zoominfoId,
        idempotencyKey: `crm-prospect-zi-${input.jobId}-${c.id}`,
      });
      zoominfoEnriched += 1;
      if (enriched) {
        firstName =
          String(enriched.firstName || "").trim() || firstName;
        lastName = String(enriched.lastName || "").trim() || lastName;
        email = String(enriched.email || "").trim() || email;
        phone =
          String(enriched.phone || enriched.mobilePhone || "").trim() ||
          phone;
        title = String(enriched.jobTitle || "").trim() || title;
        companyName =
          String(enriched.companyName || "").trim() || companyName;
        const urls = enriched.externalUrls;
        if (Array.isArray(urls)) {
          for (const item of urls) {
            if (!item || typeof item !== "object") continue;
            const u = item as { type?: string; url?: string };
            if (
              u.url &&
              String(u.type || u.url)
                .toLowerCase()
                .includes("linkedin")
            ) {
              linkedinUrl = u.url;
              break;
            }
          }
        }
      }
    }

    if (!email?.trim() && !phone?.trim()) {
      skipped += 1;
      continue;
    }
    const leadSource =
      c.sourcesFoundIn.length > 1
        ? "multi_prospect"
        : c.sourcesFoundIn[0]
          ? `${c.sourcesFoundIn[0]}_prospect`
          : "prospect_pull";

    const requireCompany =
      businessType === "b2b" ||
      (businessType === "b2b2c" && Boolean(companyName));

    const emailResolved =
      email?.trim() ||
      (phone
        ? `${phone.replace(/\D/g, "") || "prospect"}@prospect.local`
        : "");
    if (!emailResolved) {
      skipped += 1;
      continue;
    }

    const result = await upsertLeadContact(
      {
        firstName: firstName ?? "Prospect",
        lastName: lastName ?? "Lead",
        email: emailResolved,
        phone: phone,
        title: title,
        companyName: requireCompany || companyName ? companyName : null,
        companyDomain: c.companyDomain,
        companyIndustry: c.industry,
        city: c.city,
        country: c.country,
        leadSource,
        contactType: "lead",
        createdByUserId: input.actorUserId,
      },
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        source: "prospect_pull",
      },
    );

    if (linkedinUrl?.trim()) {
      await persistLeadEnrichment({
        contactId: result.contact.id,
        fields: {
          linkedinUrl: {
            value: linkedinUrl.trim(),
            confidence: 0.9,
            sourceUrl: linkedinUrl.trim(),
          },
        },
        status: "enriched",
        reason: "zoominfo_prospect_import",
      }).catch(() => undefined);
    }

    await markCandidateImported({
      candidateId: c.id,
      organizationId: input.organizationId,
      contactId: result.contact.id,
    });
    await onLeadCreated({
      contactId: result.contact.id,
      organizationId: input.organizationId,
      companyId: result.contact.person.companyId ?? null,
      triggerReason: "prospect_pull_import",
    });
    imported.push({ candidateId: c.id, contactId: result.contact.id });
  }

  await updateProspectPullJob(input.jobId, {
    status: "imported",
    completedAt: new Date(),
    resultSummary: {
      ...(typeof job.resultSummary === "object" &&
      job.resultSummary &&
      !Array.isArray(job.resultSummary)
        ? (job.resultSummary as object)
        : {}),
      importedCount: imported.length,
      skipped,
      importedContactIds: imported.map((i) => i.contactId),
    } as import("@prisma/client").Prisma.InputJsonValue,
  });

  return { imported, skipped };
}
