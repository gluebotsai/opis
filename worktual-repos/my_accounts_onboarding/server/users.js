import bcrypt from "bcrypt";

import { rowToCamel, toIso } from "./db/util.js";
import { validatePasswordPolicy } from "./passwordPolicy.js";
import { invalidateUserSessions } from "./sessions.js";
import {
  deleteUser,
  insertUser,
  selectActiveSalesAdminUser,
  selectActiveUserByEmail,
  selectAllUsers,
  selectSalesUsers,
  selectUserById,
  selectUserIdByEmail,
  updateAdminProfile as updateAdminProfileRow,
  updateUserByAdmin as updateUserByAdminRow,
  updateUserPassword,
  updateUserProfile as updateUserProfileRow,
} from "./repositories/raw/users.repo.js";

export const USER_ROLES = {
  SALES: "sales",
  FINANCE: "finance",
  ADMIN: "admin",
  SALES_ADMIN: "sales_admin",
};

export const ADMIN_MANAGED_ROLES = [
  USER_ROLES.SALES,
  USER_ROLES.FINANCE,
  USER_ROLES.SALES_ADMIN,
];

const BCRYPT_ROUNDS = 10;

const ROLE_ALIASES = {
  "sales admin": USER_ROLES.SALES_ADMIN,
  salesadmin: USER_ROLES.SALES_ADMIN,
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  const user = rowToCamel(row);
  return {
    ...user,
    createdAt: toIso(user.createdAt),
    updatedAt: toIso(user.updatedAt),
  };
}

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  return ROLE_ALIASES[raw] || raw.replace(/\s+/g, "_");
}

function normalizeUserContactFields(payload = {}) {
  const country = String(payload.country || "").trim();
  const mobileCountryCode = String(
    payload.mobileCountryCode || payload.mobile_country_code || "+91",
  ).trim();
  const mobileNumber = String(payload.mobileNumber || payload.mobile_number || "")
    .replace(/\D/g, "")
    .trim();
  const legacyPhone = String(payload.phone || "").trim();
  const phone = mobileNumber ? `${mobileCountryCode} ${mobileNumber}`.trim() : legacyPhone;

  return {
    country,
    mobileCountryCode: mobileCountryCode || "+91",
    mobileNumber,
    phone,
  };
}

export function formatUserPhone(user = {}) {
  if (user.mobileNumber) {
    return `${user.mobileCountryCode || ""} ${user.mobileNumber}`.trim();
  }

  return user.phone || "";
}

function assertRole(role) {
  const normalizedRole = normalizeRole(role);
  if (!Object.values(USER_ROLES).includes(normalizedRole)) {
    throw new Error("Role must be sales, finance, admin, or sales_admin.");
  }
  return normalizedRole;
}

function assertAdminManagedRole(role) {
  const normalizedRole = normalizeRole(role);
  if (!ADMIN_MANAGED_ROLES.includes(normalizedRole)) {
    throw new Error("Role must be sales, finance, or sales_admin.");
  }
  return normalizedRole;
}

async function assertEmailAvailable(email, ignoreUserId = null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const existing = await selectUserIdByEmail(normalizedEmail, ignoreUserId);

  if (existing) {
    throw new Error("A user with this email already exists.");
  }
}

export function isPasswordHashed(password) {
  return (
    typeof password === "string" &&
    (password.startsWith("$2a$") || password.startsWith("$2b$") || password.startsWith("$2y$"))
  );
}

export async function hashPassword(plainPassword) {
  return bcrypt.hash(String(plainPassword), BCRYPT_ROUNDS);
}

export function sanitizeUser(user) {
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
  const rows = await selectSalesUsers(USER_ROLES.SALES);
  return rows.map(mapUserRow).map(sanitizeUser);
}

export async function getUserById(userId) {
  const row = await selectUserById(userId);
  return mapUserRow(row);
}

export function isUserActive(user) {
  return Boolean(user && user.isActive !== false);
}

export function isSalesFacingUser(user) {
  return Boolean(
    user && (user.role === USER_ROLES.SALES || user.role === USER_ROLES.SALES_ADMIN),
  );
}

export async function getActiveSalesAdminUser() {
  const row = await selectActiveSalesAdminUser(USER_ROLES.SALES_ADMIN);
  return sanitizeUser(mapUserRow(row));
}

export async function getActiveUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const row = await selectActiveUserByEmail(normalizedEmail);
  return mapUserRow(row);
}

export async function verifyUserPassword(user, password) {
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

export async function rehashUserPassword(userId, plainPassword) {
  const hashed = await hashPassword(plainPassword);
  await updateUserPassword(userId, hashed);
}

export async function createUser(payload, actorEmail) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const role = assertAdminManagedRole(payload.role);
  const displayName = String(payload.displayName || "").trim();
  const department = String(payload.department || "").trim();
  const contact = normalizeUserContactFields(payload);
  await assertEmailAvailable(email);

  if (!password) {
    throw new Error("Password is required.");
  }

  validatePasswordPolicy(password);

  const hashedPassword = await hashPassword(password);

  const row = await insertUser([
    email,
    hashedPassword,
    role,
    displayName || (role === USER_ROLES.FINANCE ? "Finance User" : role === USER_ROLES.SALES_ADMIN ? "Sales Admin" : "Sales User"),
    contact.phone,
    contact.country || null,
    contact.mobileCountryCode || null,
    contact.mobileNumber || null,
    department || (role === USER_ROLES.FINANCE ? "Finance" : role === USER_ROLES.SALES_ADMIN ? "Sales Management" : "Sales"),
    actorEmail,
  ]);

  return sanitizeUser(mapUserRow(row));
}

export async function updateUserByAdmin(userId, payload, actorEmail) {
  const current = await getUserById(userId);
  if (!current) {
    throw new Error("User not found.");
  }

  const nextEmail = payload.email !== undefined ? normalizeEmail(payload.email) : current.email;

  const nextRole =
    payload.role !== undefined ? assertAdminManagedRole(payload.role) : null;

  await assertEmailAvailable(nextEmail, userId);

  if (payload.password !== undefined && !String(payload.password || "").trim()) {
    throw new Error("Password cannot be empty.");
  }

  const passwordChanging = Boolean(payload.password);
  const deactivating = payload.isActive === false && current.isActive !== false;

  if (passwordChanging) {
    validatePasswordPolicy(String(payload.password));
  }

  const nextPassword = passwordChanging ? await hashPassword(String(payload.password)) : null;
  const contact =
    payload.country !== undefined ||
    payload.mobileCountryCode !== undefined ||
    payload.mobileNumber !== undefined ||
    payload.phone !== undefined
      ? normalizeUserContactFields({
          country: payload.country !== undefined ? payload.country : current.country,
          mobileCountryCode:
            payload.mobileCountryCode !== undefined
              ? payload.mobileCountryCode
              : current.mobileCountryCode,
          mobileNumber:
            payload.mobileNumber !== undefined ? payload.mobileNumber : current.mobileNumber,
          phone: payload.phone !== undefined ? payload.phone : current.phone,
        })
      : null;

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

export async function deleteUserByAdmin(userId) {
  const current = await getUserById(userId);
  if (!current) {
    throw new Error("User not found.");
  }

  if (!ADMIN_MANAGED_ROLES.includes(current.role)) {
    throw new Error("Only sales, finance, and sales admin credentials can be deleted.");
  }

  await invalidateUserSessions(userId);
  await deleteUser(userId);

  return { id: userId };
}

export async function updateUserProfile(userId, payload) {
  const current = await getUserById(userId);
  if (!current) {
    throw new Error("User not found.");
  }

  if (current.isActive === false) {
    throw new Error("This account is inactive.");
  }

  const canChangeEmail =
    current.role !== USER_ROLES.SALES && current.role !== USER_ROLES.FINANCE;
  const nextEmail =
    canChangeEmail && payload.email !== undefined
      ? normalizeEmail(payload.email)
      : current.email;

  if (canChangeEmail && payload.email !== undefined) {
    await assertEmailAvailable(nextEmail, userId);
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
    current.email,
  ]);

  if (passwordChanging) {
    await invalidateUserSessions(userId);
  }

  return sanitizeUser(mapUserRow(row));
}

export async function updateAdminProfile(userId, payload) {
  const current = await getUserById(userId);
  if (!current) {
    throw new Error("User not found.");
  }

  if (current.role !== USER_ROLES.ADMIN) {
    throw new Error("Only admin accounts can use this profile update.");
  }

  if (current.isActive === false) {
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
    current.email,
  ]);

  if (passwordChanging) {
    await invalidateUserSessions(userId);
  }

  return sanitizeUser(mapUserRow(row));
}
