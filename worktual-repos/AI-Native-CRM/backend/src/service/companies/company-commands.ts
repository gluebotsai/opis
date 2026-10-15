/**
 * Framework-agnostic company mutations for Fastify strangler.
 */

import type { LocationType } from "@prisma/client";
import {
  companyOwnerScopeWhere,
  createCompanyWithLocation,
  createLocation,
  deleteCompany,
  deleteLocation,
  getCompany,
  getLocation,
  listCompanies,
  updateCompany,
  updateLocation,
  type CompanyInput,
  type LocationInput,
} from "@/dao/companies/company-service";
import {
  attributeContactsToLocation,
  funnelCountsFromContacts,
  resolveContactLocationId,
} from "@/dao/companies/location-leads";
import { listContacts } from "@/dao/contacts/contact-service";
import {
  canAssignContactOwner,
  canEditCompanies,
  canViewAllRecords,
} from "@/service/auth/rbac";
import {
  getCurrentOrganizationId,
  getCurrentUserRole,
  requireModuleEnabled,
  requireRole,
} from "@/service/auth/require-role";
import {
  assertCompanyViewAccess,
  assertRecordAccess,
  resolveRecordOwnerScope,
} from "@/service/auth/ownership-scope";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  getUserLabelsByIds,
  listAssignableUsers,
} from "@/service/account/user-directory";
import { prisma } from "@/dao/db/prisma";

function parseChannelRole(
  raw: string | null | undefined,
): CompanyInput["channelRole"] | null {
  const v = raw?.trim().toLowerCase();
  if (
    v === "standard" ||
    v === "franchise" ||
    v === "owned_store" ||
    v === "brand_hq"
  ) {
    return v;
  }
  if (!v) return "standard";
  return null;
}

export type CommandResult =
  | { ok: true; id: string }
  | { ok: false; error: string; existingId?: string };

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

async function findCompanyByNameInsensitive(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Names are unique per organization, and the list is tenant-scoped.
  // A global match would block create for a company the user cannot see.
  const organizationId = await getCurrentOrganizationId();
  return prisma.company.findFirst({
    where: {
      organizationId,
      name: { equals: trimmed, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
}

async function currentUserCanOpenCompany(id: string): Promise<boolean> {
  const scope = await resolveRecordOwnerScope();
  if (!scope.userId) return false;
  if (canViewAllRecords(scope.role)) return true;
  const row = await prisma.company.findFirst({
    where: { id, ...companyOwnerScopeWhere(scope.userId) },
    select: { id: true },
  });
  return Boolean(row);
}

/** Duplicate name in this tenant. Omit existingId when the user cannot open it. */
async function duplicateNameResult(
  name: string,
): Promise<CommandResult | null> {
  const duplicate = await findCompanyByNameInsensitive(name);
  if (!duplicate) return null;
  const visible = await currentUserCanOpenCompany(duplicate.id);
  if (!visible) {
    return {
      ok: false,
      error: `A company named “${duplicate.name}” already exists in your organization, but it isn't in your list because someone else owns it. Use a different name, or ask them to share it.`,
    };
  }
  return {
    ok: false,
    existingId: duplicate.id,
    error: `A company named “${duplicate.name}” already exists. Open that record instead of creating a duplicate.`,
  };
}

async function resolveCompanyOwnerUserId(
  requested: string | null,
  existingOwnerId?: string | null,
  mode: "create" | "update" = "create",
): Promise<string | null> {
  const role = await getCurrentUserRole();
  const selfId = await getServerUserId();

  if (!canAssignContactOwner(role)) {
    if (mode === "create") return selfId;
    return existingOwnerId ?? selfId;
  }

  const ownerId = requested?.trim() || null;
  if (!ownerId) {
    return mode === "create" ? selfId : (existingOwnerId ?? selfId);
  }
  if (selfId && ownerId === selfId) return ownerId;

  const assignable = await listAssignableUsers();
  if (!assignable.some((u) => u.id === ownerId)) {
    throw new Error("Selected owner is not a sales user in your organization.");
  }
  return ownerId;
}

export async function listCompaniesCommand(filters: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  await requireModuleEnabled(
    "company",
    "Companies are not available for your business type.",
  );
  const scope = await resolveRecordOwnerScope();
  const result = await listCompanies({
    page: filters.page ?? 1,
    pageSize: filters.pageSize,
    search: filters.search,
    ownerUserId: scope.ownerUserId,
  });
  return {
    items: result.items.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      industry: c.industry,
      employeeCount: c.employeeCount,
      locationCount: c.locationCount,
      logoUrl: c.logoUrl,
      createdAt: c.createdAt.toISOString(),
      expansionSignal: c.expansionSignal,
    })),
    pagination: result.pagination,
  };
}

/** Owner assignment options for the create-company form (mirrors getCompanyCommand's fields for edit). */
export async function getCompanyFormOptionsCommand() {
  await requireModuleEnabled(
    "company",
    "Companies are not available for your business type.",
  );
  await requireRole(
    canEditCompanies,
    "You do not have permission to create companies.",
  );
  const [role, assignableUsers, currentUserId] = await Promise.all([
    getCurrentUserRole(),
    listAssignableUsers(),
    getServerUserId(),
  ]);
  return {
    ok: true as const,
    canAssignOwner: canAssignContactOwner(role),
    currentUserId,
    assignableUsers: assignableUsers.map((u) => ({ id: u.id, label: u.label })),
  };
}

export async function getCompanyCommand(id: string) {
  await requireModuleEnabled(
    "company",
    "Companies are not available for your business type.",
  );
  const company = await getCompany(id);
  if (!company) {
    return { ok: false as const, error: "Company not found.", status: 404 as const };
  }
  try {
    await assertCompanyViewAccess(company);
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Forbidden",
      status: 403 as const,
    };
  }
  const role = await getCurrentUserRole();
  const assignableUsers = canAssignContactOwner(role)
    ? await listAssignableUsers()
    : [];
  return {
    ok: true as const,
    company,
    canAssignOwner: canAssignContactOwner(role),
    assignableUsers: assignableUsers.map((u) => ({ id: u.id, label: u.label })),
  };
}

export async function createCompanyCommand(input: {
  name: string;
  domain?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  linkedinUrl?: string | null;
  ownerUserId?: string | null;
  channelRole?: string | null;
  parentCompanyId?: string | null;
  locationName: string;
  locationAddress?: string | null;
  locationType?: "hq" | "branch";
}): Promise<CommandResult> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    await requireRole(
      canEditCompanies,
      "You do not have permission to create companies.",
    );
    if (!input.name.trim()) return { ok: false, error: "Company name is required." };
    if (!input.locationName.trim()) {
      return { ok: false, error: "Company location is required." };
    }

    const duplicate = await duplicateNameResult(input.name);
    if (duplicate) return duplicate;

    const channelRole = parseChannelRole(input.channelRole);
    if (input.channelRole && !channelRole) {
      return { ok: false, error: "Invalid channel role." };
    }

    const companyInput: CompanyInput = {
      name: input.name,
      domain: input.domain ?? null,
      industry: input.industry ?? null,
      employeeCount: input.employeeCount ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      channelRole,
      parentCompanyId: input.parentCompanyId ?? null,
      ownerUserId: await resolveCompanyOwnerUserId(
        input.ownerUserId ?? null,
        null,
        "create",
      ),
    };

    const { company } = await createCompanyWithLocation(companyInput, {
      name: input.locationName,
      type: input.locationType === "branch" ? "branch" : "hq",
      address: input.locationAddress ?? null,
      industry: companyInput.industry ?? null,
      ownerUserId: companyInput.ownerUserId,
    });
    return { ok: true, id: company.id };
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      const duplicate = await duplicateNameResult(input.name).catch(() => null);
      return (
        duplicate ?? {
          ok: false,
          error: "A company with this name already exists.",
        }
      );
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create company.",
    };
  }
}

export async function updateCompanyCommand(
  id: string,
  input: CompanyInput,
): Promise<CommandResult> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    await requireRole(
      canEditCompanies,
      "You do not have permission to edit companies.",
    );
    const existing = await prisma.company.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Company not found." };
    await assertRecordAccess(existing.ownerUserId);
    if (!input.name.trim()) return { ok: false, error: "Company name is required." };

    const clash = await findCompanyByNameInsensitive(input.name);
    if (clash && clash.id !== id) {
      return {
        ok: false,
        existingId: clash.id,
        error: `Another company is already named “${clash.name}”. Pick a different name.`,
      };
    }

    input.ownerUserId = await resolveCompanyOwnerUserId(
      input.ownerUserId ?? null,
      existing.ownerUserId,
      "update",
    );
    const company = await updateCompany(id, input);
    return { ok: true, id: company.id };
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      return {
        ok: false,
        error: "Another company is already using this name.",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update company.",
    };
  }
}

export async function deleteCompanyCommand(id: string): Promise<CommandResult> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    await requireRole(
      canEditCompanies,
      "You do not have permission to delete companies.",
    );
    const existing = await prisma.company.findUnique({
      where: { id },
      select: { ownerUserId: true },
    });
    if (!existing) return { ok: false, error: "Company not found." };
    await assertRecordAccess(existing.ownerUserId);
    await deleteCompany(id);
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete company.",
    };
  }
}

export async function createLocationCommand(
  companyId: string,
  input: LocationInput,
): Promise<CommandResult> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    await requireRole(
      canEditCompanies,
      "You do not have permission to edit companies.",
    );
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerUserId: true },
    });
    if (!company) return { ok: false, error: "Company not found." };
    await assertRecordAccess(company.ownerUserId);
    if (!input.name.trim()) return { ok: false, error: "Location name is required." };
    input.ownerUserId = await resolveCompanyOwnerUserId(
      input.ownerUserId ?? null,
      company.ownerUserId,
      "create",
    );
    const location = await createLocation(companyId, input);
    return { ok: true, id: location.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create location.",
    };
  }
}

export async function updateLocationCommand(
  companyId: string,
  locationId: string,
  input: LocationInput,
): Promise<CommandResult> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    await requireRole(
      canEditCompanies,
      "You do not have permission to edit companies.",
    );
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerUserId: true },
    });
    if (!company) return { ok: false, error: "Company not found." };
    await assertRecordAccess(company.ownerUserId);
    const existingLocation = await prisma.companyLocation.findFirst({
      where: { id: locationId, companyId },
      select: { ownerUserId: true },
    });
    input.ownerUserId = await resolveCompanyOwnerUserId(
      input.ownerUserId ?? null,
      existingLocation?.ownerUserId ?? company.ownerUserId,
      "update",
    );
    const location = await updateLocation(companyId, locationId, input);
    return { ok: true, id: location.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update location.",
    };
  }
}

export async function deleteLocationCommand(
  companyId: string,
  locationId: string,
): Promise<CommandResult> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    await requireRole(
      canEditCompanies,
      "You do not have permission to edit companies.",
    );
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerUserId: true },
    });
    if (!company) return { ok: false, error: "Company not found." };
    await assertRecordAccess(company.ownerUserId);
    await deleteLocation(companyId, locationId);
    return { ok: true, id: locationId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete location.",
    };
  }
}

export type QueryFailure = { ok: false; error: string; status: 404 | 403 | 500 };

/** Locations grid + attributed contacts for the company overview page. */
export async function getCompanyLocationsCommand(
  companyId: string,
): Promise<
  | {
      ok: true;
      companyId: string;
      companyName: string;
      locations: Array<{
        id: string;
        name: string;
        type: LocationType;
        address: string | null;
        city: string | null;
        ownerName: string | null;
        leadCount: number;
        dealCount: number;
        customerCount: number;
      }>;
      contacts: Array<{
        id: string;
        displayName: string;
        email: string;
        title: string | null;
        contactType: string;
        status: string;
      }>;
      contactTotal: number;
      expansionSignal: string | null;
      expansionReason: string | null;
      expansionDraft: string | null;
      expansionLastRunAt: string | null;
    }
  | QueryFailure
> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    const scope = await resolveRecordOwnerScope();
    const [company, contactsResult] = await Promise.all([
      getCompany(companyId, { dealOwnerUserId: scope.ownerUserId }),
      listContacts({
        companyId,
        pageSize: 100,
        page: 1,
        ownerUserId: scope.ownerUserId,
      }),
    ]);
    if (!company) {
      return { ok: false, error: "Company not found.", status: 404 };
    }
    try {
      await assertCompanyViewAccess(company);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Forbidden",
        status: 403,
      };
    }

    const contactRefs = contactsResult.items.map((c) => ({
      id: c.id,
      ownerUserId: c.crm.ownerUserId ?? c.person.ownerUserId ?? null,
      city: c.person.city,
      locationId: c.person.locationId,
      contactType: c.person.contactType,
      leadStatus: c.person.leadStatus,
    }));

    const locationRefs = company.locations.map((loc) => ({
      id: loc.id,
      type: loc.type,
      ownerUserId: loc.ownerUserId,
      name: loc.name,
      city: loc.city,
    }));

    const ownerLabels = await getUserLabelsByIds([
      company.ownerUserId,
      ...company.locations.map((loc) => loc.ownerUserId),
    ]);

    return {
      ok: true,
      companyId: company.id,
      companyName: company.name,
      locations: company.locations.map((loc) => {
        const ownerId = loc.ownerUserId ?? company.ownerUserId;
        const ownerLabel = ownerId ? (ownerLabels.get(ownerId) ?? null) : null;
        const locationContacts = attributeContactsToLocation(
          contactRefs,
          {
            id: loc.id,
            type: loc.type,
            ownerUserId: loc.ownerUserId,
            name: loc.name,
            city: loc.city,
          },
          locationRefs,
        );
        const { leadCount, dealCount, customerCount } =
          funnelCountsFromContacts(locationContacts);
        return {
          id: loc.id,
          name: loc.name,
          type: loc.type,
          address: loc.address,
          city: loc.city,
          ownerName: ownerLabel
            ? ownerLabel.replace(/\s*\([^)]*\)\s*$/, "")
            : null,
          leadCount,
          dealCount,
          customerCount,
        };
      }),
      contacts: contactsResult.items.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        email: c.person.email,
        title: c.person.title,
        contactType: c.person.contactType,
        status: c.crm.status,
      })),
      contactTotal: contactsResult.pagination.total,
      expansionSignal: company.expansionSignal ?? null,
      expansionReason: company.expansionReason ?? null,
      expansionDraft: company.expansionDraft ?? null,
      expansionLastRunAt: company.expansionLastRunAt
        ? company.expansionLastRunAt.toISOString()
        : null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load locations.",
      status: 500,
    };
  }
}

/** Location detail + contacts attributed to it, for the branch detail page. */
export async function getLocationCommand(
  companyId: string,
  locationId: string,
): Promise<
  | {
      ok: true;
      companyId: string;
      companyName: string;
      location: {
        id: string;
        name: string;
        type: LocationType;
        address: string | null;
        city: string | null;
        industry: string | null;
        employeeCount: number | null;
        ownerUserId: string | null;
        companyIndustry: string | null;
        companyEmployeeCount: number | null;
      };
      contacts: Array<{
        id: string;
        displayName: string;
        email: string;
        title: string | null;
        contactType: string;
        status: string;
      }>;
    }
  | QueryFailure
> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    const scope = await resolveRecordOwnerScope();
    const [location, company] = await Promise.all([
      getLocation(companyId, locationId),
      getCompany(companyId, { dealOwnerUserId: scope.ownerUserId }),
    ]);
    if (!location || !company) {
      return { ok: false, error: "Location not found.", status: 404 };
    }
    try {
      await assertCompanyViewAccess(company);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Forbidden",
        status: 403,
      };
    }

    const contactsResult = await listContacts({
      companyId,
      pageSize: 200,
      page: 1,
      ownerUserId: scope.ownerUserId,
    });

    const locationRefs = company.locations.map((loc) => ({
      id: loc.id,
      type: loc.type,
      ownerUserId: loc.ownerUserId,
      name: loc.name,
      city: loc.city,
    }));

    const locationContacts = contactsResult.items.filter(
      (c) =>
        resolveContactLocationId(
          {
            id: c.id,
            ownerUserId: c.crm.ownerUserId ?? c.person.ownerUserId ?? null,
            city: c.person.city,
            locationId: c.person.locationId,
          },
          locationRefs,
        ) === locationId,
    );

    return {
      ok: true,
      companyId: location.companyId,
      companyName: location.company.name,
      location: {
        id: location.id,
        name: location.name,
        type: location.type,
        address: location.address,
        city: location.city,
        industry: location.industry,
        employeeCount: location.employeeCount,
        ownerUserId: location.ownerUserId,
        companyIndustry: company.industry,
        companyEmployeeCount: company.employeeCount,
      },
      contacts: locationContacts.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        email: c.person.email,
        title: c.person.title,
        contactType: c.person.contactType,
        status: c.person.status,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load location.",
      status: 500,
    };
  }
}

/** Options for the create/edit location form (shared by "new" and "edit" routes). */
export async function getLocationFormOptionsCommand(
  companyId: string,
  locationId?: string | null,
): Promise<
  | {
      ok: true;
      companyId: string;
      companyName: string;
      hasHq: boolean;
      canAssignOwner: boolean;
      currentUserId: string | null;
      assignableUsers: Array<{ id: string; label: string }>;
      location: {
        id: string;
        name: string;
        type: LocationType;
        address: string | null;
        industry: string | null;
        ownerUserId: string | null;
      } | null;
    }
  | QueryFailure
> {
  try {
    await requireModuleEnabled(
      "company",
      "Companies are not available for your business type.",
    );
    const company = await getCompany(companyId);
    if (!company) {
      return { ok: false, error: "Company not found.", status: 404 };
    }

    const [role, assignableUsers, currentUserId] = await Promise.all([
      getCurrentUserRole(),
      listAssignableUsers(),
      getServerUserId(),
    ]);

    let location: {
      id: string;
      name: string;
      type: LocationType;
      address: string | null;
      industry: string | null;
      ownerUserId: string | null;
    } | null = null;

    if (locationId) {
      const existing = await getLocation(companyId, locationId);
      if (!existing) {
        return { ok: false, error: "Location not found.", status: 404 };
      }
      try {
        await assertRecordAccess(existing.ownerUserId ?? company.ownerUserId);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Forbidden",
          status: 403,
        };
      }
      location = {
        id: existing.id,
        name: existing.name,
        type: existing.type,
        address: existing.address,
        industry: existing.industry,
        ownerUserId: existing.ownerUserId,
      };
    } else {
      try {
        await assertRecordAccess(company.ownerUserId);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Forbidden",
          status: 403,
        };
      }
    }

    const hasHq = company.locations.some(
      (loc) => loc.type === "hq" && loc.id !== locationId,
    );

    return {
      ok: true,
      companyId: company.id,
      companyName: company.name,
      hasHq,
      canAssignOwner: canAssignContactOwner(role),
      currentUserId,
      assignableUsers: assignableUsers.map((u) => ({
        id: u.id,
        label: u.label,
      })),
      location,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load form.",
      status: 500,
    };
  }
}
