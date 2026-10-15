/**
 * ZoomInfo contact search via the Worktual gateway.
 * Search is free. Email is filled later by enrich (1 credit) on import.
 */

import type { ProspectCriteria } from "@/dao/ai/prospect-pull-store";
import {
  callZoominfoGatewayTool,
  ZoominfoGatewayRequestError,
} from "@/service/zoominfo/zoominfo-gateway";

export function zoominfoSearchFailureMessage(err: unknown): string {
  if (err instanceof ZoominfoGatewayRequestError) {
    if (err.code === "CONNECTED_APP_NOT_FOUND") {
      return "ZoomInfo is not connected for this organization. Connect ZoomInfo, then try the pull again.";
    }
    if (err.code === "CONNECTED_APP_NEEDS_REAUTH") {
      return "ZoomInfo needs to be reconnected before leads can be pulled.";
    }
    if (err.code === "GATEWAY_NOT_CONFIGURED" || err.code === "INVALID_ORGANIZATION") {
      return "ZoomInfo gateway is not configured for this CRM.";
    }
    const detail = err.message?.trim();
    return detail
      ? `ZoomInfo search failed: ${detail}`
      : "ZoomInfo search failed.";
  }
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return "ZoomInfo search failed.";
}

/** Structured filters only. A sentence like "searching for our products" is not a company name. */
export function zoominfoSearchParameters(
  criteria: ProspectCriteria | null | undefined,
  limit: number,
  page = 1,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    pageSize: Math.max(1, Math.min(25, Math.floor(limit) || 1)),
    page: Math.max(1, Math.floor(page) || 1),
  };
  const titles = (criteria?.titles ?? []).map((t) => t.trim()).filter(Boolean);
  const industries = (criteria?.industries ?? [])
    .map((t) => t.trim())
    .filter(Boolean);
  const geos = (criteria?.geos ?? []).map((t) => t.trim()).filter(Boolean);
  if (titles.length === 1) params.jobTitle = titles[0];
  else if (titles.length > 1) params.jobTitle = titles;
  if (industries.length === 1) params.industry = industries[0];
  else if (industries.length > 1) params.industry = industries;
  if (geos.length === 1) params.country = geos[0];
  else if (geos.length > 1) params.country = geos;

  const free = (criteria?.freeText || "").trim();
  if (free && !params.jobTitle && !params.companyName && looksLikeCompany(free)) {
    params.companyName = free.slice(0, 120);
  }
  if (!params.jobTitle && !params.companyName && !params.industry && !params.country) {
    params.jobTitle = "Manager";
  }
  return params;
}

function looksLikeCompany(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (text.length > 60) return false;
  return !/\b(lead|leads|searching|research|product|products|prospect|import|pull)\b/i.test(
    text,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function zoominfoSearchRows(data: Record<string, unknown>): unknown[] {
  const inner = data.data;
  if (Array.isArray(inner)) return inner;
  const nested = asRecord(inner);
  if (nested && Array.isArray(nested.data)) return nested.data;
  if (Array.isArray(data.raw)) return data.raw;
  return [];
}

export function mapZoominfoSearchRow(row: unknown): Record<string, unknown> | null {
  const record = asRecord(row);
  if (!record) return null;
  const attrs = asRecord(record.attributes) ?? record;
  const company = asRecord(attrs.company);
  const personId = record.id ?? attrs.id;
  const employee = attrs.companyEmployeeCount ?? company?.employeeCount;
  return {
    firstName: str(attrs.firstName) ?? str(attrs.firstname),
    lastName: str(attrs.lastName) ?? str(attrs.lastname),
    email: str(attrs.email) ?? str(attrs.emailAddress),
    phone: str(attrs.phone) ?? str(attrs.mobilePhone) ?? str(attrs.directPhone),
    title: str(attrs.jobTitle) ?? str(attrs.title),
    companyName:
      str(company?.name) ?? str(attrs.companyName) ?? str(attrs.company_name),
    companyDomain: str(attrs.companyWebsite) ?? str(company?.website),
    industry:
      str(attrs.companyIndustry) ?? str(attrs.industry) ?? str(company?.industry),
    employeeCount: typeof employee === "number" ? employee : null,
    city: str(attrs.city),
    country: str(attrs.country),
    sourcesFoundIn: ["zoominfo"],
    providerPayload: {
      zoominfoId: personId != null ? String(personId) : null,
      contactAccuracyScore: attrs.contactAccuracyScore ?? null,
    },
  };
}

export async function searchZoominfoContacts(input: {
  organizationId: string;
  criteria?: ProspectCriteria | null;
  limit: number;
  page?: number;
}): Promise<Record<string, unknown>[]> {
  const { data } = await callZoominfoGatewayTool({
    organizationId: input.organizationId,
    toolName: "search_contacts",
    parameters: zoominfoSearchParameters(
      input.criteria,
      input.limit,
      input.page,
    ),
  });
  const limit = Math.max(1, Math.min(25, Math.floor(input.limit) || 1));
  const rows = zoominfoSearchRows(data);
  const mapped: Record<string, unknown>[] = [];
  for (const row of rows) {
    const candidate = mapZoominfoSearchRow(row);
    if (!candidate) continue;
    mapped.push(candidate);
    if (mapped.length >= limit) break;
  }
  return mapped;
}
