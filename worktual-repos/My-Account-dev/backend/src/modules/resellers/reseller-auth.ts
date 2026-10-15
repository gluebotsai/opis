import crypto from "node:crypto";

import bcrypt from "bcrypt";

import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { validatePasswordPolicy } from "../auth/password-policy.js";
import * as resellerAuthRepo from "../../repositories/raw/resellerAuth.repo.js";
import * as resellersRepo from "../../repositories/raw/resellers.repo.js";
import { mapResellerRow } from "./reseller-store.js";
import { AUTH_SESSION_TTL_MS } from "../auth/session-ttl.js";
import { createSessionAlreadyActiveError } from "../auth/session-concurrency.js";

const RESELLER_SESSION_TTL_MS = AUTH_SESSION_TTL_MS;
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

function mapResellerUser(row: any) {
  const user = rowToCamel(row);
  return {
    id: user!.id,
    resellerId: user!.resellerId,
    email: user!.email,
    displayName: user!.displayName || "",
    companyName: user!.companyName || user!.resellerCompanyName || "",
    isActive: user!.isActive !== false,
    createdAt: toIso(user!.createdAt),
  };
}

export async function loginResellerUser(email: any, password: any, { replaceSession = false }: any = {}) {
  const normalizedEmail = email.trim().toLowerCase();
  const row = await resellerAuthRepo.selectActiveResellerUserByEmail(normalizedEmail);

  if (!row || row.reseller_is_active === false) {
    throw new Error("Invalid email or password.");
  }

  if (!(await verifyPassword(row.password_hash, password))) {
    throw new Error("Invalid email or password.");
  }

  if (!isPasswordHashed(row.password_hash)) {
    await resellerAuthRepo.updateResellerPassword(row.id, await hashPassword(password));
  }

  if (await resellerAuthRepo.hasActiveResellerSessionForUser(row.id)) {
    if (replaceSession) {
      await resellerAuthRepo.deleteResellerSessionsForUser(row.id);
    } else {
      throw createSessionAlreadyActiveError();
    }
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + RESELLER_SESSION_TTL_MS);

  await resellerAuthRepo.insertResellerAuthSession(
    token,
    row.id,
    row.reseller_id,
    normalizedEmail,
    expiresAt.toISOString(),
  );

  return {
    token,
    email: normalizedEmail,
    resellerId: row.reseller_id,
    user: mapResellerUser(row),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getResellerSession(token: any) {
  const row = await resellerAuthRepo.selectResellerSession(token);
  if (!row) {
    return null;
  }

  const session = rowToCamel(row);
  return {
    token,
    email: session!.email,
    resellerUserId: session!.resellerUserId,
    resellerId: session!.resellerId,
    displayName: session!.displayName || "",
    companyName: session!.companyName || "",
    expiresAt: toIso(session!.expiresAt),
  };
}

export async function logoutResellerUser(token: any) {
  await resellerAuthRepo.deleteResellerSession(token);
}

export async function changeResellerPassword(resellerUserId: any, currentPassword: any, newPassword: any) {
  const storedHash = await resellerAuthRepo.selectResellerPasswordHash(resellerUserId);
  if (!storedHash) {
    throw new Error("Reseller account not found.");
  }

  if (!(await verifyPassword(storedHash, currentPassword))) {
    throw new Error("Current password is incorrect.");
  }

  validatePasswordPolicy(newPassword);
  await resellerAuthRepo.updateResellerPassword(resellerUserId, await hashPassword(newPassword));
}

export async function listResellerLeads(resellerId: any) {
  const rows = await resellersRepo.selectLeadsByResellerId(pool, resellerId);
  return rows.map((row: any) => {
    const lead = rowToCamel(row);
    return {
      id: lead!.id,
      tenantId: lead!.tenantId,
      companyName: lead!.companyName || "",
      contactName: lead!.contactName || "",
      status: lead!.status || "New",
      convertedOrganizationId: lead!.convertedOrganizationId || null,
      createdAt: toIso(lead!.createdAt),
      updatedAt: toIso(lead!.updatedAt),
    };
  });
}

export async function getResellerLeadDetail(resellerId: any, leadId: any) {
  const { getLeadById } = await import("../leads/lead-store.js");
  const lead = await getLeadById(leadId);
  if (!lead || lead.resellerId !== resellerId) {
    return null;
  }
  return lead;
}

/** Reseller may update any lead owned by this reseller. */
export async function updateResellerLead(resellerId: any, leadId: any, updates: any = {}) {
  const { getLeadById, updateLead } = await import("../leads/lead-store.js");
  const lead = await getLeadById(leadId);
  if (!lead || lead.resellerId !== resellerId) {
    return null;
  }
  return updateLead(leadId, updates || {});
}

/** Reseller may hard-delete leads they own. */
export async function deleteResellerLead(resellerId: any, leadId: any) {
  const { getLeadById } = await import("../leads/lead-store.js");
  const { hardDeleteCustomerByLeadId } = await import("../customer-portal/deletion.js");
  const lead = await getLeadById(leadId);
  if (!lead || lead.resellerId !== resellerId) {
    return null;
  }
  return hardDeleteCustomerByLeadId(leadId, {
    actor: { type: "reseller", resellerId: String(resellerId) },
  });
}

export async function listResellerRenewals(resellerId: any, { withinDays = 90 }: any = {}) {
  const rows = await resellersRepo.selectRenewalsByResellerId(pool, resellerId, withinDays);
  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: entry!.id,
      subscriptionId: entry!.subscriptionId,
      productId: entry!.productId,
      organizationId: entry!.organizationId,
      companyName: entry!.companyName || "",
      tenantId: entry!.tenantId || "",
      dueAt: toIso(entry!.dueAt),
      status: entry!.status,
      renewalQuotationId: entry!.renewalQuotationId || null,
    };
  });
}

export async function listResellerInvoices(resellerId: any) {
  const rows = await resellersRepo.selectInvoicesByResellerId(pool, resellerId);
  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      quotationId: entry!.quotationId || null,
      leadId: entry!.leadId,
      status: entry!.quotationStatus || entry!.status || "",
      grandTotal: entry!.grandTotal !== null ? Number(entry!.grandTotal) : null,
      currency: entry!.currency || "INR",
      submittedAt: toIso(entry!.submittedAt),
      reviewedAt: toIso(entry!.reviewedAt),
      companyName: entry!.companyName || "",
      tenantId: entry!.tenantId || "",
      invoiceSource: entry!.invoiceSource || "quotation",
    };
  });
}

export async function getResellerProfile(resellerId: any) {
  const row = await resellersRepo.selectResellerById(pool, resellerId);
  if (!row) {
    return null;
  }
  const users = await resellersRepo.selectResellerUsersByResellerId(pool, resellerId);
  return mapResellerRow(
    row,
    users.map((user: any) => rowToCamel(user)),
  );
}

/** Admin: clear all portal sessions for every login under this reseller. */
export async function forceLogoutResellerByAdmin(resellerId: any) {
  const users = await resellersRepo.selectResellerUsersByResellerId(pool, resellerId);
  if (!users.length) {
    const reseller = await resellersRepo.selectResellerById(pool, resellerId);
    if (!reseller) {
      const error = new Error("Reseller not found.");
      (error as any).status = 404;
      throw error;
    }
    return { ok: true, resellerId: String(resellerId), clearedUsers: 0 };
  }

  for (const user of users) {
    await resellerAuthRepo.deleteResellerSessionsForUser(user.id);
  }

  return { ok: true, resellerId: String(resellerId), clearedUsers: users.length };
}
