/** Automatic, explicit, and import ZoomInfo enrich via gateway (1 credit per call). */

import { createHash } from "node:crypto";
import { getContact, updateContact } from "@/dao/contacts/contact-service";
import { persistLeadEnrichment } from "@/dao/ai/lead-enrichment-persist";
import { upsertLeadEnrichmentSnapshot } from "@/dao/ai/lead-enrichment-snapshot";
import {
  updateEnrichmentJob,
  upsertEnrichmentJob,
} from "@/dao/ai/lead-enrichment-store";
import { publishEnrichmentEvent } from "@/service/ai/lead-enrichment-events";
import type {
  EnrichmentFieldKey,
  EnrichmentFieldValue,
  LeadEnrichmentContext,
  LeadEnrichmentPayload,
} from "@/service/ai/lead-enrichment-types";
import {
  emailDomain,
  isFreeMailDomain,
} from "@/service/ai/lead-enrichment-types";
import {
  callZoominfoGatewayTool,
  isZoominfoGatewayConfigured,
  isZoominfoOrgSkipError,
  ZoominfoGatewayRequestError,
} from "@/service/zoominfo/zoominfo-gateway";

function field(
  value: string | number | null | undefined,
  confidence = 0.85,
  sourceUrl?: string | null,
): EnrichmentFieldValue | null {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return { value, confidence, sourceUrl: sourceUrl ?? null };
}

function pickContactBlock(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  for (const [key, val] of Object.entries(data)) {
    if (!key.startsWith("contact_")) continue;
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const block = val as Record<string, unknown>;
    const inner = block.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
    if (block.success === true) return block;
  }
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    return data.data as Record<string, unknown>;
  }
  return null;
}

function linkedinFromExternal(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { type?: string; url?: string };
    const typ = (row.type || "").toLowerCase();
    const url = row.url?.trim();
    if (!url) continue;
    if (typ.includes("linkedin") || url.toLowerCase().includes("linkedin.com")) {
      return url;
    }
  }
  return null;
}

function buildSummary(person: Record<string, unknown>): string {
  const parts: string[] = [];
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ");
  if (name) parts.push(name);
  if (person.jobTitle) parts.push(String(person.jobTitle));
  if (person.companyName) parts.push(`at ${String(person.companyName)}`);
  if (person.email) parts.push(`email ${String(person.email)}`);
  if (person.phone || person.mobilePhone) {
    parts.push(`phone ${String(person.phone || person.mobilePhone)}`);
  }
  const li = linkedinFromExternal(person.externalUrls);
  if (li) parts.push(`LinkedIn ${li}`);
  if (person.contactAccuracyScore != null) {
    parts.push(`accuracy ${String(person.contactAccuracyScore)}`);
  }
  return parts.join(" · ").slice(0, 800);
}

function mapToEnrichmentFields(
  person: Record<string, unknown>,
): Partial<Record<EnrichmentFieldKey, EnrichmentFieldValue>> {
  const fields: Partial<Record<EnrichmentFieldKey, EnrichmentFieldValue>> = {};
  const domain = field(
    (person.companyWebsite || person.companyDomain) as string | undefined,
  );
  if (domain) fields.domain = domain;
  const title = field(person.jobTitle as string | undefined);
  if (title) fields.title = title;
  const companyName = field(person.companyName as string | undefined);
  if (companyName) fields.companyName = companyName;
  const li = field(linkedinFromExternal(person.externalUrls));
  if (li) fields.linkedinUrl = li;
  const city = field(person.city as string | undefined);
  if (city) fields.city = city;
  const industry = field(
    (person.companyIndustry || person.industry) as string | undefined,
  );
  if (industry) fields.industry = industry;
  const emp = person.companyEmployeeCount ?? person.employeeCount;
  if (typeof emp === "number" && Number.isFinite(emp)) {
    fields.employeeCount = field(emp)!;
  } else if (typeof emp === "string" && emp.trim()) {
    const n = Number(emp.replace(/,/g, ""));
    if (Number.isFinite(n)) fields.employeeCount = field(n)!;
  }
  const desc = field(
    (person.companyDescription || person.description) as string | undefined,
    0.7,
  );
  if (desc) fields.companyDescription = desc;
  return fields;
}

const LEAD_ENRICH_OUTPUT_FIELDS = [
  "id",
  "firstName",
  "lastName",
  "jobTitle",
  "email",
  "phone",
  "mobilePhone",
  "companyName",
  "companyWebsite",
  "companyDomain",
  "companyIndustry",
  "industry",
  "companyEmployeeCount",
  "employeeCount",
  "companyDescription",
  "description",
  "city",
  "country",
  "externalUrls",
  "contactAccuracyScore",
];

/** Use every available lead identity signal in one ZoomInfo enrich request. */
export function zoominfoLeadEnrichmentParameters(
  input: Pick<
    LeadEnrichmentContext,
    "companyName" | "companyDomain" | "email" | "phone"
  >,
): Record<string, unknown> | null {
  const companyName = input.companyName?.trim() || null;
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  const storedDomain = input.companyDomain?.trim() || null;
  const derivedDomain = emailDomain(email);
  const companyWebsite =
    [storedDomain, derivedDomain]
      .map((value) =>
        (value ?? "")
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .split(/[/?#]/, 1)[0],
      )
      .find((value) => value && !isFreeMailDomain(value)) || null;

  if (!companyName && !companyWebsite && !email && !phone) return null;

  return {
    outputFields: LEAD_ENRICH_OUTPUT_FIELDS,
    ...(companyName ? { companyName } : {}),
    ...(companyWebsite ? { companyWebsite } : {}),
    ...(email ? { emailAddress: email } : {}),
    ...(phone ? { phone } : {}),
  };
}

/**
 * Automatic pipeline lookup only. It does not claim or finish the CRM job;
 * the lead-enrichment worker owns those state transitions.
 */
export async function lookupLeadEnrichmentViaZoominfo(
  context: LeadEnrichmentContext,
): Promise<{
  payload: LeadEnrichmentPayload;
  requestId: string | null;
  summary: string;
} | null> {
  if (!isZoominfoGatewayConfigured()) return null;
  const parameters = zoominfoLeadEnrichmentParameters(context);
  if (!parameters) return null;

  try {
    const identityFingerprint = createHash("sha256")
      .update(JSON.stringify(parameters))
      .digest("hex")
      .slice(0, 20);
    const { requestId, data } = await callZoominfoGatewayTool({
      organizationId: context.organizationId,
      toolName: "enrich_contacts",
      parameters,
      idempotencyKey: `crm-auto-enrich-zi-${context.contactId}-${identityFingerprint}`,
    });
    const person = pickContactBlock(data);
    if (!person) return null;
    const fields = mapToEnrichmentFields(person);
    if (Object.keys(fields).length === 0) return null;
    return {
      payload: {
        contactId: context.contactId,
        fields,
        status: "enriched",
        reason: "zoominfo_gateway",
      },
      requestId,
      summary: buildSummary(person),
    };
  } catch (err) {
    console.warn(
      "[zoominfo] automatic lead enrich failed; using existing enrichment fallback",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function enrichContactViaZoominfo(input: {
  organizationId: string;
  contactId: string;
  /** Optional ZoomInfo person id from prior search */
  personId?: string | null;
  actorUserId?: string | null;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  requestId?: string | null;
  summary?: string | null;
}> {
  if (!isZoominfoGatewayConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: "ZoomInfo gateway is not configured.",
    };
  }

  const contact = await getContact(input.contactId);
  if (!contact) {
    return { ok: false, reason: "Contact not found." };
  }

  const personView = contact.person;
  const email = personView.email?.trim() || null;
  const phone = personView.phone?.trim() || null;
  const personId = input.personId?.trim() || null;
  if (!personId && !email && !phone) {
    return {
      ok: false,
      reason: "Need email, phone, or ZoomInfo person id to enrich.",
    };
  }

  const job = await upsertEnrichmentJob({
    organizationId: input.organizationId,
    contactId: input.contactId,
    companyId: personView.companyId,
  });
  await updateEnrichmentJob(job.id, {
    status: "running",
    attempts: Math.max(1, job.attempts + 1),
  });
  publishEnrichmentEvent({
    contactId: input.contactId,
    status: "running",
    lastError: null,
  });

  const parameters: Record<string, unknown> = {
    outputFields: LEAD_ENRICH_OUTPUT_FIELDS,
  };
  if (personId) parameters.personId = personId;
  else if (email) parameters.emailAddress = email;
  else if (phone) parameters.phone = phone;

  try {
    const { requestId, data } = await callZoominfoGatewayTool({
      organizationId: input.organizationId,
      toolName: "enrich_contacts",
      parameters,
      idempotencyKey: `crm-enrich-zi-${input.contactId}-${personId || email || phone}`,
    });

    const person = pickContactBlock(data);
    if (!person) {
      await updateEnrichmentJob(job.id, {
        status: "failed",
        lastError: "ZoomInfo enrich returned no contact payload",
        completedAt: new Date(),
      });
      publishEnrichmentEvent({
        contactId: input.contactId,
        status: "failed",
        lastError: "empty_enrich_payload",
      });
      return {
        ok: false,
        reason: "ZoomInfo returned no contact data.",
        requestId,
      };
    }

    const fields = mapToEnrichmentFields(person);
    const summary = buildSummary(person);

    const payload: LeadEnrichmentPayload = {
      contactId: input.contactId,
      fields,
      status: "enriched",
      reason: "zoominfo_gateway",
    };
    await persistLeadEnrichment(payload, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
    });

    const patch: {
      firstName?: string;
      lastName?: string;
      title?: string | null;
      email?: string;
      phone?: string | null;
    } = {};
    const fn = String(person.firstName || "").trim();
    const ln = String(person.lastName || "").trim();
    if (fn && !personView.firstName?.trim()) patch.firstName = fn;
    if (ln && !personView.lastName?.trim()) patch.lastName = ln;
    const title = String(person.jobTitle || "").trim();
    if (title && !personView.title?.trim()) patch.title = title;
    const ziEmail = String(person.email || "").trim();
    if (ziEmail && !personView.email?.trim()) patch.email = ziEmail;
    const ziPhone = String(person.phone || person.mobilePhone || "").trim();
    if (ziPhone && !personView.phone?.trim()) patch.phone = ziPhone;
    if (Object.keys(patch).length > 0) {
      await updateContact(input.contactId, patch).catch(() => undefined);
    }

    await upsertLeadEnrichmentSnapshot({
      organizationId: input.organizationId,
      contactId: input.contactId,
      companyName: String(person.companyName || "").trim() || null,
      industry:
        String(person.companyIndustry || person.industry || "").trim() || null,
      geography: String(person.city || person.country || "").trim() || null,
      enrichmentSource: "zoominfo",
      enrichmentConfidence: 0.85,
      conflictFlags: {
        requestId,
        gateway: true,
        summary,
      },
    }).catch(() => undefined);

    await updateEnrichmentJob(job.id, {
      status: "enriched",
      lastError: null,
      completedAt: new Date(),
      resultSummary: { summary, requestId, provider: "zoominfo" },
    });
    publishEnrichmentEvent({
      contactId: input.contactId,
      status: "enriched",
      lastError: null,
      resultSummary: { summary, requestId },
    });

    return { ok: true, requestId, summary };
  } catch (err) {
    if (isZoominfoOrgSkipError(err)) {
      const skipMsg =
        err instanceof ZoominfoGatewayRequestError
          ? err.message
          : "ZoomInfo not connected for this organization.";
      await updateEnrichmentJob(job.id, {
        status: "skipped",
        lastError: skipMsg,
        completedAt: new Date(),
      });
      publishEnrichmentEvent({
        contactId: input.contactId,
        status: "skipped",
        lastError: skipMsg,
      });
      return {
        ok: false,
        skipped: true,
        reason: skipMsg,
      };
    }
    const message = err instanceof Error ? err.message : "zoominfo_enrich_failed";
    await updateEnrichmentJob(job.id, {
      status: "failed",
      lastError: message,
      completedAt: new Date(),
    });
    publishEnrichmentEvent({
      contactId: input.contactId,
      status: "failed",
      lastError: message,
    });
    return { ok: false, reason: message };
  }
}

/** Enrich at most one ZoomInfo prospect candidate (credit-safe). */
export async function enrichProspectCandidateViaZoominfo(input: {
  organizationId: string;
  personId: string;
  idempotencyKey: string;
}): Promise<Record<string, unknown> | null> {
  if (!isZoominfoGatewayConfigured()) return null;
  try {
    const { data } = await callZoominfoGatewayTool({
      organizationId: input.organizationId,
      toolName: "enrich_contacts",
      parameters: {
        personId: input.personId,
        outputFields: [
          "id",
          "firstName",
          "lastName",
          "jobTitle",
          "email",
          "phone",
          "mobilePhone",
          "companyName",
          "externalUrls",
          "contactAccuracyScore",
        ],
      },
      idempotencyKey: input.idempotencyKey,
    });
    return pickContactBlock(data);
  } catch (err) {
    console.warn(
      "[zoominfo] prospect enrich failed",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
