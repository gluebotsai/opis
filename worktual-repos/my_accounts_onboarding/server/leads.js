import crypto from "node:crypto";

import { pool, withTransaction } from "./db/pool.js";
import { rowToCamel, toIso } from "./db/util.js";
import { LEAD_STATUS_VALUES } from "./statuses.js";
import {
  deleteAdditionalAddressesExcept,
  insertLeadAssignmentRow,
  insertLeadRow,
  selectActiveProductsForLead,
  selectAdditionalAddressesForLead,
  selectAllDomainIds,
  selectLatestQuotationMetaForLead,
  selectLeadAssignedUserId,
  selectLeadById,
  selectLeadOwnershipRow,
  selectLeads,
  selectSubscriptionsForLead,
  updateLeadAssignment,
  updateLeadRow,
  updateLeadStatusRaw,
  upsertAdditionalAddressRow,
  upsertBranchRow,
} from "./repositories/raw/leads.repo.js";

export const HQ_BRANCH_ID = "hq";

const LEAD_STATUSES = LEAD_STATUS_VALUES;

function generateDomainId(usedIds) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }

  return String(Date.now()).slice(-4);
}

export function deriveBranchesFromLead(lead) {
  const branches = [];
  const leadCountry = String(lead?.country || "").trim();

  if (String(lead.billingAddress || "").trim()) {
    branches.push({
      id: HQ_BRANCH_ID,
      label: "Head office",
      address: lead.billingAddress.trim(),
      country: leadCountry,
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
      taxNumber: String(entry.taxNumber || "").trim(),
      isPrimary: false,
    });
  }

  return branches;
}

async function loadSubscriptions(client, leadId) {
  const rows = await selectSubscriptionsForLead(client, leadId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      id: entry.id,
      key: entry.key,
      organizationId: entry.organizationId,
      productId: entry.productId,
      locationId: entry.locationId,
      billingTargetId: entry.billingTargetId,
      status: entry.status || "active",
      changeType: entry.changeType || "new",
      entitlementConfig: entry.entitlementConfig || null,
      priceLabel: entry.priceLabel || "",
      implementationPurchased: entry.implementationPurchased === true,
      mrr: entry.mrr !== null ? Number(entry.mrr) : null,
      startsAt: toIso(entry.startsAt),
      approvedAt: toIso(entry.approvedAt),
      renewsAt: toIso(entry.renewsAt),
      paymentConfirmedAt: toIso(entry.paymentConfirmedAt),
      quotationId: entry.quotationId || null,
    };
  });
}

async function loadActiveProducts(client, leadId) {
  const rows = await selectActiveProductsForLead(client, leadId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      key: entry.key,
      productId: entry.productId,
      branchId: entry.branchId,
      billingTargetId: entry.billingTargetId,
      changeType: entry.changeType || "new",
      config: entry.config || null,
      implementationPurchased: entry.implementationPurchased === true,
      priceLabel: entry.priceLabel || "",
      approvedAt: toIso(entry.approvedAt),
      paymentConfirmedAt: toIso(entry.paymentConfirmedAt),
      quotationId: entry.quotationId,
    };
  });
}

async function loadAdditionalAddresses(client, leadId) {
  const rows = await selectAdditionalAddressesForLead(client, leadId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      id: entry.id,
      label: entry.label || "Branch",
      address: entry.address || "",
      country: entry.country || "",
      taxNumber: entry.taxNumber || "",
      industryType: entry.industryType || "",
      businessType: entry.businessType || "",
      companySize: entry.companySize || "",
      websiteUrl: entry.websiteUrl || "",
      contactName: entry.contactName || "",
      designation: entry.designation || "",
      workEmail: entry.workEmail || "",
      mobileCountryCode: entry.mobileCountryCode || "+91",
      mobileNumber: entry.mobileNumber || "",
      secondaryMobileCountryCode: entry.secondaryMobileCountryCode || "+91",
      secondaryMobileNumber: entry.secondaryMobileNumber || "",
    };
  });
}

async function loadLatestQuotationMeta(client, leadId) {
  const row = await selectLatestQuotationMetaForLead(client, leadId);

  if (!row) {
    return null;
  }

  const mapped = rowToCamel(row);
  return {
    financeQuotationId: mapped.id,
    financeNote: mapped.financeNote || "",
    financeReviewedAt: toIso(mapped.reviewedAt),
    financeReviewedBy: mapped.reviewedBy || "",
    latestQuotationStatus: mapped.status,
  };
}

function mapLeadRow(row, additionalAddresses, activeProducts, quotationMeta, subscriptions = []) {
  const lead = rowToCamel(row);
  return {
    id: lead.id,
    domainId: lead.domainId,
    companyName: lead.companyName || "",
    industryType: lead.industryType || "",
    businessType: lead.businessType || "",
    contactName: lead.contactName || "",
    designation: lead.designation || "",
    workEmail: lead.workEmail || "",
    adminEmail: lead.adminEmail || "",
    taxNumber: lead.taxNumber || "",
    billingAddress: lead.billingAddress || "",
    websiteUrl: lead.websiteUrl || "",
    country: lead.country || "",
    companySize: lead.companySize || "",
    isDecisionMaker: lead.isDecisionMaker !== false,
    decisionMakerName: lead.decisionMakerName || "",
    mobileCountryCode: lead.mobileCountryCode || "+91",
    mobileNumber: lead.mobileNumber || "",
    secondaryMobileCountryCode: lead.secondaryMobileCountryCode || "+91",
    secondaryMobileNumber: lead.secondaryMobileNumber || "",
    status: LEAD_STATUSES.includes(lead.status) ? lead.status : "New",
    isActive: lead.isActive !== false,
    productDraft: lead.productDraft || null,
    assignedUserId: lead.assignedUserId || null,
    createdByUserId: lead.createdByUserId || null,
    assignedAt: toIso(lead.assignedAt),
    convertedOrganizationId: lead.convertedOrganizationId || null,
    convertedAt: toIso(lead.convertedAt),
    additionalAddresses,
    activeProducts,
    subscriptions,
    createdAt: toIso(lead.createdAt),
    updatedAt: toIso(lead.updatedAt),
    ...(quotationMeta || {}),
  };
}

async function hydrateLead(client, row) {
  const additionalAddresses = await loadAdditionalAddresses(client, row.id);
  const activeProducts = await loadActiveProducts(client, row.id);
  const subscriptions = await loadSubscriptions(client, row.id);
  const quotationMeta = await loadLatestQuotationMeta(client, row.id);

  return mapLeadRow(row, additionalAddresses, activeProducts, quotationMeta, subscriptions);
}

async function syncBranches(client, leadId, lead, assignments = []) {
  const branches = [...deriveBranchesFromLead(lead)];
  const branchIds = new Set(branches.map((branch) => branch.id));

  for (const assignment of assignments || []) {
    for (const branchId of [assignment.branchId, assignment.billingTargetId]) {
      if (!branchId || branchIds.has(branchId)) {
        continue;
      }

      branches.push({
        id: branchId,
        label: branchId === HQ_BRANCH_ID ? "Head office" : "Branch",
        address: String(lead?.billingAddress || "").trim(),
        country: String(lead?.country || "").trim(),
        taxNumber: String(lead?.taxNumber || "").trim(),
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
      branch.taxNumber || null,
      branch.isPrimary,
    ]);
  }
}

async function syncAdditionalAddresses(client, leadId, addresses, leadCountry = "") {
  const normalized = normalizeAdditionalAddresses(addresses, leadCountry);
  const retainedIds = normalized.map((entry) => entry.id);

  await deleteAdditionalAddressesExcept(client, leadId, retainedIds);

  for (const entry of normalized) {
    await upsertAdditionalAddressRow(client, [
        entry.id,
        leadId,
        entry.label,
        entry.address,
        entry.country || null,
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

async function reserveDomainId(client) {
  const rows = await selectAllDomainIds(client);
  const usedIds = new Set(rows.map((row) => row.domain_id));
  return generateDomainId(usedIds);
}

function normalizeAdditionalAddresses(addresses, leadCountry = "") {
  const fallbackCountry = String(leadCountry || "").trim();

  return (addresses || [])
    .filter((entry) => String(entry?.address || "").trim())
    .map((entry) => ({
      id: entry.id || crypto.randomUUID(),
      label: String(entry.label || "").trim() || "Branch",
      address: String(entry.address || "").trim(),
      country: String(entry.country || "").trim() || fallbackCountry,
      taxNumber: String(entry.taxNumber || "").trim(),
      industryType: String(entry.industryType || "").trim(),
      businessType: String(entry.businessType || "").trim(),
      companySize: String(entry.companySize || "").trim(),
      websiteUrl: String(entry.websiteUrl || "").trim(),
      contactName: String(entry.contactName || "").trim(),
      designation: String(entry.designation || "").trim(),
      workEmail: String(entry.workEmail || "").trim(),
      mobileCountryCode: String(entry.mobileCountryCode || "+91").trim(),
      mobileNumber: String(entry.mobileNumber || "").trim(),
      secondaryMobileCountryCode: String(entry.secondaryMobileCountryCode || "+91").trim(),
      secondaryMobileNumber: String(entry.secondaryMobileNumber || "").trim(),
    }));
}

export async function listLeads({ createdByUserId = null, pipelineOnly = false } = {}) {
  const client = await pool.connect();
  try {
    const rows = await selectLeads(client, { createdByUserId, pipelineOnly });
    const leads = [];

    for (const row of rows) {
      leads.push(await hydrateLead(client, row));
    }

    return leads;
  } finally {
    client.release();
  }
}

export async function getLeadById(leadId) {
  const client = await pool.connect();
  try {
    const row = await selectLeadById(client, leadId);
    if (!row) {
      return null;
    }

    return hydrateLead(client, row);
  } finally {
    client.release();
  }
}

export async function getLeadOwnership(leadId) {
  const row = await selectLeadOwnershipRow(pool, leadId);
  if (!row) {
    return null;
  }
  const mapped = rowToCamel(row);
  return {
    id: mapped.id,
    assignedUserId: mapped.assignedUserId || null,
    createdByUserId: mapped.createdByUserId || null,
  };
}

export function canUserModifyLead(authUser, ownership) {
  if (!authUser?.userId || !ownership) {
    return false;
  }

  if (authUser.role !== "sales" && authUser.role !== "sales_admin") {
    return false;
  }

  if (ownership.assignedUserId) {
    return ownership.assignedUserId === authUser.userId;
  }

  return ownership.createdByUserId === authUser.userId;
}

export function canUserViewLead(authUser, ownership) {
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
    return ownership.createdByUserId === authUser.userId;
  }

  return false;
}

export async function createLead(payload, { createdByUserId = null } = {}) {
  return withTransaction(async (client) => {
    const domainId = await reserveDomainId(client);
    const additionalAddresses = normalizeAdditionalAddresses(
      payload.additionalAddresses,
      payload.country,
    );
    const now = new Date().toISOString();

    const leadRow = await insertLeadRow(client, [
        payload.companyName?.trim() || "",
        payload.industryType?.trim() || "",
        payload.businessType?.trim() || "",
        payload.contactName?.trim() || "",
        payload.designation?.trim() || "",
        payload.workEmail?.trim() || "",
        payload.adminEmail?.trim() || "",
        payload.taxNumber?.trim() || "",
        payload.billingAddress?.trim() || "",
        payload.websiteUrl?.trim() || "",
        payload.country?.trim() || "",
        payload.companySize?.trim() || "",
        payload.isDecisionMaker !== false,
        payload.decisionMakerName?.trim() || "",
        payload.mobileCountryCode || "+91",
        payload.mobileNumber?.trim() || "",
        payload.secondaryMobileCountryCode || "+91",
        payload.secondaryMobileNumber?.trim() || "",
        "New",
        true,
        domainId,
        createdByUserId,
        createdByUserId,
        createdByUserId ? now : null,
      ]);

    if (createdByUserId) {
      await insertLeadAssignmentRow(client, [
        leadRow.id,
        null,
        createdByUserId,
        createdByUserId,
        "Auto-assigned on lead creation",
      ]);
    }

    await syncAdditionalAddresses(client, leadRow.id, additionalAddresses, payload.country);
    const lead = await hydrateLead(client, leadRow);
    await syncBranches(client, leadRow.id, lead);
    return lead;
  });
}

export async function assignLead(leadId, toUserId, { assignedByUserId, reason = "" } = {}) {
  return withTransaction(async (client) => {
    const existingRow = await selectLeadAssignedUserId(client, leadId);
    if (!existingRow) {
      return null;
    }

    const fromUserId = existingRow.assigned_user_id;

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
}

export async function updateLead(leadId, updates) {
  return withTransaction(async (client) => {
    const existingRow = await selectLeadById(client, leadId);
    if (!existingRow) {
      return null;
    }

    const current = await hydrateLead(client, existingRow);
    const additionalAddresses =
      updates.additionalAddresses !== undefined
        ? normalizeAdditionalAddresses(updates.additionalAddresses, updates.country ?? current.country)
        : current.additionalAddresses;

    const next = {
      ...current,
      ...updates,
      id: current.id,
      domainId: current.domainId,
      additionalAddresses,
      activeProducts: current.activeProducts,
    };

    delete next.activeProducts;
    delete next.financeNote;
    delete next.financeReviewedAt;
    delete next.financeReviewedBy;
    delete next.financeQuotationId;
    delete next.latestQuotationStatus;
    delete next.createdAt;

    await updateLeadRow(client, [
      leadId,
      next.companyName,
      next.industryType,
      next.businessType || "",
      next.contactName,
      next.designation,
      next.workEmail,
      next.adminEmail,
      next.taxNumber,
      next.billingAddress,
      next.websiteUrl,
      next.country || "",
      next.companySize || "",
      next.isDecisionMaker !== false,
      next.decisionMakerName || "",
      next.mobileCountryCode,
      next.mobileNumber,
      next.secondaryMobileCountryCode,
      next.secondaryMobileNumber,
      LEAD_STATUSES.includes(next.status) ? next.status : current.status,
      next.isActive !== false,
      next.productDraft !== undefined ? next.productDraft : current.productDraft,
    ]);

    await syncAdditionalAddresses(client, leadId, additionalAddresses, next.country);
    const refreshedRow = await selectLeadById(client, leadId);
    const refreshed = await hydrateLead(client, refreshedRow);
    const draftAssignments = next.productDraft?.assignments || [];
    await syncBranches(client, leadId, refreshed, draftAssignments);
    return refreshed;
  });
}

export async function loadLeadSnapshot(client, leadId) {
  const row = await selectLeadById(client, leadId);
  if (!row) {
    return null;
  }

  return hydrateLead(client, row);
}

export async function ensureAssignmentBranchRows(client, leadId, leadSnapshot, assignments = []) {
  await syncBranches(client, leadId, leadSnapshot, assignments);
}

/** @deprecated Use ensureAssignmentBranchRows */
export async function ensureBranchesForLead(client, leadId, leadSnapshot, assignments = []) {
  await ensureAssignmentBranchRows(client, leadId, leadSnapshot, assignments);
}

export async function updateLeadStatus(client, leadId, status) {
  await updateLeadStatusRaw(client, leadId, status);
}
