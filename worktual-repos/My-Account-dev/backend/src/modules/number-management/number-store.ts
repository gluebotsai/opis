import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { listOrganizations, getOrganizationById } from "../organizations/organization-store.js";
import { getDialCodeForCountry } from "../../lib/countryDefaults.js";
import {
  assertValidPhoneNumber,
  composePhoneNumber,
  normalizeLeadDialCode,
  validateMobileForDialCode,
} from "../../lib/mobile-validation.js";
import {
  deleteNumberProvider,
  deleteProviderNumber,
  deleteProviderNumberForProvider,
  deleteProviderNumbersByNumbers,
  insertNumberProvider,
  insertProviderNumber,
  insertProviderNumbersBulk,
  selectNumberProviderById,
  selectNumberProviders,
  selectProviderNumberByNumber,
  selectProviderNumbers,
  selectUnassignedProviderNumbers,
  updateNumberProvider,
} from "../../repositories/raw/numberProviders.repo.js";
import {
  deleteNumberMapping,
  insertNumberMapping,
  selectActiveMappingCountsByProductForTenant,
  selectMappingCountsByTenant,
  selectNumberMappingById,
  selectNumberMappingByNumber,
  selectNumberMappingStatsForTenants,
  selectNumberMappings,
  selectNumberMappingsByTenant,
  updateNumberMapping,
} from "../../repositories/raw/numberMappings.repo.js";
import {
  countUsageRowsForMonth,
  selectAgentDidUsage,
  selectLatestUsageMonthByTenant,
  upsertAgentDidUsageRow,
} from "../../repositories/raw/agentDidUsage.repo.js";
import {
  NUMBER_MAPPING_PRODUCT_IDS,
  selectActiveNumberMappingEntitlements,
  selectAllActiveNumberMappingEntitlements,
} from "../../repositories/raw/subscriptions.repo.js";

const NUMBER_MAPPING_PRODUCT_LABELS: Record<string, string> = {
  "contact-center": "Contact Center",
  crm: "CRM",
  campaign: "Campaign",
};

const NUMBER_MAPPING_ELIGIBILITY_ERROR =
  "Number mapping is only available for customers with a number entitlement (agents, licensed users, or purchased numbers) on Contact Center, CRM, or Campaign.";

function toEntitlementCount(value: any) {
  const parsed = Math.floor(Number(String(value ?? "").replace(/,/g, "")));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Purchased phone numbers on CRM / Campaign quotes (base + additional / mid-period). */
function purchasedExtraNumbersFromConfig(config: any = {}) {
  const base = toEntitlementCount(config.numberCount);
  const midNumbers = config.midPeriodAddons?.numbers;
  const addonEnabled =
    midNumbers?.enabled === true || config.additionalNumbersEnabled === true;
  const addon = addonEnabled
    ? toEntitlementCount(midNumbers?.count ?? config.additionalNumberCount)
    : 0;
  return base + addon;
}

/**
 * Contact Center: totalNumberEntitlement = agentCount + queueCapacityCount.
 * includedNumberCount always equals agentCount (1 DID per agent); queue capacity is extra.
 */
function numberEntitlementFromCcaasConfig(config: any = {}) {
  if (config.totalNumberEntitlement != null && config.totalNumberEntitlement !== "") {
    const stored = toEntitlementCount(config.totalNumberEntitlement);
    if (stored > 0) {
      return stored;
    }
  }

  const usageDetails = config.usageDetails || {};
  let agentCount = toEntitlementCount(usageDetails.agentCount);

  const humanAgent = config.midPeriodAddons?.humanAgent;
  if (humanAgent?.enabled === true) {
    agentCount += toEntitlementCount(humanAgent.count);
  }

  const queue =
    config.midPeriodAddons?.queueCapacity || config.midPeriodAddons?.phoneNumbers;
  let queueCapacityCount = 0;
  if (queue?.enabled === true) {
    queueCapacityCount = toEntitlementCount(queue.count);
  } else {
    queueCapacityCount = toEntitlementCount(
      config.queueCapacityCount ?? usageDetails.queueCapacityCount,
    );
  }

  return agentCount + queueCapacityCount;
}

/** CRM: 1 number per licensed user (+ additional users) + purchased extra numbers. */
function numberEntitlementFromCrmConfig(config: any = {}) {
  let seats = toEntitlementCount(config.userCount);
  const midUsers = config.midPeriodAddons?.userLicense;
  const additionalUsersEnabled =
    midUsers?.enabled === true || config.additionalUsersEnabled === true;
  if (additionalUsersEnabled) {
    seats += toEntitlementCount(midUsers?.additionalCount ?? config.additionalUserCount);
  }
  return seats + purchasedExtraNumbersFromConfig(config);
}

/** Campaign: no number entitlement (messaging packs only). */
function numberEntitlementFromCampaignConfig(_config: any = {}) {
  return 0;
}

function numberEntitlementFromConfig(productId: string, config: any = {}) {
  if (productId === "contact-center") {
    return numberEntitlementFromCcaasConfig(config);
  }
  if (productId === "crm") {
    return numberEntitlementFromCrmConfig(config);
  }
  if (productId === "campaign") {
    return numberEntitlementFromCampaignConfig(config);
  }
  return 0;
}

/** Per-product totals (sum across branches) from active NM entitlements. */
function aggregateNumberEntitlementsByProduct(
  entitlements: { productId: string; entitlementConfig: any }[] = [],
) {
  const totals = new Map<string, number>();
  for (const entry of entitlements) {
    const id = entry.productId;
    const next =
      (totals.get(id) || 0) + numberEntitlementFromConfig(id, entry.entitlementConfig);
    totals.set(id, next);
  }
  return totals;
}

function totalNumberEntitlement(
  entitlements: { productId: string; entitlementConfig: any }[] = [],
) {
  let total = 0;
  for (const count of aggregateNumberEntitlementsByProduct(entitlements).values()) {
    total += count;
  }
  return total;
}

/** Aggregate number entitlements per active NM product (sum across branches). */
function mapPurchasedNumberMappingProducts(
  entitlements: { productId: string; entitlementConfig: any }[] = [],
  mappedByProduct: Map<string, number> = new Map(),
) {
  const totals = aggregateNumberEntitlementsByProduct(entitlements);
  // Pills only for products with at least 1 entitled number.
  return NUMBER_MAPPING_PRODUCT_IDS.filter((id) => (totals.get(id) || 0) >= 1).map((id) => {
    const numberCount = totals.get(id) || 0;
    const mapped = Math.min(numberCount, mappedByProduct.get(id) || 0);
    const remaining = Math.max(0, numberCount - mapped);
    return {
      id,
      label: NUMBER_MAPPING_PRODUCT_LABELS[id] || id,
      numberCount,
      mapped,
      remaining,
    };
  });
}

async function organizationHasNumberMappingEntitlement(organizationId: any) {
  if (!organizationId) {
    return false;
  }
  const entitlements = await selectActiveNumberMappingEntitlements(pool, organizationId);
  return totalNumberEntitlement(entitlements) > 0;
}

/** Org ids whose CC/CRM/Campaign entitlements yield a number total > 0. */
async function selectOrganizationIdsWithNumberEntitlement() {
  const rows = await selectAllActiveNumberMappingEntitlements(pool);
  const byOrg = new Map<string, { productId: string; entitlementConfig: any }[]>();
  for (const row of rows) {
    const list = byOrg.get(row.organizationId) || [];
    list.push({ productId: row.productId, entitlementConfig: row.entitlementConfig });
    byOrg.set(row.organizationId, list);
  }
  const eligible: string[] = [];
  for (const [organizationId, entitlements] of byOrg) {
    if (totalNumberEntitlement(entitlements) > 0) {
      eligible.push(organizationId);
    }
  }
  return eligible;
}

function mapMappingRow(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row);
  const productId = String(entry!.productId || "").trim();
  return {
    id: entry!.id,
    tenantId: entry!.tenantId || "",
    organizationId: entry!.organizationId || null,
    leadId: entry!.leadId || null,
    productId,
    productLabel: NUMBER_MAPPING_PRODUCT_LABELS[productId] || productId || "",
    providerId: entry!.providerId || null,
    number: entry!.number || "",
    numberType: entry!.numberType || "other",
    agentLabel: entry!.agentLabel || "",
    status: entry!.status || "active",
    notes: entry!.notes || "",
    mappedAt: toIso(entry!.mappedAt),
    createdBy: entry!.createdBy || "",
    updatedBy: entry!.updatedBy || "",
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

const MAX_PROVIDER_IMAGE_CHARS = 700_000;

/**
 * Normalize + validate an inventory number for a provider country (dial-code rules).
 * Accepts full E.164 or national digits (with optional dialCode / country hint).
 */
function normalizeInventoryNumber(
  value: any,
  {
    dialCode = "",
    nationalNumber = "",
    country = "India",
  }: { dialCode?: string; nationalNumber?: string; country?: string } = {},
) {
  const countryDial = normalizeLeadDialCode(getDialCodeForCountry(country) || "+91", "+91");
  const hint = normalizeLeadDialCode(dialCode || countryDial, countryDial);

  if (nationalNumber != null && String(nationalNumber).trim() !== "") {
    const national = String(nationalNumber || "").replace(/\D/g, "");
    const error = validateMobileForDialCode(hint, national);
    if (!national) {
      return "";
    }
    if (error) {
      throw new Error(error);
    }
    return composePhoneNumber(hint, national);
  }

  const raw = String(value || "").trim().replace(/[\s().-]+/g, "");
  if (!raw) {
    return "";
  }

  try {
    return assertValidPhoneNumber(raw, hint);
  } catch (error: any) {
    // If national-only digits were pasted without +, validate against provider dial.
    if (/^\d+$/.test(raw)) {
      const errorMsg = validateMobileForDialCode(hint, raw);
      if (errorMsg) {
        throw new Error(errorMsg);
      }
      return composePhoneNumber(hint, raw);
    }
    throw error;
  }
}

function mapProviderRow(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    name: entry!.name || "",
    imageData: entry!.imageData || "",
    country: entry!.country || "",
    storage: entry!.storage || "",
    accountId: entry!.accountId || "",
    numberCount: Number(entry!.numberCount || 0),
    createdBy: entry!.createdBy || "",
    updatedBy: entry!.updatedBy || "",
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

function mapProviderNumberRow(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    providerId: entry!.providerId || null,
    providerName: entry!.providerName || "",
    number: entry!.number || "",
    createdBy: entry!.createdBy || "",
    updatedBy: entry!.updatedBy || "",
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

function normalizeProviderPayload(payload: any = {}) {
  const name = String(payload.name || "").trim();
  if (!name) {
    throw new Error("Provider name is required.");
  }
  const imageData = String(payload.imageData || "").trim();
  if (imageData && imageData.length > MAX_PROVIDER_IMAGE_CHARS) {
    throw new Error("Provider image is too large. Use a smaller image (under ~500KB).");
  }
  if (imageData && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(imageData)) {
    throw new Error("Provider image must be a PNG, JPEG, GIF, or WebP.");
  }
  return {
    name,
    imageData,
    country: String(payload.country || "").trim(),
    // Optional — UI no longer collects these; keep DB columns with empty defaults.
    storage: String(payload.storage || "").trim(),
    accountId: String(payload.accountId || "").trim(),
  };
}

function mapUsageRow(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    tenantId: entry!.tenantId || "",
    organizationId: entry!.organizationId || null,
    numberMappingId: entry!.numberMappingId || null,
    number: entry!.number || "",
    yearMonth: entry!.yearMonth || "",
    usageValue: Number(entry!.usageValue || 0),
    usageUnit: entry!.usageUnit || "units",
    notes: entry!.notes || "",
    enteredBy: entry!.enteredBy || "",
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

function currentYearMonth(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeYearMonth(value: any) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) {
    throw new Error("yearMonth must be YYYY-MM.");
  }
  return raw;
}

function normalizeProductId(value: any) {
  const productId = String(value || "").trim().toLowerCase();
  if (!(NUMBER_MAPPING_PRODUCT_IDS as readonly string[]).includes(productId)) {
    throw new Error("Product must be Contact Center, CRM, or Campaign.");
  }
  return productId;
}

function normalizeMappingPayload(payload: any = {}) {
  const tenantId = String((payload as any).tenantId || "").trim();
  const number = String((payload as any).number || "").trim();
  if (!tenantId) {
    throw new Error("Tenant ID is required.");
  }
  if (!number) {
    throw new Error("Number is required.");
  }

  const productId = normalizeProductId((payload as any).productId);
  const numberType = String((payload as any).numberType || "other").trim().toLowerCase() || "other";
  const status = String((payload as any).status || "active").trim().toLowerCase() || "active";
  if (!["did", "agent", "other"].includes(numberType)) {
    throw new Error("numberType must be did, agent, or other.");
  }
  if (!["active", "inactive"].includes(status)) {
    throw new Error("status must be active or inactive.");
  }

  const providerIdRaw = String((payload as any).providerId || "").trim();
  return {
    tenantId,
    organizationId: (payload as any).organizationId || null,
    leadId: (payload as any).leadId || null,
    productId,
    providerId: providerIdRaw || null,
    number,
    numberType,
    agentLabel: String((payload as any).agentLabel || "").trim(),
    status,
    notes: String((payload as any).notes || "").trim(),
    mappedAt: (payload as any).mappedAt || null,
  };
}

async function resolveOrganizationForTenant(tenantId: any, organizationId: any = null) {
  if (organizationId) {
    const organization = await getOrganizationById(organizationId);
    if (organization) {
      return organization;
    }
  }
  const orgs = await listOrganizations();
  return orgs.find((org: any) => String(org.tenantId || "") === String(tenantId || "").trim()) || null;
}

async function assertNumberNotMappedElsewhere(numberValue: any, excludeId: any = null) {
  const existing = await selectNumberMappingByNumber(numberValue, excludeId);
  if (existing) {
    const productId = String(existing.product_id || "").trim();
    const label = NUMBER_MAPPING_PRODUCT_LABELS[productId] || productId || "another product";
    throw new Error(`This number is already mapped to ${label}. Each number can only map to one product.`);
  }
}

async function assertProductMappingCapacity({
  organizationId,
  tenantId,
  productId,
  status,
  excludeMappingId = null,
  previousProductId = null,
  previousStatus = null,
}: any) {
  const entitlements = await selectActiveNumberMappingEntitlements(pool, organizationId);
  const entitledByProduct = aggregateNumberEntitlementsByProduct(entitlements);
  const entitled = entitledByProduct.get(productId) || 0;
  if (entitled <= 0) {
    const label = NUMBER_MAPPING_PRODUCT_LABELS[productId] || productId;
    throw new Error(`No number entitlement available for ${label} on this tenant.`);
  }

  if (status !== "active") {
    return;
  }

  const counts = await selectActiveMappingCountsByProductForTenant(tenantId);
  const mappedByProduct = new Map(counts.map((row) => [row.productId, row.mappingCount]));
  let mapped = mappedByProduct.get(productId) || 0;

  // When editing an active mapping that already counted toward this product, free that slot.
  if (
    excludeMappingId &&
    previousStatus === "active" &&
    previousProductId === productId &&
    mapped > 0
  ) {
    mapped -= 1;
  }

  if (mapped >= entitled) {
    const label = NUMBER_MAPPING_PRODUCT_LABELS[productId] || productId;
    throw new Error(
      `${label} has ${entitled} number${entitled === 1 ? "" : "s"} available; all slots are already mapped.`,
    );
  }
}

export async function listNumberMappings(filters: any = {}) {
  const rows = await selectNumberMappings(filters);
  return rows.map(mapMappingRow);
}

export async function getNumberMapping(id: any) {
  return mapMappingRow(await selectNumberMappingById(id));
}

async function assertOrganizationEligibleForNumberMapping(organizationId: any) {
  if (!organizationId) {
    throw new Error(NUMBER_MAPPING_ELIGIBILITY_ERROR);
  }
  const eligible = await organizationHasNumberMappingEntitlement(organizationId);
  if (!eligible) {
    throw new Error(NUMBER_MAPPING_ELIGIBILITY_ERROR);
  }
}

export async function getTenantMappingCapacity(tenantIdInput: any, excludeMappingId: any = null) {
  const tenantId = String(tenantIdInput || "").trim();
  if (!tenantId) {
    throw new Error("Tenant ID is required.");
  }
  const organization = await resolveOrganizationForTenant(tenantId);
  if (!organization) {
    throw new Error("Customer not found for this tenant ID.");
  }

  const entitlements = await selectActiveNumberMappingEntitlements(pool, organization.id);
  const entitledByProduct = aggregateNumberEntitlementsByProduct(entitlements);
  if (totalNumberEntitlement(entitlements) <= 0) {
    throw new Error(NUMBER_MAPPING_ELIGIBILITY_ERROR);
  }

  const counts = await selectActiveMappingCountsByProductForTenant(tenantId);
  const mappedByProduct = new Map(counts.map((row) => [row.productId, row.mappingCount]));

  let excludeProductId = "";
  if (excludeMappingId) {
    const existing = await getNumberMapping(excludeMappingId);
    if (existing && existing.status === "active" && existing.tenantId === tenantId) {
      excludeProductId = existing.productId || "";
    }
  }

  const products = NUMBER_MAPPING_PRODUCT_IDS.filter((id) => (entitledByProduct.get(id) || 0) > 0).map(
    (id) => {
      const entitled = entitledByProduct.get(id) || 0;
      let mapped = mappedByProduct.get(id) || 0;
      if (excludeProductId && excludeProductId === id && mapped > 0) {
        mapped -= 1;
      }
      const remaining = Math.max(0, entitled - mapped);
      return {
        id,
        label: NUMBER_MAPPING_PRODUCT_LABELS[id] || id,
        entitled,
        mapped,
        remaining,
      };
    },
  );

  const country = String(organization.country || "").trim();
  return {
    tenantId,
    organizationId: organization.id,
    companyName: organization.companyName || "",
    country,
    dialCode: getDialCodeForCountry(country),
    products,
  };
}

export async function createNumberMapping(payload: any, actorEmail: any) {
  const data = normalizeMappingPayload(payload);
  const organization = await resolveOrganizationForTenant(data.tenantId, data.organizationId);
  if (!organization) {
    throw new Error("Customer not found for this tenant ID.");
  }
  data.organizationId = organization.id;
  data.leadId = organization.sourceLeadId || data.leadId || null;
  data.number = assertValidPhoneNumber(
    data.number,
    payload?.dialCode || getDialCodeForCountry(organization.country || ""),
  );

  await assertOrganizationEligibleForNumberMapping(data.organizationId);
  await assertNumberNotMappedElsewhere(data.number);
  await assertProductMappingCapacity({
    organizationId: data.organizationId,
    tenantId: data.tenantId,
    productId: data.productId,
    status: data.status,
  });

  if (data.providerId) {
    const provider = await selectNumberProviderById(data.providerId);
    if (!provider) {
      throw new Error("Selected provider was not found.");
    }
  }

  try {
    const row = await insertNumberMapping([
      data.tenantId,
      data.organizationId,
      data.leadId,
      data.productId,
      data.number,
      data.numberType,
      data.agentLabel,
      data.status,
      data.notes,
      data.mappedAt,
      actorEmail || null,
      data.providerId,
    ]);
    // Remove from provider inventory once mapped.
    await deleteProviderNumbersByNumbers([data.number]);
    return mapMappingRow(row);
  } catch (error: any) {
    if (error?.code === "23505") {
      throw new Error(
        "This number is already mapped to a product. Each number can only map to one product.",
      );
    }
    throw error;
  }
}

function mapAvailableNumberRow(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    providerId: entry!.providerId || null,
    providerName: entry!.providerName || "",
    number: entry!.number || "",
    createdBy: entry!.createdBy || "",
    updatedBy: entry!.updatedBy || "",
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

/** Legacy route: lists unassigned numbers from provider inventory (all providers). */
export async function listAvailableNumbers(filters: any = {}) {
  const rows = await selectUnassignedProviderNumbers(filters);
  return rows.map(mapAvailableNumberRow);
}

export async function createAvailableNumber(_payload: any, _actorEmail: any) {
  throw new Error(
    "Add numbers under Number Inventory by choosing a provider. The legacy available-numbers pool is no longer used.",
  );
}

export async function removeAvailableNumber(id: any) {
  const ok = await deleteProviderNumber(id);
  if (!ok) {
    throw new Error("Number not found in provider inventory.");
  }
  return { ok: true };
}

export async function patchNumberMapping(id: any, payload: any, actorEmail: any) {
  const existing = await getNumberMapping(id);
  if (!existing) {
    throw new Error("Number mapping not found.");
  }

  const data = normalizeMappingPayload({ ...existing, ...payload });
  const organization = await resolveOrganizationForTenant(data.tenantId, data.organizationId);
  if (!organization) {
    throw new Error("Customer not found for this tenant ID.");
  }
  data.organizationId = organization.id;
  data.leadId = organization.sourceLeadId || data.leadId || null;
  data.number = assertValidPhoneNumber(
    data.number,
    payload?.dialCode || getDialCodeForCountry(organization.country || ""),
  );

  await assertOrganizationEligibleForNumberMapping(data.organizationId);
  await assertNumberNotMappedElsewhere(data.number, id);
  await assertProductMappingCapacity({
    organizationId: data.organizationId,
    tenantId: data.tenantId,
    productId: data.productId,
    status: data.status,
    excludeMappingId: id,
    previousProductId: existing.productId,
    previousStatus: existing.status,
  });

  if (data.providerId) {
    const provider = await selectNumberProviderById(data.providerId);
    if (!provider) {
      throw new Error("Selected provider was not found.");
    }
  }

  try {
    const row = await updateNumberMapping(id, [
      data.tenantId,
      data.organizationId,
      data.leadId,
      data.productId,
      data.number,
      data.numberType,
      data.agentLabel,
      data.status,
      data.notes,
      data.mappedAt,
      actorEmail || null,
      data.providerId,
    ]);
    await deleteProviderNumbersByNumbers([data.number]);
    return mapMappingRow(row);
  } catch (error: any) {
    if (error?.code === "23505") {
      throw new Error(
        "This number is already mapped to a product. Each number can only map to one product.",
      );
    }
    throw error;
  }
}

export async function removeNumberMapping(id: any) {
  const ok = await deleteNumberMapping(id);
  if (!ok) {
    throw new Error("Number mapping not found.");
  }
  return { ok: true };
}

export async function getNumberManagementDashboard() {
  const yearMonth = currentYearMonth();
  const [eligibleOrgIds, organizations, mappingCounts, latestUsage, usageThisMonth] =
    await Promise.all([
      selectOrganizationIdsWithNumberEntitlement(),
      listOrganizations(),
      selectMappingCountsByTenant(),
      selectLatestUsageMonthByTenant(),
      countUsageRowsForMonth(yearMonth),
    ]);

  const eligibleOrgIdSet = new Set(eligibleOrgIds);
  const eligibleOrganizations = organizations.filter((org: any) => eligibleOrgIdSet.has(String(org.id)));
  const eligibleTenantIds = eligibleOrganizations
    .map((org: any) => String(org.tenantId || "").trim())
    .filter(Boolean);

  const stats = await selectNumberMappingStatsForTenants(eligibleTenantIds);

  const countByTenant = new Map(
    mappingCounts.map((row: any) => [String(row.tenant_id || ""), Number(row.mapping_count || 0)]),
  );
  const usageByTenant = new Map(
    latestUsage.map((row: any) => [String(row.tenant_id || ""), row.last_usage_month || ""]),
  );

  const customers = eligibleOrganizations.map((org: any) => {
    const tenantId = String(org.tenantId || "");
    return {
      id: org.id,
      companyName: org.companyName,
      tenantId,
      contactName: org.contactName,
      workEmail: org.workEmail || org.adminEmail || "",
      country: org.country || "",
      lifecycleStatus: org.lifecycleStatus || "active",
      mappingCount: countByTenant.get(tenantId) || 0,
      lastUsageMonth: usageByTenant.get(tenantId) || "",
      eligibleProducts: [...NUMBER_MAPPING_PRODUCT_IDS],
    };
  });

  const customersWithoutMapping = customers.filter((customer: any) => customer.mappingCount === 0).length;

  return {
    cards: {
      totalMappedNumbers: Number(stats.total_mappings || 0),
      activeMappings: Number(stats.active_mappings || 0),
      tenantsWithMappings: Number(stats.tenants_with_mappings || 0),
      usageRowsThisMonth: Number(usageThisMonth || 0),
      customersWithoutMapping,
    },
    customers,
    yearMonth,
    eligibility: {
      productIds: [...NUMBER_MAPPING_PRODUCT_IDS],
      label: "Number entitlement on Contact Center, CRM, or Campaign",
    },
  };
}

export async function getNumberManagementCustomer(organizationId: any) {
  const organization = await getOrganizationById(organizationId);
  if (!organization) {
    throw new Error("Customer not found.");
  }

  const purchasedEntitlements = await selectActiveNumberMappingEntitlements(
    pool,
    organization.id,
  );
  if (totalNumberEntitlement(purchasedEntitlements) <= 0) {
    throw new Error("Customer not found.");
  }

  const tenantId = String(organization.tenantId || "");
  const [mappings, usage, mappingCounts] = await Promise.all([
    selectNumberMappingsByTenant(tenantId),
    tenantId ? selectAgentDidUsage({ tenantId }) : Promise.resolve([]),
    tenantId
      ? selectActiveMappingCountsByProductForTenant(tenantId)
      : Promise.resolve([]),
  ]);
  const mappedByProduct = new Map(
    (mappingCounts || []).map((row: any) => [row.productId, Number(row.mappingCount) || 0]),
  );

  return {
    customer: {
      id: organization.id,
      companyName: organization.companyName,
      tenantId,
      contactName: organization.contactName,
      designation: organization.designation,
      workEmail: organization.workEmail || "",
      adminEmail: organization.adminEmail || "",
      country: organization.country || "",
      billingAddress: organization.billingAddress || "",
      industryType: organization.industryType || "",
      lifecycleStatus: organization.lifecycleStatus || "active",
      locations: organization.locations || [],
      purchasedProducts: mapPurchasedNumberMappingProducts(
        purchasedEntitlements,
        mappedByProduct,
      ),
    },
    mappings: mappings.map(mapMappingRow),
    usage: usage.map(mapUsageRow),
  };
}

export async function listCustomerUsage(organizationId: any, yearMonth: any) {
  const organization = await getOrganizationById(organizationId);
  if (!organization) {
    throw new Error("Customer not found.");
  }
  const tenantId = String(organization.tenantId || "");
  const filters = { tenantId };
  if (yearMonth) {
    (filters as any).yearMonth = normalizeYearMonth(yearMonth);
  }
  const rows = await selectAgentDidUsage(filters);
  return rows.map(mapUsageRow);
}

export async function listFinanceUsageCustomers() {
  const dashboard = await getNumberManagementDashboard();
  return dashboard.customers;
}

export async function getFinanceUsageForm(tenantId: any, yearMonthInput: any) {
  const tenant = String(tenantId || "").trim();
  if (!tenant) {
    throw new Error("tenantId is required.");
  }
  const yearMonth = yearMonthInput ? normalizeYearMonth(yearMonthInput) : currentYearMonth();
  const [mappings, usageRows, organizations] = await Promise.all([
    selectNumberMappingsByTenant(tenant),
    selectAgentDidUsage({ tenantId: tenant, yearMonth }),
    listOrganizations(),
  ]);

  const organization = organizations.find((org) => String(org.tenantId || "") === tenant) || null;
  const usageByNumber = new Map(usageRows.map((row) => [String(row.number || ""), mapUsageRow(row)]));

  const rows = mappings.map((mapping) => {
    const mapped = mapMappingRow(mapping);
    const existing = usageByNumber.get((mapped!.number as any));
    return {
      numberMappingId: mapped!.id,
      number: mapped!.number,
      numberType: mapped!.numberType,
      agentLabel: mapped!.agentLabel,
      usageValue: existing?.usageValue ?? "",
      usageUnit: existing?.usageUnit || "units",
      notes: existing?.notes || "",
      usageId: existing?.id || null,
    };
  });

  for (const usage of usageRows) {
    const mapped = mapUsageRow(usage);
    if (!rows.some((row) => row.number === mapped!.number)) {
      rows.push(({
        numberMappingId: mapped!.numberMappingId,
        number: mapped!.number,
        numberType: "other",
        agentLabel: "",
        usageValue: mapped!.usageValue,
        usageUnit: mapped!.usageUnit,
        notes: mapped!.notes,
        usageId: mapped!.id,
      } as any));
    }
  }

  return {
    tenantId: tenant,
    yearMonth,
    organizationId: organization?.id || null,
    companyName: organization?.companyName || "",
    rows,
  };
}

export async function saveFinanceUsage({ tenantId, yearMonth, organizationId, rows }: any, actorEmail: any) {
  const tenant = String(tenantId || "").trim();
  if (!tenant) {
    throw new Error("tenantId is required.");
  }
  const month = normalizeYearMonth(yearMonth);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    throw new Error("At least one usage row is required.");
  }

  let orgId = organizationId || null;
  if (!orgId) {
    const orgs = await listOrganizations();
    orgId = orgs.find((org) => String(org.tenantId || "") === tenant)?.id || null;
  }

  const saved = [];
  for (const row of list) {
    const number = String(row.number || "").trim();
    if (!number) {
      continue;
    }
    const usageValue = Number(row.usageValue);
    if (!Number.isFinite(usageValue)) {
      throw new Error(`Invalid usage value for ${number}.`);
    }

    const savedRow = await upsertAgentDidUsageRow([
      tenant,
      orgId,
      row.numberMappingId || null,
      number,
      month,
      usageValue,
      String(row.usageUnit || "units").trim() || "units",
      String(row.notes || "").trim(),
      actorEmail || null,
    ]);
    saved.push(mapUsageRow(savedRow));
  }

  return { yearMonth: month, tenantId: tenant, rows: saved };
}

export async function listNumberProviders(filters: any = {}) {
  const rows = await selectNumberProviders(filters);
  return rows.map(mapProviderRow);
}

export async function getNumberProvider(id: any) {
  const row = await selectNumberProviderById(id);
  if (!row) {
    throw new Error("Provider not found.");
  }
  return mapProviderRow(row);
}

export async function createNumberProvider(payload: any, actorEmail: any) {
  const data = normalizeProviderPayload(payload);
  const row = await insertNumberProvider([
    data.name,
    data.imageData,
    data.country,
    data.storage,
    data.accountId,
    actorEmail || null,
  ]);
  return mapProviderRow({ ...row, number_count: 0 });
}

export async function patchNumberProvider(id: any, payload: any, actorEmail: any) {
  const existing = await selectNumberProviderById(id);
  if (!existing) {
    throw new Error("Provider not found.");
  }
  const data = normalizeProviderPayload({
    name: payload?.name ?? existing.name,
    imageData:
      payload?.imageData !== undefined ? payload.imageData : existing.image_data,
    country: payload?.country ?? existing.country,
    storage: payload?.storage ?? existing.storage,
    accountId: payload?.accountId ?? existing.account_id,
  });
  const row = await updateNumberProvider(id, [
    data.name,
    data.imageData,
    data.country,
    data.storage,
    data.accountId,
    actorEmail || null,
  ]);
  return mapProviderRow(row);
}

export async function removeNumberProvider(id: any) {
  const ok = await deleteNumberProvider(id);
  if (!ok) {
    throw new Error("Provider not found.");
  }
  return { ok: true };
}

export async function listProviderInventory(providerId: any, filters: any = {}) {
  const provider = await selectNumberProviderById(providerId);
  if (!provider) {
    throw new Error("Provider not found.");
  }
  const rows = await selectProviderNumbers(providerId, filters);
  return rows.map(mapProviderNumberRow);
}

export async function addProviderInventoryNumber(
  providerId: any,
  payload: any,
  actorEmail: any,
) {
  const provider = await selectNumberProviderById(providerId);
  if (!provider) {
    throw new Error("Provider not found.");
  }
  let number = "";
  try {
    number = normalizeInventoryNumber(payload?.number, {
      dialCode: payload?.dialCode ? String(payload.dialCode) : "",
      nationalNumber: payload?.nationalNumber != null ? String(payload.nationalNumber) : "",
      country: String(provider.country || "India"),
    });
  } catch (error: any) {
    throw new Error(error?.message || "Enter a valid phone number for this provider country.");
  }
  if (!number) {
    throw new Error("Enter a valid phone number for this provider country.");
  }
  const mapped = await selectNumberMappingByNumber(number);
  if (mapped) {
    throw new Error("This number is already mapped to a tenant.");
  }
  const existing = await selectProviderNumberByNumber(number);
  if (existing) {
    throw new Error(
      `This number already exists under provider "${existing.provider_name || "another provider"}".`,
    );
  }
  try {
    const row = await insertProviderNumber([providerId, number, actorEmail || null]);
    return mapProviderNumberRow(row);
  } catch (error: any) {
    if (error?.code === "23505") {
      throw new Error("This number already exists in provider inventory.");
    }
    throw error;
  }
}

export async function removeProviderInventoryNumber(providerId: any, numberId: any) {
  const provider = await selectNumberProviderById(providerId);
  if (!provider) {
    throw new Error("Provider not found.");
  }
  const ok = await deleteProviderNumberForProvider(providerId, numberId);
  if (!ok) {
    throw new Error("Provider number not found.");
  }
  return { ok: true };
}

/**
 * Preview CSV/bulk import: classify numbers into ready vs conflicts (globally unique).
 * Conflicts must be resolved (skipped) before confirm import.
 */
export async function previewProviderNumberImport(providerId: any, payload: any = {}) {
  const provider = await selectNumberProviderById(providerId);
  if (!provider) {
    throw new Error("Provider not found.");
  }

  const rawList = Array.isArray(payload.numbers) ? payload.numbers : [];
  const seen = new Set<string>();
  const ready: string[] = [];
  const conflicts: Array<{ number: string; reason: string }> = [];
  const invalid: string[] = [];

  const providerCountry = String(provider.country || "India");

  for (const raw of rawList) {
    let number = "";
    try {
      number = normalizeInventoryNumber(raw, { country: providerCountry });
    } catch (error: any) {
      const display = String(raw || "").trim();
      if (display) {
        conflicts.push({
          number: display,
          reason: error?.message || "Invalid number for this provider country.",
        });
      }
      continue;
    }
    if (!number) {
      const display = String(raw || "").trim();
      if (display) {
        invalid.push(display);
      }
      continue;
    }
    const key = number.toLowerCase();
    if (seen.has(key)) {
      conflicts.push({ number, reason: "Duplicate row in this import file." });
      continue;
    }
    seen.add(key);

    const mapped = await selectNumberMappingByNumber(number);
    if (mapped) {
      conflicts.push({ number, reason: "Already mapped to a tenant." });
      continue;
    }
    const existing = await selectProviderNumberByNumber(number);
    if (existing) {
      const name = existing.provider_name || "another provider";
      conflicts.push({
        number,
        reason: `Already in inventory under "${name}".`,
      });
      continue;
    }
    ready.push(number);
  }

  return {
    providerId,
    providerName: provider.name || "",
    ready,
    conflicts,
    invalid,
    readyCount: ready.length,
    conflictCount: conflicts.length,
    invalidCount: invalid.length,
  };
}

/** Confirm import after resolve: imports `ready` numbers; conflicts are skipped. */
export async function confirmProviderNumberImport(
  providerId: any,
  payload: any = {},
  actorEmail: any,
) {
  const preview = await previewProviderNumberImport(providerId, payload);
  const skipSet = new Set(
    (Array.isArray(payload.skip) ? payload.skip : [])
      .map((value: any) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  // Conflicts are always skipped; optional skip can also drop from ready.
  const toInsert = preview.ready.filter((number) => !skipSet.has(number.toLowerCase()));
  const rows = await insertProviderNumbersBulk(providerId, toInsert, actorEmail);
  return {
    imported: rows.map(mapProviderNumberRow),
    importedCount: rows.length,
    skippedConflicts: preview.conflicts,
    skippedInvalid: preview.invalid,
    skippedByUser: preview.ready.filter((number) => skipSet.has(number.toLowerCase())),
  };
}

export { currentYearMonth };
