import { api } from "./api";
import type { ContactInput } from "./contact-types";
import type { ComposeContactOption } from "@/components/email/types";

export type ContactListItem = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  companyName: string | null;
  contactType: string | null;
  leadStatus: string;
  status: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  ownerName: string | null;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext?: boolean;
  hasPrev?: boolean;
};

/** First paint and each later page of the Contacts screen. */
export const CONTACT_LIST_PAGE_SIZE = 20;

export type ContactListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  contactType?: string;
  leadStatus?: string;
  status?: string;
  location?: string;
  leadSource?: string;
  owner?: string;
  company?: string;
  email?: string;
  phone?: string;
  createdOn?: string;
};

export async function fetchContactsPage(params: ContactListQuery) {
  const { data } = await api.get<{
    ok: true;
    items: ContactListItem[];
    pagination: PaginationMeta;
    showOwner: boolean;
    businessType: "b2b" | "b2c" | "b2b2c";
  }>("/api/contacts", { params });
  return data;
}

export type ContactActivityDetail = {
  id: string;
  contactId: string;
  type: "note" | "task" | "call" | "email" | "meeting" | "sms" | "other";
  folder: "inbox" | "sent" | "draft" | "trash";
  threadId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  emailDirection: "outbound" | "inbound" | null;
  subject: string;
  body: string | null;
  dueAt: string | null;
  assigneeUserId: string | null;
  taskStatus: "open" | "in_progress" | "completed" | null;
  completedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  transcriptText?: string | null;
  transcriptSource?: string | null;
  disposition?: string | null;
};

export type RelatedDealActivity = {
  id: string;
  dealId: string;
  dealTitle: string;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  createdAt: string;
};

export type DuplicateCandidateView = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  city: string | null;
  contactType: string;
  confidence: number;
  reasons: Array<{ code: string; label: string; weight: number }>;
  updatedAt: string;
};

export type ContactDetailView = {
  id: string;
  displayName: string;
  person: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    title: string | null;
    companyId: string | null;
    locationId: string | null;
    company?: { id: string; name: string } | null;
    contactType: string | null;
    leadStatus: string;
    status: string | null;
    notes: string | null;
    ownerUserId: string | null;
    addressLine: string | null;
    city: string | null;
    country: string | null;
    leadSource: string | null;
    tags: string[];
    isPinned?: boolean;
    secondaryEmails?: string[];
    secondaryPhones?: string[];
    convertedDealId?: string | null;
    disqualifyReason?: string | null;
    bantBudget?: boolean | null;
    bantAuthority?: boolean | null;
    bantNeed?: boolean | null;
    bantTimeline?: boolean | null;
    bantBudgetDetail?: string | null;
    bantAuthorityDetail?: string | null;
    bantNeedDetail?: string | null;
    bantTimelineDetail?: string | null;
    updatedAt?: string;
    createdAt?: string;
  };
  crm: {
    status: string | null;
    ownerUserId: string | null;
    leadSource?: string | null;
    notes?: string | null;
  };
};

export async function fetchContactDetail(id: string) {
  const { data } = await api.get(`/api/contacts/${id}`);
  return data as
    | {
        ok: true;
        contact: ContactDetailView;
        activities: ContactActivityDetail[];
        relatedDeals: Array<{
          id: string;
          title: string;
          stage: string;
          amount: string | null;
          updatedAt: string;
          company: { id: string; name: string } | null;
        }>;
        relatedDealActivities: RelatedDealActivity[];
        orders: Array<Record<string, unknown>>;
        assignableUsers: Array<{ id: string; label: string }>;
        currentUserId: string | null;
        canAssignAssignee: boolean;
        showConvert: boolean;
        showCompany: boolean;
        showSales: boolean;
        showCommerce: boolean;
        businessType: "b2b" | "b2c" | "b2b2c";
        canAssignOwner: boolean;
        ownerLabels: Record<string, string>;
        companySnapshot: Record<string, unknown> | null;
        companyLocation: Record<string, unknown> | null;
        duplicateInfo: {
          seed: DuplicateCandidateView | null;
          duplicates: DuplicateCandidateView[];
          recommendedPrimaryId: string | null;
        };
        enrichmentStatus: Record<string, unknown> | null;
        nurtureStatus: Record<string, unknown> | null;
        lifecycleStatus: Record<string, unknown> | null;
        companySize?: string | null;
        utmSource?: string | null;
        leadScore?: {
          status: string | null;
          score: number | null;
          fitScore: number | null;
          intentScore: number | null;
          previousScore: number | null;
          grade: string | null;
          band: string | null;
          rationale: string | null;
          updatedAt: string | null;
        } | null;
      }
    | { ok: false; error: string };
}

export type AgentStepDto = {
  step: string;
  label: string;
  status: "started" | "ok" | "failed" | "skipped";
  detail?: unknown;
  errorReason?: string | null;
  startedAt: string;
  endedAt: string | null;
};

/** Curated step trace for the latest lead-enrichment run — on-demand fetch. */
export async function fetchEnrichmentSteps(contactId: string) {
  const { data } = await api.get<{
    ok: true;
    jobId?: string;
    steps: AgentStepDto[];
  }>(`/api/contacts/${contactId}/enrichment/steps`);
  return { jobId: data.jobId ?? null, steps: data.steps ?? [] };
}

/** Manual ZoomInfo enrich via Worktual gateway (1 data credit). */
export async function enrichContactViaZoominfo(
  contactId: string,
  body?: { personId?: string },
) {
  const { data } = await api.post<{
    ok: boolean;
    summary?: string | null;
    requestId?: string | null;
    error?: string;
  }>(`/api/contacts/${contactId}/enrichment/zoominfo`, body ?? {});
  return data;
}

export async function fetchContactFormOptions(id?: string) {
  const url = id
    ? `/api/contacts/${id}/form-options`
    : "/api/contacts/form-options";
  const { data } = await api.get(url);
  return data as {
    ok: true;
    contact: {
      id: string;
      displayName: string;
      person: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string | null;
        title: string | null;
        companyId: string | null;
        locationId: string | null;
        companyName?: string | null;
        contactType: string | null;
        leadStatus: string;
        status: string | null;
        notes: string | null;
        ownerUserId: string | null;
        addressLine: string | null;
        city: string | null;
        country: string | null;
        leadSource: string | null;
        tags: string[];
        secondaryEmails?: string[];
        secondaryPhones?: string[];
        bantBudget?: boolean;
        bantAuthority?: boolean;
        bantNeed?: boolean;
        bantTimeline?: boolean;
        bantBudgetDetail?: string | null;
        bantAuthorityDetail?: string | null;
        bantNeedDetail?: string | null;
        bantTimelineDetail?: string | null;
        company?: { id: string; name: string } | null;
        customAttributes?: Record<string, unknown>;
      };
      crm: { status: string | null; ownerUserId: string | null };
    } | null;
    businessType: "b2b" | "b2c" | "b2b2c";
    canAssignOwner: boolean;
    currentUserRole?: string;
    currentUserId: string | null;
    vertical?: string;
    contactVerticalFields?: Array<{
      key: string;
      label: string;
      type: string;
      required?: boolean;
      placeholder?: string;
    }>;
    assignableUsers: Array<{ id: string; label: string; role?: string }>;
    companies: Array<{
      id: string;
      name: string;
      industry: string | null;
      ownerUserId: string | null;
      locations: Array<{
        id: string;
        name: string;
        type: string;
        ownerUserId: string | null;
      }>;
    }>;
  };
}

export async function findContactDuplicates(input: {
  excludeContactId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  city?: string | null;
}) {
  const { data } = await api.post("/api/contacts/duplicates/find", input);
  return data as
    | { ok: true; duplicates: DuplicateCandidateView[] }
    | { ok: false; error: string };
}

export async function createContact(input: ContactInput) {
  const { data } = await api.post<{ ok: true; id: string } | { ok: false; error: string }>(
    "/api/contacts",
    input,
  );
  return data;
}

export async function updateContact(id: string, input: ContactInput) {
  const { data } = await api.patch<{ ok: true; id: string } | { ok: false; error: string }>(
    `/api/contacts/${id}`,
    input,
  );
  return data;
}

export async function deleteContact(id: string) {
  const { data } = await api.delete<{ ok: true; id: string } | { ok: false; error: string }>(
    `/api/contacts/${id}`,
  );
  return data;
}

export async function setContactPinned(id: string, isPinned: boolean) {
  const { data } = await api.post<{ ok: true; id: string } | { ok: false; error: string }>(
    `/api/contacts/${id}/pin`,
    { isPinned },
  );
  return data;
}

export async function convertLead(
  id: string,
  body?: { dealTitle?: string; amount?: number | null },
) {
  const { data } = await api.post(`/api/contacts/${id}/convert`, body ?? {});
  return data as
    | { ok: true; dealId: string; alreadyConverted: boolean }
    | { ok: false; error: string };
}

export async function importContactsCsv(input: {
  csvText: string;
  dryRun?: boolean;
}) {
  const { data } = await api.post("/api/contacts/import", input);
  return data as
    | {
        ok: true;
        dryRun: boolean;
        parsed: number;
        created: number;
        updated: number;
        skipped: number;
        errors: Array<{
          row: number;
          message: string;
          email?: string;
          displayName?: string;
        }>;
        duplicates: Array<{
          row: number;
          email: string;
          phone?: string | null;
          displayName: string;
          reason: string;
        }>;
      }
    | { ok: false; error: string };
}

export type ProspectPullCandidate = {
  id: string;
  rank: number | null;
  selected: boolean;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  industry: string | null;
  employeeCount: number | null;
  city: string | null;
  country: string | null;
  technographics: unknown;
  sourcesFoundIn: string[];
  qualifyReasons: unknown;
  qualifyScore: number | null;
  importedContactId: string | null;
};

export async function startProspectPull(input: {
  limit?: number;
  sources?: string[];
  criteria?: Record<string, unknown>;
}) {
  const { data } = await api.post("/api/contacts/prospect-pull", input);
  return data as
    | {
        ok: true;
        jobId: string;
        status: string;
        limit: number;
        sourcesRequested: string[];
      }
    | { ok: false; error: string };
}

export async function getProspectPull(jobId: string) {
  const { data } = await api.get(`/api/contacts/prospect-pull/${jobId}`);
  return data as
    | {
        ok: true;
        job: {
          id: string;
          status: string;
          limitN: number;
          sourcesRequested: string[];
          sourcesUsed: string[] | null;
          lastError: string | null;
          resultSummary?: { skippedExisting?: number } | null;
        };
        candidates: ProspectPullCandidate[];
      }
    | { ok: false; error: string };
}

export async function importProspectPull(
  jobId: string,
  selectedIds?: string[],
) {
  const { data } = await api.post(
    `/api/contacts/prospect-pull/${jobId}/import`,
    { selectedIds },
  );
  return data as
    | {
        ok: true;
        imported: Array<{ candidateId: string; contactId: string }>;
        skipped: number;
        message: string;
      }
    | { ok: false; error: string };
}

export async function exportContacts(
  params: Omit<ContactListQuery, "page" | "pageSize"> & { format?: string },
) {
  const { data } = await api.get("/api/contacts/export", { params });
  return data as
    | {
        ok: true;
        content: string;
        filename: string;
        mimeType: string;
        count: number;
        truncated: boolean;
      }
    | { ok: false; error: string };
}

export async function createContactActivity(
  contactId: string,
  body: {
    type: string;
    subject: string;
    body?: string | null;
    dueAt?: string | null;
    assigneeUserId?: string | null;
    folder?: "inbox" | "sent" | "draft" | "trash";
    gmailMessageId?: string | null;
    gmailThreadId?: string | null;
    rfcMessageId?: string | null;
    emailDirection?: "outbound" | "inbound" | null;
  },
) {
  const { data } = await api.post(
    `/api/contacts/${contactId}/activities`,
    body,
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export type MergeContactSnapshot = {
  id: string;
  displayName: string;
  values: Record<string, string | null>;
  secondaryEmails: string[];
  secondaryPhones: string[];
  companyName: string | null;
  related: {
    deals: number;
    activities: number;
    orders: number;
    emails: number;
    calls: number;
    tasks: number;
  };
};

export type MergePreview = {
  contacts: MergeContactSnapshot[];
  recommendedPrimaryId: string;
  suggestedFieldSources: Record<string, string>;
  totalRelated: { deals: number; activities: number; orders: number };
};

export async function previewMerge(contactIds: string[]) {
  const { data } = await api.post("/api/contacts/merge/preview", { contactIds });
  const body = data as
    | ({ ok: true } & MergePreview)
    | ({ ok: true; preview: MergePreview })
    | { ok: false; error: string };
  if (!body || typeof body !== "object") {
    return { ok: false as const, error: "Invalid merge preview response." };
  }
  if (!body.ok) return body;
  if ("preview" in body && body.preview && typeof body.preview === "object") {
    return { ok: true as const, ...body.preview };
  }
  return body as { ok: true } & MergePreview;
}

export async function executeMerge(input: {
  primaryContactId: string;
  duplicateContactIds: string[];
  fieldSources: Record<string, string>;
}) {
  const { data } = await api.post("/api/contacts/merge/execute", input);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function updateTaskStatus(
  activityId: string,
  taskStatus: "open" | "in_progress" | "completed" | "cancelled",
) {
  const { data } = await api.patch(
    `/api/contacts/activities/${activityId}/status`,
    { taskStatus },
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function deleteActivity(contactId: string, activityId: string) {
  const { data } = await api.delete(
    `/api/contacts/${contactId}/activities/${activityId}`,
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function searchContactsForCompose(query?: string) {
  const { data } = await api.get<{ ok: true; items: ComposeContactOption[] }>(
    "/api/contacts/search-compose",
    { params: { q: query } },
  );
  return data.items;
}

export async function searchMeetingParticipants(query?: string) {
  const { data } = await api.get<{
    ok: true;
    items: Array<{
      id: string;
      displayName: string;
      email: string;
      detail: string;
    }>;
  }>("/api/contacts/search-meeting-participants", { params: { q: query } });
  return data.items;
}

export async function listTaskFormOptions() {
  const { data } = await api.get<{
    ok: true;
    users: Array<{ id: string; label: string }>;
    currentUserId: string | null;
    canAssignAssignee: boolean;
  }>("/api/contacts/task-options");
  return data;
}
