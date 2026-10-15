/**
 * Verifies CRM force login invalidates the first session (DB + SSE + HTTP /me).
 * run: cd backend && npx tsx --env-file=../.env scripts/test-force-login-session.ts
 */
import assert from "node:assert/strict";
import type { FastifyRequest } from "fastify";
import { authenticateAccountUser } from "@/service/account/auth-service";
import {
  CrmSessionActiveElsewhereError,
  deleteCrmSessionsForEmail,
  establishCrmLoginSession,
  findActiveCrmSessionByEmail,
  findValidCrmSessionByToken,
  insertCrmAuthSession,
  mintAuthSessionToken,
  sessionExpiresAt,
} from "@/service/account/auth-sessions";
import {
  publishCrmSessionReplaced,
  registerCrmSessionListener,
} from "@/service/account/auth-session-events";
import { resolveSessionUserId } from "@/middlewares/auth";
import { SESSION_COOKIE_NAME } from "@/service/account/session-crypto";
import { accountQuery } from "@/dao/db/account-pool";

const API = process.env.CRM_API_URL?.trim() || "http://127.0.0.1:4000";

async function pickCrmSessionSubject(): Promise<{
  email: string;
  userId: string;
}> {
  const fromEnv = process.env.E2E_EMAIL?.trim();
  if (fromEnv) {
    const auth = await authenticateAccountUser({
      email: fromEnv,
      password: process.env.E2E_PASSWORD?.trim() || "demo",
    });
    if (auth.ok) {
      return { email: fromEnv, userId: auth.user.id };
    }
  }

  const { rows } = await accountQuery<{ email: string; user_id: string }>(
    `SELECT lower(u.work_email) AS email, u.id::text AS user_id
     FROM accounts.setup_users u
     INNER JOIN accounts.users usr ON usr.id = u.id
     INNER JOIN accounts.setup_user_product_access a
       ON a.user_id = u.id AND a.product_id = 'crm'
     WHERE u.status = 'active'
     ORDER BY u.id ASC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row?.email || !row.user_id) {
    throw new Error("No CRM user with accounts.users FK for session test");
  }
  return { email: row.email.trim(), userId: row.user_id.trim() };
}

function mockRequest(cookie: string | undefined): FastifyRequest {
  return {
    cookies: cookie ? { [SESSION_COOKIE_NAME]: cookie } : {},
    crmSessionUserId: undefined,
    crmStaleAuthSession: undefined,
  } as FastifyRequest;
}

async function httpLogin(body: Record<string, unknown>): Promise<{
  status: number;
  json: Record<string, unknown>;
  setCookie: string | null;
}> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, json, setCookie };
}

function cookieTokenFromSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = /worktual_uid=([^;]+)/.exec(setCookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function httpMe(cookieToken: string): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  const res = await fetch(`${API}/api/auth/me`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieToken}` },
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  const { email, userId } = await pickCrmSessionSubject();

  await deleteCrmSessionsForEmail(email);

  const tokenA = mintAuthSessionToken();
  const tokenB = mintAuthSessionToken();
  const expiresAt = sessionExpiresAt(false);

  await insertCrmAuthSession({
    token: tokenA,
    email,
    role: "admin",
    displayName: "Test A",
    userId,
    expiresAt,
  });

  let revoked = 0;
  const unsub = registerCrmSessionListener({
    userId,
    email,
    token: tokenA,
    send: (event) => {
      if (event === "revoked") revoked += 1;
    },
  });

  assert.ok(await findValidCrmSessionByToken(tokenA));

  await deleteCrmSessionsForEmail(email);
  await insertCrmAuthSession({
    token: tokenB,
    email,
    role: "admin",
    displayName: "Test A",
    userId,
    expiresAt,
  });

  publishCrmSessionReplaced({ userId, email, activeToken: tokenB });
  assert.equal(revoked, 1, "SSE listener should receive revoked once");

  const reqStale = mockRequest(tokenA);
  const uidStale = await resolveSessionUserId(reqStale);
  assert.equal(uidStale, null, "token A should not resolve");
  assert.equal(reqStale.crmStaleAuthSession, true, "token A should be stale");

  const reqActive = mockRequest(tokenB);
  const uidActive = await resolveSessionUserId(reqActive);
  assert.equal(uidActive, userId, "token B should resolve");
  assert.equal(reqActive.crmStaleAuthSession, false);

  unsub();
  await deleteCrmSessionsForEmail(email);

  const tokenHttpA = mintAuthSessionToken();
  const tokenHttpB = mintAuthSessionToken();
  await insertCrmAuthSession({
    token: tokenHttpA,
    email,
    role: "admin",
    displayName: "HTTP A",
    userId,
    expiresAt: sessionExpiresAt(false),
  });

  const meA1 = await httpMe(tokenHttpA);
  assert.equal(meA1.status, 200, `/me A before force: ${JSON.stringify(meA1.json)}`);

  await deleteCrmSessionsForEmail(email);
  await insertCrmAuthSession({
    token: tokenHttpB,
    email,
    role: "admin",
    displayName: "HTTP B",
    userId,
    expiresAt: sessionExpiresAt(false),
  });
  publishCrmSessionReplaced({
    userId,
    email,
    activeToken: tokenHttpB,
  });

  const meA2 = await httpMe(tokenHttpA);
  assert.equal(
    meA2.status,
    401,
    `/me A after force should be 401: ${JSON.stringify(meA2.json)}`,
  );
  assert.equal(
    meA2.json.code,
    "session_revoked_elsewhere",
    `/me A should return session_revoked_elsewhere`,
  );

  const meB = await httpMe(tokenHttpB);
  assert.equal(meB.status, 200, `/me B should work: ${JSON.stringify(meB.json)}`);

  await deleteCrmSessionsForEmail(email);

  const first = await establishCrmLoginSession({
    email,
    role: "admin",
    displayName: "Gate A",
    userId,
    expiresAt: sessionExpiresAt(false),
    force: false,
  });
  await assert.rejects(
    () =>
      establishCrmLoginSession({
        email,
        role: "admin",
        displayName: "Gate B",
        userId,
        expiresAt: sessionExpiresAt(false),
        force: false,
      }),
    CrmSessionActiveElsewhereError,
  );
  const forced = await establishCrmLoginSession({
    email,
    role: "admin",
    displayName: "Gate B",
    userId,
    expiresAt: sessionExpiresAt(false),
    force: true,
  });
  assert.equal(forced.replaced, true);
  assert.equal(await findValidCrmSessionByToken(first.token), null);
  assert.ok(await findValidCrmSessionByToken(forced.token));
  assert.equal((await findActiveCrmSessionByEmail(email))?.token, forced.token);

  const meOld = await httpMe(first.token);
  assert.equal(meOld.status, 401);
  assert.equal(meOld.json.code, "session_revoked_elsewhere");

  await deleteCrmSessionsForEmail(email);

  console.log("test-force-login-session.ts ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
