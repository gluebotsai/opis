import crypto from "node:crypto";

import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { LEAD_STATUS_VALUES } from "../../lib/statuses.js";
import {
  deleteAdditionalAddressesExcept,
  insertLeadAssignmentRow,
  insertLeadRow,
  selectActiveProductsForLead,
  selectAdditionalAddressesForLead,
  selectAllTenantIds,
  countLeadsOwnedByUser as countLeadsOwnedByUserRow,
  selectLatestQuotationMetaForLead,
  selectLeadAssignedUserId,
  selectLeadById,
  selectLeadOwnershipRow,
  selectLeads,
  selectLeadsOwnedByUser,
  selectSubscriptionsForLead,
  updateLeadAssignment,
  updateLeadCreator,
  updateLeadRow,
  updateLeadStatusRaw,
  upsertAdditionalAddressRow,
  upsertBranchRow,
} from "../../repositories/raw/leads.repo.js";
import { getResellerSummaryForLead } from "../resellers/reseller-store.js";
import { getPartnerSummaryForLead } from "../partners/partner-store.js";
import { normalizeLeadDialCode } from "../../lib/mobile-validation.js";
import { validateLeadPayload } from "./contact-validation.js";
import {
  selectOrganizationByLeadId,
  selectOrganizationLocations,
} from "../../repositories/raw/organizations.repo.js";

export const HQ_BRANCH_ID = "hq";

const LEAD_STATUSES = LEAD_STATUS_VALUES;
const INDUSTRY_OTHER = "Other";

/** Prefer industryType; fall back to industrySelection / customIndustryType from the form. */
function resolveIndustryTypeFromPayload(payload: any = {}) {
  const direct = String(payload.industryType || "").trim();
  if (direct) {
    return direct;
  }
  const selection = String(payload.industrySelection || "").trim();
  if (selection === INDUSTRY_OTHER) {
    return String(payload.customIndustryType || "").trim();
  }
  return selection;
}

function generateTenantId(usedIds: any) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }

  return String(Date.now()).slice(-4);
}

export function deriveBranchesFromLead(lead: any) {
  const branches = [];
  const leadCountry = String(lead?.country || "").trim();

  if (String(lead.billingAddress || "").trim()) {
    branches.push({
      id: HQ_BRANCH_ID,
      label: "Head office",
      address: lead.billingAddress.trim(),
      country: leadCountry,
      state: String(lead?.state || "").trim(),
      taxNumber: String(lead?.taxNumber || "").trim(),
      isPrimary: true,
    });
  }

  for (const entry of lead.additionalAddresses || []) {
    if (!String(entry?.address || "").trim()) {
      continue;
    }

    branches.push({
      id: entry.id,
      label: String(entry.label || "").trim() || "Branch",
      address: String(entry.address || "").trim(),
      country: String(entry.country || "").trim() || leadCountry,
      state: String(entry.state || "").trim(),
      taxNumber: String(entry.taxNumber || "").trim(),
      isPrimary: false,
    });
  }

  return branches;
}

async function loadSubscriptions(client: any, leadId: any) {
  const rows = await selectSubscriptionsForLead(client, leadId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: (entry as any).id,
      key: (entry as any).key,
      organizationId: (entry as any).organizationId,
      productId: (entry as any).productId,
      branchId: (entry as any).branchId,
      billingBranchId: (entry as any).billingBranchId,
      status: (entry as any).status || "active",
      changeType: (entry as any).changeType || "new",
      entitlementConfig: (entry as any).entitlementConfig || null,
      priceLabel: (entry as any).priceLabel || "",
      implementationPurchased: (entry as any).implementationPurchased === true,
      mrr: (entry as any).mrr !== null ? Number((entry as any).mrr) : null,
      startsAt: toIso((entry as any).startsAt),
      approvedAt: toIso((entry as any).approvedAt),
      renewsAt: toIso((entry as any).renewsAt),
      paymentConfirmedAt: toIso((entry as any).paymentConfirmedAt),
      quotationId: (entry as any).quotationId || null,
      cancelledAt: toIso((entry as any).cancelledAt),
      cancelledBy: (entry as any).cancelledBy || "",
      cancellationReason: (entry as any).cancellationReason || "",
      cancelAtPeriodEnd: (entry as any).cancelAtPeriodEnd === true,
      cancelEffectiveAt: toIso((entry as any).cancelEffectiveAt),
      scheduledCancellationRequestId: (entry as any).scheduledCancellationRequestId || null,
    };
  });
}

async function loadActiveProducts(client: any, leadId: any) {
  const rows = await selectActiveProductsForLead(client, leadId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      key: (entry as any).key,
      productId: (entry as any).productId,
      branchId: (entry as any).branchId,
      billingBranchId: (entry as any).billingBranchId,
      changeType: (entry as any).changeType || "new",
      config: (entry as any).config || null,
      implementationPurchased: (entry as any).implementationPurchased === true,
      priceLabel: (entry as any).priceLabel || "",
      approvedAt: toIso((entry as any).approvedAt),
      paymentConfirmedAt: toIso((entry as any).paymentConfirmedAt),
      quotationId: (entry as any).quotationId,
      lifecycleStatus: (entry as any).lifecycleStatus || null,
      goLiveId: (entry as any).goLiveId || null,
    };
  });
}

async function loadAdditionalAddresses(client: any, leadId: any) {
  const rows = await selectAdditionalAddressesForLead(client, leadId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: (entry as any).id,
      label: (entry as any).label || "Branch",
      address: (entry as any).address || "",
      country: (entry as any).country || "",
      state: (entry as any).state || "",
      taxNumber: (entry as any).taxNumber || "",
      industryType: (entry as any).industryType || "",
      businessType: (entry as any).businessType || "",
      companySize: (entry as any).companySize || "",
      websiteUrl: (entry as any).websiteUrl || "",
      contactName: (entry as any).contactName || "",
      designation: (entry as any).designation || "",
      workEmail: (entry as any).workEmail || "",
      mobileCountryCode: (entry as any).mobileCountryCode || "+91",
      mobileNumber: (entry as any).mobileNumber || "",
      secondaryMobileCountryCode: (entry as any).secondaryMobileCountryCode || "+91",
      secondaryMobileNumber: (entry as any).secondaryMobileNumber || "",
    };
  });
}

async function loadLatestQuotationMeta(client: any, leadId: any) {
  const row = await selectLatestQuotationMetaForLead(client, leadId);

  if (!row) {
    return null;
  }

  const mapped = rowToCamel(row);
  return {
    financeQuotationId: (mapped as any).id,
    financeNote: (mapped as any).financeNote || "",
    financeReviewedAt: toIso((mapped as any).reviewedAt),
    financeReviewedBy: (mapped as any).reviewedBy || "",
    latestQuotationStatus: (mapped as any).status,
  };
}

function mapOrganizationLocationsForLead(rows: any) {
  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: (entry as any).id,
      label: (entry as any).label || "",
      address: (entry as any).address || "",
      isPrimary: (entry as any).isPrimary === true,
      country: (entry as any).country || "",
      taxNumber: (entry as any).taxNumber || "",
      contactName: (entry as any).contactName || "",
      designation: (entry as any).designation || "",
      workEmail: (entry as any).workEmail || "",
      industryType: (entry as any).industryType || "",
      mobileCountryCode: (entry as any).mobileCountryCode || "",
      mobileNumber: (entry as any).mobileNumber || "",
      secondaryMobileCountryCode: (entry as any).secondaryMobileCountryCode || "",
      secondaryMobileNumber: (entry as any).secondaryMobileNumber || "",
      status: (entry as any).status || "active",
      inactivatedAt: toIso((entry as any).inactivatedAt),
      scheduledDropAt: toIso((entry as any).scheduledDropAt),
    };
  });
}

async function loadOrganizationLocationsForLead(client: any, leadId: any) {
  const org = await selectOrganizationByLeadId(client, leadId);
  if (!org?.id) {
    return [];
  }
  const rows = await selectOrganizationLocations(client, org.id);
  return mapOrganizationLocationsForLead(rows);
}

function mapLeadRow(
  row: any,
  additionalAddresses: any,
  activeProducts: any,
  quotationMeta: any,
  subscriptions = [],
  reseller = null,
  partner = null,
  organizationLocations = [],
) {
  const lead = rowToCamel(row);
  return {
    id: (lead as any).id,
    tenantId: (lead as any).tenantId,
    companyName: (lead as any).companyName || "",
    industryType: (lead as any).industryType || "",
    businessType: (lead as any).businessType || "",
    contactName: (lead as any).contactName || "",
    designation: (lead as any).designation || "",
    workEmail: (lead as any).workEmail || "",
    adminEmail: (lead as any).adminEmail || "",
    taxNumber: (lead as any).taxNumber || "",
    billingAddress: (lead as any).billingAddress || "",
    websiteUrl: (lead as any).websiteUrl || "",
    country: (lead as any).country || "",
    state: (lead as any).state || "",
    companySize: (lead as any).companySize || "",
    isDecisionMaker: (lead as any).isDecisionMaker !== false,
    decisionMakerName: (lead as any).decisionMakerName || "",
    mobileCountryCode: (lead as any).mobileCountryCode || "+91",
    mobileNumber: (lead as any).mobileNumber || "",
    secondaryMobileCountryCode: (lead as any).secondaryMobileCountryCode || "+91",
    secondaryMobileNumber: (lead as any).secondaryMobileNumber || "",
    status: LEAD_STATUSES.includes((lead as any).status) ? (lead as any).status : "New",
    isActive: (lead as any).isActive !== false,
    leadKind:
      String((lead as any).leadKind || "").toLowerCase() === "temporary"
        ? "temporary"
        : "standard",
    productDraft: (lead as any).productDraft || null,
    assignedUserId: (lead as any).assignedUserId || null,
    createdByUserId: (lead as any).createdByUserId || null,
    assignedAt: toIso((lead as any).assignedAt),
    organizationId: (lead as any).organizationId || null,
    convertedOrganizationId: (lead as any).convertedOrganizationId || null,
    convertedAt: toIso((lead as any).convertedAt),
    resellerId: (lead as any).resellerId || null,
    reseller: reseller || null,
    partnerId: (lead as any).partnerId || null,
    partner: partner || null,
    additionalAddresses,
    organizationLocations,
    activeProducts,
    subscriptions,
    createdAt: toIso((lead as any).createdAt),
    updatedAt: toIso((lead as any).updatedAt),
    ...(quotationMeta || {}),
  };
}

async function hydrateLead(client: any, row: any) {
  const additionalAddresses = await loadAdditionalAddresses(client, row.id);
  const activeProducts = await loadActiveProducts(client, row.id);
  const subscriptions = await loadSubscriptions(client, row.id);
  const quotationMeta = await loadLatestQuotationMeta(client, row.id);
  const organizationLocations = await loadOrganizationLocationsForLead(client, row.id);
  const lead = rowToCamel(row);
  const reseller = (lead as any).resellerId ? await getResellerSummaryForLead((lead as any).resellerId) : null;
  const partner = (lead as any).partnerId ? await getPartnerSummaryForLead((lead as any).partnerId) : null;

  return mapLeadRow(
    row,
    additionalAddresses,
    activeProducts,
    quotationMeta,
    subscriptions,
    (reseller as any),
    (partner as any),
    organizationLocations,
  );
}

async function syncBranches(client: any, leadId: any, lead: any, assignments = []) {
  const branches = [...deriveBranchesFromLead(lead)];
  const branchIds = new Set(branches.map((branch) => branch.id));

  for (const assignment of assignments || []) {
    for (const branchId of [(assignment as any).branchId, (assignment as any).billingBranchId]) {
      if (!branchId || branchIds.has(branchId)) {
        continue;
      }

      branches.push({
        id: branchId,
        label: branchId === HQ_BRANCH_ID ? "Head office" : "Branch",
        address: String(lead?.billingAddress || "").trim(),
        country: String(lead?.country || "").trim(),
        taxNumber: String(lead?.taxNumber || "").trim(),
        state: String(lead?.state || "").trim(),
        isPrimary: branchId === HQ_BRANCH_ID,
      });
      branchIds.add(branchId);
    }
  }

  // Upsert only — never delete branches referenced by quotations or active products.
  for (const branch of branches) {
    await upsertBranchRow(client, [
      branch.id,
      leadId,
      branch.label,
      branch.address,
      branch.country || null,
      branch.state || null,
      branch.taxNumber || null,
      branch.isPrimary,
    ]);
  }
}

async function syncAdditionalAddresses(client: any, leadId: any, addresses: any, leadCountry = "") {
  const normalized = normalizeAdditionalAddresses(addresses, leadCountry);
  const retainedIds = normalized.map((entry: any) => entry.id);

  await deleteAdditionalAddressesExcept(client, leadId, retainedIds);

  for (const entry of normalized) {
    await upsertAdditionalAddressRow(client, [
        entry.id,
        leadId,
        entry.label,
        entry.address,
        entry.country || null,
        entry.state || null,
        entry.taxNumber || null,
        entry.industryType || null,
        entry.businessType || null,
        entry.companySize || null,
        entry.websiteUrl || null,
        entry.contactName || null,
        entry.designation || null,
        entry.workEmail || null,
        entry.mobileCountryCode || null,
        entry.mobileNumber || null,
        entry.secondaryMobileCountryCode || null,
        entry.secondaryMobileNumber || null,
    ]);
  }
}

async function reserveTenantId(client: any) {
  const rows = await selectAllTenantIds(client);
  const usedIds = new Set(rows.map((row: any) => row.tenant_id));
  return generateTenantId(usedIds);
}

function normalizeAdditionalAddresses(addresses: any, leadCountry = "") {
  const fallbackCountry = String(leadCountry || "").trim();

  return (addresses || [])
    .filter((entry: any) => String(entry?.address || "").trim())
    .map((entry: any) => ({
      id: entry.id || crypto.randomUUID(),
      label: String(entry.label || "").trim() || "Branch",
      address: String(entry.address || "").trim(),
      country: String(entry.country || "").trim() || fallbackCountry,
      state: String(entry.state || "").trim(),
      taxNumber: String(entry.taxNumber || "").trim(),
      industryType: String(entry.industryType || "").trim(),
      businessType: String(entry.businessType || "").trim(),
      companySize: String(entry.companySize || "").trim(),
      websiteUrl: String(entry.websiteUrl || "").trim(),
      contactName: String(entry.contactName || "").trim(),
      designation: String(entry.designation || "").trim(),
      workEmail: String(entry.workEmail || "").trim(),
      mobileCountryCode: normalizeLeadDialCode(entry.mobileCountryCode),
      mobileNumber: String(entry.mobileNumber || "").trim(),
      secondaryMobileCountryCode: normalizeLeadDialCode(entry.secondaryMobileCountryCode),
      secondaryMobileNumber: String(entry.secondaryMobileNumber || "").trim(),
    }));
}

export async function listLeads({ createdByUserId = null, pipelineOnly = false, leadKind = null }: any = {}) {
  const client = await pool.connect();
  try {
    const rows = await selectLeads(client, { createdByUserId, pipelineOnly, leadKind });
    const leads = [];

    for (const row of rows) {
      leads.push(await hydrateLead(client, row));
    }

    return leads;
  } finally {
    client.release();
  }
}

export async function getLeadById(leadId: any, client = null) {
  if (client) {
    const row = await selectLeadById(client, leadId);
    if (!row) {
      return null;
    }
    return hydrateLead(client, row);
  }

  const dbClient = await pool.connect();
  try {
    const row = await selectLeadById(dbClient, leadId);
    if (!row) {
      return null;
    }

    return hydrateLead(dbClient, row);
  } finally {
    dbClient.release();
  }
}

export async function getLeadOwnership(leadId: any) {
  const row = await selectLeadOwnershipRow(pool, leadId);
  if (!row) {
    return null;
  }
  const mapped = rowToCamel(row);
  return {
    id: (mapped as any).id,
    assignedUserId: (mapped as any).assignedUserId || null,
    createdByUserId: (mapped as any).createdByUserId || null,
    partnerId: (mapped as any).partnerId || null,
    resellerId: (mapped as any).resellerId || null,
  };
}

export function assertLeadSourceExclusive({ partnerId = null, resellerId = null } = {}) {
  if (partnerId && resellerId) {
    throw new Error("A lead cannot be both partner-sourced and reseller-sourced.");
  }
}

export function canUserCreateQuotation(authUser: any, ownership: any) {
  if (!authUser || !ownership) {
    return false;
  }

  if (authUser.role !== "sales" && authUser.role !== "sales_admin") {
    return false;
  }

  // Sales admin can create quotations for any lead they can view (oversight / cover).
  if (authUser.role === "sales_admin") {
    return true;
  }

  if (ownership.partnerId) {
    return ownership.assignedUserId === authUser.userId;
  }

  if (ownership.resellerId) {
    return false;
  }

  return canUserModifyLead(authUser, ownership);
}

export function canUserModifyLead(authUser: any, ownership: any) {
  if (!authUser?.userId || !ownership) {
    return false;
  }

  if (authUser.role !== "sales" && authUser.role !== "sales_admin") {
    return false;
  }

  // Sales admin can modify any lead they can view (oversight / cover).
  if (authUser.role === "sales_admin") {
    return true;
  }

  if (ownership.assignedUserId) {
    return ownership.assignedUserId === authUser.userId;
  }

  return ownership.createdByUserId === authUser.userId;
}

export function canUserViewLead(authUser: any, ownership: any) {
  if (!authUser || !ownership) {
    return false;
  }

  if (
    authUser.role === "sales_admin" ||
    authUser.role === "admin" ||
    authUser.role === "finance"
  ) {
    return true;
  }

  if (authUser.role === "sales") {
    return (
      ownership.createdByUserId === authUser.userId ||
      ownership.assignedUserId === authUser.userId
    );
  }

  return false;
}

export async function createLead(payload: any, options: any = {}) {
  const {
    createdByUserId = null,
    partnerId = null,
    resellerId = payload.resellerId || null,
    assignedUserId = createdByUserId,
    assignmentReason = createdByUserId ? "Auto-assigned on lead creation" : null,
  } = options;

  assertLeadSourceExclusive({ partnerId, resellerId });

  await validateLeadPayload(payload);

  return withTransaction(async (client) => {
    const tenantId = await reserveTenantId(client);
    const additionalAddresses = normalizeAdditionalAddresses(
      payload.additionalAddresses,
      payload.country,
    );
    const now = new Date().toISOString();
    const resolvedAssignedUserId = assignedUserId ?? null;

    const industryType = resolveIndustryTypeFromPayload(payload);
    const mobileCountryCode = normalizeLeadDialCode(payload.mobileCountryCode);
    const secondaryMobileCountryCode = normalizeLeadDialCode(payload.secondaryMobileCountryCode);

    const { createProspectOrganization } = await import("../organizations/organization-store.js");
    const prospectOrg = await createProspectOrganization(client, {
      tenantId,
      companyName: payload.companyName?.trim() || "",
      industryType,
      contactName: payload.contactName?.trim() || "",
      designation: payload.designation?.trim() || "",
      workEmail: payload.workEmail?.trim() || "",
      adminEmail: payload.adminEmail?.trim() || "",
      taxNumber: payload.taxNumber?.trim() || "",
      billingAddress: payload.billingAddress?.trim() || "",
      websiteUrl: payload.websiteUrl?.trim() || "",
      country: payload.country?.trim() || "",
      companySize: payload.companySize?.trim() || "",
      mobileCountryCode,
      mobileNumber: payload.mobileNumber?.trim() || "",
      resellerId: resellerId || null,
    });

    const leadKind =
      String(payload.leadKind || "").toLowerCase() === "temporary" ? "temporary" : "standard";

    const leadRow = await insertLeadRow(client, [
        payload.companyName?.trim() || "",
        industryType,
        payload.businessType?.trim() || "",
        payload.contactName?.trim() || "",
        payload.designation?.trim() || "",
        payload.workEmail?.trim() || "",
        payload.adminEmail?.trim() || "",
        payload.taxNumber?.trim() || "",
        payload.billingAddress?.trim() || "",
        payload.websiteUrl?.trim() || "",
        payload.country?.trim() || "",
        payload.state?.trim() || "",
        payload.companySize?.trim() || "",
        payload.isDecisionMaker !== false,
        payload.decisionMakerName?.trim() || "",
        mobileCountryCode,
        payload.mobileNumber?.trim() || "",
        secondaryMobileCountryCode,
        payload.secondaryMobileNumber?.trim() || "",
        "New",
        true,
        tenantId,
        resolvedAssignedUserId,
        createdByUserId,
        resolvedAssignedUserId ? now : null,
        resellerId || null,
        partnerId || null,
        prospectOrg.id,
        leadKind,
      ]);

    const { updateOrganizationSourceLead } = await import(
      "../../repositories/raw/organizations.repo.js"
    );
    await updateOrganizationSourceLead(client, prospectOrg.id, leadRow.id);

    if (resolvedAssignedUserId && assignmentReason) {
      await insertLeadAssignmentRow(client, [
        leadRow.id,
        null,
        resolvedAssignedUserId,
        createdByUserId || resolvedAssignedUserId,
        assignmentReason,
      ]);
    }

    await syncAdditionalAddresses(client, leadRow.id, additionalAddresses, payload.country);
    const lead = await hydrateLead(client, leadRow);
    await syncBranches(client, leadRow.id, lead);
    return lead;
  });
}

export async function assignLead(leadId: any, toUserId: any, { assignedByUserId, reason = "" }: any = {}) {
  let assigneeChanged = false;

  const lead = await withTransaction(async (client) => {
    const existingRow = await selectLeadAssignedUserId(client, leadId);
    if (!existingRow) {
      return null;
    }

    const fromUserId = existingRow.assigned_user_id;
    assigneeChanged = String(fromUserId || "") !== String(toUserId || "");

    await updateLeadAssignment(client, leadId, toUserId);

    await insertLeadAssignmentRow(client, [
      leadId,
      fromUserId,
      toUserId,
      assignedByUserId,
      reason || null,
    ]);

    const refreshedRow = await selectLeadById(client, leadId);
    return hydrateLead(client, refreshedRow);
  });

  if (!lead) {
    return null;
  }

  if (lead.partnerId && lead.assignedUserId) {
    const { queuePortalLeadCreatedEmail } = await import("../../infra/notify.js");
    void queuePortalLeadCreatedEmail(lead.id, { event: "assigned" });
  }

  if (assigneeChanged && lead.assignedUserId) {
    const { queueSalesLeadAssignedEmail } = await import("../../infra/notify.js");
    void queueSalesLeadAssignedEmail(lead.id, {
      toUserId: lead.assignedUserId,
      assignedByUserId,
      reason,
    });
  }

  return lead;
}

export async function countLeadsOwnedByUser(userId: any) {
  return countLeadsOwnedByUserRow(pool, userId);
}

/**
 * Transfer every lead owned by fromUserId (assignee or creator) to toUserId.
 * When the leaving user is only the creator, update creator only so the current
 * assignee is not stolen. When they are the assignee, move assignee + creator.
 */
export async function reassignAllLeadsOwnedByUser(
  fromUserId: any,
  toUserId: any,
  { assignedByUserId, reason = "" }: any = {},
) {
  if (!fromUserId || !toUserId) {
    throw new Error("fromUserId and toUserId are required.");
  }
  if (String(fromUserId) === String(toUserId)) {
    throw new Error("Cannot reassign leads to the same user.");
  }

  const assigneeLeadIds: string[] = [];

  const result = await withTransaction(async (client) => {
    const owned = await selectLeadsOwnedByUser(client, fromUserId);
    let transferred = 0;

    for (const row of owned) {
      const leadId = row.id;
      const isAssignee = String(row.assigned_user_id || "") === String(fromUserId);
      const isCreator = String(row.created_by_user_id || "") === String(fromUserId);

      if (isAssignee) {
        await updateLeadAssignment(client, leadId, toUserId);
        await insertLeadAssignmentRow(client, [
          leadId,
          row.assigned_user_id,
          toUserId,
          assignedByUserId,
          reason || null,
        ]);
        assigneeLeadIds.push(String(leadId));
        transferred += 1;
      } else if (isCreator) {
        await updateLeadCreator(client, leadId, toUserId);
        transferred += 1;
      }
    }

    return {
      fromUserId: String(fromUserId),
      toUserId: String(toUserId),
      transferred,
    };
  });

  if (assigneeLeadIds.length) {
    const { queueSalesLeadAssignedEmail } = await import("../../infra/notify.js");
    for (const leadId of assigneeLeadIds) {
      void queueSalesLeadAssignedEmail(leadId, {
        toUserId,
        assignedByUserId,
        reason,
      });
    }
  }

  return result;
}

export async function updateLead(leadId: any, updates: any) {
  const existingRow = await selectLeadById(pool, leadId);
  if (!existingRow) {
    return null;
  }

  const current = await hydrateLead(pool, existingRow);
  const additionalAddresses =
    updates.additionalAddresses !== undefined
      ? normalizeAdditionalAddresses(updates.additionalAddresses, updates.country ?? current.country)
      : current.additionalAddresses;

  const next = {
    ...current,
    ...updates,
    id: current.id,
    tenantId: current.tenantId,
    additionalAddresses,
    activeProducts: current.activeProducts,
  };

  // GSTIN / tax checks belong to lead create and tax-field edits — not draft clears,
  // status/product updates, or other non-tax patches that would block finance submit.
  const taxFieldsTouched =
    updates.taxNumber !== undefined ||
    updates.state !== undefined ||
    updates.country !== undefined ||
    updates.additionalAddresses !== undefined;

  await validateLeadPayload(
    {
      workEmail: next.workEmail,
      adminEmail: next.adminEmail,
      mobileCountryCode: next.mobileCountryCode,
      mobileNumber: next.mobileNumber,
      secondaryMobileCountryCode: next.secondaryMobileCountryCode,
      secondaryMobileNumber: next.secondaryMobileNumber,
      taxNumber: next.taxNumber,
      state: next.state,
      country: next.country,
      additionalAddresses: next.additionalAddresses,
    },
    { ignoreLeadId: leadId, skipTaxValidation: !taxFieldsTouched },
  );

  return withTransaction(async (client) => {
    const existingRowInTx = await selectLeadById(client, leadId);
    if (!existingRowInTx) {
      return null;
    }

    const currentInTx = await hydrateLead(client, existingRowInTx);
    const additionalAddressesInTx =
      updates.additionalAddresses !== undefined
        ? normalizeAdditionalAddresses(updates.additionalAddresses, updates.country ?? currentInTx.country)
        : currentInTx.additionalAddresses;

    const nextInTx = {
      ...currentInTx,
      ...updates,
      id: currentInTx.id,
      tenantId: currentInTx.tenantId,
      additionalAddresses: additionalAddressesInTx,
      activeProducts: currentInTx.activeProducts,
    };

    if (updates.industryType !== undefined || updates.industrySelection !== undefined) {
      nextInTx.industryType = resolveIndustryTypeFromPayload({
        ...currentInTx,
        ...updates,
      });
    }
    if (updates.mobileCountryCode !== undefined) {
      nextInTx.mobileCountryCode = normalizeLeadDialCode(updates.mobileCountryCode);
    }
    if (updates.secondaryMobileCountryCode !== undefined) {
      nextInTx.secondaryMobileCountryCode = normalizeLeadDialCode(
        updates.secondaryMobileCountryCode,
      );
    }

    delete nextInTx.activeProducts;
    delete nextInTx.financeNote;
    delete nextInTx.financeReviewedAt;
    delete nextInTx.financeReviewedBy;
    delete nextInTx.financeQuotationId;
    delete nextInTx.latestQuotationStatus;
    delete nextInTx.createdAt;

    await updateLeadRow(client, [
      leadId,
      nextInTx.companyName,
      nextInTx.industryType,
      nextInTx.businessType || "",
      nextInTx.contactName,
      nextInTx.designation,
      nextInTx.workEmail,
      nextInTx.adminEmail,
      nextInTx.taxNumber,
      nextInTx.billingAddress,
      nextInTx.websiteUrl,
      nextInTx.country || "",
      nextInTx.state || "",
      nextInTx.companySize || "",
      nextInTx.isDecisionMaker !== false,
      nextInTx.decisionMakerName || "",
      nextInTx.mobileCountryCode,
      nextInTx.mobileNumber,
      nextInTx.secondaryMobileCountryCode,
      nextInTx.secondaryMobileNumber,
      LEAD_STATUSES.includes(nextInTx.status) ? nextInTx.status : currentInTx.status,
      nextInTx.isActive !== false,
      nextInTx.productDraft !== undefined ? nextInTx.productDraft : currentInTx.productDraft,
      nextInTx.resellerId !== undefined ? nextInTx.resellerId || null : currentInTx.resellerId,
    ]);

    await syncAdditionalAddresses(client, leadId, additionalAddressesInTx, nextInTx.country);
    const refreshedRow = await selectLeadById(client, leadId);
    const refreshed = await hydrateLead(client, refreshedRow);
    const draftAssignments = nextInTx.productDraft?.assignments || [];
    await syncBranches(client, leadId, refreshed, draftAssignments);

    const linkedOrgId =
      refreshed.organizationId || refreshed.convertedOrganizationId || null;
    if (linkedOrgId) {
      const { syncOrganizationProfileFromLead } = await import(
        "../organizations/organization-store.js"
      );
      await syncOrganizationProfileFromLead(client, leadId, linkedOrgId);
    }

    return refreshed;
  });
}

export async function loadLeadSnapshot(client: any, leadId: any) {
  const row = await selectLeadById(client, leadId);
  if (!row) {
    return null;
  }

  return hydrateLead(client, row);
}

export async function ensureAssignmentBranchRows(client: any, leadId: any, leadSnapshot: any, assignments = []) {
  await syncBranches(client, leadId, leadSnapshot, assignments);
}

/** @deprecated Use ensureAssignmentBranchRows */
export async function ensureBranchesForLead(client: any, leadId: any, leadSnapshot: any, assignments = []) {
  await ensureAssignmentBranchRows(client, leadId, leadSnapshot, assignments);
}

export async function updateLeadStatus(client: any, leadId: any, status: any) {
  await updateLeadStatusRaw(client, leadId, status);
}
