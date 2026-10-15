/**
 * Chat prospect pull commands (start / poll / import).
 */

import { getServerUserId } from "@/service/account/session-cookie";
import { canEditContacts } from "@/service/auth/rbac";
import {
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import {
  enqueueProspectPull,
  getProspectPullReview,
  importProspectPullSelection,
  processProspectPullJob,
} from "@/service/ai/prospect-pull-job";
import type { ProspectCriteria } from "@/dao/ai/prospect-pull-store";

export async function startProspectPullCommand(input: {
  limit?: number;
  sources?: string[] | null;
  criteria?: ProspectCriteria | null;
}) {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to pull prospect leads.",
    );
    const organizationId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false as const, error: "Not signed in." };
    }
    const limit = Math.min(25, Math.max(1, Math.floor(input.limit ?? 10)));
    const job = await enqueueProspectPull({
      organizationId,
      requestedByUserId: userId,
      limit,
      sources: input.sources,
      criteria: input.criteria ?? {},
      processImmediately: true,
    });
    return {
      ok: true as const,
      jobId: job.id,
      status: job.status,
      limit: job.limitN,
      sourcesRequested: job.sourcesRequested,
    };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to start prospect pull.",
    };
  }
}

export async function getProspectPullCommand(jobId: string) {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to view prospect pulls.",
    );
    const organizationId = await getCurrentOrganizationId();
    let review = await getProspectPullReview({ jobId, organizationId });
    if (
      review &&
      (review.job.status === "pending" ||
        review.job.status === "searching" ||
        review.job.status === "qualifying" ||
        review.job.status === "personnel")
    ) {
      // Kick processing if still mid-flight (idempotent)
      await processProspectPullJob(jobId);
      review = await getProspectPullReview({ jobId, organizationId });
    }
    if (!review) {
      return { ok: false as const, error: "Prospect pull job not found." };
    }
    return {
      ok: true as const,
      job: {
        id: review.job.id,
        status: review.job.status,
        limitN: review.job.limitN,
        sourcesRequested: review.job.sourcesRequested,
        sourcesUsed: review.job.sourcesUsed,
        criteria: review.job.criteria,
        lastError: review.job.lastError,
        resultSummary: review.job.resultSummary,
      },
      candidates: review.candidates.map((c) => ({
        id: c.id,
        rank: c.rank,
        selected: c.selected,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        title: c.title,
        companyName: c.companyName,
        companyDomain: c.companyDomain,
        industry: c.industry,
        employeeCount: c.employeeCount,
        city: c.city,
        country: c.country,
        technographics: c.technographics,
        sourcesFoundIn: c.sourcesFoundIn,
        qualifyReasons: c.qualifyReasons,
        qualifyScore: c.qualifyScore,
        importedContactId: c.importedContactId,
      })),
    };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to load prospect pull.",
    };
  }
}

export async function importProspectPullCommand(input: {
  jobId: string;
  selectedIds?: string[] | null;
}) {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to import prospect leads.",
    );
    const organizationId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false as const, error: "Not signed in." };
    }
    const result = await importProspectPullSelection({
      jobId: input.jobId,
      organizationId,
      actorUserId: userId,
      selectedIds: input.selectedIds,
    });
    return {
      ok: true as const,
      imported: result.imported,
      skipped: result.skipped,
      message:
        result.skipped > 0
          ? `Imported ${result.imported.length} prospect lead(s). ${result.skipped} could not be added because ZoomInfo did not return an email or phone.`
          : `Imported ${result.imported.length} prospect lead(s).`,
    };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error
          ? err.message
          : "Failed to import prospect leads.",
    };
  }
}
