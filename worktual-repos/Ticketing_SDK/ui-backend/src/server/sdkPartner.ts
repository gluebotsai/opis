/**
 * Partner SDK sessions and usage.
 * Org API key mints a staff JWT for an existing Ticketing actor.
 * AI turns on those sessions are metered for partner billing.
 */
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthUser } from "../types";
import {
  getEffectiveIdentity,
  listAssignableAgents,
  resolveStaffServiceActor,
} from "./accountsSync";
import { ensureColumn, query } from "./db";
import { authenticateOrgApiKey, extractApiKeyFromRequest } from "./orgApiKeys";
import {
  sdkConfirmRequired,
  sdkErrorMessage,
  sdkGrantDecision,
  sdkLocaleFromParts,
  sdkPartnerCall,
  sdkQuotaDecision,
  sdkQuotaLimits,
  sdkQuotaTierMap,
  sdkRoleDenied,
  sdkSkillBreakdown,
  sdkUsageContext,
  sdkUsageMeter,
  sdkUsageSkill,
} from "./sdkTasks";

const JWT_SECRET = process.env.JWT_SECRET || "worktual-dev-secret-change-me";
const SESSION_TTL_SEC = 8 * 60 * 60;

const USAGE_FEATURES = new Set([
  "auth.session",
  "auth.session_end",
  "ai.turn",
  "ai.stream",
  "ai.confirm",
  "ai.reject",
  "ai.tasks.summarize",
  "ai.tasks.classify",
  "ai.tasks.draftReply",
  "ai.tasks.similar",
  "ai.tasks.recommendKb",
  "ai.tasks.deflect",
  "ai.proposals.list",
  "ai.proposals.confirm",
  "ai.proposals.reject",
  "ai.tasks.askMetrics",
  "ai.tasks.askWhy",
  "ai.tasks.listTickets",
  "ai.tasks.createTicket",
  "ai.tasks.assign",
  "ai.tasks.resolveSuggest",
  "ai.tasks.qualityCheck",
  "ai.tasks.slaAdvise",
  "ai.tasks.workload",
  "quota.exceeded",
]);

const inflightTurns = new Map<string, number>();

export type SdkActorInput = {
  id?: string;
  email?: string;
};

type SessionActor = {
  id: string;
  name: string;
  email: string;
  role: AuthUser["role"];
  initials: string;
  organizationId: string;
};

let schemaPromise: Promise<void> | null = null;

export function ensureSdkPartnerSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureColumn("ticketing", "user_sessions", "client_kind", "TEXT");
      await ensureColumn("ticketing", "user_sessions", "partner_key_id", "BIGINT");
      await query(`
        CREATE TABLE IF NOT EXISTS ticketing.sdk_usage_events (
          id               BIGSERIAL PRIMARY KEY,
          organization_id  BIGINT NOT NULL,
          partner_key_id   BIGINT,
          actor_id         BIGINT,
          session_id       BIGINT,
          surface          TEXT NOT NULL DEFAULT 'headless',
          component        TEXT,
          feature          TEXT NOT NULL,
          locale           TEXT,
          skill            TEXT,
          executor         TEXT,
          agent_turns      INTEGER NOT NULL DEFAULT 0,
          confirm_required BOOLEAN NOT NULL DEFAULT FALSE,
          ok               BOOLEAN NOT NULL DEFAULT TRUE,
          status_code      INTEGER,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await ensureColumn("ticketing", "sdk_usage_events", "component", "TEXT");
      await ensureColumn("ticketing", "sdk_usage_events", "agent_turns", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("ticketing", "sdk_usage_events", "confirm_required", "BOOLEAN NOT NULL DEFAULT FALSE");
      await query(`
        CREATE TABLE IF NOT EXISTS ticketing.sdk_partner_quota (
          organization_id  BIGINT PRIMARY KEY,
          rate_per_minute  INTEGER NOT NULL DEFAULT 0,
          concurrent_turns INTEGER NOT NULL DEFAULT 0,
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_sdk_usage_org_created
        ON ticketing.sdk_usage_events (organization_id, created_at DESC)
      `);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

export function mergeReplyLocale(
  sessionMemory: unknown,
  localeRaw: unknown
): { sessionMemory: Record<string, unknown>; locale?: string } {
  const base =
    sessionMemory && typeof sessionMemory === "object" && !Array.isArray(sessionMemory)
      ? { ...(sessionMemory as Record<string, unknown>) }
      : {};
  const locale = normalizeSdkLocale(localeRaw);
  if (!locale) return { sessionMemory: base };
  base.reply_locale = locale;
  return { sessionMemory: base, locale };
}

export function normalizeSdkLocale(raw: unknown): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) {
    const err = new Error("locale must be a BCP 47 tag such as en or es-MX") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 400;
    err.code = "validation_error";
    throw err;
  }
  return value;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function httpError(status: number, code: string, error: string): Error {
  const err = new Error(error) as Error & { status?: number; code?: string };
  err.status = status;
  err.code = code;
  return err;
}

function sdkFail(status: number, code: string, locale: unknown): Error {
  return httpError(status, code, sdkErrorMessage(code, locale));
}

/** Locale for an SDK error: body, query, then Accept-Language. */
export function sdkRequestLocale(req: Request): string {
  return sdkLocaleFromParts({
    body: req.body,
    query: req.query,
    acceptLanguage: req.headers["accept-language"],
  });
}

function clientMeta(req: Request) {
  const ua = String(req.headers["user-agent"] || "").trim();
  const ip =
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      ?.trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";
  return {
    userAgent: ua.slice(0, 400) || "partner-sdk",
    ipAddress: ip,
  };
}

async function resolveSessionActor(
  organizationId: string,
  actor: SdkActorInput,
  locale: unknown
): Promise<SessionActor> {
  const wantedId = String(actor.id || "").trim();
  const wantedEmail = String(actor.email || "").trim().toLowerCase();
  if (!wantedId && !wantedEmail) {
    throw httpError(400, "validation_error", "actor.id or actor.email is required");
  }

  const roster = await listAssignableAgents(organizationId);
  const match = roster.find((row) => {
    if (wantedId && (row.id === wantedId || row.setupUserId === wantedId)) return true;
    if (wantedEmail && row.email.trim().toLowerCase() === wantedEmail) return true;
    return false;
  });

  const identity = match
    ? await getEffectiveIdentity(match.id, organizationId)
    : wantedId
      ? await resolveStaffServiceActor(wantedId, organizationId)
      : null;

  const resolved = identity
    ? identity
    : match
      ? await resolveStaffServiceActor(match.id, organizationId)
      : null;

  if (!resolved) {
    throw httpError(404, "actor_not_found", "No active Ticketing user matches this actor");
  }
  if (resolved.role === "customer") {
    throw sdkFail(403, "forbidden", locale);
  }

  const role = resolved.role as AuthUser["role"];
  return {
    id: resolved.id,
    name: resolved.name,
    email: resolved.email,
    role,
    initials: resolved.initials || initialsFromName(resolved.name),
    organizationId: resolved.organizationId,
  };
}

function signSdkToken(actor: SessionActor, sessionId: string): { token: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000).toISOString();
  const token = jwt.sign(
    {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      initials: actor.initials,
      role: actor.role,
      organizationId: actor.organizationId,
      sessionId,
    },
    JWT_SECRET,
    { expiresIn: SESSION_TTL_SEC }
  );
  return { token, expiresAt };
}

export async function createSdkSession(
  req: Request,
  input: { tenantId?: string; actor: SdkActorInput; locale?: string | null }
) {
  await ensureSdkPartnerSchema();
  const rawKey = extractApiKeyFromRequest({
    headers: req.headers as Record<string, unknown>,
  });
  const locale = input.locale || null;
  if (!rawKey || rawKey.startsWith("eyJ")) {
    throw sdkFail(401, "auth_required", locale);
  }
  const apiKey = await authenticateOrgApiKey(rawKey);
  if (!apiKey) {
    throw sdkFail(401, "auth_required", locale);
  }
  await assertSdkProductGrant(apiKey.organizationId, locale);

  const tenantId = String(input.tenantId || "").trim();
  if (tenantId && tenantId !== apiKey.organizationId) {
    throw httpError(403, "tenant_mismatch", "tenantId does not match this API key");
  }

  const actor = await resolveSessionActor(apiKey.organizationId, input.actor, locale);
  const meta = clientMeta(req);

  const inserted = await query<{ id: string }>(
    `INSERT INTO user_sessions (
       organization_id, user_id, device_label, browser, os, location,
       user_agent, ip_address, is_current, last_active_at, client_kind
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,NOW(),'sdk')
     RETURNING id::text AS id`,
    [
      actor.organizationId,
      actor.id,
      "Partner SDK",
      "SDK",
      "Server",
      "Partner",
      meta.userAgent,
      meta.ipAddress,
    ]
  );
  const sessionId = String(inserted.rows[0]?.id || "");
  if (!sessionId) {
    throw sdkFail(503, "temporarily_unavailable", locale);
  }
  if (/^\d+$/.test(String(apiKey.keyId || ""))) {
    await query(
      `UPDATE user_sessions SET partner_key_id = $2::bigint WHERE id = $1::bigint`,
      [sessionId, apiKey.keyId]
    );
  }

  await query(
    `INSERT INTO user_login_events (
       organization_id, user_id, device_label, location, ip_address
     ) VALUES ($1,$2,$3,$4,$5)`,
    [actor.organizationId, actor.id, "Partner SDK", "Partner", meta.ipAddress]
  );

  await recordUsage({
    organizationId: actor.organizationId,
    partnerKeyId: apiKey.keyId,
    actorId: actor.id,
    sessionId,
    feature: "auth.session",
    locale,
    ok: true,
    statusCode: 201,
  });

  const signed = signSdkToken(actor, sessionId);
  return {
    sessionToken: signed.token,
    sessionId,
    expiresAt: signed.expiresAt,
    locale: locale || "en",
    organizationId: actor.organizationId,
    actor: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      role: actor.role,
    },
  };
}

async function loadSdkSession(sessionId: string, userId: string) {
  const { rows } = await query<{
    id: string;
    client_kind: string | null;
    organization_id: string;
    partner_key_id: string | null;
  }>(
    `SELECT id::text AS id, client_kind, organization_id::text AS organization_id,
            partner_key_id::text AS partner_key_id
     FROM user_sessions
     WHERE id = $1::bigint AND user_id = $2::bigint AND revoked_at IS NULL`,
    [sessionId, userId]
  );
  return rows[0] || null;
}

export async function endSdkSession(user: AuthUser, locale?: unknown) {
  await ensureSdkPartnerSchema();
  const sessionId = String(user.sessionId || "").trim();
  if (!sessionId) {
    throw sdkFail(401, "session_expired", locale);
  }
  const row = await loadSdkSession(sessionId, user.id);
  if (!row || row.client_kind !== "sdk") {
    throw sdkFail(401, "session_expired", locale);
  }
  await query(
    `UPDATE user_sessions SET revoked_at = NOW(), is_current = FALSE WHERE id = $1::bigint`,
    [sessionId]
  );
  await recordUsage({
    organizationId: user.organizationId,
    actorId: user.id,
    sessionId,
    feature: "auth.session_end",
    ok: true,
    statusCode: 200,
  });
  return { ok: true as const };
}

export async function refreshSdkSession(user: AuthUser, locale?: unknown) {
  await ensureSdkPartnerSchema();
  const sessionId = String(user.sessionId || "").trim();
  if (!sessionId) {
    throw sdkFail(401, "session_expired", locale);
  }
  const row = await loadSdkSession(sessionId, user.id);
  if (!row || row.client_kind !== "sdk") {
    throw sdkFail(401, "session_expired", locale);
  }
  await query(`UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1::bigint`, [sessionId]);
  const signed = signSdkToken(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      initials: user.initials,
      organizationId: user.organizationId,
    },
    sessionId
  );
  return {
    sessionToken: signed.token,
    sessionId,
    expiresAt: signed.expiresAt,
    organizationId: user.organizationId,
    actor: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

function usageContextFrom(req: { headers?: object }) {
  const headers = (req.headers || {}) as Record<string, unknown>;
  return sdkUsageContext({
    surface: headers["x-worktual-sdk-surface"],
    component: headers["x-worktual-sdk-component"],
  });
}

async function recordUsage(input: {
  organizationId: string;
  partnerKeyId?: string | null;
  actorId?: string | null;
  sessionId?: string | null;
  surface?: "ui" | "headless";
  component?: string | null;
  feature: string;
  locale?: string | null;
  skill?: string | null;
  executor?: string | null;
  confirmRequired?: boolean;
  ok: boolean;
  statusCode?: number;
}) {
  if (!USAGE_FEATURES.has(input.feature)) return;
  await ensureSdkPartnerSchema();
  const meter = sdkUsageMeter(input.feature, Boolean(input.confirmRequired));
  await query(
    `INSERT INTO ticketing.sdk_usage_events (
       organization_id, partner_key_id, actor_id, session_id,
       surface, component, feature, locale, skill, executor, ok, status_code,
       agent_turns, confirm_required
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.organizationId,
      input.partnerKeyId || null,
      input.actorId || null,
      input.sessionId || null,
      input.surface === "ui" ? "ui" : "headless",
      input.component || null,
      input.feature,
      input.locale || null,
      input.skill || null,
      input.executor || null,
      input.ok,
      input.statusCode ?? null,
      meter.agentTurns,
      meter.confirmRequired,
    ]
  );
}

/** Meter a partner session. Staff JWTs and unknown features are ignored. */
export async function meterSdkFeature(
  req: UsageRequest,
  feature: string,
  ok: boolean,
  statusCode: number
): Promise<void> {
  const user = req.user;
  const sessionId = String(user?.sessionId || "").trim();
  const organizationId = String(user?.organizationId || "").trim();
  if (!user || !sessionId || !organizationId || !USAGE_FEATURES.has(feature)) return;
  await ensureSdkPartnerSchema();
  const row = await loadSdkSession(sessionId, user.id);
  if (!row || row.client_kind !== "sdk") return;
  const context = usageContextFrom(req);
  await recordUsage({
    organizationId,
    partnerKeyId: row.partner_key_id,
    actorId: user.id,
    sessionId,
    surface: context.surface,
    component: context.component,
    feature,
    ok,
    statusCode,
  });
}

type UsageRequest = Request & {
  user?: AuthUser;
};

export function watchSdkAiUsage(req: UsageRequest, res: Response, fallbackFeature: "ai.turn" | "ai.stream") {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if ("agent" in record) res.locals.sdkAgent = String(record.agent || "");
      const data = record.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const reported = String((data as { skill_name?: unknown }).skill_name || "").trim();
        if (reported) res.locals.sdkSkill = reported;
      }
      res.locals.sdkConfirmRequired = sdkConfirmRequired(record);
    }
    return originalJson(body);
  }) as Response["json"];

  res.on("finish", () => {
    if (res.locals.sdkSkipUsage) return;
    const header = String(req.headers["x-worktual-sdk-feature"] || "").trim();
    const feature = USAGE_FEATURES.has(header) ? header : fallbackFeature;
    const sdkTask =
      req.body && typeof req.body === "object" ? (req.body as { sdk_task?: unknown }).sdk_task : undefined;
    const sessionId = String(req.user?.sessionId || "").trim();
    const organizationId = String(req.user?.organizationId || "").trim();
    if (!sessionId || !organizationId) return;
    let locale: string | null = null;
    try {
      locale = normalizeSdkLocale(req.body?.locale);
    } catch {
      locale = null;
    }
    void (async () => {
      await ensureSdkPartnerSchema();
      const row = await loadSdkSession(sessionId, String(req.user?.id || ""));
      if (!row || row.client_kind !== "sdk") return;
      const context = usageContextFrom(req);
      await recordUsage({
        organizationId,
        partnerKeyId: row.partner_key_id,
        actorId: req.user?.id,
        sessionId,
        surface: context.surface,
        component: context.component,
        feature,
        locale,
        skill: sdkUsageSkill({
          sdkTask,
          reportedSkill: res.locals.sdkSkill,
        }),
        executor: typeof res.locals.sdkAgent === "string" ? res.locals.sdkAgent : null,
        confirmRequired: res.locals.sdkConfirmRequired === true,
        ok: res.statusCode < 400 && res.locals.sdkFailed !== true,
        statusCode: res.statusCode,
      });
    })().catch((err) => {
      console.error("sdk usage record failed", err);
    });
  });
}

function parseRange(query: Request["query"]) {
  const now = new Date();
  const to = query.to ? new Date(String(query.to)) : now;
  const from = query.from
    ? new Date(String(query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw httpError(400, "validation_error", "from and to must be ISO dates");
  }
  return { from, to };
}

export async function sdkPartnerOrganizationId(req: Request, tenantId?: string): Promise<string> {
  return orgFromPartnerKey(req, tenantId);
}

async function orgFromPartnerKey(req: Request, tenantId?: string) {
  await ensureSdkPartnerSchema();
  const rawKey = extractApiKeyFromRequest({
    headers: req.headers as Record<string, unknown>,
  });
  const locale = sdkRequestLocale(req);
  if (!rawKey) {
    throw sdkFail(401, "auth_required", locale);
  }
  const apiKey = await authenticateOrgApiKey(rawKey);
  if (!apiKey) {
    throw sdkFail(401, "auth_required", locale);
  }
  if (tenantId && tenantId !== apiKey.organizationId) {
    throw httpError(403, "tenant_mismatch", "tenantId does not match this API key");
  }
  return apiKey.organizationId;
}

export async function sdkUsageSummary(req: Request) {
  const tenantId = String(req.query.tenantId || req.query.tenant_id || "").trim();
  const organizationId = await orgFromPartnerKey(req, tenantId || undefined);
  const range = parseRange(req.query);
  const { rows } = await query<{ feature: string; count: string }>(
    `SELECT feature, COUNT(*)::text AS count
     FROM ticketing.sdk_usage_events
     WHERE organization_id = $1::bigint
       AND created_at >= $2
       AND created_at < $3
     GROUP BY feature
     ORDER BY feature`,
    [organizationId, range.from.toISOString(), range.to.toISOString()]
  );
  const byFeature = rows.map((row) => ({
    feature: row.feature,
    count: Number(row.count),
  }));
  const countOf = (feature: string) => byFeature.find((row) => row.feature === feature)?.count || 0;
  const skillRows = await query<{ skill: string | null; count: string }>(
    `SELECT skill, COUNT(*)::text AS count
     FROM ticketing.sdk_usage_events
     WHERE organization_id = $1::bigint
       AND created_at >= $2
       AND created_at < $3
       AND skill IS NOT NULL
       AND btrim(skill) <> ''
     GROUP BY skill
     ORDER BY skill`,
    [organizationId, range.from.toISOString(), range.to.toISOString()]
  );
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    organizationId,
    logins: countOf("auth.session"),
    sessionEnds: countOf("auth.session_end"),
    turns: countOf("ai.turn"),
    streams: countOf("ai.stream"),
    confirms: countOf("ai.confirm"),
    rejects: countOf("ai.reject"),
    quotaExceeded: countOf("quota.exceeded"),
    byFeature,
    bySkill: sdkSkillBreakdown(skillRows.rows),
    quota: await resolveSdkQuota(organizationId),
  };
}

export async function sdkUsageEvents(req: Request) {
  const tenantId = String(req.query.tenantId || req.query.tenant_id || "").trim();
  const organizationId = await orgFromPartnerKey(req, tenantId || undefined);
  const range = parseRange(req.query);
  const requested = Number(req.query.limit || 100);
  const limit = Number.isFinite(requested) ? Math.min(200, Math.max(1, Math.floor(requested))) : 100;
  const { rows } = await query<{
    id: string;
    partner_key_id: string | null;
    actor_id: string | null;
    session_id: string | null;
    surface: string | null;
    component: string | null;
    feature: string;
    skill: string | null;
    executor: string | null;
    locale: string | null;
    agent_turns: number | null;
    confirm_required: boolean | null;
    ok: boolean;
    created_at: Date;
  }>(
    `SELECT id::text AS id, partner_key_id::text AS partner_key_id, actor_id::text AS actor_id,
            session_id::text AS session_id, surface, component, feature, skill, executor, locale,
            agent_turns, confirm_required, ok, created_at
     FROM ticketing.sdk_usage_events
     WHERE organization_id = $1::bigint
       AND created_at >= $2
       AND created_at < $3
     ORDER BY created_at DESC
     LIMIT $4::int`,
    [organizationId, range.from.toISOString(), range.to.toISOString(), limit]
  );
  return {
    organizationId,
    events: rows.map((row) => ({
      id: row.id,
      partnerId: row.partner_key_id,
      tenantId: organizationId,
      actorId: row.actor_id,
      sessionId: row.session_id,
      surface: row.surface === "ui" ? "ui" : "headless",
      component: row.component,
      feature: row.feature,
      skill: row.skill,
      executor: row.executor,
      locale: row.locale,
      agentTurns: Number(row.agent_turns || 0),
      confirmRequired: row.confirm_required === true,
      ok: row.ok === true,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}

export async function sdkUsageLogins(req: Request) {
  const tenantId = String(req.query.tenantId || req.query.tenant_id || "").trim();
  const organizationId = await orgFromPartnerKey(req, tenantId || undefined);
  const range = parseRange(req.query);
  const { rows } = await query<{
    id: string;
    actor_id: string | null;
    session_id: string | null;
    locale: string | null;
    created_at: Date;
  }>(
    `SELECT id::text AS id, actor_id::text AS actor_id, session_id::text AS session_id,
            locale, created_at
     FROM ticketing.sdk_usage_events
     WHERE organization_id = $1::bigint
       AND feature = 'auth.session'
       AND created_at >= $2
       AND created_at < $3
     ORDER BY created_at DESC
     LIMIT 200`,
    [organizationId, range.from.toISOString(), range.to.toISOString()]
  );
  return {
    organizationId,
    logins: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      sessionId: row.session_id,
      locale: row.locale,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}

function positiveLimit(name: string): number {
  const value = Number(process.env[name] || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function releaseInflight(organizationId: string): void {
  const next = (inflightTurns.get(organizationId) || 1) - 1;
  if (next <= 0) inflightTurns.delete(organizationId);
  else inflightTurns.set(organizationId, next);
}

async function assertSdkProductGrant(organizationId: string, locale: unknown): Promise<void> {
  const orgId = String(organizationId || "").trim();
  if (!/^\d+$/.test(orgId)) return;
  try {
    const schema = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'accounts' AND table_name = 'setup_user_product_access'
       ) AS exists`
    );
    const organization = schema.rows[0]?.exists
      ? await query<{ id: string }>(
          `SELECT id::text AS id FROM accounts.organizations WHERE id = $1::bigint`,
          [orgId]
        )
      : { rows: [] as Array<{ id: string }> };
    const access = schema.rows[0]?.exists && organization.rows[0]?.id
      ? await query<{ has_ticketing: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM accounts.setup_user_product_access a
             WHERE a.organization_id = $1::bigint AND a.product_id = 'ticketing'
           ) AS has_ticketing`,
          [orgId]
        )
      : { rows: [] as Array<{ has_ticketing: boolean }> };
    const decision = sdkGrantDecision({
      schemaAvailable: Boolean(schema.rows[0]?.exists),
      organizationExists: Boolean(organization.rows[0]?.id),
      granted: Boolean(access.rows[0]?.has_ticketing),
    });
    if (decision === "missing") throw sdkFail(403, "ticketing_not_purchased", locale);
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "ticketing_not_purchased") throw err;
    console.error("sdk ticketing grant check failed", err);
  }
}

/**
 * Partner AI calls only. A denied role or a missing Ticketing grant stops before the model.
 * Staff chat has no SDK feature header and is left unchanged.
 */
export async function guardSdkAiTurn(req: Request, locale?: string | null): Promise<void> {
  if (
    !sdkPartnerCall({
      path: req.originalUrl || req.path,
      feature: req.headers["x-worktual-sdk-feature"],
    })
  ) {
    return;
  }
  const user = (req as UsageRequest).user;
  const task = (req.body as { sdk_task?: unknown } | undefined)?.sdk_task;
  if (sdkRoleDenied(user?.role, task)) {
    throw sdkFail(403, "forbidden", locale);
  }
  const organizationId = String(user?.organizationId || "").trim();
  if (organizationId) await assertSdkProductGrant(organizationId, locale);
}

/**
 * Caps partner AI calls before the model runs.
 * A stored row wins, then `SDK_QUOTA_TIERS`, then `SDK_TURN_RATE_PER_MINUTE` and `SDK_CONCURRENT_TURNS`.
 * `0` means that cap is off.
 * Staff chat has no SDK feature header and is not capped.
 * The returned function releases the in-flight slot.
 */
async function readStoredQuota(
  organizationId: string
): Promise<{ ratePerMinute: number; concurrent: number } | null> {
  try {
    const { rows } = await query<{ rate_per_minute: number | null; concurrent_turns: number | null }>(
      `SELECT rate_per_minute, concurrent_turns
       FROM ticketing.sdk_partner_quota
       WHERE organization_id = $1::bigint`,
      [organizationId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ratePerMinute: Math.max(0, Math.floor(Number(row.rate_per_minute) || 0)),
      concurrent: Math.max(0, Math.floor(Number(row.concurrent_turns) || 0)),
    };
  } catch (err) {
    console.error("sdk quota tier read failed", err);
    return null;
  }
}

async function resolveSdkQuota(organizationId: string): Promise<{ ratePerMinute: number; concurrent: number }> {
  await ensureSdkPartnerSchema();
  return sdkQuotaLimits({
    organizationId,
    envRate: positiveLimit("SDK_TURN_RATE_PER_MINUTE"),
    envConcurrent: positiveLimit("SDK_CONCURRENT_TURNS"),
    configured: sdkQuotaTierMap(process.env.SDK_QUOTA_TIERS),
    stored: await readStoredQuota(organizationId),
  });
}

export async function enforceSdkQuota(req: UsageRequest): Promise<() => void> {
  const noop = () => {};
  const feature = String(req.headers["x-worktual-sdk-feature"] || "").trim();
  if (!feature) return noop;
  const user = req.user;
  const sessionId = String(user?.sessionId || "").trim();
  const organizationId = String(user?.organizationId || "").trim();
  if (!user || !sessionId || !organizationId) return noop;
  const row = await loadSdkSession(sessionId, user.id);
  if (!row || row.client_kind !== "sdk") return noop;
  const limits = await resolveSdkQuota(organizationId);
  const ratePerMinute = limits.ratePerMinute;
  const concurrent = limits.concurrent;
  if (ratePerMinute <= 0 && concurrent <= 0) return noop;

  const inFlight = inflightTurns.get(organizationId) || 0;
  let recentTurns = 0;
  if (ratePerMinute > 0) {
    try {
      const counted = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM ticketing.sdk_usage_events
         WHERE organization_id = $1::bigint
           AND created_at >= NOW() - INTERVAL '1 minute'
           AND feature LIKE 'ai.%'`,
        [organizationId]
      );
      recentTurns = Number(counted.rows[0]?.count || 0);
    } catch (err) {
      console.error("sdk quota count failed", err);
      recentTurns = 0;
    }
  }
  const decision = sdkQuotaDecision({ recentTurns, inFlight, ratePerMinute, concurrent });
  if (!decision.ok) {
    const context = usageContextFrom(req);
    let locale = "en";
    try {
      locale = normalizeSdkLocale(req.body?.locale) || "en";
    } catch {
      locale = "en";
    }
    await recordUsage({
      organizationId,
      partnerKeyId: row.partner_key_id,
      actorId: user.id,
      sessionId,
      surface: context.surface,
      component: context.component,
      feature: "quota.exceeded",
      locale,
      ok: false,
      statusCode: 429,
    }).catch((err) => {
      console.error("sdk quota record failed", err);
    });
    throw httpError(429, "quota_exceeded", sdkQuotaMessage(locale));
  }
  if (concurrent <= 0) return noop;
  inflightTurns.set(organizationId, inFlight + 1);
  return () => releaseInflight(organizationId);
}

export function sendSdkError(res: Response, err: unknown) {
  const status =
    err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) : 500;
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code || "")
      : "";
  const safe = status >= 400 && status < 600 ? status : 500;
  res.status(safe).json({
    error: err instanceof Error ? err.message : "SDK request failed",
    ...(code ? { code } : {}),
  });
}
