import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import * as commissionsRepo from "../../repositories/raw/commissions.repo.js";
import * as partnersRepo from "../../repositories/raw/partners.repo.js";
import { validatePartnerBankPayload } from "./partner-bank-fields.js";
import { publishCommissionEvent } from "../../infra/events.js";
import { assertValidUtr } from "../../lib/utr-validation.js";
import { resolveLeadPortalEventContext } from "../leads/portal-event-context.js";

export const COMMISSION_ENTRY_STATUSES = {
  PENDING: "pending",
  PAID: "paid",
};

const COMMISSION_COUNTRY_CURRENCIES = {
  India: "INR",
  "United States": "GBP",
  "United Kingdom": "GBP",
  Australia: "GBP",
  Singapore: "GBP",
  Canada: "GBP",
  "United Arab Emirates": "AED",
  Germany: "GBP",
  France: "GBP",
  Other: "INR",
};

export function currencyForCommissionCountry(country = "India") {
  return (COMMISSION_COUNTRY_CURRENCIES as any)[country] || "INR";
}

function mapSlab(row: any) {
  if (!row) {
    return null;
  }
  const slab = rowToCamel(row);
  return {
    id: slab!.id,
    country: slab!.country || "India",
    minAmount: Number(slab!.minAmount || 0),
    maxAmount: slab!.maxAmount === null || slab!.maxAmount === undefined ? null : Number(slab!.maxAmount),
    ratePercent: Number(slab!.ratePercent || 0),
    currency: slab!.currency || currencyForCommissionCountry((slab!.country as any)),
    sortOrder: Number(slab!.sortOrder || 0),
    isActive: slab!.isActive !== false,
    createdAt: toIso(slab!.createdAt),
    updatedAt: toIso(slab!.updatedAt),
  };
}

function mapBankAccount(row: any) {
  if (!row) {
    return null;
  }
  const account = rowToCamel(row);
  return {
    id: account!.id,
    partnerId: account!.partnerId,
    accountHolderName: account!.accountHolderName || "",
    bankName: account!.bankName || "",
    accountNumber: account!.accountNumber || "",
    ifscOrRouting: account!.ifscOrRouting || "",
    branchName: account!.branchName || "",
    iban: account!.iban || "",
    swiftBic: account!.swiftBic || "",
    isPrimary: account!.isPrimary !== false,
    createdAt: toIso(account!.createdAt),
    updatedAt: toIso(account!.updatedAt),
  };
}

function hasBankPayoutDetails(entry: any) {
  return Boolean(
    entry?.accountHolderName ||
      entry?.bankName ||
      entry?.accountNumber ||
      entry?.ifscOrRouting ||
      entry?.iban ||
      entry?.swiftBic ||
      entry?.branchName,
  );
}

function mapCommissionEntry(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    partnerId: entry!.partnerId,
    leadId: entry!.leadId,
    quotationId: entry!.quotationId,
    paymentId: entry!.paymentId || null,
    dealAmount: Number(entry!.dealAmount || 0),
    slabId: entry!.slabId || null,
    ratePercent: Number(entry!.ratePercent || 0),
    commissionAmount: Number(entry!.commissionAmount || 0),
    currency: entry!.currency || "INR",
    status: entry!.status || COMMISSION_ENTRY_STATUSES.PENDING,
    accruedAt: toIso(entry!.accruedAt),
    paidAt: toIso(entry!.paidAt),
    paidBy: entry!.paidBy || null,
    payoutReference: entry!.payoutReference || "",
    notes: entry!.notes || "",
    leadCompanyName: entry!.leadCompanyName || "",
    leadTenantId: entry!.leadTenantId || "",
    partnerCompanyName: entry!.partnerCompanyName || "",
    partnerContactName: entry!.partnerContactName || "",
    partnerWorkEmail: entry!.partnerWorkEmail || "",
    partnerCountry: entry!.partnerCountry || "",
    bankAccount: hasBankPayoutDetails(entry)
      ? {
          accountHolderName: entry!.accountHolderName || "",
          bankName: entry!.bankName || "",
          accountNumber: entry!.accountNumber || "",
          ifscOrRouting: entry!.ifscOrRouting || "",
          branchName: entry!.branchName || "",
          iban: entry!.iban || "",
          swiftBic: entry!.swiftBic || "",
        }
      : null,
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

function normalizeMaxAmount(maxAmount: any) {
  return maxAmount === null || maxAmount === undefined ? null : Number(maxAmount);
}

/** Exact same From/To only — overlapping ranges are allowed. */
function rangesEqual(aMin: any, aMax: any, bMin: any, bMax: any) {
  return Number(aMin) === Number(bMin) && normalizeMaxAmount(aMax) === normalizeMaxAmount(bMax);
}

function normalizeSlabPayload(payload: any = {}) {
  const country = String((payload as any).country || "India").trim() || "India";
  const minAmount = Number((payload as any).minAmount);
  const maxRaw = (payload as any).maxAmount;
  const maxAmount =
    maxRaw === null || maxRaw === undefined || maxRaw === "" ? null : Number(maxRaw);
  const ratePercent = Number((payload as any).ratePercent);
  const currency =
    String((payload as any).currency || currencyForCommissionCountry(country)).trim().toUpperCase() ||
    currencyForCommissionCountry(country);
  const sortOrder = Number((payload as any).sortOrder || 0);
  const isActive = (payload as any).isActive !== false;

  if (!Number.isFinite(minAmount) || minAmount < 0) {
    throw new Error("Minimum amount must be a non-negative number.");
  }
  if (maxAmount === null || !Number.isFinite(maxAmount) || maxAmount < 0) {
    throw new Error("Maximum amount is required and must be a non-negative number.");
  }
  if (maxAmount <= minAmount) {
    throw new Error("Maximum amount must be greater than minimum amount.");
  }
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 99.9) {
    throw new Error("Commission rate must be between 0 and 99.9.");
  }
  if (Math.abs(ratePercent * 10 - Math.round(ratePercent * 10)) > 1e-9) {
    throw new Error("Commission rate may have at most one decimal place (e.g. 99.9).");
  }

  return { country, minAmount, maxAmount, ratePercent, currency, sortOrder, isActive };
}

async function assertNoDuplicateSlabRange({ country, minAmount, maxAmount, ignoreId = null }: any) {
  const slabs = await commissionsRepo.selectAllCommissionSlabs(pool, {
    activeOnly: false,
    country,
  });
  for (const row of slabs) {
    if (ignoreId && row.id === ignoreId) {
      continue;
    }
    if (row.is_active === false) {
      continue;
    }
    const existing = mapSlab(row);
    if (rangesEqual(minAmount, maxAmount, existing!.minAmount, existing!.maxAmount)) {
      throw new Error(
        `Slab already exists for ${country} range ${existing!.minAmount} – ${existing!.maxAmount ?? "—"} (${existing!.ratePercent}%).`,
      );
    }
  }
}

export async function listCommissionSlabs({ activeOnly = false, country = null }: any = {}) {
  const rows = await commissionsRepo.selectAllCommissionSlabs(pool, {
    activeOnly,
    country: country || null,
  });
  return rows.map(mapSlab);
}

export async function createCommissionSlab(payload: any) {
  const normalized = normalizeSlabPayload(payload);
  await assertNoDuplicateSlabRange(normalized);
  const row = await commissionsRepo.insertCommissionSlab(pool, [
    normalized.country,
    normalized.minAmount,
    normalized.maxAmount,
    normalized.ratePercent,
    normalized.currency,
    normalized.sortOrder,
    normalized.isActive,
  ]);
  return mapSlab(row);
}

export async function updateCommissionSlab(slabId: any, payload: any) {
  const existing = await commissionsRepo.selectCommissionSlabById(pool, slabId);
  if (!existing) {
    throw new Error("Commission slab not found.");
  }
  const normalized = normalizeSlabPayload({
    ...payload,
    country: payload.country ?? existing.country,
  });
  await assertNoDuplicateSlabRange({ ...normalized, ignoreId: slabId });
  const row = await commissionsRepo.updateCommissionSlab(pool, slabId, [
    normalized.country,
    normalized.minAmount,
    normalized.maxAmount,
    normalized.ratePercent,
    normalized.currency,
    normalized.sortOrder,
    normalized.isActive,
  ]);
  return mapSlab(row);
}

export async function deleteCommissionSlab(slabId: any) {
  const deleted = await commissionsRepo.deleteCommissionSlab(pool, slabId);
  if (!deleted) {
    throw new Error("Commission slab not found.");
  }
  return { ok: true };
}

function slabCreatedAtMs(slab: any) {
  const parsed = slab?.createdAt ? Date.parse(slab.createdAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function resolveSlabForAmount(slabs: any, amount: any, { country = null }: any = {}) {
  const value = Number(amount) || 0;
  // First match wins: lower sortOrder, then earlier created (comes first), then minAmount.
  const active = (slabs || [])
    .filter((slab: any) => slab.isActive !== false)
    .filter((slab: any) => !country || slab.country === country)
    .sort(
      (left: any, right: any) =>
        left.sortOrder - right.sortOrder ||
        slabCreatedAtMs(left) - slabCreatedAtMs(right) ||
        left.minAmount - right.minAmount,
    );

  for (const slab of active) {
    const withinMin = value >= slab.minAmount;
    const withinMax = slab.maxAmount === null || value <= slab.maxAmount;
    if (withinMin && withinMax) {
      return slab;
    }
  }
  return null;
}

export async function getPartnerCountry(partnerId: any) {
  const partner = await partnersRepo.selectPartnerById(pool, partnerId);
  return String(partner?.country || "India").trim() || "India";
}

export async function getPartnerBankAccount(partnerId: any) {
  const row = await commissionsRepo.selectPartnerBankAccount(pool, partnerId);
  return mapBankAccount(row);
}

export async function upsertPartnerBankAccount(partnerId: any, payload: any = {}) {
  const country = await getPartnerCountry(partnerId);
  const { values } = validatePartnerBankPayload(payload, country);

  const row = await commissionsRepo.upsertPartnerBankAccount(pool, [
    partnerId,
    values.accountHolderName,
    values.bankName || "",
    values.accountNumber || "",
    values.ifscOrRouting || "",
    values.branchName || null,
    values.iban || null,
    values.swiftBic || null,
  ]);
  return mapBankAccount(row);
}

export async function getCommissionEntryById(entryId: any) {
  const row = await commissionsRepo.selectCommissionEntryById(pool, entryId);
  return mapCommissionEntry(row);
}

export async function listPartnerCommissions(partnerId: any) {
  const rows = await commissionsRepo.selectCommissionEntriesForPartner(pool, partnerId);
  const entries = rows.map(mapCommissionEntry);
  const pendingTotal = entries
    .filter((entry: any) => entry.status === COMMISSION_ENTRY_STATUSES.PENDING)
    .reduce((sum: any, entry: any) => sum + entry.commissionAmount, 0);
  const paidTotal = entries
    .filter((entry: any) => entry.status === COMMISSION_ENTRY_STATUSES.PAID)
    .reduce((sum: any, entry: any) => sum + entry.commissionAmount, 0);

  return {
    entries,
    summary: {
      pendingCount: entries.filter((entry: any) => entry.status === COMMISSION_ENTRY_STATUSES.PENDING)
        .length,
      paidCount: entries.filter((entry: any) => entry.status === COMMISSION_ENTRY_STATUSES.PAID).length,
      pendingTotal,
      paidTotal,
      currency: entries[0]?.currency || "INR",
    },
  };
}

export async function listFinanceCommissions({ status = null }: any = {}) {
  const normalizedStatus =
    status === COMMISSION_ENTRY_STATUSES.PENDING || status === COMMISSION_ENTRY_STATUSES.PAID
      ? status
      : null;
  const rows = await commissionsRepo.selectCommissionEntriesForFinance(pool, {
    status: normalizedStatus,
  });
  return rows.map(mapCommissionEntry);
}

function mapFinanceCommissionPartner(row: any) {
  if (!row) {
    return null;
  }
  const pendingCount = Number(row.pendingCount ?? row.pending_count ?? 0);
  const paidCount = Number(row.paidCount ?? row.paid_count ?? 0);
  let status = "paid";
  if (pendingCount > 0 && paidCount > 0) {
    status = "mixed";
  } else if (pendingCount > 0) {
    status = "pending";
  }
  return {
    partnerId: row.partnerId || row.partner_id,
    partnerCompanyName: row.partnerCompanyName || row.partner_company_name || "",
    partnerContactName: row.partnerContactName || row.partner_contact_name || "",
    partnerWorkEmail: row.partnerWorkEmail || row.partner_work_email || "",
    partnerCountry: row.partnerCountry || row.partner_country || "",
    entryCount: Number(row.entryCount ?? row.entry_count ?? 0),
    pendingCount,
    paidCount,
    dealTotal: Number(row.dealTotal ?? row.deal_total ?? 0),
    pendingCommissionTotal: Number(
      row.pendingCommissionTotal ?? row.pending_commission_total ?? 0,
    ),
    paidCommissionTotal: Number(row.paidCommissionTotal ?? row.paid_commission_total ?? 0),
    commissionTotal: Number(row.commissionTotal ?? row.commission_total ?? 0),
    currency: row.currency || "INR",
    status,
    latestAccruedAt: toIso(row.latestAccruedAt || row.latest_accrued_at),
  };
}

export async function listFinanceCommissionPartners({ status = null }: any = {}) {
  const normalizedStatus =
    status === COMMISSION_ENTRY_STATUSES.PENDING || status === COMMISSION_ENTRY_STATUSES.PAID
      ? status
      : null;
  const rows = await commissionsRepo.selectFinanceCommissionPartners(pool, {
    status: normalizedStatus,
  });
  return rows.map(mapFinanceCommissionPartner);
}

export async function getFinancePartnerCommissionOverview(partnerId: any) {
  const overview = await commissionsRepo.selectFinancePartnerCommissionOverview(pool, partnerId);
  if (!overview?.partner) {
    const error = new Error("Partner not found.");
    (error as any).status = 404;
    throw error;
  }

  const partner = rowToCamel(overview.partner);
  if (!partner) {
    const error = new Error("Partner not found.");
    (error as any).status = 404;
    throw error;
  }

  const deals = (overview.entries || []).map((row: any) => {
    const entry = mapCommissionEntry({
      ...row,
      partner_company_name: partner.companyName,
      partner_contact_name: partner.contactName,
      partner_work_email: partner.workEmail,
      partner_country: partner.country,
      account_holder_name: partner.accountHolderName,
      bank_name: partner.bankName,
      account_number: partner.accountNumber,
      ifsc_or_routing: partner.ifscOrRouting,
      branch_name: partner.branchName,
      iban: partner.iban,
      swift_bic: partner.swiftBic,
    });
    return {
      ...entry,
      leadStatus: row.lead_status || row.leadStatus || "",
    };
  });

  const dealTotal = deals.reduce((sum: number, entry: any) => sum + Number(entry.dealAmount || 0), 0);
  const pendingCommissionTotal = deals
    .filter((entry: any) => entry.status === COMMISSION_ENTRY_STATUSES.PENDING)
    .reduce((sum: number, entry: any) => sum + Number(entry.commissionAmount || 0), 0);
  const paidCommissionTotal = deals
    .filter((entry: any) => entry.status === COMMISSION_ENTRY_STATUSES.PAID)
    .reduce((sum: number, entry: any) => sum + Number(entry.commissionAmount || 0), 0);

  return {
    partner: {
      id: partner.id,
      companyName: partner.companyName || "",
      contactName: partner.contactName || "",
      workEmail: partner.workEmail || "",
      country: partner.country || "",
      isActive: partner.isActive !== false,
      bankAccount: partner.accountHolderName || partner.accountNumber || partner.iban
        ? {
            accountHolderName: partner.accountHolderName || "",
            bankName: partner.bankName || "",
            accountNumber: partner.accountNumber || "",
            ifscOrRouting: partner.ifscOrRouting || "",
            branchName: partner.branchName || "",
            iban: partner.iban || "",
            swiftBic: partner.swiftBic || "",
          }
        : null,
    },
    summary: {
      dealTotal,
      pendingCommissionTotal,
      paidCommissionTotal,
      commissionTotal: pendingCommissionTotal + paidCommissionTotal,
      leadCount: Number(overview.leadCount || 0),
      customerCount: Number(overview.customerCount || 0),
      pendingCount: deals.filter((entry: any) => entry.status === COMMISSION_ENTRY_STATUSES.PENDING)
        .length,
      paidCount: deals.filter((entry: any) => entry.status === COMMISSION_ENTRY_STATUSES.PAID).length,
      currency: deals[0]?.currency || "INR",
    },
    deals,
  };
}

export async function markPartnerCommissionPaid(
  entryId: any,
  { paidBy, payoutReference = "", notes = "" }: any,
) {
  if (!paidBy) {
    throw new Error("Finance user is required to mark commission paid.");
  }
  const normalizedReference = assertValidUtr(payoutReference, "UTR or bank reference");
  const row = await commissionsRepo.markCommissionEntryPaid(pool, entryId, {
    paidBy,
    payoutReference: normalizedReference,
    notes: String(notes || "").trim(),
  });
  if (!row) {
    throw new Error("Pending commission entry not found.");
  }
  const entry = mapCommissionEntry(row);
  if (!entry) {
    throw new Error("Pending commission entry not found.");
  }
  const portal = await resolveLeadPortalEventContext(entry.leadId);
  await publishCommissionEvent("commission.paid", {
    ...portal,
    entryId: entry.id,
    partnerId: entry.partnerId,
    leadId: entry.leadId,
    quotationId: entry.quotationId,
    status: entry.status,
  });

  const { queuePortalCommissionPaidEmail } = await import("../../infra/notify.js");
  void queuePortalCommissionPaidEmail(entry.id);

  return entry;
}

/**
 * Accrue a pending commission when a partner-referred quotation is fully paid.
 */
export async function accruePartnerCommissionForPaidQuotation(quotation: any, payment: any = null) {
  if (!quotation?.id || !quotation?.leadId) {
    return null;
  }

  const paymentStatus = (payment as any)?.status || quotation.payment?.status;
  if (paymentStatus && paymentStatus !== "paid") {
    return null;
  }

  const leadRow = await commissionsRepo.selectPartnerLeadPartnerId(pool, quotation.leadId);
  if (!leadRow?.partner_id) {
    return null;
  }

  const existing = await commissionsRepo.selectCommissionEntryByQuotationId(pool, quotation.id);
  if (existing) {
    return mapCommissionEntry(existing);
  }

  const dealAmount = Number(
    (payment as any)?.grandTotal || quotation.payment?.grandTotal || quotation.grandTotal || 0,
  );
  if (!Number.isFinite(dealAmount) || dealAmount <= 0) {
    return null;
  }

  const leadCountry =
    leadRow.country ||
    quotation.lead?.country ||
    quotation.leadSnapshot?.country ||
    "India";

  const slabs = await listCommissionSlabs({ activeOnly: true, country: leadCountry });
  const slab = resolveSlabForAmount(slabs, dealAmount, { country: leadCountry });
  if (!slab) {
    console.warn(
      `[commissions] No active ${leadCountry} slab for deal amount ${dealAmount} on quotation ${quotation.id}`,
    );
    return null;
  }

  const commissionAmount = Number(((dealAmount * slab.ratePercent) / 100).toFixed(2));
  const paymentId = (payment as any)?.id || quotation.payment?.id || null;
  const currency =
    (payment as any)?.currency ||
    quotation.payment?.currency ||
    quotation.currency ||
    slab.currency ||
    currencyForCommissionCountry(leadCountry);

  const row = await commissionsRepo.insertCommissionEntry(pool, [
    leadRow.partner_id,
    quotation.leadId,
    quotation.id,
    paymentId,
    dealAmount,
    slab.id,
    slab.ratePercent,
    commissionAmount,
    currency,
  ]);

  if (!row) {
    const again = await commissionsRepo.selectCommissionEntryByQuotationId(pool, quotation.id);
    return mapCommissionEntry(again);
  }

  const entry = mapCommissionEntry(row);
  if (!entry) {
    return null;
  }
  const portal = await resolveLeadPortalEventContext(entry.leadId);
  await publishCommissionEvent("commission.accrued", {
    ...portal,
    entryId: entry.id,
    partnerId: entry.partnerId,
    leadId: entry.leadId,
    quotationId: entry.quotationId,
    status: entry.status,
  });

  const { queuePortalCommissionAccruedEmail } = await import("../../infra/notify.js");
  void queuePortalCommissionAccruedEmail(entry.id);

  return entry;
}
