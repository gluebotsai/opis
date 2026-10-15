import bcrypt from "bcrypt";

import { rowToCamel, toIso } from "../../db/util.js";
import { assertValidEmailAddress } from "../../lib/email-validation-runtime.js";
import { validatePasswordPolicy } from "../auth/password-policy.js";
import { assertStaffContactAvailable } from "../leads/contact-validation.js";
import { validateMobileForDialCode } from "../../lib/mobile-validation.js";
import { invalidateUserSessions } from "../auth/sessions.js";
import {
  deleteUser,
  insertUser,
  selectActiveSalesAdminUser,
  selectActiveUserByEmail,
  selectActiveUsersByRole,
  selectAllUsers,
  selectUserById,
  selectUserIdByEmail,
  updateAdminProfile as updateAdminProfileRow,
  updateUserByAdmin as updateUserByAdminRow,
  updateUserPassword,
  updateUserProfile as updateUserProfileRow,
} from "../../repositories/raw/users.repo.js";

export const USER_ROLES = {
  SALES: "sales",
  FINANCE: "finance",
  ADMIN: "admin",
  SALES_ADMIN: "sales_admin",
  NUMBER_MANAGEMENT: "number_management",
};

export const ADMIN_MANAGED_ROLES = [
  USER_ROLES.SALES,
  USER_ROLES.FINANCE,
  USER_ROLES.SALES_ADMIN,
  USER_ROLES.NUMBER_MANAGEMENT,
];

const BCRYPT_ROUNDS = 10;

const ROLE_ALIASES = {
  "sales admin": USER_ROLES.SALES_ADMIN,
  salesadmin: USER_ROLES.SALES_ADMIN,
  "number management": USER_ROLES.NUMBER_MANAGEMENT,
  numbermanagement: USER_ROLES.NUMBER_MANAGEMENT,
};

function normalizeEmail(email: any) {
  return String(email || "").trim().toLowerCase();
}

function mapUserRow(row: any) {
  if (!row) {
    return null;
  }

  const user = rowToCamel(row);
  return {
    ...user,
    createdAt: toIso((user as any).createdAt),
    updatedAt: toIso((user as any).updatedAt),
  };
}

function normalizeRole(role: any) {
  const raw = String(role || "").trim().toLowerCase();
  return (ROLE_ALIASES as any)[raw] || raw.replace(/\s+/g, "_");
}

function normalizeUserContactFields(payload = {}) {
  const country = String((payload as any).country || "").trim();
  const mobileCountryCode = String(
    (payload as any).mobileCountryCode || (payload as any).mobile_country_code || "+91",
  ).trim();
  const mobileNumber = String((payload as any).mobileNumber || (payload as any).mobile_number || "")
    .replace(/\D/g, "")
    .trim();
  const legacyPhone = String((payload as any).phone || "").trim();
  const phone = mobileNumber ? `${mobileCountryCode} ${mobileNumber}`.trim() : legacyPhone;

  return {
    country,
    mobileCountryCode: mobileCountryCode || "+91",
    mobileNumber,
    phone,
  };
}

function assertUserMobileValid(contact: any) {
  if (!contact?.mobileNumber) {
    return;
  }
  const error = validateMobileForDialCode(contact.mobileCountryCode, contact.mobileNumber);
  if (error) {
    throw new Error(error);
  }
}

export function formatUserPhone(user = {}) {
  if ((user as any).mobileNumber) {
    return `${(user as any).mobileCountryCode || ""} ${(user as any).mobileNumber}`.trim();
  }

  return (user as any).phone || "";
}

function assertRole(role: any) {
  const normalizedRole = normalizeRole(role);
  if (!Object.values(USER_ROLES).includes(normalizedRole)) {
    throw new Error("Role must be sales, finance, admin, sales_admin, or number_management.");
  }
  return normalizedRole;
}

function assertAdminManagedRole(role: any) {
  const normalizedRole = normalizeRole(role);
  if (!ADMIN_MANAGED_ROLES.includes(normalizedRole)) {
    throw new Error("Role must be sales, finance, sales_admin, or number_management.");
  }
  return normalizedRole;
}

async function assertEmailAvailable(email: any, ignoreUserId = null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }
  assertValidEmailAddress(normalizedEmail, "Email");

  const existing = await selectUserIdByEmail(normalizedEmail, ignoreUserId);

  if (existing) {
    throw new Error("A user with this email already exists.");
  }
}

export function isPasswordHashed(password: any) {
  return (
    typeof password === "string" &&
    (password.startsWith("$2a$") || password.startsWith("$2b$") || password.startsWith("$2y$"))
  );
}

export async function hashPassword(plainPassword: any) {
  return bcrypt.hash(String(plainPassword), BCRYPT_ROUNDS);
}

export function sanitizeUser(user: any) {
  if (!user) {
    return null;
  }

  const { password, ...safeUser } = user;
  return safeUser;
}

export async function listUsers() {
  const rows = await selectAllUsers();
  return rows.map(mapUserRow).map(sanitizeUser);
}

export async function listSalesUsers() {
  const rows = await selectActiveUsersByRole(USER_ROLES.SALES);
  return rows.map(mapUserRow).map(sanitizeUser);
}

export async function listActiveFinanceEmails() {
  const rows = await selectActiveUsersByRole(USER_ROLES.FINANCE);
  return rows
    .map(mapUserRow)
    .map((user) => String((user as any)?.email || "").trim().toLowerCase())
    .filter(Boolean);
}

export async function getUserById(userId: any) {
  const row = await selectUserById(userId);
  return mapUserRow(row);
}

async function assertUserHasNoOwnedLeads(userId: any, actionLabel: any) {
  const { countLeadsOwnedByUser } = await import("../leads/lead-store.js");
  const ownedCount = await countLeadsOwnedByUser(userId);
  if (ownedCount > 0) {
    const error = new Error(
      `Reassign ${ownedCount} customer${ownedCount === 1 ? "" : "s"} before ${actionLabel} this account.`,
    );
    (error as any).status = 409;
    throw error;
  }
}

export function isUserActive(user: any) {
  return Boolean(user && user.isActive !== false);
}

export function isSalesFacingUser(user: any) {
  return Boolean(
    user && (user.role === USER_ROLES.SALES || user.role === USER_ROLES.SALES_ADMIN),
  );
}

export async function getActiveSalesAdminUser() {
  const row = await selectActiveSalesAdminUser(USER_ROLES.SALES_ADMIN);
  return sanitizeUser(mapUserRow(row));
}

export async function getActiveUserByEmail(email: any) {
  const normalizedEmail = normalizeEmail(email);
  const row = await selectActiveUserByEmail(normalizedEmail);
  return mapUserRow(row);
}

export async function verifyUserPassword(user: any, password: any) {
  if (!user || password === undefined || password === null) {
    return false;
  }

  const stored = user.password;
  if (!stored) {
    return false;
  }

  if (isPasswordHashed(stored)) {
    return bcrypt.compare(String(password), stored);
  }

  return stored === String(password);
}

export async function rehashUserPassword(userId: any, plainPassword: any) {
  const hashed = await hashPassword(plainPassword);
  await updateUserPassword(userId, hashed);
}

export async function createUser(payload: any, actorEmail: any) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const role = assertAdminManagedRole(payload.role);
  const displayName = String(payload.displayName || "").trim();
  const department = String(payload.department || "").trim();
  const contact = normalizeUserContactFields(payload);
  assertUserMobileValid(contact);
  await assertEmailAvailable(email);
  await assertStaffContactAvailable(
    {
      email,
      mobileCountryCode: contact.mobileCountryCode,
      mobileNumber: contact.mobileNumber,
      phone: contact.phone,
    },
    { ignoreUserId: null },
  );

  if (!password) {
    throw new Error("Password is required.");
  }

  validatePasswordPolicy(password);

  const hashedPassword = await hashPassword(password);

  const row = await insertUser([
    email,
    hashedPassword,
    role,
    displayName ||
      (role === USER_ROLES.FINANCE
        ? "Finance User"
        : role === USER_ROLES.SALES_ADMIN
          ? "Sales Admin"
          : role === USER_ROLES.NUMBER_MANAGEMENT
            ? "Number Management"
            : "Sales User"),
    contact.phone,
    contact.country || null,
    contact.mobileCountryCode || null,
    contact.mobileNumber || null,
    department ||
      (role === USER_ROLES.FINANCE
        ? "Finance"
        : role === USER_ROLES.SALES_ADMIN
          ? "Sales Management"
          : role === USER_ROLES.NUMBER_MANAGEMENT
            ? "Number Management"
            : "Sales"),
    actorEmail,
  ]);

  return sanitizeUser(mapUserRow(row));
}

export async function updateUserByAdmin(userId: any, payload: any, actorEmail: any) {
  const current = await getUserById(userId);
  if (!current) {
    throw new Error("User not found.");
  }

  const nextEmail = payload.email !== undefined ? normalizeEmail(payload.email) : (current as any).email;

  const nextRole =
    payload.role !== undefined ? assertAdminManagedRole(payload.role) : null;

  await assertEmailAvailable(nextEmail, userId);

  const contact =
    payload.country !== undefined ||
    payload.mobileCountryCode !== undefined ||
    payload.mobileNumber !== undefined ||
    payload.phone !== undefined
      ? normalizeUserContactFields({
          country: payload.country !== undefined ? payload.country : (current as any).country,
          mobileCountryCode:
            payload.mobileCountryCode !== undefined
              ? payload.mobileCountryCode
              : (current as any).mobileCountryCode,
          mobileNumber:
            payload.mobileNumber !== undefined ? payload.mobileNumber : (current as any).mobileNumber,
          phone: payload.phone !== undefined ? payload.phone : (current as any).phone,
        })
      : null;

  if (contact) {
    assertUserMobileValid(contact);
  }

  await assertStaffContactAvailable(
    {
      email: nextEmail,
      mobileCountryCode: contact?.mobileCountryCode ?? (current as any).mobileCountryCode,
      mobileNumber: contact?.mobileNumber ?? (current as any).mobileNumber,
      phone: contact?.phone ?? (current as any).phone,
    },
    { ignoreUserId: userId },
  );

  if (payload.password !== undefined && !String(payload.password || "").trim()) {
    throw new Error("Password cannot be empty.");
  }

  const passwordChanging = Boolean(payload.password);
  const deactivating = payload.isActive === false && (current as any).isActive !== false;

  if (deactivating && ((current as any).role === USER_ROLES.SALES || (current as any).role === USER_ROLES.SALES_ADMIN)) {
    await assertUserHasNoOwnedLeads(userId, "deactivating");
  }

  if (passwordChanging) {
    validatePasswordPolicy(String(payload.password));
  }

  const nextPassword = passwordChanging ? await hashPassword(String(payload.password)) : null;

  const row = await updateUserByAdminRow([
    userId,
    nextEmail,
    nextRole,
    payload.displayName !== undefined ? String(payload.displayName).trim() : null,
    contact ? contact.phone : payload.phone !== undefined ? String(payload.phone).trim() : null,
    contact ? contact.country || null : null,
    contact ? contact.mobileCountryCode || null : null,
    contact ? contact.mobileNumber || null : null,
    payload.department !== undefined ? String(payload.department).trim() : null,
    payload.isActive !== undefined ? Boolean(payload.isActive) : null,
    nextPassword,
    actorEmail,
  ]);

  if (passwordChanging || deactivating) {
    await invalidateUserSessions(userId);
  }

  return sanitizeUser(mapUserRow(row));
}

export async function deleteUserByAdmin(userId: any) {
  const current = await getUserById(userId);
  if (!current) {
    throw new Error("User not found.");
  }

  if (!ADMIN_MANAGED_ROLES.includes((current as any).role)) {
    throw new Error("Only sales, finance, sales admin, and number management credentials can be deleted.");
  }

  if ((current as any).role === USER_ROLES.SALES || (current as any).role === USER_ROLES.SALES_ADMIN) {
    await assertUserHasNoOwnedLeads(userId, "deleting");
  }

  await invalidateUserSessions(userId);
  await deleteUser(userId);

  return { id: userId };
}

export async function forceLogoutUserByAdmin(userId: any) {
  const current = await getUserById(userId);
  if (!current) {
    const error = new Error("User not found.");
    (error as any).status = 404;
    throw error;
  }

  if ((current as any).role === USER_ROLES.ADMIN) {
    throw new Error("Force logout is not available for admin accounts.");
  }

  await invalidateUserSessions(userId);
  return { ok: true, userId: String(userId) };
}

export async function updateUserProfile(userId: any, payload: any) {
  const current = await getUserById(userId);
  if (!current) {
    throw new Error("User not found.");
  }

  if ((current as any).isActive === false) {
    throw new Error("This account is inactive.");
  }

  const canChangeEmail =
    (current as any).role !== USER_ROLES.SALES && (current as any).role !== USER_ROLES.FINANCE;
  const nextEmail =
    canChangeEmail && payload.email !== undefined
      ? normalizeEmail(payload.email)
      : (current as any).email;

  if (canChangeEmail && payload.email !== undefined) {
    await assertEmailAvailable(nextEmail, userId);
  }

  const nextPhone =
    payload.phone !== undefined ? String(payload.phone).trim() : String((current as any).phone || "").trim();
  const emailChanged =
    canChangeEmail && payload.email !== undefined && nextEmail !== normalizeEmail((current as any).email);
  const phoneChanged = payload.phone !== undefined && nextPhone !== String((current as any).phone || "").trim();

  if (emailChanged || phoneChanged) {
    await assertStaffContactAvailable(
      {
        email: nextEmail,
        mobileCountryCode: (current as any).mobileCountryCode,
        mobileNumber: (current as any).mobileNumber,
        phone: nextPhone,
      },
      { ignoreUserId: userId },
    );
  }

  const passwordChanging = Boolean(payload.password);

  if (passwordChanging) {
    const currentPassword = String(payload.currentPassword || "");
    if (!(await verifyUserPassword(current, currentPassword))) {
      throw new Error("Current password is incorrect.");
    }
    if (!String(payload.password).trim()) {
      throw new Error("New password cannot be empty.");
    }
    validatePasswordPolicy(String(payload.password));
  }

  const nextPassword = passwordChanging ? await hashPassword(String(payload.password)) : null;

  const row = await updateUserProfileRow([
    userId,
    nextEmail,
    payload.displayName !== undefined ? String(payload.displayName).trim() : null,
    payload.phone !== undefined ? String(payload.phone).trim() : null,
    payload.department !== undefined ? String(payload.department).trim() : null,
    nextPassword,
    (current as any).email,
  ]);

  if (passwordChanging) {
    await invalidateUserSessions(userId);
  }

  return sanitizeUser(mapUserRow(row));
}

export async function updateAdminProfile(userId: any, payload: any) {
  const current = await getUserById(userId);
  if (!current) {
    throw new Error("User not found.");
  }

  if ((current as any).role !== USER_ROLES.ADMIN) {
    throw new Error("Only admin accounts can use this profile update.");
  }

  if ((current as any).isActive === false) {
    throw new Error("This account is inactive.");
  }

  const passwordChanging = Boolean(payload.password);

  if (passwordChanging) {
    const currentPassword = String(payload.currentPassword || "");
    if (!(await verifyUserPassword(current, currentPassword))) {
      throw new Error("Current password is incorrect.");
    }
    if (!String(payload.password).trim()) {
      throw new Error("New password cannot be empty.");
    }
    validatePasswordPolicy(String(payload.password));
  }

  const nextPassword = passwordChanging ? await hashPassword(String(payload.password)) : null;

  const row = await updateAdminProfileRow([
    userId,
    payload.displayName !== undefined ? String(payload.displayName).trim() : null,
    nextPassword,
    (current as any).email,
  ]);

  if (passwordChanging) {
    await invalidateUserSessions(userId);
  }

  return sanitizeUser(mapUserRow(row));
}
