import {
  accountRepository,
  findContactIdsByContactType,
  findContactIdsBySearch,
  filterContactIdsByReachability,
  getPeopleByIds,
  listActiveContactIds,
} from "@/dao/account/account-repository";
import type {
  AccountPerson,
  ContactStatus,
  ContactType,
  LeadStatus,
} from "@/service/account/types";
import {
  clampPage,
  clampPageSize,
  CONTACT_LIST_PAGE_SIZE,
  paginatedResult,
  type PaginatedResult,
  type PaginationInput,
} from "@/lib/pagination";
import {
  getCompanySnapshot,
  syncCompanyForContactChange,
} from "@/dao/companies/sync-from-contacts";
import {
  findContactIdsByCompanyNameSearch,
  findContactIdsByOverlaySearch,
  getContactProfileByAccountId,
  listContactProfiles,
  patchContactProfile,
  setContactProfilePinned,
  upsertContactProfile,
  type ContactProfileRecord,
} from "@/dao/contacts/contact-profile-repository";
import { purgeContactCompletely } from "@/dao/contacts/contact-purge";
import { claimUnownedEmailsForContact } from "@/dao/inbox/email-activity-user";
import { prisma } from "@/dao/db/prisma";
import {
  findContactIdsByEmail,
  findContactIdsByLeadSource,
  findContactIdsByPhone,
  findContactIdsByPlace,
  findContactIdsCreatedOn,
  interpretContactListSearch,
  normalizeCreatedOn,
} from "@/dao/contacts/contact-list-search";
import { formatContactDisplayName } from "@/lib/contact-name";
import {
  isLeadPipelineStage,
  reconcileLeadStatusWithContactType,
  resolveContactTypeForChannels,
} from "@/lib/contact-lifecycle";

export type { ContactStatus, ContactType };

export type ContactCrmFields = {
  ownerUserId: string | null;
  createdByUserId: string | null;
  leadSource: string | null;
  tags: string[];
  status: ContactStatus;
  notes: string | null;
};

export type ContactView = {
  id: string;
  person: AccountPerson;
  crm: ContactCrmFields;
  displayName: string;
};

export type ContactFilters = PaginationInput & {
  search?: string;
  contactType?: ContactType | "all";
  leadStatus?: import("@/service/account/types").LeadStatus | "all";
  /** CRM status, `all` (non-archived), or `unknown` (no email/phone identity). */
  status?: ContactStatus | "all" | "unknown";
  companyId?: string | null;
  /** Owner name from chat or the search box. Distinct from the RBAC owner scope. */
  ownerName?: string | null;
  location?: string | null;
  leadSource?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Calendar day the contact was created, YYYY-MM-DD in Asia/Kolkata. */
  createdOn?: string | null;
  ownerUserId?: string | null;
  channelCompanyIds?: string[] | null;
  /** Tenant scope — defaults to the signed-in user's organization. */
  organizationId?: string | null;
};

export type ContactInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  secondaryEmails?: string[];
  secondaryPhones?: string[];
  title?: string | null;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  companyId?: string | null;
  locationId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  ownerUserId?: string | null;
  /** Required when a manager or admin assigns or reassigns a lead. */
  ownerChangeReason?: string | null;
  contactType?: ContactType;
  leadSource?: string | null;
  leadStatus?: import("@/service/account/types").LeadStatus;
  disqualifyReason?: string | null;
  bantBudget?: boolean | null;
  bantAuthority?: boolean | null;
  bantNeed?: boolean | null;
  bantTimeline?: boolean | null;
  /** What the customer actually said — the budget, the decision maker, the date. */
  bantBudgetDetail?: string | null;
  bantAuthorityDetail?: string | null;
  bantNeedDetail?: string | null;
  bantTimelineDetail?: string | null;
  convertedDealId?: string | null;
  tags?: string[];
  status?: ContactStatus;
  notes?: string | null;
  createdByUserId?: string | null;
  organizationId?: string | null;
  isPinned?: boolean;
  customAttributes?: Record<string, unknown> | null;
};

function mergePersonWithProfile(
  identity: AccountPerson,
  profile: ContactProfileRecord | null,
): AccountPerson {
  if (!profile) return identity;
  return {
    ...identity,
    companyId: profile.companyId,
    locationId: profile.locationId,
    company: identity.company
      ? { ...identity.company, id: profile.companyId }
      : profile.companyId
        ? {
            id: profile.companyId,
            name: "",
            domain: null,
            industry: null,
          }
        : null,
    ownerUserId: profile.ownerUserId,
    createdByUserId: profile.createdByUserId ?? identity.createdByUserId,
    organizationId: profile.organizationId ?? identity.organizationId,
    leadSource: identity.leadSource,
    leadStatus: profile.leadStatus,
    disqualifyReason: profile.disqualifyReason,
    bantBudget: profile.bantBudget,
    bantAuthority: profile.bantAuthority,
    bantNeed: profile.bantNeed,
    bantTimeline: profile.bantTimeline,
    bantBudgetDetail: profile.bantBudgetDetail,
    bantAuthorityDetail: profile.bantAuthorityDetail,
    bantNeedDetail: profile.bantNeedDetail,
    bantTimelineDetail: profile.bantTimelineDetail,
    convertedDealId: profile.convertedDealId,
    tags: profile.tags,
    status: profile.status,
    notes: profile.notes,
    isPinned: profile.isPinned,
    customAttributes: profile.customAttributes ?? {},
    updatedAt:
      profile.updatedAt > identity.updatedAt
        ? profile.updatedAt
        : identity.updatedAt,
  };
}

function toView(person: AccountPerson): ContactView {
  return {
    id: person.id,
    person,
    crm: {
      ownerUserId: person.ownerUserId,
      createdByUserId: person.createdByUserId ?? null,
      leadSource: person.leadSource,
      tags: person.tags,
      status: person.status,
      notes: person.notes,
    },
    displayName: formatContactDisplayName(person.firstName, person.lastName),
  };
}

async function resolveCompanyFields(
  input: Partial<ContactInput>,
): Promise<Partial<ContactInput>> {
  if (input.companyId === undefined && input.companyName === undefined) {
    return input;
  }

  const selectedId = input.companyId?.trim() || null;
  if (selectedId) {
    const company = await getCompanySnapshot(selectedId);
    if (!company) {
      throw new Error("Selected company was not found.");
    }
    return {
      ...input,
      companyId: company.id,
      companyName: company.name,
      companyDomain: company.domain ?? input.companyDomain ?? null,
      companyIndustry: company.industry ?? input.companyIndustry ?? null,
    };
  }

  const name = input.companyName?.trim() || null;
  if (name) {
    const synced = await syncCompanyForContactChange({
      nextCompanyName: name,
      nextDomain: input.companyDomain,
      nextIndustry: input.companyIndustry,
      nextCity: input.city,
      organizationId: input.organizationId,
    });
    if (synced.companyId) {
      const company = await getCompanySnapshot(synced.companyId);
      return {
        ...input,
        companyId: synced.companyId,
        companyName: company?.name ?? name,
        companyDomain: company?.domain ?? input.companyDomain ?? null,
        companyIndustry: company?.industry ?? input.companyIndustry ?? null,
      };
    }
  }

  return {
    ...input,
    companyId: null,
    companyName: null,
    companyDomain: null,
    companyIndustry: null,
  };
}

async function findContactIdsByOwnerName(
  search: string,
  organizationId: string,
): Promise<string[]> {
  const needle = search.trim().toLowerCase();
  if (needle.length < 2) return [];
  const { listAssignableUsers } = await import(
    "@/service/account/user-directory"
  );
  const owners = await listAssignableUsers(organizationId);
  const ownerIds = owners
    .filter((user) => {
      const label = `${user.name} ${user.label} ${user.email}`.toLowerCase();
      return label.includes(needle);
    })
    .map((user) => {
      try {
        return BigInt(user.id);
      } catch {
        return null;
      }
    })
    .filter((id): id is bigint => id != null);
  if (ownerIds.length === 0) return [];
  const profiles = await prisma.contactProfile.findMany({
    where: {
      organizationId: BigInt(organizationId),
      ownerUserId: { in: ownerIds },
    },
    select: { accountContactId: true },
    take: 5000,
  });
  return profiles.map((profile) => profile.accountContactId);
}

export async function listContacts(
  filters: ContactFilters = {},
): Promise<PaginatedResult<ContactView>> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize, CONTACT_LIST_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  const { resolveRequestOrganizationId } = await import(
    "@/service/auth/require-role"
  );
  const organizationId = await resolveRequestOrganizationId(
    filters.organizationId,
  );

  // Scope to live cdp.customer_profile for this tenant so stale / other-org profiles
  // cannot inflate totals or hide CDP-backed people.
  const interpreted = interpretContactListSearch(filters.search ?? "");
  const text = interpreted.text;
  const createdOn =
    normalizeCreatedOn(filters.createdOn) || interpreted.createdOn;
  const location = filters.location?.trim() || "";
  const leadSource = filters.leadSource?.trim() || "";
  const ownerName = filters.ownerName?.trim() || "";
  const company = filters.company?.trim() || "";
  const email = filters.email?.trim() || "";
  const phone = filters.phone?.trim() || "";

  const [createdIds, placeIds, sourceIds, ownerIds, companyIds, emailIds, phoneIds] =
    await Promise.all([
      createdOn ? findContactIdsCreatedOn(createdOn, organizationId) : null,
      location ? findContactIdsByPlace(location, organizationId) : null,
      leadSource ? findContactIdsByLeadSource(leadSource, organizationId) : null,
      ownerName ? findContactIdsByOwnerName(ownerName, organizationId) : null,
      company ? findContactIdsByCompanyNameSearch(company, organizationId) : null,
      email ? findContactIdsByEmail(email, organizationId) : null,
      phone ? findContactIdsByPhone(phone, organizationId) : null,
    ]);
  const narrowedIds = [
    createdIds,
    placeIds,
    sourceIds,
    ownerIds,
    companyIds,
    emailIds,
    phoneIds,
  ].filter((ids): ids is string[] => ids != null);

  let searchAccountIds: string[];
  if (text) {
    const [fromPerson, fromCompany, fromOverlay, fromOwner] = await Promise.all([
      findContactIdsBySearch(text, { organizationId }),
      findContactIdsByCompanyNameSearch(text, organizationId),
      findContactIdsByOverlaySearch(text, organizationId),
      findContactIdsByOwnerName(text, organizationId),
    ]);
    searchAccountIds = [
      ...new Set([...fromPerson, ...fromCompany, ...fromOverlay, ...fromOwner]),
    ];
  } else if (narrowedIds.length > 0) {
    searchAccountIds = narrowedIds[0];
  } else if (!filters.search?.trim()) {
    searchAccountIds = await listActiveContactIds({ organizationId });
  } else {
    searchAccountIds = [];
  }

  const rest = text ? narrowedIds : narrowedIds.slice(1);
  for (const matched of rest) {
    const allowed = new Set(matched);
    searchAccountIds = searchAccountIds.filter((id) => allowed.has(id));
  }

  if (filters.contactType && filters.contactType !== "all") {
    const typedIds = await findContactIdsByContactType(filters.contactType, {
      organizationId,
    });
    const typedSet = new Set(typedIds);
    searchAccountIds = searchAccountIds.filter((id) => typedSet.has(id));
  }

  const statusFilter = filters.status ?? "all";
  const wantUnknown = statusFilter === "unknown";
  searchAccountIds = await filterContactIdsByReachability(
    searchAccountIds,
    !wantUnknown,
  );

  const profiles = await listContactProfiles({
    searchAccountIds,
    leadStatus: filters.leadStatus,
    status: wantUnknown ? "all" : (statusFilter as ContactStatus | "all"),
    companyId: filters.companyId,
    ownerUserId: filters.ownerUserId ?? undefined,
    channelCompanyIds: filters.channelCompanyIds ?? undefined,
    limit: pageSize,
    offset,
  });

  const identities = await getPeopleByIds(
    profiles.items.map((p) => p.accountContactId),
  );
  const identityById = new Map(identities.map((p) => [p.id, p]));

  const items = profiles.items
    .map((profile) => {
      const identity = identityById.get(profile.accountContactId);
      if (!identity) return null;
      return toView(mergePersonWithProfile(identity, profile));
    })
    .filter(Boolean) as ContactView[];

  return paginatedResult(items, profiles.total, page, pageSize);
}

const MAX_CONTACT_SELECT = 500;

export async function listContactsForSelect(options?: {
  companyId?: string | null;
  ownerUserId?: string | null;
  search?: string | null;
  limit?: number;
}): Promise<
  {
    id: string;
    displayName: string;
    email: string;
    phone: string | null;
    companyId: string | null;
  }[]
> {
  const limit = Math.min(options?.limit ?? MAX_CONTACT_SELECT, MAX_CONTACT_SELECT);
  const { resolveRecordOwnerScope } = await import(
    "@/service/auth/ownership-scope"
  );
  const scope = await resolveRecordOwnerScope();
  const useSessionScope = options?.ownerUserId === undefined;
  const ownerUserId = useSessionScope ? scope.ownerUserId : options?.ownerUserId;

  const result = await listContacts({
    companyId: options?.companyId ?? undefined,
    ownerUserId: ownerUserId ?? undefined,
    channelCompanyIds: useSessionScope ? scope.channelCompanyIds : undefined,
    search: options?.search?.trim() || undefined,
    status: "active",
    page: 1,
    pageSize: limit,
  });

  return result.items
    .map((view) => ({
      id: view.id,
      displayName: view.displayName,
      email: view.person.email,
      phone: view.person.phone,
      companyId: view.person.companyId,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getContact(id: string): Promise<ContactView | null> {
  const identity = await accountRepository.getPerson(id);
  if (!identity) return null;
  const profile = await getContactProfileByAccountId(id);
  if (profile?.status === "archived") return null;
  return toView(mergePersonWithProfile(identity, profile));
}

export async function createContact(input: ContactInput): Promise<ContactView> {
  const resolved = (await resolveCompanyFields(input)) as ContactInput;
  const contactType = resolveContactTypeForChannels({
    requested: resolved.contactType,
    existing: "contact",
    email: resolved.email,
    phone: resolved.phone,
    secondaryEmails: resolved.secondaryEmails,
    secondaryPhones: resolved.secondaryPhones,
  });
  const leadStatus = reconcileLeadStatusWithContactType(
    contactType,
    (resolved.leadStatus ?? "new") as LeadStatus,
  );
  const leadSource = resolved.leadSource?.trim() || "crm";

  const identity = await accountRepository.createPerson({
    firstName: resolved.firstName,
    lastName: resolved.lastName,
    email: resolved.email,
    phone: resolved.phone,
    secondaryEmails: resolved.secondaryEmails,
    secondaryPhones: resolved.secondaryPhones,
    title: resolved.title,
    addressLine: resolved.addressLine,
    city: resolved.city,
    country: resolved.country,
    companyName: resolved.companyName,
    companyDomain: resolved.companyDomain,
    companyIndustry: resolved.companyIndustry,
    createdByUserId: resolved.createdByUserId,
    organizationId: resolved.organizationId,
    contactType,
    leadSource,
  });

  const profile = await upsertContactProfile(identity.id, {
    organizationId: resolved.organizationId ?? identity.organizationId,
    companyId: resolved.companyId,
    locationId: resolved.locationId,
    ownerUserId: resolved.ownerUserId,
    createdByUserId: resolved.createdByUserId,
    leadSource,
    leadStatus,
    disqualifyReason: resolved.disqualifyReason,
    bantBudget: resolved.bantBudget,
    bantAuthority: resolved.bantAuthority,
    bantNeed: resolved.bantNeed,
    bantTimeline: resolved.bantTimeline,
    bantBudgetDetail: resolved.bantBudgetDetail,
    bantAuthorityDetail: resolved.bantAuthorityDetail,
    bantNeedDetail: resolved.bantNeedDetail,
    bantTimelineDetail: resolved.bantTimelineDetail,
    convertedDealId: resolved.convertedDealId,
    tags: resolved.tags,
    status: resolved.status,
    notes: resolved.notes,
    isPinned: resolved.isPinned,
    customAttributes: resolved.customAttributes ?? {},
  });

  return toView(mergePersonWithProfile(identity, profile));
}

async function reassignContactDealsToCompany(
  contactId: string,
  companyId: string,
): Promise<void> {
  const deals = await prisma.deal.findMany({
    where: { contactId },
    select: { id: true, locationId: true },
  });
  if (deals.length === 0) return;

  const companyLocations = await prisma.companyLocation.findMany({
    where: { companyId },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const targetLocationId = companyLocations[0]?.id ?? null;

  await prisma.deal.updateMany({
    where: { contactId },
    data: { companyId, locationId: targetLocationId },
  });

  await patchContactProfile(contactId, { locationId: targetLocationId });
}

export async function updateContact(
  id: string,
  input: Partial<ContactInput>,
): Promise<ContactView> {
  const existingView = await getContact(id);
  if (!existingView) throw new Error("Contact not found.");
  const existing = existingView.person;
  const previousCompanyId = existing.companyId ?? null;
  const previousCompanyName = existing.company?.name ?? null;

  const merged: ContactInput = {
    firstName: input.firstName ?? existing.firstName,
    lastName: input.lastName ?? existing.lastName,
    email: input.email ?? existing.email,
    phone: input.phone !== undefined ? input.phone : existing.phone,
    secondaryEmails:
      input.secondaryEmails !== undefined
        ? input.secondaryEmails
        : existing.secondaryEmails,
    secondaryPhones:
      input.secondaryPhones !== undefined
        ? input.secondaryPhones
        : existing.secondaryPhones,
    title: input.title !== undefined ? input.title : existing.title,
    addressLine:
      input.addressLine !== undefined ? input.addressLine : existing.addressLine,
    city: input.city !== undefined ? input.city : existing.city,
    country: input.country !== undefined ? input.country : existing.country,
    companyId:
      input.companyId !== undefined ? input.companyId : existing.companyId,
    locationId:
      input.locationId !== undefined ? input.locationId : existing.locationId,
    companyName:
      input.companyName !== undefined
        ? input.companyName
        : existing.company?.name ?? null,
    companyDomain:
      input.companyDomain !== undefined
        ? input.companyDomain
        : existing.company?.domain ?? null,
    companyIndustry:
      input.companyIndustry !== undefined
        ? input.companyIndustry
        : existing.company?.industry ?? null,
    ownerUserId:
      input.ownerUserId !== undefined ? input.ownerUserId : existing.ownerUserId,
    contactType: existing.contactType,
    leadSource:
      input.leadSource !== undefined ? input.leadSource : existing.leadSource,
    leadStatus: existing.leadStatus,
    disqualifyReason:
      input.disqualifyReason !== undefined
        ? input.disqualifyReason
        : existing.disqualifyReason,
    bantBudget:
      input.bantBudget !== undefined ? input.bantBudget : existing.bantBudget,
    bantAuthority:
      input.bantAuthority !== undefined
        ? input.bantAuthority
        : existing.bantAuthority,
    bantNeed: input.bantNeed !== undefined ? input.bantNeed : existing.bantNeed,
    bantTimeline:
      input.bantTimeline !== undefined
        ? input.bantTimeline
        : existing.bantTimeline,
    bantBudgetDetail:
      input.bantBudgetDetail !== undefined
        ? input.bantBudgetDetail
        : existing.bantBudgetDetail,
    bantAuthorityDetail:
      input.bantAuthorityDetail !== undefined
        ? input.bantAuthorityDetail
        : existing.bantAuthorityDetail,
    bantNeedDetail:
      input.bantNeedDetail !== undefined
        ? input.bantNeedDetail
        : existing.bantNeedDetail,
    bantTimelineDetail:
      input.bantTimelineDetail !== undefined
        ? input.bantTimelineDetail
        : existing.bantTimelineDetail,
    convertedDealId:
      input.convertedDealId !== undefined
        ? input.convertedDealId
        : existing.convertedDealId,
    tags: input.tags ?? existing.tags,
    status: input.status ?? existing.status,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    createdByUserId: input.createdByUserId,
    organizationId: input.organizationId ?? existing.organizationId,
    customAttributes:
      input.customAttributes !== undefined
        ? input.customAttributes
        : (existing.customAttributes ?? {}),
  };

  merged.contactType = resolveContactTypeForChannels({
    requested: input.contactType ?? existing.contactType,
    existing: existing.contactType,
    email: merged.email,
    phone: merged.phone,
    secondaryEmails: merged.secondaryEmails,
    secondaryPhones: merged.secondaryPhones,
  });
  merged.leadStatus = reconcileLeadStatusWithContactType(
    merged.contactType,
    (input.leadStatus ?? existing.leadStatus) as LeadStatus,
  );

  const resolved = (await resolveCompanyFields(merged)) as ContactInput;

  const identityBefore = {
    email: existing.email || null,
    phone: existing.phone,
    companyName: existing.company?.name?.trim() || null,
    companyId: existing.companyId ?? null,
  };

  const identity = await accountRepository.updatePerson(id, {
    firstName: resolved.firstName,
    lastName: resolved.lastName,
    email: resolved.email,
    phone: resolved.phone,
    secondaryEmails: resolved.secondaryEmails,
    secondaryPhones: resolved.secondaryPhones,
    title: resolved.title,
    addressLine: resolved.addressLine,
    city: resolved.city,
    country: resolved.country,
    companyName: resolved.companyName,
    companyDomain: resolved.companyDomain,
    companyIndustry: resolved.companyIndustry,
    organizationId: resolved.organizationId,
    contactType: resolved.contactType,
    leadSource: resolved.leadSource,
  });

  const profile = await upsertContactProfile(id, {
    organizationId: resolved.organizationId ?? identity.organizationId,
    companyId: resolved.companyId,
    locationId: resolved.locationId,
    ownerUserId: resolved.ownerUserId,
    createdByUserId: resolved.createdByUserId,
    leadSource: resolved.leadSource,
    leadStatus: resolved.leadStatus,
    disqualifyReason: resolved.disqualifyReason,
    bantBudget: resolved.bantBudget,
    bantAuthority: resolved.bantAuthority,
    bantNeed: resolved.bantNeed,
    bantTimeline: resolved.bantTimeline,
    bantBudgetDetail: resolved.bantBudgetDetail,
    bantAuthorityDetail: resolved.bantAuthorityDetail,
    bantNeedDetail: resolved.bantNeedDetail,
    bantTimelineDetail: resolved.bantTimelineDetail,
    convertedDealId: resolved.convertedDealId,
    tags: resolved.tags,
    status: resolved.status,
    notes: resolved.notes,
    isPinned: existing.isPinned,
    customAttributes:
      resolved.customAttributes !== undefined
        ? resolved.customAttributes
        : (existing.customAttributes ?? {}),
  });

  if (resolved.ownerUserId?.trim()) {
    await claimUnownedEmailsForContact(id, resolved.ownerUserId);
  }

  await syncCompanyForContactChange({
    previousCompanyId,
    previousCompanyName,
    nextCompanyId: resolved.companyId,
    nextCompanyName: resolved.companyName,
    nextDomain: resolved.companyDomain,
    nextIndustry: resolved.companyIndustry,
    nextCity: resolved.city,
    organizationId: resolved.organizationId ?? identity.organizationId,
  });

  const displayName = formatContactDisplayName(
    identity.firstName,
    identity.lastName,
  );
  await prisma.deal.updateMany({
    where: { contactId: id },
    data: {
      contactName: displayName,
      contactEmail: identity.email,
    },
  });

  const nextCompanyId = resolved.companyId ?? null;
  if (nextCompanyId && nextCompanyId !== previousCompanyId) {
    await reassignContactDealsToCompany(id, nextCompanyId);
  }

  const refreshedProfile =
    (await getContactProfileByAccountId(id)) ?? profile;

  const identityAfter = {
    email: identity.email || null,
    phone: identity.phone,
    companyName:
      resolved.companyName?.trim() ||
      identity.company?.name?.trim() ||
      null,
    companyId: resolved.companyId ?? refreshedProfile?.companyId ?? null,
  };
  const { enrichmentIdentityFieldsChanged, reenqueueLeadEnrichmentOnIdentityUpdate } =
    await import("@/service/ai/lead-enrichment-job");
  if (
    isLeadPipelineStage(identity.contactType) &&
    enrichmentIdentityFieldsChanged(identityBefore, identityAfter)
  ) {
    void reenqueueLeadEnrichmentOnIdentityUpdate({
      contactId: id,
      organizationId: resolved.organizationId ?? identity.organizationId,
      companyId: resolved.companyId ?? refreshedProfile?.companyId ?? null,
    });
  }

  return toView(mergePersonWithProfile(identity, refreshedProfile));
}

/**
 * Promote a reachable contact to lead (no demote). Returns the lead view,
 * or null when the person is not in the lead pipeline.
 */
export async function promoteContactToLeadIfEligible(
  contactId: string,
): Promise<ContactView | null> {
  const contact = await getContact(contactId);
  if (!contact) return null;
  if (isLeadPipelineStage(contact.person.contactType)) return contact;
  const nextType = resolveContactTypeForChannels({
    existing: contact.person.contactType,
    email: contact.person.email,
    phone: contact.person.phone,
    secondaryEmails: contact.person.secondaryEmails,
    secondaryPhones: contact.person.secondaryPhones,
  });
  if (nextType !== "lead") return null;
  return updateContact(contactId, { contactType: "lead" });
}

export async function deleteContact(id: string): Promise<void> {
  const identity = await accountRepository.getPerson(id);
  const profile = await getContactProfileByAccountId(id);
  const previousCompanyId =
    profile?.companyId ?? identity?.companyId ?? null;
  const previousCompanyName = identity?.company?.name ?? null;
  const organizationId =
    profile?.organizationId ?? identity?.organizationId ?? null;

  await purgeContactCompletely(id);
  await syncCompanyForContactChange({
    previousCompanyId,
    previousCompanyName,
    nextCompanyId: null,
    nextCompanyName: null,
    organizationId,
  });
}

export async function setContactPinned(
  id: string,
  isPinned: boolean,
): Promise<ContactView> {
  const identity = await accountRepository.getPerson(id);
  if (!identity) throw new Error("Contact not found.");
  const profile = await setContactProfilePinned(id, isPinned);
  return toView(mergePersonWithProfile(identity, profile));
}

export function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function parseContactMethodList(
  value: string | null | undefined,
): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Point a contact at a specific CRM location (or clear it). */
export async function setContactLocation(
  id: string,
  locationId: string | null,
): Promise<void> {
  await patchContactProfile(id, { locationId });
}
