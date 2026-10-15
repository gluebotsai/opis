import type { BusinessType } from "@/config/modules";
import type { ContactInput } from "@/dao/contacts/contact-service";

/**
 * Motion-aware company rules for contacts (common-table model).
 * See docs/multi-tenancy-common-model.md.
 *
 * PARALLEL B2B/B2C WORK: high-touch shared file — coordinate before editing.
 * Log changes in docs/parallel-work-log.md (see docs/merge-validation-checklist.md).
 */
export function enforceContactCompanyForBusinessType(
  businessType: BusinessType,
  input: Pick<
    ContactInput,
    "companyId" | "companyName" | "locationId" | "domain" | "industry"
  >,
): { ok: true; input: typeof input } | { ok: false; error: string } {
  const companyId = input.companyId?.trim() || null;
  const companyName =
    typeof input.companyName === "string" ? input.companyName.trim() : "";
  const creatingCompany = Boolean(companyName) && !companyId;

  if (businessType === "b2c") {
    if (companyId || creatingCompany || input.locationId?.trim()) {
      return {
        ok: false,
        error: "Company linking is not available for B2C contacts.",
      };
    }
    return {
      ok: true,
      input: {
        ...input,
        companyId: null,
        companyName: null,
        locationId: null,
        domain: null,
        industry: null,
      },
    };
  }

  // b2b / b2b2c: company optional (link when provided)
  return { ok: true, input };
}
