import crypto from "node:crypto";

import {
  deleteAuthSession,
  deleteAuthSessionsForUser,
  deleteExpiredAuthSessions,
  hasActiveAuthSessionForUser,
  insertAuthSession,
  selectAuthSession,
} from "../../repositories/raw/sessions.repo.js";
import { rowToCamel } from "../../db/util.js";
import { AUTH_SESSION_TTL_MS } from "./session-ttl.js";

const SESSION_TTL_MS = AUTH_SESSION_TTL_MS;

export { SESSION_TTL_MS };

export async function cleanupExpiredSessions() {
  await deleteExpiredAuthSessions();
}

export async function hasActiveUserSession(userId: any) {
  if (!userId) {
    return false;
  }
  await cleanupExpiredSessions();
  return hasActiveAuthSessionForUser(userId);
}

export async function createSession({ email, role, userId = null, displayName = "" }: any) {
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

export async function getSession(token: any) {
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
    token: (session as any).token,
    email: (session as any).email,
    role: (session as any).role,
    userId: (session as any).userId,
    displayName: (session as any).displayName || "",
    expiresAt: new Date((session as any).expiresAt).getTime(),
  };
}

export async function revokeSession(token: any) {
  if (!token) {
    return;
  }

  await deleteAuthSession(token);
}

export async function invalidateUserSessions(userId: any) {
  if (!userId) {
    return;
  }

  await deleteAuthSessionsForUser(userId);
}
