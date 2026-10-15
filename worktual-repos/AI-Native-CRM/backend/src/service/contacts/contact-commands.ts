 /**
 * Framework-agnostic contact mutations (no next/cache).
 * Used by Fastify strangler routes; mirrors Next server actions.
 */

import type { ActivityType, TaskStatus } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { CONTACT_LIST_PAGE_SIZE } from "@/lib/pagination";
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  setContactPinned,
  updateContact,
  type ContactInput,
  type ContactStatus,
  type ContactView,
  type ContactType,
} from "@/dao/contacts/contact-service";
import { backfillCompanyOwnerFromContact } from "@/dao/companies/company-owner-backfill";
import { upsertLeadContact } from "@/dao/contacts/inbound-lead-upsert";
import { onLeadCreated } from "@/service/ai/lead-pipeline";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
import { findScoringJobByContactId } from "@/dao/ai/lead-scoring-store";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import { notifyCustomerOfOwnerChangeAsync } from "@/service/contacts/owner-change-notify";
import { isSalesRepRoleName } from "@/dao/sales/territory-assignment";
import { accountQuery } from "@/dao/db/account-pool";
import { loadFirstTouchAttribution } from "@/service/contacts/customer-360";
import { beginLeadOwnerFollowup } from "@/service/ai/lead-assignment-followup";
import { userFacingCommandError } from "@/helpers/user-facing-error";
import {
  createContactActivity,
  deleteContactActivity,
  listContactActivities,
  updateTaskStatus,
  type ContactActivityInput,
} from "@/dao/contacts/contact-activity-service";
import type { LeadStatus } from "@/service/account/types";
import {
  normalizeContactTypeFilter,
  normalizeLeadStatusFilter,
} from "@/dao/contacts/contact-list-search";
import { ACTIVITY_TYPES } from "@/service/sales/stages";
import { enforceContactCompanyForBusinessType } from "@/lib/contact-company-motion";
import { parseNoteBody } from "@/lib/note-body";
import { getServerUserId } from "@/service/account/session-cookie";
import { convertLeadToDeal } from "@/dao/sales/convert-lead";
import { ensureContactInSalesPipeline } from "@/dao/sales/contact-pipeline-sync";
import {
  findDuplicateContacts,
  findDuplicatesForContactId,
} from "@/dao/contacts/contact-duplicate-service";
import {
  buildMergePreview,
  executeContactMerge,
} from "@/dao/contacts/contact-merge-service";
import {
  canAssignContactOwner,
  canAssignTaskAssignee,
  canConvertLeads,
  canEditContacts,
} from "@/service/auth/rbac";
import {
  ForbiddenError,
  getCurrentBusinessType,
  getCurrentOrganizationId,
  getCurrentUserRole,
  requireRole,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import {
  getUserLabelsByIds,
  listAssignableUsers,
  searchMeetingTeam,
} from "@/service/account/user-directory";
import { listCompaniesForSelect } from "@/dao/companies/company-service";
import { showConvertLeadCta, showCompanyOnContacts } from "@/lib/business-type-copy";
import {
  becameLead,
  isLeadPipelineStage,
  isSalesPipelineStage,
  resolveContactTypeForChannels,
} from "@/lib/contact-lifecycle";
import { assertRecordAccess, resolveRecordOwnerScope } from "@/service/auth/ownership-scope";
import { listOrdersForContact } from "@/dao/sales/order-service";
import {
  listActivitiesForDealIds,
  listDealsForContact,
} from "@/dao/sales/deal-service";
import {
  getCompanySnapshot,
  getCompanyLocationSummary,
} from "@/dao/companies/sync-from-contacts";
import { getLeadEnrichmentStatus } from "@/service/ai/lead-enrichment-job";
import { findLeadEnrichmentSnapshot } from "@/dao/ai/lead-enrichment-snapshot";
import { getLeadNurtureStatus } from "@/service/ai/lead-nurture-job";
import { getLeadLifecycleStatus } from "@/service/ai/lead-lifecycle-job";
import { isModuleEnabledForAccess, isModuleEnabledForType } from "@/config/modules";
import {
  formatLeadStatus,
  formatContactType,
  formatStatus,
} from "@/lib/contact-labels";
import { buildExportFile, type ContactExportFormat } from "@/lib/csv";

export type CommandResult =
  | {
      ok: true;
      id: string;
      merged?: boolean;
      displayName?: string;
      matchReasons?: string[];
    }
  | { ok: false; error: string };

export type ContactListPageItem = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  companyName: string | null;
  contactType: string | null;
  leadStatus: LeadStatus;
  status: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  ownerName: string | null;
};

const VALID_LEAD_STATUSES = new Set([
  "new",
  "contacted",
  "qualifying",
  "qualified",
  "disqualified",
  "converted",
]);

function validate(input: ContactInput): string | null {
  if (!input.firstName.trim()) return "First name is required.";
  const email = (input.email ?? "").trim();
  const phone = (input.phone ?? "").trim();
  if (!email && !phone) {
    return "Email or phone number is required.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  if (
    input.leadStatus !== undefined &&
    !VALID_LEAD_STATUSES.has(String(input.leadStatus))
  ) {
    return "Invalid lead status. A numeric lead score must use the lead score action.";
  }
  if (
    !input.companyId &&
    typeof input.companyName === "string" &&
    !input.companyName.trim()
  ) {
    return "Company name is required when creating a new company.";
  }
  return null;
}

async function resolveOwnerFromCompanyLocation(
  companyId: string | null | undefined,
  locationId: string | null | undefined,
): Promise<string | null> {
  const locId = locationId?.trim() || null;
  const coId = companyId?.trim() || null;
  if (locId) {
    const location = await prisma.companyLocation.findUnique({
      where: { id: locId },
      select: {
        ownerUserId: true,
        companyId: true,
        company: { select: { ownerUserId: true } },
      },
    });
    if (location) {
      return (
        location.ownerUserId?.trim() ||
        location.company.ownerUserId?.trim() ||
        null
      );
    }
  }
  if (coId) {
    const company = await prisma.company.findUnique({
      where: { id: coId },
      select: { ownerUserId: true },
    });
    return company?.ownerUserId?.trim() || null;
  }
  return null;
}

async function ownerIsSalesRep(userId: string): Promise<boolean> {
  const { rows } = await accountQuery<{ role: string | null }>(
    `SELECT lower(r.name) AS role
     FROM accounts.setup_users u
     LEFT JOIN accounts.setup_user_product_access a
       ON a.user_id = u.id AND a.product_id = 'crm'
     LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE u.id = $1::bigint
       AND u.status = 'active'
     LIMIT 1`,
    [userId],
  );
  return isSalesRepRoleName(rows[0]?.role);
}

function leadOwnerChangeError(input: {
  previousOwnerUserId: string | null;
  nextOwnerUserId: string | null;
  reason: string | null | undefined;
}): string | null {
  if (input.previousOwnerUserId === input.nextOwnerUserId) return null;
  if ((input.reason?.trim().length ?? 0) < 3) {
    return "A reason is required to assign or reassign a lead.";
  }
  return null;
}

async function resolveContactOwnerUserId(
  requested: string | null,
  existingOwnerId: string | null | undefined,
  mode: "create" | "update",
): Promise<string | null> {
  const role = await getCurrentUserRole();
  const selfId = await getServerUserId();
  const ownerId = requested?.trim() || null;

  if (!canAssignContactOwner(role)) {
    if (ownerId && selfId && ownerId === selfId) return ownerId;
    if (ownerId) {
      const assignable = await listAssignableUsers();
      if (assignable.some((u) => u.id === ownerId)) return ownerId;
    }
    if (mode === "create") return ownerId ?? selfId;
    return existingOwnerId ?? ownerId ?? selfId;
  }

  if (!ownerId) {
    return mode === "create" ? selfId : (existingOwnerId ?? selfId);
  }

  if (selfId && ownerId === selfId) return ownerId;

  const assignable = await listAssignableUsers();
  if (!assignable.some((u) => u.id === ownerId)) {
    throw new ForbiddenError(
      "Selected owner is not a sales user in your organization.",
    );
  }
  return ownerId;
}

function mapListItems(
  contacts: ContactView[],
  ownerLabels: Map<string, string> | null,
  effectiveOwnerByContactId?: Map<string, string>,
): ContactListPageItem[] {
  return contacts.map((contact) => {
    const ownerId =
      effectiveOwnerByContactId?.get(contact.id) ??
      contact.crm.ownerUserId ??
      null;
    return {
      id: contact.id,
      displayName: contact.displayName,
      email: contact.person.email,
      phone: contact.person.phone,
      title: contact.person.title,
      companyId: contact.person.companyId ?? contact.person.company?.id ?? null,
      companyName: contact.person.company?.name ?? null,
      contactType: contact.person.contactType,
      leadStatus: contact.person.leadStatus,
      status: contact.crm.status,
      isPinned: contact.person.isPinned,
      createdAt: contact.person.createdAt.toISOString(),
      updatedAt: contact.person.updatedAt.toISOString(),
      ownerName:
        ownerLabels && ownerId ? (ownerLabels.get(ownerId) ?? null) : null,
    };
  });
}

/**
 * Contact Owner for list/export = CRM profile owner only.
 * Company owner is account relationship, not lead assignment — never fill it in here.
 */
async function effectiveOwnerIdsForContacts(
  contacts: ContactView[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const c of contacts) {
    const ownerId = c.crm.ownerUserId?.trim();
    if (ownerId) out.set(c.id, ownerId);
  }
  return out;
}

export type ComposeContactOption = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
};

/** Small contact lookup for compose/recipient fields (email, phone, meeting participants). */
export async function searchContactsForComposeCommand(
  query?: string,
): Promise<ComposeContactOption[]> {
  const scope = await resolveRecordOwnerScope();
  const result = await listContacts({
    search: query?.trim() || undefined,
    page: 1,
    pageSize: 8,
    status: "active",
    ownerUserId: scope.ownerUserId,
    channelCompanyIds: scope.channelCompanyIds,
  });

  return result.items.map((contact) => ({
    id: contact.id,
    displayName: contact.displayName,
    email: contact.person.email,
    phone: contact.person.phone,
  }));
}

export type MeetingParticipantOption = {
  id: string;
  displayName: string;
  email: string;
  detail: string;
};

/** Customers plus every CRM teammate for a meeting invite. */
export async function searchMeetingParticipantsCommand(
  query?: string,
): Promise<MeetingParticipantOption[]> {
  const [contacts, team] = await Promise.all([
    searchContactsForComposeCommand(query),
    searchMeetingTeam(query),
  ]);
  const seen = new Set<string>();
  const items: MeetingParticipantOption[] = [];
  for (const person of team) {
    const email = person.email.trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    items.push(person);
  }
  for (const contact of contacts) {
    const email = contact.email.trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    items.push({
      id: contact.id,
      displayName: contact.displayName,
      email,
      detail: "Customer",
    });
  }
  return items;
}

/** Options for task create forms (quick actions, pipeline, list). */
export async function listTaskFormOptionsCommand(): Promise<{
  users: Array<{ id: string; label: string }>;
  currentUserId: string | null;
  canAssignAssignee: boolean;
}> {
  const [assignable, currentUserId, role] = await Promise.all([
    listAssignableUsers(),
    getServerUserId(),
    getCurrentUserRole(),
  ]);
  return {
    users: assignable.map((u) => ({ id: u.id, label: u.label })),
    currentUserId,
    canAssignAssignee: canAssignTaskAssignee(role),
  };
}

type ContactListQuery = {
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

function contactListFilters(filters: ContactListQuery) {
  const contactType = normalizeContactTypeFilter(filters.contactType);
  const leadStatus = normalizeLeadStatusFilter(filters.leadStatus);
  return {
    search: filters.search,
    contactType: (contactType ?? "all") as ContactType | "all",
    leadStatus: (leadStatus ?? "all") as LeadStatus | "all",
    status: (filters.status ?? "all") as ContactStatus | "all" | "unknown",
    location: filters.location,
    leadSource: filters.leadSource,
    ownerName: filters.owner,
    company: filters.company,
    email: filters.email,
    phone: filters.phone,
    createdOn: filters.createdOn,
  };
}

export async function listContactsCommand(filters: ContactListQuery) {
  const [scope, businessType, role] = await Promise.all([
    resolveRecordOwnerScope(),
    getCurrentBusinessType(),
    getCurrentUserRole(),
  ]);
  const result = await listContacts({
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? CONTACT_LIST_PAGE_SIZE,
    ...contactListFilters(filters),
    ownerUserId: scope.ownerUserId,
    channelCompanyIds: scope.channelCompanyIds,
  });
  const effectiveOwners = await effectiveOwnerIdsForContacts(result.items);
  const ownerLabels =
    role === "admin"
      ? await getUserLabelsByIds([...effectiveOwners.values()])
      : null;
  return {
    items: mapListItems(result.items, ownerLabels, effectiveOwners),
    pagination: result.pagination,
    showOwner: role === "admin",
    businessType,
  };
}

async function assertContactAccess(contact: ContactView) {
  await assertRecordAccess(
    contact.crm.ownerUserId,
    undefined,
    contact.person.companyId,
    contact.crm.createdByUserId,
  );
}

export async function getContactCommand(id: string) {
  const contact = await getContact(id);
  if (!contact) return { ok: false as const, error: "Contact not found.", status: 404 };
  try {
    await assertContactAccess(contact);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false as const, error: err.message, status: 403 };
    }
    throw err;
  }

  const businessType = await getCurrentBusinessType();
  const role = await getCurrentUserRole();
  const showCompany = showCompanyOnContacts(businessType);
  const showCommerce = isModuleEnabledForType("commerce", businessType);
  const showSales = isModuleEnabledForAccess("sales", businessType, role);
  const companyId = contact.person.companyId;
  const locationId = contact.person.locationId;

  const [
    activities,
    orders,
    relatedDeals,
    assignableUsers,
    currentUserId,
    companySnapshot,
    companyLocation,
    duplicateInfo,
    enrichmentStatus,
    nurtureStatus,
    lifecycleStatus,
    companySize,
    leadScore,
    utmSource,
  ] = await Promise.all([
    listContactActivities(id),
    showCommerce ? listOrdersForContact(id) : Promise.resolve([]),
    showSales
      ? listDealsForContact(id, contact.person.convertedDealId)
      : Promise.resolve([]),
    listAssignableUsers(),
    getServerUserId(),
    showCompany && companyId
      ? getCompanySnapshot(companyId)
      : Promise.resolve(null),
    showCompany && companyId && locationId
      ? getCompanyLocationSummary(companyId, locationId)
      : Promise.resolve(null),
    findDuplicatesForContactId(id).catch(() => ({
      seed: null,
      duplicates: [],
      recommendedPrimaryId: null,
    })),
    getLeadEnrichmentStatus(id).catch(() => null),
    getLeadNurtureStatus(id).catch(() => null),
    getLeadLifecycleStatus(id).catch(() => null),
    companySizeBandForContact(id),
    storedLeadScore(id),
    firstTouchUtmSource(contact.person.organizationId, id),
  ]);

  const relatedDealActivities = showSales
    ? await listActivitiesForDealIds(relatedDeals.map((d) => d.id))
    : [];

  const ownerLabels = await getUserLabelsByIds([
    contact.crm.ownerUserId,
    companySnapshot?.ownerUserId ?? null,
    ...activities.map((a) => a.assigneeUserId),
  ]);

  // Labels for contact owner + company owner (secondary) + activity assignees.
  // Company owner is never treated as the contact Owner.
  for (const user of assignableUsers) {
    if (user.id && !ownerLabels.has(user.id)) {
      ownerLabels.set(user.id, user.name || user.label);
    }
  }

  return {
    ok: true as const,
    contact,
    activities,
    orders,
    relatedDeals,
    relatedDealActivities,
    assignableUsers: assignableUsers.map((u) => ({ id: u.id, label: u.label })),
    currentUserId,
    canAssignAssignee: canAssignTaskAssignee(role),
    canAssignOwner: canAssignContactOwner(role),
    showConvert: showConvertLeadCta(businessType),
    showCompany,
    showCommerce,
    showSales,
    businessType,
    companySnapshot,
    companyLocation,
    duplicateInfo,
    enrichmentStatus,
    nurtureStatus,
    lifecycleStatus,
    companySize,
    leadScore,
    utmSource,
    ownerLabels: Object.fromEntries(ownerLabels),
  };
}

async function firstTouchUtmSource(
  organizationId: string | null,
  contactId: string,
): Promise<string | null> {
  try {
    const orgId = organizationId?.trim() || (await getCurrentOrganizationId());
    const touch = await loadFirstTouchAttribution(orgId, contactId);
    return touch?.utmSource ?? null;
  } catch (err) {
    console.error("firstTouchUtmSource failed", contactId, err);
    return null;
  }
}

/** Last saved score, including the number kept while a rescore is running. */
async function storedLeadScore(contactId: string) {
  try {
    const job = await findScoringJobByContactId(contactId);
    if (!job) return null;
    const score = job.score ?? job.previousScore;
    if (score == null && job.previousScore == null) return null;
    return {
      status: job.status,
      score,
      fitScore: job.fitScore,
      intentScore: job.intentScore,
      previousScore: job.previousScore ?? job.score,
      grade: job.grade,
      band: job.band,
      rationale: job.rationale,
      updatedAt: job.updatedAt?.toISOString() ?? null,
    };
  } catch {
    return null;
  }
}

/** Size band already saved on the enrichment snapshot. No schema change. */
async function companySizeBandForContact(contactId: string): Promise<string | null> {
  try {
    const organizationId = await getCurrentOrganizationId();
    const snap = await findLeadEnrichmentSnapshot(organizationId, contactId);
    const raw = snap?.company_size;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export async function getContactFormOptionsCommand(id?: string) {
  await requireRole(
    canEditContacts,
    "You do not have permission to edit contacts.",
  );
  let contact: ContactView | null = null;
  if (id) {
    contact = await getContact(id);
    if (!contact) return { ok: false as const, error: "Contact not found." };
    await assertContactAccess(contact);
  }
  const [companies, assignableUsers, businessType, role, currentUserId, orgId] =
    await Promise.all([
      listCompaniesForSelect(),
      listAssignableUsers(),
      getCurrentBusinessType(),
      getCurrentUserRole(),
      getServerUserId(),
      getCurrentOrganizationId(),
    ]);
  const { getOrganizationProfile } = await import(
    "@/dao/org/organization-profile-store"
  );
  const { contactFieldsForVertical } = await import("@/lib/vertical-packs");
  const orgProfile = await getOrganizationProfile(orgId);
  return {
    ok: true as const,
    contact,
    businessType,
    canAssignOwner: canAssignContactOwner(role),
    currentUserRole: role,
    currentUserId,
    vertical: orgProfile.vertical,
    contactVerticalFields: contactFieldsForVertical(orgProfile.vertical),
    assignableUsers: assignableUsers.map((u) => ({
      id: u.id,
      label: u.label,
      role: u.role,
    })),
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      ownerUserId: c.ownerUserId,
      locations: c.locations.map((loc) => ({
        id: loc.id,
        name: loc.name,
        type: loc.type,
        ownerUserId: loc.ownerUserId,
      })),
    })),
  };
}

export async function createContactCommand(
  input: ContactInput,
  options?: { mergeDuplicates?: boolean },
): Promise<CommandResult> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to create contacts.",
    );
    const error = validate(input);
    if (error) return { ok: false, error };

    const businessType = await getCurrentBusinessType();
    const companyGate = enforceContactCompanyForBusinessType(businessType, input);
    if (!companyGate.ok) return { ok: false, error: companyGate.error };
    Object.assign(input, companyGate.input);

    const organizationId = await getCurrentOrganizationId();
    const { getOrganizationProfile } = await import(
      "@/dao/org/organization-profile-store"
    );
    const { sanitizeCustomAttributes } = await import("@/lib/vertical-packs");
    const orgProfile = await getOrganizationProfile(organizationId);
    input.customAttributes = sanitizeCustomAttributes(
      orgProfile.vertical,
      input.customAttributes ?? {},
    );

    const role = await getCurrentUserRole();
    const actorUserId = await getServerUserId();
    input.contactType = resolveContactTypeForChannels({
      requested: input.contactType,
      existing: "contact",
      email: input.email,
      phone: input.phone,
      secondaryEmails: input.secondaryEmails,
      secondaryPhones: input.secondaryPhones,
    });
    const stage = input.contactType;
    // Marketing and admin-created leads stay pooled until score ≥ 40.
    // A sales rep who creates the contact owns it immediately.
    if (stage === "lead") {
      const explicitClaim =
        canAssignContactOwner(role) && Boolean(input.ownerUserId?.trim());
      if (explicitClaim) {
        input.ownerUserId = await resolveContactOwnerUserId(
          input.ownerUserId?.trim() || null,
          null,
          "create",
        );
      } else if (role === "sales_rep" && actorUserId) {
        input.ownerUserId = actorUserId;
        if ((input.ownerChangeReason?.trim().length ?? 0) < 3) {
          input.ownerChangeReason = "Created by this salesperson.";
        }
      } else {
        input.ownerUserId = null;
      }
    } else if (!canAssignContactOwner(role)) {
      input.ownerUserId = await resolveContactOwnerUserId(null, null, "create");
    } else {
      const formOwner = input.ownerUserId?.trim() || null;
      const locationOwner = formOwner
        ? null
        : await resolveOwnerFromCompanyLocation(input.companyId, input.locationId);
      const requested = formOwner || locationOwner;
      input.ownerUserId = requested
        ? await resolveContactOwnerUserId(requested, null, "create")
        : null;
    }

    if (stage === "lead" && input.ownerUserId?.trim()) {
      const ownerError = leadOwnerChangeError({
        previousOwnerUserId: null,
        nextOwnerUserId: input.ownerUserId.trim(),
        reason: input.ownerChangeReason,
      });
      if (ownerError) return { ok: false, error: ownerError };
      if (!(await ownerIsSalesRep(input.ownerUserId.trim()))) {
        return {
          ok: false,
          error: "A lead can only be assigned to a sales rep.",
        };
      }
    }

    input.organizationId = organizationId;
    input.createdByUserId = actorUserId;
    const mergeDuplicates = options?.mergeDuplicates !== false;
    const upserted =
      stage === "lead" && mergeDuplicates
        ? await upsertLeadContact(input, {
            organizationId,
            actorUserId,
            source: "create_contact_api",
          })
        : {
            contact: await createContact(input),
            merged: false,
            primaryContactId: "",
            archivedContactIds: [] as string[],
            matchReasons: [] as string[],
          };
    const contact = upserted.contact;
    if (stage === "lead" && contact.crm.ownerUserId) {
      await beginLeadOwnerFollowup({
        contactId: contact.id,
        organizationId,
        ownerUserId: contact.crm.ownerUserId,
        reason: input.ownerChangeReason?.trim() || "Lead assigned.",
        displayName: contact.displayName,
        leadStatus: contact.person.leadStatus,
      }).catch((err) =>
        console.error("create lead assignment email failed", contact.id, err),
      );
    }
    try {
      if (isLeadPipelineStage(contact.person.contactType)) {
        await onLeadCreated({
          contactId: contact.id,
          organizationId,
          companyId: contact.person.companyId,
          triggerReason: upserted.merged ? "lead_merged" : "lead_created",
        });
      }
    } catch (pipelineErr) {
      console.error("lead pipeline after create failed", pipelineErr);
    }
    if (isLeadPipelineStage(stage)) {
      notifyAdminsOfLeadEventAsync({
        kind: upserted.merged ? "lead_updated" : "lead_created",
        organizationId,
        contactId: contact.id,
        contactName: contact.displayName,
        companyName: contact.person.company?.name ?? null,
        ownerUserId: contact.crm.ownerUserId ?? contact.person.ownerUserId,
        actorUserId,
        detail: upserted.merged
          ? "Matched an existing lead and merged inbound details."
          : null,
      });
    } else if (isSalesPipelineStage(stage)) {
      await ensureContactInSalesPipeline(contact.id, {
        actorUserId,
      }).catch((err) => {
        console.error("pipeline ensure after contact create failed", err);
      });
    }
    return {
      ok: true,
      id: contact.id,
      merged: upserted.merged,
      displayName: contact.displayName,
      matchReasons: upserted.matchReasons ?? [],
    };
  } catch (err) {
    console.error("createContactCommand failed", err);
    return {
      ok: false,
      error: userFacingCommandError(
        err,
        "Couldn't create this contact. Try again, or use a different email/phone.",
      ),
    };
  }
}

export async function importContactsCommand(input: {
  csvText: string;
  dryRun?: boolean;
}) {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to import contacts.",
    );
    const { importContactsFromCsv } = await import(
      "@/dao/contacts/contact-import-service"
    );
    const result = await importContactsFromCsv(input.csvText, {
      dryRun: Boolean(input.dryRun),
    });
    return {
      ok: true as const,
      dryRun: Boolean(input.dryRun),
      parsed: result.parsed,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      duplicates: result.duplicates,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Import failed.",
    };
  }
}

export async function getContactImportSampleCommand() {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to import contacts.",
    );
    const { getCurrentBusinessType } = await import(
      "@/service/auth/require-role"
    );
    const { contactImportSampleCsv } = await import(
      "@/dao/contacts/contact-import-service"
    );
    const businessType = await getCurrentBusinessType();
    const sample = contactImportSampleCsv(businessType);
    return { ok: true as const, ...sample };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to load import sample.",
    };
  }
}

export async function updateContactCommand(
  id: string,
  input: ContactInput,
): Promise<CommandResult> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to edit contacts.",
    );
    const existing = await getContact(id);
    if (!existing) return { ok: false, error: "Contact not found." };
    await assertContactAccess(existing);

    const error = validate(input);
    if (error) return { ok: false, error };

    const businessType = await getCurrentBusinessType();
    const companyGate = enforceContactCompanyForBusinessType(businessType, input);
    if (!companyGate.ok) return { ok: false, error: companyGate.error };
    Object.assign(input, companyGate.input);

    const organizationId = await getCurrentOrganizationId();
    const { getOrganizationProfile } = await import(
      "@/dao/org/organization-profile-store"
    );
    const { sanitizeCustomAttributes } = await import("@/lib/vertical-packs");
    const orgProfile = await getOrganizationProfile(organizationId);
    if (input.customAttributes !== undefined) {
      input.customAttributes = sanitizeCustomAttributes(
        orgProfile.vertical,
        input.customAttributes ?? {},
      );
    }

    const role = await getCurrentUserRole();
    input.contactType = resolveContactTypeForChannels({
      requested: input.contactType ?? existing.person.contactType,
      existing: existing.person.contactType,
      email: input.email ?? existing.person.email,
      phone: input.phone !== undefined ? input.phone : existing.person.phone,
      secondaryEmails:
        input.secondaryEmails ?? existing.person.secondaryEmails,
      secondaryPhones:
        input.secondaryPhones ?? existing.person.secondaryPhones,
    });
    const stage = input.contactType;
    if (!canAssignContactOwner(role)) {
      input.ownerUserId = await resolveContactOwnerUserId(
        null,
        existing.crm.ownerUserId,
        "update",
      );
    } else if (stage === "lead") {
      const formOwner = input.ownerUserId?.trim() || null;
      if (formOwner) {
        input.ownerUserId = await resolveContactOwnerUserId(
          formOwner,
          existing.crm.ownerUserId,
          "update",
        );
      } else if (canAssignContactOwner(role)) {
        // Admin/manager may return a lead to the pool or leave it unassigned.
        input.ownerUserId = null;
      } else {
        input.ownerUserId = existing.crm.ownerUserId?.trim() || null;
      }
    } else {
      const formOwner = input.ownerUserId?.trim() || null;
      const locationOwner = await resolveOwnerFromCompanyLocation(
        input.companyId ?? existing.person.companyId,
        input.locationId ?? existing.person.locationId,
      );
      input.ownerUserId = await resolveContactOwnerUserId(
        formOwner || locationOwner,
        existing.crm.ownerUserId,
        "update",
      );
    }

    const previousOwnerUserId = existing.crm.ownerUserId?.trim() || null;
    const nextOwnerUserId = input.ownerUserId?.trim() || null;
    if (isLeadPipelineStage(stage) && canAssignContactOwner(role)) {
      const ownerError = leadOwnerChangeError({
        previousOwnerUserId,
        nextOwnerUserId,
        reason: input.ownerChangeReason,
      });
      if (ownerError) return { ok: false, error: ownerError };
      if (nextOwnerUserId && nextOwnerUserId !== previousOwnerUserId) {
        if (!(await ownerIsSalesRep(nextOwnerUserId))) {
          return {
            ok: false,
            error: "A lead can only be assigned to a sales rep.",
          };
        }
      }
    }

    const contact = await updateContact(id, input);
    const actorUserId = await getServerUserId();
    const notifyOrganizationId = await resolveRequestOrganizationId(
      contact.person.organizationId,
    );
    const newOwnerUserId = contact.crm.ownerUserId?.trim() || null;
    if (newOwnerUserId && newOwnerUserId !== previousOwnerUserId) {
      // Assigning the person should not leave the account unowned.
      await backfillCompanyOwnerFromContact({
        contactId: contact.id,
        ownerUserId: newOwnerUserId,
        companyId: contact.person.companyId,
      });
    }
    if (
      isLeadPipelineStage(stage) &&
      canAssignContactOwner(role) &&
      newOwnerUserId &&
      newOwnerUserId !== previousOwnerUserId
    ) {
      await beginLeadOwnerFollowup({
        contactId: contact.id,
        organizationId: notifyOrganizationId,
        ownerUserId: newOwnerUserId,
        reason: input.ownerChangeReason?.trim() || "Lead reassigned.",
        displayName: contact.displayName,
        leadStatus: contact.person.leadStatus,
      }).catch((err) =>
        console.error("manual lead assignment email failed", contact.id, err),
      );
    }
    if (canAssignContactOwner(role)) {
      notifyCustomerOfOwnerChangeAsync({
        contactId: contact.id,
        organizationId: notifyOrganizationId,
        newOwnerUserId,
        previousOwnerUserId,
      });
    }

    const leadStatusChanged =
      input.leadStatus !== undefined &&
      input.leadStatus !== existing.person.leadStatus;
    const contactTypeChanged =
      input.contactType !== undefined &&
      input.contactType !== existing.person.contactType;
    if (leadStatusChanged || contactTypeChanged) {
      const parts: string[] = [];
      if (leadStatusChanged) {
        parts.push(
          `leadStatus ${existing.person.leadStatus} → ${input.leadStatus}`,
        );
      }
      if (contactTypeChanged) {
        parts.push(
          `contactType ${existing.person.contactType} → ${input.contactType}`,
        );
      }
      try {
        await prisma.contactProfile.update({
          where: { accountContactId: id },
          data: {
            lifecycleLastAction: "manual_edit",
            lifecycleLastReason: `Human edit: ${parts.join("; ")}`.slice(
              0,
              2000,
            ),
            lifecycleLastRunAt: new Date(),
          },
        });
      } catch (err) {
        console.error("manual_edit lifecycle stamp failed", id, err);
      }
    }

    const becameDisqualified =
      input.leadStatus === "disqualified" &&
      existing.person.leadStatus !== "disqualified";
    const promotedToLead = becameLead(
      existing.person.contactType,
      contact.person.contactType,
    );
    const isLead = isLeadPipelineStage(contact.person.contactType);
    if (promotedToLead) {
      try {
        await onLeadCreated({
          contactId: contact.id,
          organizationId: notifyOrganizationId,
          companyId: contact.person.companyId,
          triggerReason: "contact_promoted_to_lead",
        });
      } catch (pipelineErr) {
        console.error("lead pipeline after promote failed", pipelineErr);
      }
      notifyAdminsOfLeadEventAsync({
        kind: "lead_created",
        contactId: contact.id,
        contactName: contact.displayName,
        companyName: contact.person.company?.name ?? null,
        ownerUserId: contact.crm.ownerUserId ?? contact.person.ownerUserId,
        actorUserId,
        detail: "Promoted to lead after a reachable email or phone was added.",
      });
    } else if (isLead) {
      notifyAdminsOfLeadEventAsync({
        kind: becameDisqualified ? "lead_disqualified" : "lead_updated",
        contactId: contact.id,
        contactName: contact.displayName,
        companyName: contact.person.company?.name ?? null,
        ownerUserId: contact.crm.ownerUserId ?? contact.person.ownerUserId,
        actorUserId,
        detail: becameDisqualified
          ? input.disqualifyReason ||
            contact.person.disqualifyReason ||
            existing.person.disqualifyReason ||
            null
          : null,
      });
    }
    if (isLead && !promotedToLead) {
      void enqueueLeadScoring({
        contactId: contact.id,
        organizationId: await resolveRequestOrganizationId(
          contact.person.organizationId,
        ),
        triggerReason: "contact_updated",
        processImmediately: true,
      }).catch((err) => {
        console.error("scoring enqueue after contact update failed", err);
      });
    }
    if (isSalesPipelineStage(contact.person.contactType)) {
      await ensureContactInSalesPipeline(contact.id, {
        actorUserId,
      }).catch((err) => {
        console.error("pipeline ensure after contact update failed", err);
      });
    }
    return { ok: true, id: contact.id };
  } catch (err) {
    console.error("updateContactCommand failed", err);
    return {
      ok: false,
      error: userFacingCommandError(
        err,
        "Couldn't update this contact. Try again.",
      ),
    };
  }
}

export async function deleteContactCommand(id: string): Promise<CommandResult> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to delete contacts.",
    );
    const existing = await getContact(id);
    if (!existing) return { ok: false, error: "Contact not found." };
    await assertContactAccess(existing);
    const actorUserId = await getServerUserId();
    await deleteContact(id);
    if (existing.person.contactType === "lead") {
      notifyAdminsOfLeadEventAsync({
        kind: "lead_deleted",
        contactId: id,
        contactName: existing.displayName,
        companyName: existing.person.company?.name ?? null,
        ownerUserId: existing.crm.ownerUserId ?? existing.person.ownerUserId,
        actorUserId,
      });
    }
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: userFacingCommandError(err, "Couldn't delete this contact. Try again."),
    };
  }
}

export async function setContactPinnedCommand(
  id: string,
  isPinned: boolean,
): Promise<CommandResult> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to pin contacts.",
    );
    const existing = await getContact(id);
    if (!existing) return { ok: false, error: "Contact not found." };
    await assertContactAccess(existing);
    await setContactPinned(id, isPinned);
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update pin.",
    };
  }
}

export async function convertLeadCommand(
  contactId: string,
  input?: { dealTitle?: string; amount?: number | null },
) {
  try {
    const userId = await getServerUserId();
    await requireRole(
      canConvertLeads,
      "You do not have permission to convert leads.",
    );
    const businessType = await getCurrentBusinessType();
    if (!showConvertLeadCta(businessType)) {
      return {
        ok: false as const,
        error:
          "Convert to deal is not used for B2C — create a commerce order instead.",
      };
    }
    const existing = await getContact(contactId);
    if (!existing) return { ok: false as const, error: "Contact not found." };
    await assertContactAccess(existing);
    const result = await convertLeadToDeal({
      contactId,
      dealTitle: input?.dealTitle,
      amount: input?.amount,
      actorUserId: userId,
    });
    if (!result.alreadyConverted) {
      notifyAdminsOfLeadEventAsync({
        kind: "lead_converted",
        contactId,
        contactName: existing.displayName,
        companyName: existing.person.company?.name ?? null,
        ownerUserId: existing.crm.ownerUserId ?? existing.person.ownerUserId,
        actorUserId: userId,
        dealId: result.dealId,
        href: `/sales/${result.dealId}`,
        detail: `Converted to a deal.`,
        metadata: { dealId: result.dealId },
      });
    }
    return {
      ok: true as const,
      dealId: result.dealId,
      alreadyConverted: result.alreadyConverted,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to convert lead.",
    };
  }
}

export async function findDuplicatesCommand(input: {
  excludeContactId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  secondaryEmails?: string[];
  secondaryPhones?: string[];
  companyId?: string | null;
  companyName?: string | null;
  city?: string | null;
}) {
  try {
    await requireRole(canEditContacts, "You cannot view contacts.");
    const organizationId = await getCurrentOrganizationId();
    const duplicates = await findDuplicateContacts({
      ...input,
      organizationId,
    });
    return { ok: true as const, duplicates };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to find duplicates.",
    };
  }
}

export async function getDuplicatesForContactCommand(contactId: string) {
  try {
    await requireRole(canEditContacts, "You cannot view contacts.");
    const data = await findDuplicatesForContactId(contactId);
    return { ok: true as const, data };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to load duplicates.",
    };
  }
}

export async function previewMergeCommand(contactIds: string[]) {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to merge contacts.",
    );
    for (const contactId of contactIds) {
      const contact = await getContact(contactId);
      if (!contact) {
        return { ok: false as const, error: "One or more contacts were not found." };
      }
      await assertContactAccess(contact);
    }
    const preview = await buildMergePreview(contactIds);
    return { ok: true as const, ...preview };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to preview merge.",
    };
  }
}

export async function executeMergeCommand(input: {
  primaryContactId: string;
  duplicateContactIds: string[];
  fieldSources: Record<string, string>;
}): Promise<CommandResult> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to merge contacts.",
    );
    const allIds = [input.primaryContactId, ...input.duplicateContactIds];
    for (const contactId of allIds) {
      const contact = await getContact(contactId);
      if (!contact) {
        return { ok: false, error: "One or more contacts were not found." };
      }
      await assertContactAccess(contact);
    }
    const userId = await getServerUserId();
    const result = await executeContactMerge({
      primaryContactId: input.primaryContactId,
      duplicateContactIds: input.duplicateContactIds,
      fieldSources: input.fieldSources as Parameters<
        typeof executeContactMerge
      >[0]["fieldSources"],
      actorUserId: userId,
    });
    return { ok: true, id: result.primaryContactId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to merge contacts.",
    };
  }
}

export async function createActivityCommand(
  contactId: string,
  input: {
    type: string;
    subject: string;
    body?: string | null;
    dueAt?: string | null;
    assigneeUserId?: string | null;
    taskStatus?: string | null;
    folder?: "inbox" | "sent" | "draft" | "trash";
    threadId?: string | null;
    gmailMessageId?: string | null;
    gmailThreadId?: string | null;
    rfcMessageId?: string | null;
    emailDirection?: "outbound" | "inbound" | null;
  },
): Promise<CommandResult> {
  try {
    const existing = await getContact(contactId);
    if (!existing) return { ok: false, error: "Contact not found." };
    await assertContactAccess(existing);
    if (!ACTIVITY_TYPES.includes(input.type as ActivityType)) {
      return { ok: false, error: "Invalid activity type." };
    }
    const activityType = input.type as ActivityType;

    const actorUserId = await getServerUserId();
    const role = await getCurrentUserRole();

    let assigneeUserId: string | null = null;
    if (activityType === "note") {
      const raw = (input.body ?? input.subject).trim();
      if (!raw) return { ok: false, error: "Note description is required." };
      const parsed = parseNoteBody(raw);
      if (!parsed.plain && parsed.attachments.length === 0) {
        return { ok: false, error: "Note description is required." };
      }
    } else if (activityType === "task") {
      if (!input.subject.trim()) {
        return { ok: false, error: "Task title is required." };
      }
      if (!input.body?.trim()) {
        return { ok: false, error: "Task description is required." };
      }
      if (!input.dueAt?.trim()) {
        return { ok: false, error: "Task due date is required." };
      }
      if (!actorUserId) {
        return { ok: false, error: "You must be signed in to create a task." };
      }
      if (canAssignTaskAssignee(role)) {
        assigneeUserId = input.assigneeUserId?.trim() || null;
        if (!assigneeUserId) {
          return { ok: false, error: "Task assignee is required." };
        }
      } else {
        assigneeUserId = actorUserId;
      }
    } else if (!input.subject.trim()) {
      return { ok: false, error: "Activity subject is required." };
    }

    const payload: ContactActivityInput = {
      type: activityType,
      subject: input.subject,
      body: input.body ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      assigneeUserId: activityType === "task" ? assigneeUserId : null,
      taskStatus: activityType === "task" ? "open" : null,
      folder: input.folder,
      threadId: input.threadId ?? null,
      gmailMessageId: input.gmailMessageId ?? null,
      gmailThreadId: input.gmailThreadId ?? null,
      rfcMessageId: input.rfcMessageId ?? null,
      emailDirection: input.emailDirection ?? null,
      createdByUserId: actorUserId,
    };
    const activity = await createContactActivity(contactId, payload);
    notifyAdminsOfLeadEventAsync({
      kind: "lead_activity",
      contactId,
      contactName: existing.displayName,
      companyName: existing.person.company?.name ?? null,
      ownerUserId: existing.crm.ownerUserId ?? existing.person.ownerUserId,
      actorUserId,
      activityType: activity.type,
      activitySubject: activity.subject,
      href: `/contact/${contactId}`,
    });
    void enqueueLeadScoring({
      contactId,
      organizationId: await resolveRequestOrganizationId(
        existing.person.organizationId,
      ),
      triggerReason: `activity:${activity.type}`,
      processImmediately: true,
    }).catch((err) => {
      console.error("scoring enqueue after activity failed", err);
    });
    return { ok: true, id: activity.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create activity.",
    };
  }
}

export async function updateTaskStatusCommand(
  activityId: string,
  taskStatus: string,
): Promise<CommandResult> {
  try {
    const updated = await updateTaskStatus(
      activityId,
      taskStatus as TaskStatus,
    );
    return { ok: true, id: updated.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update task.",
    };
  }
}

export async function deleteActivityCommand(
  contactId: string,
  activityId: string,
): Promise<CommandResult> {
  try {
    await deleteContactActivity(contactId, activityId);
    return { ok: true, id: activityId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete activity.",
    };
  }
}

const MAX_CONTACT_EXPORT_ROWS = 5000;

function isContactExportFormat(value: string): value is ContactExportFormat {
  return (
    value === "csv" ||
    value === "tsv" ||
    value === "json" ||
    value === "xlsx" ||
    value === "txt"
  );
}

export async function exportContactsCommand(filters: ContactListQuery & {
  format?: string;
}) {
  try {
    const format: ContactExportFormat = isContactExportFormat(
      filters.format ?? "csv",
    )
      ? (filters.format as ContactExportFormat)
      : "csv";

    const [scope, businessType, role] = await Promise.all([
      resolveRecordOwnerScope(),
      getCurrentBusinessType(),
      getCurrentUserRole(),
    ]);

    const listFilters = contactListFilters(filters);
    const includeCompany = showCompanyOnContacts(businessType);
    const includeOwner = role === "admin";

    const collected: ContactView[] = [];
    let page = 1;
    let truncated = false;

    while (collected.length < MAX_CONTACT_EXPORT_ROWS) {
      const result = await listContacts({
        page,
        pageSize: 100,
        ...listFilters,
        ownerUserId: scope.ownerUserId,
        channelCompanyIds: scope.channelCompanyIds,
      });
      collected.push(...result.items);
      if (!result.pagination.hasNext || result.items.length === 0) break;
      if (collected.length >= MAX_CONTACT_EXPORT_ROWS) {
        truncated = collected.length < result.pagination.total;
        break;
      }
      page += 1;
    }

    if (collected.length > MAX_CONTACT_EXPORT_ROWS) {
      collected.length = MAX_CONTACT_EXPORT_ROWS;
      truncated = true;
    }

    const effectiveOwners = includeOwner
      ? await effectiveOwnerIdsForContacts(collected)
      : new Map<string, string>();
    const ownerLabels = includeOwner
      ? await getUserLabelsByIds([...effectiveOwners.values()])
      : null;

    const headers = [
      "Name",
      "Email",
      "Phone",
      "Title",
      ...(includeCompany ? ["Company"] : []),
      ...(includeOwner ? ["Owner"] : []),
      "Stage",
      "Lead status",
      "Status",
      "Updated",
    ];

    const rows = collected.map((contact) => {
      const ownerId = effectiveOwners.get(contact.id) ?? null;
      const ownerRaw =
        includeOwner && ownerId ? (ownerLabels?.get(ownerId) ?? "") : "";
      const ownerName = ownerRaw.includes(" (")
        ? ownerRaw.slice(0, ownerRaw.indexOf(" ("))
        : ownerRaw;

      return [
        contact.displayName,
        contact.person.email,
        contact.person.phone,
        contact.person.title,
        ...(includeCompany ? [contact.person.company?.name ?? ""] : []),
        ...(includeOwner ? [ownerName] : []),
        formatContactType(contact.person.contactType),
        formatLeadStatus(contact.person.leadStatus),
        formatStatus(contact.crm.status),
        contact.person.updatedAt.toISOString(),
      ];
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const baseName =
      contactType === "lead"
        ? `leads-export-${stamp}`
        : `contacts-export-${stamp}`;

    const file = buildExportFile(
      format,
      { headers, rows },
      baseName,
      contactType === "lead" ? "Leads" : "Contacts",
    );

    return {
      ok: true as const,
      content: file.content,
      filename: file.filename,
      mimeType: file.mimeType,
      count: collected.length,
      truncated,
    };
  } catch (err) {
    console.error("exportContactsCommand failed", err);
    return {
      ok: false as const,
      error: "Could not export contacts. Try again.",
    };
  }
}
