import crypto from "node:crypto";

import bcrypt from "bcrypt";

import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { validatePasswordPolicy } from "../auth/password-policy.js";
import * as partnerAuthRepo from "../../repositories/raw/partnerAuth.repo.js";
import * as partnersRepo from "../../repositories/raw/partners.repo.js";
import { mapPartnerRow } from "./partner-store.js";
import { AUTH_SESSION_TTL_MS } from "../auth/session-ttl.js";
import { createSessionAlreadyActiveError } from "../auth/session-concurrency.js";

const PARTNER_SESSION_TTL_MS = AUTH_SESSION_TTL_MS;
const BCRYPT_ROUNDS = 12;

function isPasswordHashed(password: any) {
  return String(password || "").startsWith("$2");
}

function hashPasswordLegacy(password: any) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

async function hashPassword(password: any) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function verifyPassword(storedHash: any, password: any) {
  if (!storedHash) {
    return false;
  }

  if (isPasswordHashed(storedHash)) {
    return bcrypt.compare(String(password), storedHash);
  }

  return storedHash === hashPasswordLegacy(password);
}

function mapPartnerUser(row: any) {
  const user = rowToCamel(row);
  return {
    id: user!.id,
    partnerId: user!.partnerId,
    email: user!.email,
    displayName: user!.displayName || "",
    companyName: user!.companyName || user!.partnerCompanyName || "",
    isActive: user!.isActive !== false,
    createdAt: toIso(user!.createdAt),
  };
}

export async function loginPartnerUser(email: any, password: any, { replaceSession = false }: any = {}) {
  const normalizedEmail = email.trim().toLowerCase();
  const row = await partnerAuthRepo.selectActivePartnerUserByEmail(normalizedEmail);

  if (!row || row.partner_is_active === false) {
    throw new Error("Invalid email or password.");
  }

  if (!(await verifyPassword(row.password_hash, password))) {
    throw new Error("Invalid email or password.");
  }

  if (!isPasswordHashed(row.password_hash)) {
    await partnerAuthRepo.updatePartnerPassword(row.id, await hashPassword(password));
  }

  if (await partnerAuthRepo.hasActivePartnerSessionForUser(row.id)) {
    if (replaceSession) {
      await partnerAuthRepo.deletePartnerSessionsForUser(row.id);
    } else {
      throw createSessionAlreadyActiveError();
    }
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PARTNER_SESSION_TTL_MS);

  await partnerAuthRepo.insertPartnerAuthSession(
    token,
    row.id,
    row.partner_id,
    normalizedEmail,
    expiresAt.toISOString(),
  );

  return {
    token,
    email: normalizedEmail,
    partnerId: row.partner_id,
    user: mapPartnerUser(row),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getPartnerSession(token: any) {
  const row = await partnerAuthRepo.selectPartnerSession(token);
  if (!row) {
    return null;
  }

  const session = rowToCamel(row);
  return {
    token,
    email: session!.email,
    partnerUserId: session!.partnerUserId,
    partnerId: session!.partnerId,
    displayName: session!.displayName || "",
    companyName: session!.companyName || "",
    expiresAt: toIso(session!.expiresAt),
  };
}

export async function logoutPartnerUser(token: any) {
  await partnerAuthRepo.deletePartnerSession(token);
}

export async function changePartnerPassword(partnerUserId: any, currentPassword: any, newPassword: any) {
  const storedHash = await partnerAuthRepo.selectPartnerPasswordHash(partnerUserId);
  if (!storedHash) {
    throw new Error("Partner account not found.");
  }

  if (!(await verifyPassword(storedHash, currentPassword))) {
    throw new Error("Current password is incorrect.");
  }

  validatePasswordPolicy(newPassword);
  await partnerAuthRepo.updatePartnerPassword(partnerUserId, await hashPassword(newPassword));
}

export async function listPartnerLeads(partnerId: any) {
  const rows = await partnersRepo.selectLeadsByPartnerId(pool, partnerId);
  const leadIds = rows.map((row: any) => row.id).filter(Boolean);
  const { selectLatestQuotationsForLeadIds } = await import(
    "../../repositories/raw/quotations.repo.js"
  );
  const { mapPartnerQuotationSummary, partnerQuotationStatusLabel } = await import(
    "./quotations.js"
  );
  const latestRows = await selectLatestQuotationsForLeadIds(pool, leadIds);
  const latestByLeadId = new Map(
    latestRows.map((row: any) => [String(row.lead_id), mapPartnerQuotationSummary(row)]),
  );

  return rows.map((row: any) => {
    const lead = rowToCamel(row);
    const latest = latestByLeadId.get(String(lead!.id)) || null;
    return {
      id: lead!.id,
      tenantId: lead!.tenantId,
      companyName: lead!.companyName || "",
      contactName: lead!.contactName || "",
      status: lead!.status || "New",
      assignedUserId: lead!.assignedUserId || null,
      convertedOrganizationId: lead!.convertedOrganizationId || null,
      latestQuotationId: (latest as any)?.id || null,
      latestQuotationStatus: (latest as any)?.status || null,
      latestQuotationStatusLabel: (latest as any)?.statusLabel || partnerQuotationStatusLabel(null),
      latestQuotationGrandTotal: (latest as any)?.grandTotal ?? null,
      latestQuotationCurrency: (latest as any)?.currency || null,
      createdAt: toIso(lead!.createdAt),
      updatedAt: toIso(lead!.updatedAt),
    };
  });
}

export async function getPartnerLeadDetail(partnerId: any, leadId: any) {
  const { getLeadById } = await import("../leads/lead-store.js");
  const { selectQuotationsByLeadId } = await import("../../repositories/raw/quotations.repo.js");
  const { mapPartnerQuotationSummary, partnerQuotationStatusLabel } = await import(
    "./quotations.js"
  );

  const lead = await getLeadById(leadId);
  if (!lead || lead.partnerId !== partnerId) {
    return null;
  }

  const quotationRows = await selectQuotationsByLeadId(pool, leadId);
  const quotations = quotationRows.map((row: any) => mapPartnerQuotationSummary(row));
  const latest = quotations[0] || null;

  return {
    ...lead,
    quotations,
    latestQuotationId: latest?.id || null,
    latestQuotationStatus: latest?.status || null,
    latestQuotationStatusLabel: latest?.statusLabel || partnerQuotationStatusLabel(null),
  };
}

/** Partner may update any referral owned by this partner. */
export async function updatePartnerLead(partnerId: any, leadId: any, updates: any = {}) {
  const { getLeadById, updateLead } = await import("../leads/lead-store.js");
  const lead = await getLeadById(leadId);
  if (!lead || lead.partnerId !== partnerId) {
    return null;
  }
  return updateLead(leadId, updates || {});
}

/** Partner may hard-delete referrals they own. */
export async function deletePartnerLead(partnerId: any, leadId: any) {
  const { getLeadById } = await import("../leads/lead-store.js");
  const { hardDeleteCustomerByLeadId } = await import("../customer-portal/deletion.js");
  const lead = await getLeadById(leadId);
  if (!lead || lead.partnerId !== partnerId) {
    return null;
  }
  return hardDeleteCustomerByLeadId(leadId, {
    actor: { type: "partner", partnerId: String(partnerId) },
  });
}

export async function getPartnerQuotationInvoice(partnerId: any, leadId: any, quotationId: any) {
  const { getLeadById } = await import("../leads/lead-store.js");
  const { getQuotationInvoiceForLead } = await import("../quotations/quotation-store.js");
  const { selectQuotationById } = await import("../../repositories/raw/quotations.repo.js");
  const { partnerCanViewInvoice } = await import("./quotations.js");

  const lead = await getLeadById(leadId);
  if (!lead || lead.partnerId !== partnerId) {
    const error = new Error("Lead not found.");
    (error as any).status = 404;
    throw error;
  }

  const row = await selectQuotationById(pool, quotationId);
  if (!row || String(row.lead_id) !== String(leadId)) {
    const error = new Error("Quotation not found.");
    (error as any).status = 404;
    throw error;
  }

  if (!partnerCanViewInvoice(row.status)) {
    const error = new Error(
      "Invoice is available after finance approval or when the quotation is paid.",
    );
    (error as any).status = 403;
    throw error;
  }

  const invoice = await getQuotationInvoiceForLead(leadId, quotationId);
  if (!invoice) {
    const error = new Error("Invoice not found for this quotation.");
    (error as any).status = 404;
    throw error;
  }

  return invoice;
}

export async function getPartnerProfile(partnerId: any) {
  const row = await partnersRepo.selectPartnerById(pool, partnerId);
  if (!row) {
    return null;
  }
  const users = await partnersRepo.selectPartnerUsersByPartnerId(pool, partnerId);
  return mapPartnerRow(
    row,
    users.map((user: any) => rowToCamel(user)),
  );
}

/** Admin: clear all portal sessions for every login under this partner. */
export async function forceLogoutPartnerByAdmin(partnerId: any) {
  const users = await partnersRepo.selectPartnerUsersByPartnerId(pool, partnerId);
  if (!users.length) {
    const partner = await partnersRepo.selectPartnerById(pool, partnerId);
    if (!partner) {
      const error = new Error("Partner not found.");
      (error as any).status = 404;
      throw error;
    }
    return { ok: true, partnerId: String(partnerId), clearedUsers: 0 };
  }

  for (const user of users) {
    await partnerAuthRepo.deletePartnerSessionsForUser(user.id);
  }

  return { ok: true, partnerId: String(partnerId), clearedUsers: users.length };
}

/** Admin: permanently remove a partner (portal users/sessions cascade). */
export async function deletePartnerByAdmin(partnerId: any) {
  const partner = await partnersRepo.selectPartnerById(pool, partnerId);
  if (!partner) {
    const error = new Error("Partner not found.");
    (error as any).status = 404;
    throw error;
  }

  const linked = await partnersRepo.countPartnerLinkedRecords(pool, partnerId);
  if (linked.leadCount > 0 || linked.commissionCount > 0) {
    const parts = [];
    if (linked.leadCount > 0) {
      parts.push(
        `${linked.leadCount} referral lead${linked.leadCount === 1 ? "" : "s"}`,
      );
    }
    if (linked.commissionCount > 0) {
      parts.push(
        `${linked.commissionCount} commission entr${linked.commissionCount === 1 ? "y" : "ies"}`,
      );
    }
    throw new Error(
      `Cannot delete this partner while it still has ${parts.join(" and ")}. Mark the partner inactive instead.`,
    );
  }

  await forceLogoutPartnerByAdmin(partnerId);
  const deleted = await partnersRepo.deletePartnerById(pool, partnerId);
  if (!deleted) {
    const error = new Error("Partner not found.");
    (error as any).status = 404;
    throw error;
  }

  return { ok: true, partnerId: String(partnerId) };
}
