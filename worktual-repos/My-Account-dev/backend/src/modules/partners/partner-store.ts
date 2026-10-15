import bcrypt from "bcrypt";

import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { assertValidEmailAddress } from "../../lib/email-validation-runtime.js";
import {
  MOBILE_VALIDATION_RULES,
  validateMobileForDialCode,
} from "../../lib/mobile-validation.js";
import { validatePasswordPolicy } from "../auth/password-policy.js";
import {
  assertExternalAccountContactsAvailable,
  normalizePhone,
} from "../leads/contact-validation.js";
import * as partnersRepo from "../../repositories/raw/partners.repo.js";

const BCRYPT_ROUNDS = 12;

function normalizeEmail(email: any) {
  return String(email || "").trim().toLowerCase();
}

function isUniqueViolation(error: any) {
  return error?.code === "23505";
}

export async function assertPartnerContactsAvailable(
  {
    workEmail,
    loginEmail,
    mobileCountryCode,
    mobileNumber,
  }: {
    workEmail?: string;
    loginEmail?: string;
    mobileCountryCode?: string;
    mobileNumber?: string;
  },
  { ignorePartnerId = null }: { ignorePartnerId?: string | null } = {},
) {
  const emails = [
    ...new Set(
      [normalizeEmail(workEmail), normalizeEmail(loginEmail)].filter(Boolean),
    ),
  ];

  await assertExternalAccountContactsAvailable(
    {
      emails,
      mobileCountryCode,
      mobileNumber,
    },
    { ignorePartnerId },
  );
}

export function mapPartnerRow(row: any, users: any[] = []) {
  if (!row) {
    return null;
  }

  const partner = rowToCamel(row);
  const parsedUsers = Array.isArray(users)
    ? users
    : Array.isArray(partner!.users)
      ? partner!.users
      : [];

  return {
    id: partner!.id,
    companyName: partner!.companyName || "",
    contactName: partner!.contactName || "",
    designation: partner!.designation || "",
    workEmail: partner!.workEmail || "",
    country: partner!.country || "",
    websiteUrl: partner!.websiteUrl || "",
    mobileCountryCode: partner!.mobileCountryCode || "+91",
    mobileNumber: partner!.mobileNumber || "",
    isActive: partner!.isActive !== false,
    createdBy: partner!.createdBy || null,
    users: parsedUsers.map((user: any) => ({
      id: user.id,
      email: user.email || "",
      displayName: user.displayName || user.display_name || "",
      isActive: user.isActive !== false && user.is_active !== false,
    })),
    createdAt: toIso(partner!.createdAt),
    updatedAt: toIso(partner!.updatedAt),
  };
}

export function mapPartnerSnapshot(partner: any) {
  if (!partner) {
    return null;
  }

  return {
    id: partner.id,
    companyName: partner.companyName || "",
    contactName: partner.contactName || "",
    designation: partner.designation || "",
    workEmail: partner.workEmail || "",
    country: partner.country || "",
    mobileCountryCode: partner.mobileCountryCode || "+91",
    mobileNumber: partner.mobileNumber || "",
  };
}

function assertPartnerPayload(payload: any = {}, { requireLogin = false }: any = {}) {
  const companyName = String((payload as any).companyName || "").trim();
  const contactName = String((payload as any).contactName || "").trim();
  const workEmail = normalizeEmail((payload as any).workEmail);
  const country = String((payload as any).country || "").trim();

  if (!companyName) {
    throw new Error("Partner company name is required.");
  }
  if (!contactName) {
    throw new Error("Partner contact name is required.");
  }
  if (!workEmail) {
    throw new Error("Partner work email is required.");
  }
  assertValidEmailAddress(workEmail, "Partner work email");
  if (!country) {
    throw new Error("Partner country is required.");
  }

  const loginEmail = normalizeEmail((payload as any).loginEmail || (payload as any).portalEmail);
  const password = String((payload as any).password || "");
  const displayName = String((payload as any).displayName || (payload as any).contactName || companyName).trim();

  if (requireLogin) {
    if (!loginEmail) {
      throw new Error("Partner portal login email is required.");
    }
    assertValidEmailAddress(loginEmail, "Partner portal login email");
    validatePasswordPolicy(password);
  }

  const mobileCountryCode = String((payload as any).mobileCountryCode || "+91").trim();
  const mobileNumber = String((payload as any).mobileNumber || "").replace(/\D/g, "").trim();
  if (!mobileNumber) {
    throw new Error("Mobile number is required.");
  }
  if (!(MOBILE_VALIDATION_RULES as Record<string, any>)[mobileCountryCode]) {
    throw new Error("Mobile country code is required.");
  }
  const mobileError = validateMobileForDialCode(mobileCountryCode, mobileNumber);
  if (mobileError) {
    throw new Error(mobileError);
  }

  return {
    companyName,
    contactName,
    designation: String((payload as any).designation || "").trim(),
    workEmail,
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

export async function listPartners() {
  const rows = await partnersRepo.selectAllPartners(pool);
  const partners = rows.map((row: any) => mapPartnerRow(row)).filter(Boolean);
  const byContact = new Map<string, any>();

  for (const partner of partners) {
    const contactKey =
      normalizeEmail(partner.workEmail) ||
      normalizeEmail(partner.users?.[0]?.email) ||
      normalizePhone(partner.mobileCountryCode, partner.mobileNumber) ||
      String(partner.id);
    const existing = byContact.get(contactKey);
    if (!existing) {
      byContact.set(contactKey, partner);
      continue;
    }

    const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
    const partnerUpdated = partner.updatedAt ? new Date(partner.updatedAt).getTime() : 0;
    if (partnerUpdated > existingUpdated) {
      byContact.set(contactKey, partner);
    }
  }

  return [...byContact.values()];
}

export async function getPartnerById(partnerId: any) {
  const row = await partnersRepo.selectPartnerById(pool, partnerId);
  if (!row) {
    return null;
  }

  const users = await partnersRepo.selectPartnerUsersByPartnerId(pool, partnerId);
  return mapPartnerRow(row, users.map((user: any) => rowToCamel(user)));
}

export async function createPartner(payload: any, { createdByUserId = null }: any = {}) {
  const normalized = assertPartnerPayload(payload, { requireLogin: true });
  await assertPartnerContactsAvailable(normalized);
  const passwordHash = await hashPassword(normalized.password);

  try {
    const partnerRow = await partnersRepo.insertPartner(pool, [
      normalized.companyName,
      normalized.contactName,
      normalized.designation,
      normalized.workEmail,
      normalized.country,
      normalized.websiteUrl,
      normalized.mobileCountryCode,
      normalized.mobileNumber,
      normalized.isActive,
      createdByUserId,
    ]);

    await partnersRepo.insertPartnerUser(pool, [
      partnerRow.id,
      normalized.loginEmail,
      passwordHash,
      normalized.displayName,
      true,
    ]);

    return getPartnerById(partnerRow.id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A partner with this work email already exists.");
    }
    throw error;
  }
}

export async function updatePartner(partnerId: any, payload: any) {
  const existing = await getPartnerById(partnerId);
  if (!existing) {
    return null;
  }

  const normalized = assertPartnerPayload({
    ...existing,
    ...payload,
  });

  const nextLoginEmail = normalizeEmail(
    payload.loginEmail || existing.users[0]?.email || normalized.workEmail,
  );
  if (nextLoginEmail) {
    assertValidEmailAddress(nextLoginEmail, "Partner portal login email");
  }

  await assertPartnerContactsAvailable(
    {
      workEmail: normalized.workEmail,
      loginEmail: nextLoginEmail || normalized.loginEmail,
      mobileCountryCode: normalized.mobileCountryCode,
      mobileNumber: normalized.mobileNumber,
    },
    { ignorePartnerId: partnerId },
  );

  const row = await partnersRepo.updatePartner(pool, partnerId, [
    normalized.companyName,
    normalized.contactName,
    normalized.designation,
    normalized.workEmail,
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
      await partnersRepo.updatePartnerUserPassword(
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
        await partnersRepo.updatePartnerUser(pool, primaryUser.id, [
          nextLoginEmail,
          String(payload.displayName ?? primaryUser.displayName).trim(),
          payload.portalIsActive !== undefined ? payload.portalIsActive !== false : primaryUser.isActive,
        ]);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new Error("A partner with this work email already exists.");
        }
        throw error;
      }
    }
  }

  return getPartnerById(row.id);
}

export async function getPartnerSummaryForLead(partnerId: any) {
  if (!partnerId) {
    return null;
  }

  const partner = await getPartnerById(partnerId);
  return mapPartnerSnapshot(partner);
}
