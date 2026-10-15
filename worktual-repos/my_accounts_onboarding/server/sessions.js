import crypto from "node:crypto";

import {
  deleteAuthSession,
  deleteAuthSessionsForUser,
  deleteExpiredAuthSessions,
  insertAuthSession,
  selectAuthSession,
} from "./repositories/raw/sessions.repo.js";
import { rowToCamel } from "./db/util.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export { SESSION_TTL_MS };

export async function cleanupExpiredSessions() {
  await deleteExpiredAuthSessions();
}

export async function createSession({ email, role, userId = null, displayName = "" }) {
  await cleanupExpiredSessions();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await insertAuthSession({
    token,
    userId,
    email,
    role,
    displayName,
    expiresAt: expiresAt.toISOString(),
  });

  return { token, email, role, userId, displayName };
}

export async function getSession(token) {
  if (!token) {
    return null;
  }

  await cleanupExpiredSessions();

  const row = await selectAuthSession(token);
  if (!row) {
    return null;
  }

  const session = rowToCamel(row);
  return {
    token: session.token,
    email: session.email,
    role: session.role,
    userId: session.userId,
    displayName: session.displayName || "",
    expiresAt: new Date(session.expiresAt).getTime(),
  };
}

export async function revokeSession(token) {
  if (!token) {
    return;
  }

  await deleteAuthSession(token);
}

export async function invalidateUserSessions(userId) {
  if (!userId) {
    return;
  }

  await deleteAuthSessionsForUser(userId);
}
