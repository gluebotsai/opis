import bcrypt from "bcrypt";

import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { assertValidEmailAddress } from "../../lib/email-validation-runtime.js";
import {
  assertExternalAccountContactsAvailable,
  isValidLeadAddressFormat,
} from "../leads/contact-validation.js";
import { validateMobileForDialCode } from "../../lib/mobile-validation.js";
import { validatePasswordPolicy } from "../auth/password-policy.js";
import * as resellersRepo from "../../repositories/raw/resellers.repo.js";

const BCRYPT_ROUNDS = 12;

function normalizeEmail(email: any) {
  return String(email || "").trim().toLowerCase();
}

function isUniqueViolation(error: any) {
  return error?.code === "23505";
}

function normalizeInvoiceCcEmails(value: any) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeEmail(entry)).filter(Boolean);
  }

  return String(value || "")
    .split(/[,;]/)
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}

export function mapResellerRow(row: any, users: any[] = []) {
  if (!row) {
    return null;
  }

  const reseller = rowToCamel(row);
  const parsedUsers = Array.isArray(users)
    ? users
    : Array.isArray(reseller!.users)
      ? reseller!.users
      : [];

  return {
    id: reseller!.id,
    companyName: reseller!.companyName || "",
    contactName: reseller!.contactName || "",
    designation: reseller!.designation || "",
    workEmail: reseller!.workEmail || "",
    invoiceEmail: reseller!.invoiceEmail || "",
    invoiceCcEmails: (() => {
      if (Array.isArray(reseller!.invoiceCcEmails)) {
        return reseller!.invoiceCcEmails;
      }
      if (typeof reseller!.invoiceCcEmails === "string") {
        try {
          return JSON.parse(reseller!.invoiceCcEmails || "[]");
        } catch {
          return [];
        }
      }
      return [];
    })(),
    taxNumber: reseller!.taxNumber || "",
    billingAddress: reseller!.billingAddress || "",
    country: reseller!.country || "",
    websiteUrl: reseller!.websiteUrl || "",
    mobileCountryCode: reseller!.mobileCountryCode || "+91",
    mobileNumber: reseller!.mobileNumber || "",
    isActive: reseller!.isActive !== false,
    createdBy: reseller!.createdBy || null,
    users: parsedUsers.map((user: any) => ({
      id: user.id,
      email: user.email || "",
      displayName: user.displayName || user.display_name || "",
      isActive: user.isActive !== false && user.is_active !== false,
    })),
    createdAt: toIso(reseller!.createdAt),
    updatedAt: toIso(reseller!.updatedAt),
  };
}

export function mapResellerSnapshot(reseller: any) {
  if (!reseller) {
    return null;
  }

  return {
    id: reseller.id,
    companyName: reseller.companyName || "",
    contactName: reseller.contactName || "",
    designation: reseller.designation || "",
    workEmail: reseller.workEmail || "",
    invoiceEmail: reseller.invoiceEmail || "",
    invoiceCcEmails: reseller.invoiceCcEmails || [],
    taxNumber: reseller.taxNumber || "",
    billingAddress: reseller.billingAddress || "",
    country: reseller.country || "",
    mobileCountryCode: reseller.mobileCountryCode || "+91",
    mobileNumber: reseller.mobileNumber || "",
  };
}

function assertResellerPayload(payload: any = {}, { requireLogin = false }: any = {}) {
  const companyName = String((payload as any).companyName || "").trim();
  const contactName = String((payload as any).contactName || "").trim();
  const workEmail = normalizeEmail((payload as any).workEmail);
  const invoiceEmail = normalizeEmail((payload as any).invoiceEmail || (payload as any).workEmail);
  const taxNumber = String((payload as any).taxNumber || "").trim();
  const billingAddress = String((payload as any).billingAddress || "").trim();
  const country = String((payload as any).country || "").trim();

  if (!companyName) {
    throw new Error("Reseller company name is required.");
  }
  if (!contactName) {
    throw new Error("Reseller contact name is required.");
  }
  if (!workEmail) {
    throw new Error("Reseller work email is required.");
  }
  assertValidEmailAddress(workEmail, "Reseller work email");
  if (!invoiceEmail) {
    throw new Error("Reseller invoice email is required.");
  }
  assertValidEmailAddress(invoiceEmail, "Reseller invoice email");
  if (!billingAddress) {
    throw new Error("Reseller billing address is required.");
  }
  if (!isValidLeadAddressFormat(billingAddress)) {
    throw new Error(
      "Reseller billing address can only include letters, numbers, spaces, and , . - / # '.",
    );
  }
  if (!country) {
    throw new Error("Reseller country is required.");
  }

  const loginEmail = normalizeEmail((payload as any).loginEmail || (payload as any).portalEmail);
  const password = String((payload as any).password || "");
  const displayName = String((payload as any).displayName || (payload as any).contactName || companyName).trim();

  if (requireLogin) {
    if (!loginEmail) {
      throw new Error("Reseller portal login email is required.");
    }
    assertValidEmailAddress(loginEmail, "Reseller portal login email");
    validatePasswordPolicy(password);
  }

  const invoiceCcEmails = normalizeInvoiceCcEmails((payload as any).invoiceCcEmails);
  for (const [index, email] of invoiceCcEmails.entries()) {
    assertValidEmailAddress(email, `Invoice CC email ${index + 1}`);
  }

  const mobileCountryCode = String((payload as any).mobileCountryCode || "+91").trim();
  const mobileNumber = String((payload as any).mobileNumber || "").replace(/\D/g, "").trim();
  const mobileError = validateMobileForDialCode(mobileCountryCode, mobileNumber);
  if (mobileError) {
    throw new Error(mobileError);
  }

  return {
    companyName,
    contactName,
    designation: String((payload as any).designation || "").trim(),
    workEmail,
    invoiceEmail,
    invoiceCcEmails,
    taxNumber,
    billingAddress,
    country,
    websiteUrl: String((payload as any).websiteUrl || "").trim(),
    mobileCountryCode,
    mobileNumber,
    isActive: (payload as any).isActive !== false,
    loginEmail,
    password,
    displayName,
  };
}

async function hashPassword(password: any) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function assertResellerContactsAvailable(
  {
    workEmail,
    invoiceEmail,
    loginEmail,
    mobileCountryCode,
    mobileNumber,
  }: {
    workEmail?: string;
    invoiceEmail?: string;
    loginEmail?: string;
    mobileCountryCode?: string;
    mobileNumber?: string;
  },
  { ignoreResellerId = null }: { ignoreResellerId?: string | null } = {},
) {
  await assertExternalAccountContactsAvailable(
    {
      emails: [workEmail, invoiceEmail, loginEmail],
      mobileCountryCode,
      mobileNumber,
    },
    { ignoreResellerId },
  );
}

export async function listResellers() {
  const rows = await resellersRepo.selectAllResellers(pool);
  return rows.map((row: any) => mapResellerRow(row));
}

export async function listActiveResellers() {
  const rows = await resellersRepo.selectActiveResellers(pool);
  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: entry!.id,
      companyName: entry!.companyName || "",
      contactName: entry!.contactName || "",
      invoiceEmail: entry!.invoiceEmail || "",
      workEmail: entry!.workEmail || "",
    };
  });
}

export async function getResellerById(resellerId: any) {
  const row = await resellersRepo.selectResellerById(pool, resellerId);
  if (!row) {
    return null;
  }

  const users = await resellersRepo.selectResellerUsersByResellerId(pool, resellerId);
  return mapResellerRow(row, users.map((user: any) => rowToCamel(user)));
}

export async function createReseller(payload: any, { createdByUserId = null }: any = {}) {
  const normalized = assertResellerPayload(payload, { requireLogin: true });
  await assertResellerContactsAvailable(normalized);
  const passwordHash = await hashPassword(normalized.password);

  let resellerRow;
  try {
    resellerRow = await resellersRepo.insertReseller(pool, [
      normalized.companyName,
      normalized.contactName,
      normalized.designation,
      normalized.workEmail,
      normalized.invoiceEmail,
      JSON.stringify(normalized.invoiceCcEmails),
      normalized.taxNumber,
      normalized.billingAddress,
      normalized.country,
      normalized.websiteUrl,
      normalized.mobileCountryCode,
      normalized.mobileNumber,
      normalized.isActive,
      createdByUserId,
    ]);

    await resellersRepo.insertResellerUser(pool, [
      resellerRow.id,
      normalized.loginEmail,
      passwordHash,
      normalized.displayName,
      true,
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("This email is already used by a reseller login.");
    }
    throw error;
  }

  return getResellerById(resellerRow.id);
}

export async function updateReseller(resellerId: any, payload: any) {
  const existing = await getResellerById(resellerId);
  if (!existing) {
    return null;
  }

  const normalized = assertResellerPayload({
    ...existing,
    ...payload,
  });

  const nextLoginEmail = normalizeEmail(
    payload.loginEmail || existing.users[0]?.email || normalized.workEmail,
  );
  if (nextLoginEmail) {
    assertValidEmailAddress(nextLoginEmail, "Reseller portal login email");
  }

  await assertResellerContactsAvailable(
    {
      workEmail: normalized.workEmail,
      invoiceEmail: normalized.invoiceEmail,
      loginEmail: nextLoginEmail || normalized.loginEmail,
      mobileCountryCode: normalized.mobileCountryCode,
      mobileNumber: normalized.mobileNumber,
    },
    { ignoreResellerId: resellerId },
  );

  const row = await resellersRepo.updateReseller(pool, resellerId, [
    normalized.companyName,
    normalized.contactName,
    normalized.designation,
    normalized.workEmail,
    normalized.invoiceEmail,
    JSON.stringify(normalized.invoiceCcEmails),
    normalized.taxNumber,
    normalized.billingAddress,
    normalized.country,
    normalized.websiteUrl,
    normalized.mobileCountryCode,
    normalized.mobileNumber,
    normalized.isActive,
  ]);

  if (payload.password) {
    validatePasswordPolicy(payload.password);
    const primaryUser = existing.users[0];
    if (primaryUser?.id) {
      await resellersRepo.updateResellerUserPassword(
        pool,
        primaryUser.id,
        await hashPassword(payload.password),
      );
    }
  }

  if (payload.loginEmail || payload.displayName !== undefined || payload.portalIsActive !== undefined) {
    const primaryUser = existing.users[0];
    if (primaryUser?.id) {
      try {
        await resellersRepo.updateResellerUser(pool, primaryUser.id, [
          nextLoginEmail,
          String(payload.displayName ?? primaryUser.displayName).trim(),
          payload.portalIsActive !== undefined ? payload.portalIsActive !== false : primaryUser.isActive,
        ]);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new Error("This email is already used by a reseller login.");
        }
        throw error;
      }
    }
  }

  return getResellerById(row.id);
}

export async function getResellerSummaryForLead(resellerId: any) {
  if (!resellerId) {
    return null;
  }

  const reseller = await getResellerById(resellerId);
  return mapResellerSnapshot(reseller);
}
