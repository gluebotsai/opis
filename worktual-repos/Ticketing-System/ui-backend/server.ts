import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import multer from "multer";

import {
  computeDueAt,
  formatRelative,
  ensureSlaPoliciesTable,
  ensureSlaPoliciesForAllOrgs,
  listOrgPriorities,
  createOrgPriority,
  updateOrgPriority,
  deleteOrgPriority,
  isActiveOrgPriority,
} from "./src/server/sla";
import {
  ensureTicketStatusesTable,
  ensureTicketStatusesForAllOrgs,
  listOrgTicketStatuses,
  createOrgTicketStatus,
  updateOrgTicketStatus,
  deleteOrgTicketStatus,
  isActiveOrgStatus,
  isTerminalOrgStatus,
  resolveOrgStatusKey,
  statusFromAssignment,
  mayApplyAssignmentStatus,
} from "./src/server/statuses";
import {
  mapTicket,
  mapKb,
  mapQueue,
  mapActivity,
  mapMetrics,
  normalizeTicketChannel,
} from "./src/server/mappers";
import type { AuthUser, DashboardMetrics, Priority } from "./src/types";
import {
  canAccessModule,
  canCreateTicket as roleCanCreateTicket,
  canMutateKnowledge,
  dataScopeForRole,
  modulesForRole,
  portalLabelForRole,
  ticketsListModuleForRole,
} from "./src/rbac";
import { DEFAULT_ORG_ID, pool, query, seedDemoEnabled } from "./src/server/db";
import { bootstrapTicketingSchema } from "./src/server/bootstrapTicketing";
import {
  ensureAuditTable,
  listAuditEvents,
  writeAuditEvent,
} from "./src/server/audit";
import { ensurePhase2Schema } from "./src/server/phase2";
import {
  authenticateMyAccountStaff,
  changeMyAccountPassword,
  ensureThinTicketingUser,
  getEffectiveIdentity,
  resolveStaffServiceActor,
  hasEligibleMyAccountUser,
  listAssignableAgents,
  startAccountsIdentityMappingBackfill,
  TicketingProductError,
} from "./src/server/accountsSync";
import {
  assertReassignTargetAllowed,
  createTicketingTeam,
  deleteTicketingTeam,
  filterRosterForActor,
  collectResolvedMemberIds,
  listTicketingTeams,
  resolveAgentIdByName,
  resolveTicketingTeam,
  teamToQueuePayload,
  updateTicketingTeam,
} from "./src/server/ticketingTeams";
import { enrichTicketDraft, pickBestResolver } from "./src/server/ticketEnrich";
import { guidedChatReply, guidedTicketReasonTurn } from "./src/server/guidedChatReply";
import { clearLlmHits, listLlmHits, recordLlmHit } from "./src/server/llmHits";
import { triageAssignViaAgents } from "./src/server/coworkerTasks";
import {
  notifyOrgAgents,
  notifyUsers,
  resolveUserIdByName,
  resolveUserIdByEmail,
  listUserNotifications,
} from "./src/server/notifications";
import {
  buildPnaNotifyPayload,
  emitCustomerReplied,
  emitProactiveEvent,
} from "./src/server/proactiveOutbox";
import { nextTicketNumber } from "./src/server/ticketNumbers";
import {
  authenticateOrgApiKey,
  createOrgApiKey,
  ensureOrgApiKeysTable,
  extractApiKeyFromRequest,
  listOrgApiKeys,
  revokeOrgApiKey,
} from "./src/server/orgApiKeys";
import {
  CANONICAL_INTAKE_TASK,
  createTicketFromIntake,
  listTicketsByContact,
  verifyWebchatCustomer,
} from "./src/server/intake";
import {
  createOrgWidget,
  ensureOrgWidgetsTable,
  getWidgetByPublicId,
  listOrgWidgets,
  originAllowed,
  updateOrgWidget,
} from "./src/server/orgWidgets";
import {
  ensureEmailMessageRefsTable,
  processInboundEmail,
} from "./src/server/emailIntake";
import {
  emailCustomerTicketCreated,
  emailCustomerTicketReply,
  emailCustomerTicketResolved,
  ensureOutboundEmailLogTable,
} from "./src/server/customerMail";
import {
  emailStaffOnAssignChange,
  runTicketCreatedNotifyAndMail,
} from "./src/server/ticketCreatedSideEffects";
import {
  runSlaSweep,
  startSlaSweepTimer,
} from "./src/server/slaSweep";
import {
  createAutomationRule,
  deleteAutomationRule,
  ensureAutomationRulesTable,
  listAutomationRules,
  runAutomations,
  updateAutomationRule,
} from "./src/server/automation";
import type { AutomationEvent } from "./src/server/automation";
import {
  clearTicketPresence,
  ensureTicketPresenceTable,
  listOtherTicketViewers,
  upsertTicketPresence,
} from "./src/server/ticketPresence";
import {
  getPublishedHelpArticle,
  listHelpCategories,
  listPublishedHelpArticles,
  resolveHelpOrgBySlug,
  ensureOrgPortalSlug,
} from "./src/server/helpCenter";
import { ensureSupportPortalSchema } from "./src/server/supportPortalSchema";
import {
  incrementCustomerTickets,
  requireExistingCustomer,
  CustomerDirectoryError,
  findDirectoryCustomer,
  listDirectoryCustomers,
  mapDirectoryCustomer,
} from "./src/server/customersDirectory";
import { extractPortalToken, resolvePortalServiceActor, resolveHubServiceActor, cookieShouldBeSecure } from "./src/server/portalAuth";
import {
  adminCreateCustomer,
  adminImportCustomers,
  registerPortalRoutes,
} from "./src/server/portalRoutes";
import { registerSpokeHealthRoutes } from "./src/server/spokeHealth";
import { registerSpokeDocsRoutes } from "./src/server/spokeOpenApi";
import { authenticateCrmBearer } from "./src/server/crmJwtAuth";
import { registerConversationContextRoutes } from "./src/server/conversationContextApi";
import {
  ensureTicketEventOutboxTable,
  startTicketEventOutboxWorker,
} from "./src/server/ticketEventOutbox";
import { resolveInternalServiceOrgId } from "./src/server/internalServiceAuth";
import { registerTriageDataRoutes } from "./src/server/triageDataApi";
import { registerProactiveInternalRoutes } from "./src/server/proactiveInternalApi";

// ESM (tsx): import.meta.url. CJS bundle: esbuild --define + banner (see package.json).
// Do not name these __filename/__dirname — that shadows Node's CJS params after esbuild.
const moduleFilePath = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(moduleFilePath);
const REPO_ROOT = path.resolve(moduleDir, "..");
const FRONTEND_ROOT = path.join(REPO_ROOT, "ui-frontend");

const app = express();
const API_ONLY = process.env.TICKETING_API_ONLY === "1";
const PORT = Number(
  process.env.PORT || (API_ONLY ? process.env.TICKETING_API_PORT || 3001 : 3000)
);
const JWT_SECRET = process.env.JWT_SECRET || "worktual-dev-secret-change-me";
const COWORKER_TASKS_SECRET = String(
  process.env.COWORKER_TASKS_SECRET || ""
).trim();
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET ||
    process.env.JWT_SECRET === "worktual-dev-secret-change-me")
) {
  throw new Error(
    "JWT_SECRET must be set to a strong unique value in production"
  );
}
if (
  process.env.NODE_ENV === "production" &&
  (!COWORKER_TASKS_SECRET ||
    COWORKER_TASKS_SECRET === "worktual-tasks-dev-secret")
) {
  throw new Error(
    "COWORKER_TASKS_SECRET must be set to a strong unique value in production"
  );
}
const COOKIE_NAME = "worktual_token";
const UPLOAD_DIR = path.join(REPO_ROOT, "uploads");

function authCookieOptions(req?: Request) {
  // Secure cookies are dropped on plain HTTP. Derive from the browser request
  // (Origin/Referer / x-forwarded-proto), not only APP_URL — otherwise LAN
  // http://192.168.x.x logins bounce back to the login page.
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieShouldBeSecure(req),
    path: "/",
  };
}

// Idle DB clients can drop on remote networks; avoid crashing the process.
pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error (idle client):", err.message);
});

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

registerSpokeHealthRoutes(app);
registerSpokeDocsRoutes(app);

// Reject path-traversal probes before Express/Vite normalize `/uploads/../x` → `/x`.
app.use((req, res, next) => {
  const raw = String(req.originalUrl || req.url || "");
  if (
    raw.includes("..") ||
    /%2e%2e/i.test(raw) ||
    /%252e/i.test(raw)
  ) {
    return res.status(400).json({ error: "Invalid path" });
  }
  next();
});

// Never expose repo/config files via Vite static serving in development.
app.use((req, res, next) => {
  const p = String(req.path || "").toLowerCase();
  if (
    p === "/package.json" ||
    p === "/package-lock.json" ||
    p === "/tsconfig.json" ||
    p === "/vite.config.ts" ||
    p === "/server.ts" ||
    p === "/.env" ||
    p.startsWith("/.env.") ||
    p.endsWith(".pem") ||
    p.endsWith(".key")
  ) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
});

// Attachments require a valid session (same-origin <img>/download sends cookies).
// Only allow a single basename under UPLOAD_DIR — block nested paths.
app.use("/uploads", (req, res, next) => {
  const token =
    req.cookies?.[COOKIE_NAME] || extractBearer(req) || extractPortalToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  let rel = "";
  try {
    rel = decodeURIComponent(String(req.path || ""));
  } catch {
    return res.status(400).json({ error: "Invalid path" });
  }
  const parts = rel.split("/").filter(Boolean);
  if (
    parts.length !== 1 ||
    parts[0].includes("..") ||
    parts[0].includes("\0") ||
    parts[0].includes("\\")
  ) {
    return res.status(400).json({ error: "Invalid path" });
  }
  const resolvedRoot = path.resolve(UPLOAD_DIR);
  const full = path.resolve(UPLOAD_DIR, parts[0]);
  if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  req.url = `/${parts[0]}`;
  next();
}, express.static(UPLOAD_DIR, { index: false, dotfiles: "deny", fallthrough: false }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ---- Auth helpers ----

interface AuthedRequest extends Request {
  user?: AuthUser;
}

function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      initials: user.initials,
      role: user.role,
      organizationId: user.organizationId,
      sessionId: user.sessionId,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res: Response, token: string, req?: Request) {
  res.cookie(COOKIE_NAME, token, {
    ...authCookieOptions(req),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res: Response, req?: Request) {
  res.clearCookie(COOKIE_NAME, authCookieOptions(req));
}

function parseClient(req: Request) {
  const ua = String(req.headers["user-agent"] || "").trim();
  let browser = "Browser";
  if (/Edg(?:e|A|iOS)?\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\/|FxiOS\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  else if (/curl\//i.test(ua)) browser = "curl";
  else if (/PostmanRuntime/i.test(ua)) browser = "Postman";
  else if (!ua) browser = "Unknown client";

  let os = "Unknown";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  const deviceLabel =
    os !== "Unknown" && browser !== "Browser" && browser !== "Unknown client"
      ? `${os} — ${browser}`
      : os !== "Unknown"
        ? os
        : browser !== "Browser"
          ? browser
          : "Signed-in session";

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";

  const isLocal =
    ip.includes("127.0.0.1") ||
    ip === "::1" ||
    ip.endsWith(":1") ||
    ip === ":1" ||
    ip === "::ffff:127.0.0.1";

  return {
    browser,
    os,
    deviceLabel,
    userAgent: ua.slice(0, 400) || "n/a",
    ipAddress: ip,
    location: isLocal ? "Local" : "Network",
  };
}

function formatSessionTitle(row: {
  device_label?: unknown;
  browser?: unknown;
  os?: unknown;
}) {
  const os = String(row.os || "").trim();
  const browser = String(row.browser || "").trim();
  const label = String(row.device_label || "").trim();
  const osOk = os && os !== "Unknown";
  const browserOk = browser && browser !== "Browser" && browser !== "Unknown client";
  if (osOk && browserOk) return `${os} · ${browser}`;
  if (osOk) return os;
  if (browserOk) return browser;
  if (label && !/^Unknown/i.test(label)) return label.replace(/\s*—\s*/g, " · ");
  return "Signed-in session";
}

function formatSessionMeta(row: {
  browser?: unknown;
  os?: unknown;
  location?: unknown;
  ip_address?: unknown;
}) {
  const parts = [
    String(row.browser || "").trim() || null,
    String(row.os || "").trim() || null,
    String(row.location || "").trim() || null,
  ].filter((p) => p && p !== "Unknown" && p !== "Browser");
  if (parts.length) return parts.join(" · ");
  const ip = String(row.ip_address || "").trim();
  return ip || "Active session";
}

function formatAccountTime(value: unknown) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function findLiveStaff(
  organizationId: string,
  selector: { id?: string | null; name?: string | null; email?: string | null }
) {
  const roster = await listAssignableAgents(organizationId);
  const id = String(selector.id || "").trim();
  if (id) return roster.find((user) => user.id === id) || null;
  const email = String(selector.email || "").trim().toLowerCase();
  if (email) {
    return (
      roster.find((user) => user.email.trim().toLowerCase() === email) || null
    );
  }
  const name = String(selector.name || "").trim().toLowerCase();
  if (!name) return null;
  const exact = roster.find((user) => user.name.trim().toLowerCase() === name);
  if (exact) return exact;
  const partial = roster.filter((user) => {
    const lower = user.name.trim().toLowerCase();
    return lower.includes(name) || name.includes(lower);
  });
  if (partial.length === 1) return partial[0];
  const starts = partial.filter((user) =>
    user.name.trim().toLowerCase().startsWith(name)
  );
  if (starts.length === 1) return starts[0];
  const firstToken = name.split(/\s+/)[0];
  if (firstToken.length >= 3) {
    const byFirst = partial.filter((user) =>
      user.name.trim().toLowerCase().startsWith(firstToken)
    );
    if (byFirst.length === 1) return byFirst[0];
  }
  return null;
}

async function hydrateTicketIdentityNames(
  organizationId: string,
  rows: Array<Record<string, unknown>>
) {
  const roster = await listAssignableAgents(organizationId);
  const byId = new Map(roster.map((user) => [user.id, user]));
  return rows.map((row) => {
    const assignee = row.assignee_id
      ? byId.get(String(row.assignee_id))
      : undefined;
    const resolver = row.resolver_id
      ? byId.get(String(row.resolver_id))
      : undefined;
    return {
      ...row,
      assignee_name: assignee?.name || row.assignee_name,
      resolver_name: resolver?.name || row.resolver_name,
    };
  });
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.[COOKIE_NAME];
  const bearer = extractBearer(req);
  const token = cookieToken || bearer;
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    const payloadUserId = String(payload.id || "").trim();
    if (!/^\d+$/.test(payloadUserId)) {
      clearAuthCookie(res, req);
      return res.status(401).json({ error: "Session expired. Please sign in again." });
    }
    if (payload.sessionId) {
      const { rows } = await query(
      `SELECT id FROM user_sessions
         WHERE id = $1 AND user_id = $2::bigint AND revoked_at IS NULL`,
        [payload.sessionId, payloadUserId]
      );
        if (!rows[0]) {
        clearAuthCookie(res, req);
          return res.status(401).json({ error: "Session expired. Please sign in again." });
        }
    }

    // JWT identifies the FK only. Current role/status/product access and
    // profile always come from MyAccount (SEED_DEMO is the sole local exception).
    const identity = await getEffectiveIdentity(payloadUserId, payload.organizationId);
    if (!identity) {
      clearAuthCookie(res, req);
      return res.status(401).json({
        error: "Your MyAccount access is inactive or no longer includes Ticketing.",
      });
    }
    req.user = {
      id: identity.id,
      myAccountUserId: identity.accountsUserId || undefined,
      name: identity.name,
      email: identity.email,
      initials: identity.initials,
      role: identity.role as AuthUser["role"],
      organizationId: identity.organizationId,
      organizationName: identity.companyName || undefined,
      sessionId: payload.sessionId,
    };

    if (payload.sessionId) {
      void query(
          `UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1`,
          [payload.sessionId]
        ).catch(() => undefined);
    }
    return next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError && bearer && !cookieToken) {
      const crm = await authenticateCrmBearer(bearer);
      if (crm.status === "ok") {
        req.user = crm.user;
        return next();
      }
      if (crm.status === "forbidden") {
        return res.status(403).json({ error: crm.error });
      }
    }
    if (err instanceof jwt.JsonWebTokenError) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
    console.error("authoritative identity lookup failed", err);
    return res.status(503).json({ error: "Authentication temporarily unavailable" });
  }
}

/**
 * Session cookie/Bearer OR LangGraph service-on-behalf-of actor.
 * Service path: X-Coworker-Tasks-Key + X-Coworker-Actor-Id + X-Coworker-Org-Id.
 */
async function requireAuthOrServiceActor(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const expected =
    COWORKER_TASKS_SECRET ||
    process.env.COWORKER_TASKS_SECRET ||
    "worktual-tasks-dev-secret";
  const key = String(req.headers["x-coworker-tasks-key"] || "").trim();
  const actorId = String(req.headers["x-coworker-actor-id"] || "").trim();
  const orgId = String(req.headers["x-coworker-org-id"] || "").trim();

  if (key && key === expected && actorId && orgId) {
    try {
      const hubActor = resolveHubServiceActor(actorId, orgId);
      if (hubActor) {
        req.user = hubActor;
        return next();
      }
      const identity = await getEffectiveIdentity(actorId, orgId);
      const staff =
        identity ||
        (await resolveStaffServiceActor(actorId, orgId));
      const portalActor = staff
        ? null
        : await resolvePortalServiceActor(actorId, orgId);
      if (!staff && !portalActor) {
        return res.status(401).json({ error: "Service actor not found" });
      }
      if (staff) {
        req.user = {
          id: staff.id,
          myAccountUserId: staff.accountsUserId || undefined,
          name: staff.name,
          email: staff.email,
          initials: staff.initials,
          role: staff.role as AuthUser["role"],
          organizationId: staff.organizationId,
          organizationName: staff.companyName || undefined,
        };
      } else if (portalActor) {
        req.user = portalActor;
      }
      return next();
    } catch (err) {
      console.error("service actor auth failed", err);
      return res.status(503).json({ error: "Authentication temporarily unavailable" });
    }
  }

  return requireAuth(req, res, next);
}

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return null;
}

function requireRole(...roles: AuthUser["role"][]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

const canMutate = requireRole("admin", "agent", "resolver");
/** Admin/agent create for any customer; customer role creates for self only (enforced in handler). */
const canCreateTicket = requireRole("admin", "agent", "customer");

/** Middleware: deny API if role cannot access the related module. */
function requireModule(module: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!canAccessModule(req.user.role, module)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

function assigneeOrResolverScopeSql(
  idParam: string,
  nameParam: string,
  forResolverRole: boolean
): string {
  if (forResolverRole) {
    return `AND (
        resolver_id = ${idParam}::bigint
        OR lower(COALESCE(resolver_name, '')) = lower(${nameParam})
        OR assignee_id = ${idParam}::bigint
        OR lower(COALESCE(assignee_name, '')) = lower(${nameParam})
      )`;
  }
  return `AND (
        assignee_id = ${idParam}::bigint
        OR lower(COALESCE(assignee_name, '')) = lower(${nameParam})
      )`;
}

/**
 * Ticket list WHERE fragment + params for the current user.
 * Returns { sql, params } where params start after organization_id ($1).
 */
function ticketScopeClause(user: AuthUser): { sql: string; params: unknown[] } {
  const scope = dataScopeForRole(user.role);
  if (scope === "requester") {
    return {
      sql: "AND lower(customer_email) = lower($2)",
      params: [user.email],
    };
  }
  if (scope === "assignee") {
    return {
      sql: assigneeOrResolverScopeSql("$2", "$3", user.role === "resolver"),
      params: [user.id, user.name],
    };
  }
  return { sql: "", params: [] };
}

/** Missing L1 agent and/or L2 resolver (queue pressure + Unassigned list). */
const UNASSIGNED_SQL = `(
  assignee_id IS NULL
  OR assignee_name IS NULL
  OR assignee_name = ''
  OR assignee_name = 'Unassigned'
  OR resolver_id IS NULL
  OR resolver_name IS NULL
  OR resolver_name = ''
  OR resolver_name = 'Unassigned'
)`;

/**
 * Optional list scopes: team | unassigned | assignee | created | org | default.
 */
async function ticketListScopeClause(
  user: AuthUser,
  listScope?: string | null
): Promise<{ sql: string; params: unknown[] }> {
  const scope = String(listScope || "default").toLowerCase();

  if (scope === "team") {
    if (!canAccessModule(user.role, "team-inbox")) {
      throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
    }
    const teams = await listTicketingTeams(user.organizationId);
    const mine = teams.filter(
      (t) =>
        t.memberIds.includes(user.id) ||
        t.members.some((m) => m.id === user.id)
    );
    // Team pool + tickets where I am L1 or L2 (even if queue is another team).
    // Creator-only history stays out of the list; open-by-id still allows creator.
    const involvedSql = `(
      assignee_id = $2::bigint
      OR lower(COALESCE(assignee_name, '')) = lower($3)
      OR resolver_id = $2::bigint
      OR lower(COALESCE(resolver_name, '')) = lower($3)
    )`;
    if (!mine.length) {
      return {
        sql: `AND ${involvedSql}`,
        params: [user.id, user.name],
      };
    }
    const ids = mine.map((t) => t.id);
    const names = mine.map((t) => t.name.toLowerCase());
    return {
      sql: `AND (
        queue_id = ANY($4::bigint[])
        OR lower(COALESCE(queue_name, '')) = ANY($5::text[])
        OR ${involvedSql}
      )`,
      params: [user.id, user.name, ids, names],
    };
  }

  if (scope === "unassigned") {
    if (!canAccessModule(user.role, "unassigned")) {
      throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
    }
    if (user.role === "admin" || user.role === "viewer") {
      return { sql: `AND ${UNASSIGNED_SQL}`, params: [] };
    }
    const teams = await listTicketingTeams(user.organizationId);
    const mine = teams.filter(
      (t) =>
        t.memberIds.includes(user.id) ||
        t.members.some((m) => m.id === user.id)
    );
    if (!mine.length) {
      return { sql: `AND ${UNASSIGNED_SQL} AND FALSE`, params: [] };
    }
    const ids = mine.map((t) => t.id);
    const names = mine.map((t) => t.name.toLowerCase());
    return {
      sql: `AND ${UNASSIGNED_SQL} AND (
        queue_id = ANY($2::bigint[])
        OR lower(COALESCE(queue_name, '')) = ANY($3::text[])
      )`,
      params: [ids, names],
    };
  }

  /** Search: agents see team pool; admins org; resolvers/customers keep default role scope */
  if (scope === "search") {
    if (user.role === "admin" || user.role === "viewer") {
      return { sql: "", params: [] };
    }
    if (user.role === "agent" && canAccessModule(user.role, "team-inbox")) {
      return ticketListScopeClause(user, "team");
    }
    return ticketScopeClause(user);
  }

  if (scope === "assignee") {
    return {
      sql: assigneeOrResolverScopeSql("$2", "$3", user.role === "resolver"),
      params: [user.id, user.name],
    };
  }

  if (scope === "created") {
    if (user.role !== "admin" && user.role !== "agent") {
      throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
    }
    return {
      sql: "AND created_by_id = $2::bigint",
      params: [user.id],
    };
  }

  if (scope === "org") {
    if (user.role !== "admin" && user.role !== "viewer") {
      throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
    }
    return { sql: "", params: [] };
  }

  return ticketScopeClause(user);
}

type TicketListFilters = {
  createdBySelf: boolean;
  assignedToSelf: boolean;
  assignedToName?: string;
  status?: string;
  priority?: string;
  channel?: "Email" | "Chat" | "Phone" | "Web";
  q?: string;
  queue?: string;
  customer?: string;
  due?: "today" | "overdue";
  createdRange?: string;
  updatedRange?: string;
  sort?: "latest" | "oldest" | "priority" | "due";
  limit: number;
};

function queryString(
  value: unknown,
  name: string,
  maxLength: number
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw Object.assign(new Error(`${name} must be a single string`), { status: 400 });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw Object.assign(
      new Error(`${name} must be between 1 and ${maxLength} characters`),
      { status: 400 }
    );
  }
  return normalized;
}

const TICKET_TIME_RANGES = new Set([
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_24h",
  "last_7d",
  "last_30d",
]);

function parseTicketListFilters(queryParams: AuthedRequest["query"]): TicketListFilters {
  const createdBy = queryString(queryParams.createdBy, "createdBy", 16);
  const assignedTo = queryString(queryParams.assignedTo, "assignedTo", 128);
  if (createdBy && createdBy.toUpperCase() !== "SELF") {
    throw Object.assign(new Error("createdBy only supports SELF"), { status: 400 });
  }
  const assignedToSelf = Boolean(assignedTo && assignedTo.toUpperCase() === "SELF");
  const assignedToName =
    assignedTo && !assignedToSelf ? assignedTo : undefined;
  const status = queryString(queryParams.status, "status", 128);
  const priority = queryString(queryParams.priority, "priority", 128);
  const channelRaw = queryString(queryParams.channel, "channel", 32);
  const validChannels = new Map(
    ["Email", "Chat", "Phone", "Web"].map((channel) => [
      channel.toLowerCase(),
      channel as TicketListFilters["channel"],
    ])
  );
  const channel = channelRaw ? validChannels.get(channelRaw.toLowerCase()) : undefined;
  if (channelRaw && !channel) {
    throw Object.assign(
      new Error("channel must be one of Email, Chat, Phone, or Web"),
      { status: 400 }
    );
  }

  const q = queryString(queryParams.q, "q", 200);
  const queue = queryString(queryParams.queue, "queue", 128);
  const customer = queryString(queryParams.customer, "customer", 128);
  const dueRaw = queryString(queryParams.due, "due", 16);
  const due =
    dueRaw && ["today", "overdue"].includes(dueRaw.toLowerCase())
      ? (dueRaw.toLowerCase() as TicketListFilters["due"])
      : undefined;
  if (dueRaw && !due) {
    throw Object.assign(new Error("due must be today or overdue"), { status: 400 });
  }
  const createdRangeRaw = queryString(queryParams.createdRange, "createdRange", 32);
  const updatedRangeRaw = queryString(queryParams.updatedRange, "updatedRange", 32);
  const createdRange = createdRangeRaw
    ? createdRangeRaw.toLowerCase().replace(/\s+/g, "_")
    : undefined;
  const updatedRange = updatedRangeRaw
    ? updatedRangeRaw.toLowerCase().replace(/\s+/g, "_")
    : undefined;
  if (createdRange && !TICKET_TIME_RANGES.has(createdRange)) {
    throw Object.assign(new Error("unsupported createdRange"), { status: 400 });
  }
  if (updatedRange && !TICKET_TIME_RANGES.has(updatedRange)) {
    throw Object.assign(new Error("unsupported updatedRange"), { status: 400 });
  }
  const sortRaw = queryString(queryParams.sort, "sort", 16);
  const sort =
    sortRaw && ["latest", "oldest", "priority", "due"].includes(sortRaw.toLowerCase())
      ? (sortRaw.toLowerCase() as TicketListFilters["sort"])
      : undefined;
  if (sortRaw && !sort) {
    throw Object.assign(
      new Error("sort must be latest, oldest, priority, or due"),
      { status: 400 }
    );
  }
  let limit = 100;
  if (queryParams.limit !== undefined) {
    const rawLimit = queryString(queryParams.limit, "limit", 4);
    if (!rawLimit || !/^\d+$/.test(rawLimit)) {
      throw Object.assign(new Error("limit must be an integer"), { status: 400 });
    }
    limit = Number(rawLimit);
    if (limit < 1 || limit > 100) {
      throw Object.assign(new Error("limit must be between 1 and 100"), { status: 400 });
    }
  }

  return {
    createdBySelf: Boolean(createdBy),
    assignedToSelf,
    assignedToName,
    status,
    priority,
    channel,
    q,
    queue,
    customer,
    due,
    createdRange,
    updatedRange,
    sort,
    limit,
  };
}

function ticketFilterClause(
  user: AuthUser,
  filters: TicketListFilters,
  firstParam: number
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sqlForParam: (placeholder: string) => string, value: unknown) => {
    params.push(value);
    clauses.push(sqlForParam(`$${firstParam + params.length - 1}`));
  };

  if (filters.createdBySelf) {
    add((p) => `created_by_id = ${p}::bigint`, user.id);
  }
  if (filters.assignedToSelf) {
    params.push(user.id, user.name);
    const idParam = `$${firstParam + params.length - 2}`;
    const nameParam = `$${firstParam + params.length - 1}`;
    clauses.push(`(
      assignee_id = ${idParam}::bigint
      OR lower(COALESCE(assignee_name, '')) = lower(${nameParam})
    )`);
  }
  if (filters.assignedToName) {
    add(
      (p) => `lower(COALESCE(assignee_name, '')) = lower(${p})`,
      filters.assignedToName
    );
  }
  if (filters.status) {
    add((p) => `lower(status) = lower(${p})`, filters.status);
  }
  if (filters.priority) {
    add((p) => `lower(priority) = lower(${p})`, filters.priority);
  }
  if (filters.channel) {
    add((p) => `lower(channel) = lower(${p})`, filters.channel);
  }
  if (filters.queue) {
    add((p) => `lower(COALESCE(queue_name, '')) = lower(${p})`, filters.queue);
  }
  if (filters.customer) {
    const escapedCustomer = filters.customer.replace(/[\\%_]/g, "\\$&");
    add(
      (p) => `(
        customer_name ILIKE ${p} ESCAPE '\\'
        OR customer_email ILIKE ${p} ESCAPE '\\'
      )`,
      `%${escapedCustomer}%`
    );
  }
  if (filters.due === "overdue") {
    clauses.push(`(
      lower(status) = 'overdue'
      OR (
        status <> 'Resolved'
        AND due_at IS NOT NULL
        AND due_at < NOW()
      )
    )`);
  }
  if (filters.due === "today") {
    clauses.push(`(
      status <> 'Resolved'
      AND due_at IS NOT NULL
      AND (
        due_at AT TIME ZONE (
          SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
          FROM ticketing.org_settings WHERE organization_id = $1
        )
      )::date
      = (
        NOW() AT TIME ZONE (
          SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
          FROM ticketing.org_settings WHERE organization_id = $1
        )
      )::date
    )`);
  }
  const applyTimeRange = (column: "created_at" | "updated_at", range?: string) => {
    if (!range) return;
    const tz = `(
      SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
      FROM ticketing.org_settings WHERE organization_id = $1
    )`;
    if (range === "last_24h") {
      clauses.push(`${column} >= NOW() - INTERVAL '24 hours'`);
      return;
    }
    if (range === "last_7d") {
      clauses.push(`${column} >= NOW() - INTERVAL '7 days'`);
      return;
    }
    if (range === "last_30d") {
      clauses.push(`${column} >= NOW() - INTERVAL '30 days'`);
      return;
    }
    if (range === "today") {
      clauses.push(`(${column} AT TIME ZONE ${tz})::date = (NOW() AT TIME ZONE ${tz})::date`);
      return;
    }
    if (range === "yesterday") {
      clauses.push(
        `(${column} AT TIME ZONE ${tz})::date = (NOW() AT TIME ZONE ${tz})::date - 1`
      );
      return;
    }
    if (range === "this_week") {
      clauses.push(
        `${column} >= date_trunc('week', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`
      );
      return;
    }
    if (range === "last_week") {
      clauses.push(
        `${column} >= date_trunc('week', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz} - INTERVAL '7 days'
         AND ${column} < date_trunc('week', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`
      );
      return;
    }
    if (range === "this_month") {
      clauses.push(
        `${column} >= date_trunc('month', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`
      );
      return;
    }
    if (range === "last_month") {
      clauses.push(
        `${column} >= date_trunc('month', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz} - INTERVAL '1 month'
         AND ${column} < date_trunc('month', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`
      );
    }
  };
  applyTimeRange("created_at", filters.createdRange);
  applyTimeRange("updated_at", filters.updatedRange);
  if (filters.q) {
    const escaped = filters.q.replace(/[\\%_]/g, "\\$&");
    add(
      (p) => `(
        ticket_number ILIKE ${p} ESCAPE '\\'
        OR subject ILIKE ${p} ESCAPE '\\'
        OR description ILIKE ${p} ESCAPE '\\'
        OR customer_name ILIKE ${p} ESCAPE '\\'
        OR customer_email ILIKE ${p} ESCAPE '\\'
        OR COALESCE(assignee_name, '') ILIKE ${p} ESCAPE '\\'
        OR COALESCE(queue_name, '') ILIKE ${p} ESCAPE '\\'
      )`,
      `%${escaped}%`
    );
  }

  return {
    sql: clauses.length ? `AND ${clauses.join("\nAND ")}` : "",
    params,
  };
}

/**
 * Staff/customer may load or mutate a ticket only when in scope.
 * Admin/viewer: org. Agent: assignee or team queue. Resolver: assignee only.
 * Customer: requester email match.
 */
async function userMayAccessTicket(
  user: AuthUser,
  ticket: {
    assignee_id?: unknown;
    assignee_name?: unknown;
    resolver_id?: unknown;
    resolver_name?: unknown;
    queue_id?: unknown;
    queue_name?: unknown;
    customer_email?: unknown;
    created_by_id?: unknown;
  }
): Promise<boolean> {
  if (user.role === "admin" || user.role === "viewer") return true;
  if (user.role === "customer") {
    return (
      String(ticket.customer_email || "").toLowerCase() ===
      String(user.email || "").toLowerCase()
    );
  }
  // Creator always retains access (enrich may reassign away immediately).
  const createdById = ticket.created_by_id ? String(ticket.created_by_id) : "";
  if (createdById && createdById === user.id) {
    return true;
  }
  const assigneeId = ticket.assignee_id ? String(ticket.assignee_id) : "";
  const assigneeName = String(ticket.assignee_name || "");
  if (
    assigneeId === user.id ||
    assigneeName.toLowerCase() === String(user.name || "").toLowerCase()
  ) {
    return true;
  }
  const resolverId = ticket.resolver_id ? String(ticket.resolver_id) : "";
  const resolverName = String(ticket.resolver_name || "");
  if (
    resolverId === user.id ||
    (resolverName &&
      resolverName.toLowerCase() === String(user.name || "").toLowerCase())
  ) {
    return true;
  }
  if (user.role === "resolver") return false;
  if (user.role !== "agent") return false;

  const teams = await listTicketingTeams(user.organizationId);
  const mine = teams.filter(
    (t) =>
      t.memberIds.includes(user.id) ||
      t.members.some((m) => m.id === user.id)
  );
  if (!mine.length) return false;
  const ids = new Set(mine.map((t) => t.id));
  const names = new Set(mine.map((t) => t.name.toLowerCase()));
  const qid = ticket.queue_id ? String(ticket.queue_id) : "";
  const qname = String(ticket.queue_name || "").toLowerCase();
  return Boolean((qid && ids.has(qid)) || (qname && names.has(qname)));
}

async function metricsForUser(user: AuthUser) {
  const orgId = user.organizationId;
  const scope = ticketScopeClause(user);
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('Open', 'Pending', 'Reopened', 'Overdue'))::int AS open_tickets,
       COUNT(*) FILTER (WHERE status = 'On Hold')::int AS on_hold,
       COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue,
       COUNT(*) FILTER (
         WHERE status <> 'Resolved'
           AND due_at IS NOT NULL
           AND (
             due_at AT TIME ZONE (
               SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
               FROM ticketing.org_settings WHERE organization_id = $1
             )
           )::date
           = (
             NOW() AT TIME ZONE (
               SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
               FROM ticketing.org_settings WHERE organization_id = $1
             )
           )::date
       )::int AS due_today,
       COUNT(*) FILTER (
         WHERE status <> 'Resolved'
           AND (
             assignee_id IS NULL
             OR assignee_name IS NULL
             OR assignee_name = ''
             OR assignee_name = 'Unassigned'
             OR resolver_id IS NULL
             OR resolver_name IS NULL
             OR resolver_name = ''
             OR resolver_name = 'Unassigned'
           )
       )::int AS unassigned
     FROM tickets
     WHERE organization_id = $1
     ${scope.sql}`,
    [orgId, ...scope.params]
  );
  return metricsWithBreakdown(mapMetrics(rows[0] || {}), user, "user");
}

/** Assignee/resolver metrics even when the caller is admin (org dashboard is separate). */
async function metricsForAssignee(user: AuthUser) {
  const orgId = user.organizationId;
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('Open', 'Pending', 'Reopened', 'Overdue'))::int AS open_tickets,
       COUNT(*) FILTER (WHERE status = 'On Hold')::int AS on_hold,
       COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue,
       COUNT(*) FILTER (
         WHERE status <> 'Resolved'
           AND due_at IS NOT NULL
           AND (
             due_at AT TIME ZONE (
               SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
               FROM ticketing.org_settings WHERE organization_id = $1
             )
           )::date
           = (
             NOW() AT TIME ZONE (
               SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
               FROM ticketing.org_settings WHERE organization_id = $1
             )
           )::date
       )::int AS due_today,
       COUNT(*) FILTER (
         WHERE status <> 'Resolved'
           AND (
             assignee_id IS NULL
             OR assignee_name IS NULL
             OR assignee_name = ''
             OR assignee_name = 'Unassigned'
             OR resolver_id IS NULL
             OR resolver_name IS NULL
             OR resolver_name = ''
             OR resolver_name = 'Unassigned'
           )
       )::int AS unassigned
     FROM tickets
     WHERE organization_id = $1
     ${assigneeOrResolverScopeSql("$2", "$3", user.role === "resolver")}`,
    [orgId, user.id, user.name]
  );
  return metricsWithBreakdown(mapMetrics(rows[0] || {}), user, "assignee");
}

const EMPTY_PRIORITY_COUNTS = {
  low: 0,
  medium: 0,
  high: 0,
  urgent: 0,
};

/** Live open-ticket donut + top queues (same scope as KPI metrics). */
async function openTicketBreakdown(
  orgId: string,
  extraSql = "",
  extraParams: unknown[] = []
): Promise<{
  priorityCounts: typeof EMPTY_PRIORITY_COUNTS;
  topQueues: Array<{ name: string; count: number }>;
}> {
  const params = [orgId, ...extraParams];
  const { rows: prioRows } = await query(
    `SELECT lower(COALESCE(NULLIF(TRIM(priority), ''), 'medium')) AS priority,
            COUNT(*)::int AS n
       FROM tickets
      WHERE organization_id = $1::bigint
        AND status IS DISTINCT FROM 'Resolved'
        ${extraSql}
      GROUP BY 1`,
    params
  );
  const priorityCounts = { ...EMPTY_PRIORITY_COUNTS };
  for (const r of prioRows) {
    let key = String(r.priority || "medium").toLowerCase();
    if (key === "critical") key = "urgent";
    if (key === "low" || key === "medium" || key === "high" || key === "urgent") {
      priorityCounts[key] += Number(r.n || 0);
    } else {
      priorityCounts.medium += Number(r.n || 0);
    }
  }
  const { rows: qRows } = await query(
    `SELECT COALESCE(NULLIF(TRIM(queue_name), ''), 'Unqueued') AS name,
            COUNT(*)::int AS n
       FROM tickets
      WHERE organization_id = $1::bigint
        AND status IS DISTINCT FROM 'Resolved'
        ${extraSql}
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 4`,
    params
  );
  return {
    priorityCounts,
    topQueues: qRows.map((r) => ({
      name: String(r.name),
      count: Number(r.n || 0),
    })),
  };
}

/** Tickets filed on the org's local calendar day (not SLA due today). */
async function createdTodayCount(
  orgId: string,
  extraSql = "",
  extraParams: unknown[] = []
): Promise<number> {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM tickets
      WHERE organization_id = $1::bigint
        AND (
          created_at AT TIME ZONE (
            SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
            FROM ticketing.org_settings WHERE organization_id = $1::bigint
          )
        )::date
        = (
          NOW() AT TIME ZONE (
            SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
            FROM ticketing.org_settings WHERE organization_id = $1::bigint
          )
        )::date
        ${extraSql}`,
    [orgId, ...extraParams]
  );
  return Number(rows[0]?.n || 0);
}

async function metricsWithBreakdown(
  metrics: DashboardMetrics,
  user: AuthUser,
  mode: "org" | "user" | "assignee"
): Promise<DashboardMetrics> {
  let extraSql = "";
  let extraParams: unknown[] = [];
  if (mode === "assignee") {
    extraSql = assigneeOrResolverScopeSql("$2", "$3", user.role === "resolver");
    extraParams = [user.id, user.name];
  } else if (mode === "user") {
    const scope = ticketScopeClause(user);
    extraSql = scope.sql;
    extraParams = scope.params;
  }
  const breakdown = await openTicketBreakdown(
    user.organizationId,
    extraSql,
    extraParams
  );
  const createdToday = await createdTodayCount(
    user.organizationId,
    extraSql,
    extraParams
  );
  return { ...metrics, ...breakdown, createdToday };
}

// ---- SLA / metrics helpers ----
// Timed SLA reminder + breach mail: src/server/slaSweep.ts (Express owns SMTP).
// All LLM (chat, phrase, ticket-reason, triage, insights) → coworker-agents (Python).


async function refreshDashboardMetrics(orgId: string) {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('Open', 'Pending', 'Reopened', 'Overdue'))::int AS open_tickets,
       COUNT(*) FILTER (WHERE status = 'On Hold')::int AS on_hold,
       COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue,
       COUNT(*) FILTER (
         WHERE status <> 'Resolved'
           AND due_at IS NOT NULL
           AND (
             due_at AT TIME ZONE (
               SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
               FROM ticketing.org_settings WHERE organization_id = $1
             )
           )::date
           = (
             NOW() AT TIME ZONE (
               SELECT COALESCE(NULLIF(display_timezone, ''), 'UTC')
               FROM ticketing.org_settings WHERE organization_id = $1
             )
           )::date
       )::int AS due_today,
       COUNT(*) FILTER (
         WHERE status <> 'Resolved'
           AND (
             assignee_id IS NULL
             OR assignee_name IS NULL
             OR assignee_name = ''
             OR assignee_name = 'Unassigned'
             OR resolver_id IS NULL
             OR resolver_name IS NULL
             OR resolver_name = ''
             OR resolver_name = 'Unassigned'
           )
       )::int AS unassigned
     FROM tickets
     WHERE organization_id = $1`,
    [orgId]
  );
  const m = rows[0] || {};
  await query(
    `INSERT INTO dashboard_metrics (
       organization_id, open_tickets, on_hold, overdue, due_today, unassigned,
       open_change, on_hold_change, overdue_change, due_today_change, unassigned_change, captured_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'—','—','—','—','—', NOW())
     ON CONFLICT (organization_id) DO UPDATE SET
       open_tickets = EXCLUDED.open_tickets,
       on_hold = EXCLUDED.on_hold,
       overdue = EXCLUDED.overdue,
       due_today = EXCLUDED.due_today,
       unassigned = EXCLUDED.unassigned,
       captured_at = NOW()`,
    [
      orgId,
      m.open_tickets || 0,
      m.on_hold || 0,
      m.overdue || 0,
      m.due_today || 0,
      m.unassigned || 0,
    ]
  );
}

async function logActivity(orgId: string, text: string, ticketUuid?: string | null) {
  await query(
    `INSERT INTO activity_logs (organization_id, ticket_id, text)
     VALUES ($1, $2, $3)`,
    [orgId, ticketUuid || null, text]
  );
}

// nextTicketNumber lives in ./src/server/ticketNumbers (shared with intake)
const TICKET_NUMBER_LOCK_NS = 87201442;

/**
 * Ticket numbers are unique per organization (each org starts at #1).
 * Drop the legacy global unique index and resolve any within-org duplicates.
 */
async function ensurePerOrgTicketNumbers(): Promise<void> {
  try {
    await query(`DROP INDEX IF EXISTS idx_tickets_number_global`);
    await query(`DROP INDEX IF EXISTS ticketing.idx_tickets_number_global`);
  } catch (err) {
    console.warn(
      "Drop global ticket_number index skipped:",
      (err as Error).message
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [
      TICKET_NUMBER_LOCK_NS,
    ]);

    const { rows: dups } = await client.query<{
      id: string;
      organization_id: string;
      ticket_prefix: string;
      ticket_number: string;
    }>(
      `SELECT t.id::text AS id,
              t.organization_id::text AS organization_id,
              COALESCE(NULLIF(TRIM(os.ticket_prefix), ''), '#') AS ticket_prefix,
              t.ticket_number
       FROM tickets t
       LEFT JOIN ticketing.org_settings os ON os.organization_id = t.organization_id
       WHERE t.id IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY organization_id, ticket_number
                    ORDER BY created_at ASC NULLS LAST, id ASC
                  ) AS rn
           FROM tickets
         ) ranked
         WHERE rn > 1
       )
       ORDER BY t.created_at ASC NULLS LAST, t.id ASC`
    );

    let renumbered = 0;
    for (const row of dups) {
      const { rows: maxRows } = await client.query<{ max: string | null }>(
        `SELECT MAX(NULLIF(regexp_replace(ticket_number, '\\D', '', 'g'), '')::bigint)::text AS max
         FROM tickets
         WHERE organization_id = $1::bigint`,
        [row.organization_id]
      );
      let n = (maxRows[0]?.max ? Number(maxRows[0].max) : 0) + 1;
      const prefix = String(row.ticket_prefix || "#").slice(0, 8);
      let next = `${prefix}${n}`;
      for (let i = 0; i < 50; i++) {
        const clash = await client.query(
          `SELECT 1 FROM tickets
           WHERE organization_id = $1::bigint AND ticket_number = $2
           LIMIT 1`,
          [row.organization_id, next]
        );
        if (!clash.rows[0]) break;
        n += 1;
        next = `${prefix}${n}`;
      }
      await client.query(
        `UPDATE tickets SET ticket_number = $1, updated_at = NOW() WHERE id = $2::bigint`,
        [next, row.id]
      );
      renumbered += 1;
      console.log(
        `Per-org ticket id: renumbered duplicate ${row.ticket_number} → ${next} (org ${row.organization_id})`
      );
    }

    await client.query("COMMIT");
    if (renumbered > 0) {
      console.log(
        `Resolved ${renumbered} duplicate ticket_number(s) within orgs.`
      );
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn("ensurePerOrgTicketNumbers:", (err as Error).message);
  } finally {
    client.release();
  }

  try {
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_org_number
       ON tickets (organization_id, ticket_number)`
    );
  } catch (err) {
    console.warn(
      "Per-org ticket_number unique index skipped:",
      (err as Error).message
    );
  }
}

// ---- Bootstrap passwords + SLA due dates for seed ----

// ---- Bootstrap ticketing schema (ticketing.* only) + passwords / SLA ----

async function bootstrap() {
  await bootstrapTicketingSchema();
  await ensureAuditTable();
  await ensurePhase2Schema();
  await ensureSupportPortalSchema();
  await ensureOrgApiKeysTable();
  await ensureOrgWidgetsTable();
  await ensureEmailMessageRefsTable();
  await ensureOutboundEmailLogTable();
  await ensureAutomationRulesTable();
  await ensureTicketPresenceTable();
  await ensurePerOrgTicketNumbers();
  await ensureSlaPoliciesTable();
  await ensureSlaPoliciesForAllOrgs();
  await ensureTicketStatusesTable();
  await ensureTicketStatusesForAllOrgs();

  // Backfill solved timestamps for already-resolved tickets
  await query(
    `UPDATE tickets
     SET resolved_at = COALESCE(resolved_at, updated_at)
     WHERE status = 'Resolved' AND resolved_at IS NULL`
  );

  if (seedDemoEnabled()) {
    const demoPassword = String(process.env.SEED_DEMO_PASSWORD || "").trim();
    if (demoPassword) {
      const hash = await bcrypt.hash(demoPassword, 10);
      console.warn(
        "SEED_DEMO password stamp skipped — agents have no local password_hash (MyAccount-only)."
      );
    } else {
      console.warn(
        "SEED_DEMO=1 but SEED_DEMO_PASSWORD unset — not stamping demo passwords."
      );
    }
  }

  // Backfill due_at for any tenant tickets missing SLA deadlines
  const { rows } = await query(
    `SELECT id, organization_id, priority, created_at FROM tickets WHERE due_at IS NULL`
  );
  for (const row of rows) {
    const due = await computeDueAt(
      String(row.organization_id),
      row.priority as Priority,
      new Date(row.created_at as string)
    );
    await query(`UPDATE tickets SET due_at = $1 WHERE id = $2`, [due, row.id]);
  }

  // SLA + metrics run on the listen timer — do not sweep every org during
  // startup. SMTP retries (Gmail 454) blocked the event loop for minutes and
  // left the UI on "Synchronizing workspace…".
  startAccountsIdentityMappingBackfill();
  console.log(
    "Database bootstrap complete (ticketing schema, identity mapping)."
  );
}

// ---- Auth routes ----

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const emailStr = String(email).trim();
    const passwordStr = String(password);

    // 1) MyAccount-only auth for onboarded staff (password never read from ticketing).
    const accountsProfile = await authenticateMyAccountStaff(emailStr, passwordStr);
    if (accountsProfile) {
      if (accountsProfile.role === "customer") {
        const thinCustomer = await ensureThinTicketingUser(accountsProfile);
        const org = await query(
          `SELECT COALESCE(s.portal_slug, a.support_portal_slug) AS slug,
              COALESCE(s.portal_auth_mode, 'otp') AS portal_auth_mode
       FROM accounts.organizations a
       LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
       WHERE a.id = $1 LIMIT 1`,
          [thinCustomer.organizationId]
        );
        const slug = org.rows[0]?.slug ? String(org.rows[0].slug) : "";
        return res.status(403).json({
          error: "Customer accounts use the support portal.",
          supportPortalPath: slug
            ? `/support/${encodeURIComponent(slug)}`
            : "/support",
        });
      }

      const thin = await ensureThinTicketingUser(accountsProfile);
    const client = parseClient(req);
    await query(
      `UPDATE user_sessions
       SET is_current = FALSE
       WHERE user_id = $1 AND revoked_at IS NULL`,
        [thin.id]
    );
    const sessionInsert = await query(
      `INSERT INTO user_sessions (
         organization_id, user_id, device_label, browser, os, location,
         user_agent, ip_address, is_current, last_active_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW())
       RETURNING id`,
      [
          thin.organizationId,
          thin.id,
        client.deviceLabel,
        client.browser,
        client.os,
        client.location,
        client.userAgent,
        client.ipAddress,
      ]
    );
    const sessionId = String(sessionInsert.rows[0].id);
    await query(
      `INSERT INTO user_login_events (
         organization_id, user_id, device_label, location, ip_address
       ) VALUES ($1,$2,$3,$4,$5)`,
      [
          thin.organizationId,
          thin.id,
        client.deviceLabel,
        client.location,
        client.ipAddress,
      ]
    );
      await query(
        `UPDATE agents SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [thin.id]
      );

    const authUser: AuthUser = {
        id: thin.id,
        myAccountUserId: thin.accountsUserId,
        name: thin.name,
        email: thin.email,
        initials: thin.initials,
        role: thin.role as AuthUser["role"],
        organizationId: thin.organizationId,
        organizationName: thin.companyName || undefined,
      sessionId,
    };
    const token = signToken(authUser);
      setAuthCookie(res, token, req);
      return res.json({ user: authUser, token });
    }

    // Eligible MyAccount user with wrong password → hard fail (no ticketing hash).
    if (await hasEligibleMyAccountUser(emailStr)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // MyAccount-refer-only: no local ticketing password login.
    return res.status(401).json({ error: "Invalid email or password." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/auth/logout", async (req: AuthedRequest, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME] || extractBearer(req);
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
        if (payload.sessionId) {
          await query(
            `UPDATE user_sessions SET revoked_at = NOW(), is_current = FALSE
             WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
            [payload.sessionId, payload.id]
          );
        }
      } catch {
        // ignore invalid token on logout
      }
    }
  } catch (err) {
    console.error(err);
  }
  clearAuthCookie(res, req);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role === "customer") {
    clearAuthCookie(res, req);
    const org = await query(
      `SELECT COALESCE(s.portal_slug, a.support_portal_slug) AS slug,
              COALESCE(s.portal_auth_mode, 'otp') AS portal_auth_mode
       FROM accounts.organizations a
       LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
       WHERE a.id = $1 LIMIT 1`,
      [req.user.organizationId]
    );
    const slug = org.rows[0]?.slug ? String(org.rows[0].slug) : "";
    return res.status(403).json({
      error: "Customer accounts use the support portal.",
      supportPortalPath: slug ? `/support/${encodeURIComponent(slug)}` : "/support",
    });
  }
  res.json({
    user: req.user,
    modules: modulesForRole(req.user!.role as Parameters<typeof modulesForRole>[0]),
    dataScope: dataScopeForRole(req.user!.role as Parameters<typeof dataScopeForRole>[0]),
    portalLabel: portalLabelForRole(req.user!.role as Parameters<typeof portalLabelForRole>[0]),
  });
});

// ---- Account settings (DB-backed) ----

async function loadAccountPayload(userId: string, sessionId?: string) {
  const identity = await getEffectiveIdentity(userId);
  if (!identity) return null;
  const { rows } = await query(
    `SELECT u.*
     FROM agents u
     WHERE u.id = $1`,
    [userId]
  );
  const user = rows[0];
  if (!user) return null;

  const sessions = await query(
    `SELECT id, device_label, browser, os, location, ip_address, last_active_at, created_at, is_current
     FROM user_sessions
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY
       CASE WHEN $2::bigint IS NOT NULL AND id = $2::bigint THEN 0 ELSE 1 END,
       last_active_at DESC
     LIMIT 25`,
    [userId, sessionId || null]
  );

  const logins = await query(
    `SELECT id, device_label, location, ip_address, created_at
     FROM user_login_events
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );

  return {
    profile: {
      id: String(user.id),
      name: identity.name,
      email: identity.email,
      initials: identity.initials,
      phone: identity.phone,
      role: identity.role,
      status: identity.status,
      organizationId: String(user.organization_id),
      organizationName: String(identity.companyName || ""),
      access: "Ticketing Console",
      lastLoginAt: user.last_login_at,
      lastLoginLabel: formatAccountTime(user.last_login_at),
      passwordChangedAt: null,
      passwordChangedLabel: "Managed in MyAccount",
      twoFactorEnabled: Boolean(user.two_factor_enabled),
    },
    notifications: {
      ticketAssignments: Boolean(user.notify_ticket_assignments),
      ticketUpdates: Boolean(user.notify_ticket_updates),
      securityAlerts: Boolean(user.notify_security_alerts),
      slaAlerts: Boolean(user.notify_sla_alerts),
      productUpdates: Boolean(user.notify_product_updates),
    },
    preferences: {
      language: String(user.language || "English"),
      timezone: String(user.timezone || "Asia/Kolkata"),
      dateFormat: String(user.date_format || "DD/MM/YYYY"),
    },
    sessions: sessions.rows.map((s) => {
      const current = Boolean(sessionId && String(s.id) === sessionId);
      return {
        id: String(s.id),
        title: formatSessionTitle(s),
        meta: formatSessionMeta(s),
        lastActive: formatRelative(s.last_active_at as string),
        current,
      };
    }),
    loginActivity: logins.rows.map((e, idx) => ({
      id: String(e.id),
      when: formatAccountTime(e.created_at),
      detail: `${e.device_label || "Session"} · ${e.location || "Local"}`,
      current: idx === 0,
    })),
  };
}

app.get("/api/account", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const payload = await loadAccountPayload(req.user!.id, req.user!.sessionId);
    if (!payload) return res.status(404).json({ error: "User not found" });
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load account" });
  }
});

app.patch("/api/account/profile", requireAuth, async (req: AuthedRequest, res) => {
  try {
    return res.status(409).json({
      error: "Name, email, and phone are managed in MyAccount.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.post("/api/account/password", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required." });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    const userId = req.user!.id;
    const email = String(req.user!.email || "").trim();
    const nextHash = await bcrypt.hash(String(newPassword), 10);

    // MyAccount is the only credential store for onboarded staff.
    if (email && (await hasEligibleMyAccountUser(email))) {
      const changed = await changeMyAccountPassword(
        email,
        String(currentPassword),
        nextHash
      );
      if (!changed) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    await query(
        `UPDATE agents SET updated_at = NOW() WHERE id = $1`,
        [userId]
      );
    } else {
      return res.status(400).json({
        error: "Password changes must be made in MyAccount.",
      });
    }

    await notifyUsers({
      orgId: req.user!.organizationId,
      userIds: [userId],
      kind: "security",
      title: "Password changed",
      message: "Your account password was updated successfully.",
    });
    res.json({ ok: true, message: "Password updated." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update password" });
  }
});

app.patch("/api/account/security", requireAuth, async (req: AuthedRequest, res) => {
  try {
    if (req.user!.myAccountUserId) {
      return res.status(409).json({
        error: "Authentication security settings are managed in MyAccount.",
      });
    }
    const enabled = Boolean(req.body?.twoFactorEnabled);
    await query(
      `UPDATE agents SET two_factor_enabled = $1, updated_at = NOW() WHERE id = $2`,
      [enabled, req.user!.id]
    );
    await notifyUsers({
      orgId: req.user!.organizationId,
      userIds: [req.user!.id],
      kind: "security",
      title: enabled ? "Two-factor authentication enabled" : "Two-factor authentication disabled",
      message: enabled
        ? "2FA is now enabled on your account."
        : "2FA was turned off on your account.",
    });
    const account = await loadAccountPayload(req.user!.id, req.user!.sessionId);
    res.json({ account });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update security settings" });
  }
});

app.patch("/api/account/notifications", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const n = req.body || {};
    await query(
      `UPDATE agents SET
         notify_ticket_assignments = $1,
         notify_ticket_updates = $2,
         notify_security_alerts = $3,
         notify_sla_alerts = $4,
         notify_product_updates = $5,
         updated_at = NOW()
       WHERE id = $6`,
      [
        Boolean(n.ticketAssignments),
        Boolean(n.ticketUpdates),
        Boolean(n.securityAlerts),
        Boolean(n.slaAlerts),
        Boolean(n.productUpdates),
        req.user!.id,
      ]
    );
    const account = await loadAccountPayload(req.user!.id, req.user!.sessionId);
    res.json({ account });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save notifications" });
  }
});

// ---- Inbox notifications (persisted) ----

app.post(
  "/api/notifications/send",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const { userId, title, message, kind, ticketUuid, customerName } = req.body || {};
      if (!userId || !title || !message) {
        return res.status(400).json({ error: "userId, title, and message are required" });
      }
      const notifyKind =
        kind === "assignment" ||
        kind === "sla" ||
        kind === "security" ||
        kind === "product"
          ? kind
          : "update";
      await notifyUsers({
        orgId,
        userIds: [String(userId)],
        kind: notifyKind,
        title: String(title),
        message: String(message),
        ticketUuid: ticketUuid ? String(ticketUuid) : null,
        customerName: customerName ? String(customerName) : null,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to send notification" });
    }
  }
);

app.get(
  "/api/proactive/approvals",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ error: "Admin only" });
      }
      const orgId = req.user!.organizationId;
      let items: unknown[] = [];
      try {
        const { rows } = await query(
          `SELECT id::text AS id, agent_id, ticket_number, summary, tool_name, tool_args,
                  payload, status, created_at
             FROM proactive_approvals
            WHERE organization_id = $1 AND status = 'pending'
            ORDER BY created_at DESC`,
          [orgId]
        );
        items = rows;
      } catch {
        items = [];
      }
      if (!items.length) {
        const agentsUrl = (
          process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
        ).replace(/\/$/, "");
        const secret =
          process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
        const r = await fetch(
          `${agentsUrl}/proactive/approvals?organization_id=${encodeURIComponent(orgId)}`,
          {
            headers: {
              "Content-Type": "application/json",
              "X-Coworker-Tasks-Key": secret,
            },
          }
        );
        if (r.ok) {
          const body = (await r.json()) as { items?: unknown };
          items = Array.isArray(body.items) ? body.items : [];
        }
      }
      res.json({ items });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load approvals" });
    }
  }
);

app.post(
  "/api/proactive/approvals/:id/decide",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ error: "Admin only" });
      }
      const orgId = req.user!.organizationId;
      const accept = Boolean(req.body?.accept);
      const agentsUrl = (
        process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
      ).replace(/\/$/, "");
      const secret =
        process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
      const r = await fetch(`${agentsUrl}/proactive/approvals/decide`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Coworker-Tasks-Key": secret,
        },
        body: JSON.stringify({
          organization_id: orgId,
          approval_id: req.params.id,
          accept,
          // Confirm runs tools as the admin who clicked — Express escalate requires actor.
          actor_id: req.user!.id,
          actor_role: req.user!.role,
          actor_name: req.user!.name || req.user!.email || undefined,
          edited_text:
            req.body?.edited_text != null
              ? String(req.body.edited_text)
              : undefined,
          tool_args:
            req.body?.tool_args && typeof req.body.tool_args === "object"
              ? req.body.tool_args
              : undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));
      const toolFailed =
        accept &&
        body &&
        typeof body === "object" &&
        (body as { ok?: boolean }).ok === false;
      res.status(toolFailed ? 422 : r.ok ? 200 : r.status).json(body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to decide approval" });
    }
  }
);

app.get(
  "/api/proactive/recommendations",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const ticketNumber = req.query.ticketNumber
        ? String(req.query.ticketNumber)
        : "";
      let items: unknown[] = [];
      try {
        const { rows } = await query(
          ticketNumber
            ? `SELECT id::text AS id, agent_id, ticket_number, summary, payload, status, created_at
                 FROM proactive_recommendations
                WHERE organization_id = $1 AND ticket_number = $2
                  AND agent_id <> 'tsaa'
                ORDER BY created_at DESC`
            : `SELECT id::text AS id, agent_id, ticket_number, summary, payload, status, created_at
                 FROM proactive_recommendations
                WHERE organization_id = $1
                  AND agent_id <> 'tsaa'
                ORDER BY created_at DESC
                LIMIT 100`,
          ticketNumber ? [orgId, ticketNumber] : [orgId]
        );
        items = rows.filter(
          (r) => String((r as { agent_id?: string }).agent_id || "").toLowerCase() !== "tsaa"
        );
      } catch {
        items = [];
      }
      if (!items.length) {
        const qs = new URLSearchParams({ organization_id: orgId });
        if (ticketNumber) qs.set("ticket_number", ticketNumber);
        const agentsUrl = (
          process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
        ).replace(/\/$/, "");
        const secret =
          process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
        const r = await fetch(
          `${agentsUrl}/proactive/recommendations?${qs.toString()}`,
          {
            headers: {
              "Content-Type": "application/json",
              "X-Coworker-Tasks-Key": secret,
            },
          }
        );
        if (r.ok) {
          const body = (await r.json()) as { items?: unknown };
          const raw = Array.isArray(body.items) ? body.items : [];
          items = raw.filter((row) => {
            const agent = String(
              (row as { agent_id?: string }).agent_id || ""
            )
              .trim()
              .toLowerCase();
            return agent !== "tsaa";
          });
        }
      }
      res.json({ items });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load recommendations" });
    }
  }
);

app.get("/api/notifications", requireAuthOrServiceActor, async (req: AuthedRequest, res) => {
  try {
    const rows = await listUserNotifications({
      orgId: req.user!.organizationId,
      userId: req.user!.id,
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

app.patch(
  "/api/notifications/:id/read",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
    try {
      await query(
        `UPDATE notifications SET is_read = TRUE
         WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
        [req.params.id, req.user!.id, req.user!.organizationId]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to mark notification read" });
    }
  }
);

app.post("/api/notifications/read-all", requireAuthOrServiceActor, async (req: AuthedRequest, res) => {
  try {
    await query(
      `UPDATE notifications SET is_read = TRUE
       WHERE user_id = $1 AND organization_id = $2 AND is_read = FALSE`,
      [req.user!.id, req.user!.organizationId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

app.delete("/api/notifications", requireAuth, async (req: AuthedRequest, res) => {
  try {
    await query(
      `DELETE FROM notifications WHERE user_id = $1 AND organization_id = $2`,
      [req.user!.id, req.user!.organizationId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

app.patch("/api/account/preferences", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { language, timezone, dateFormat } = req.body || {};
    await query(
      `UPDATE agents SET
         language = COALESCE($1, language),
         timezone = COALESCE($2, timezone),
         date_format = COALESCE($3, date_format),
         updated_at = NOW()
       WHERE id = $4`,
      [
        language ? String(language) : null,
        timezone ? String(timezone) : null,
        dateFormat ? String(dateFormat) : null,
        req.user!.id,
      ]
    );
    const account = await loadAccountPayload(req.user!.id, req.user!.sessionId);
    res.json({ account });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

app.delete("/api/account/sessions/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const sessionId = String(req.params.id);
    if (sessionId === req.user!.sessionId) {
      return res.status(400).json({ error: "Use logout to end the current session." });
    }
    const result = await query(
      `UPDATE user_sessions
       SET revoked_at = NOW(), is_current = FALSE
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [sessionId, req.user!.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Session not found" });
    const account = await loadAccountPayload(req.user!.id, req.user!.sessionId);
    res.json({ account });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to revoke session" });
  }
});

app.post("/api/account/sessions/revoke-all", requireAuth, async (req: AuthedRequest, res) => {
  try {
    await query(
      `UPDATE user_sessions
       SET revoked_at = NOW(), is_current = FALSE
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user!.id]
    );
    clearAuthCookie(res, req);
    res.json({ ok: true, loggedOut: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to revoke sessions" });
  }
});

app.post("/api/account/deactivate", requireAuth, async (req: AuthedRequest, res) => {
  try {
    if (req.user!.myAccountUserId) {
      return res.status(409).json({
        error: "Account status is managed in MyAccount.",
      });
    }
    await query(
      `UPDATE agents SET status = 'Inactive', updated_at = NOW() WHERE id = $1`,
      [req.user!.id]
    );
    await query(
      `UPDATE user_sessions SET revoked_at = NOW(), is_current = FALSE
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user!.id]
    );
    clearAuthCookie(res, req);
    res.json({ ok: true, loggedOut: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to deactivate account" });
  }
});

app.post("/api/account/delete-data", requireAuth, async (req: AuthedRequest, res) => {
  try {
    await query(
      `UPDATE agents SET
         notify_product_updates = FALSE,
         updated_at = NOW()
       WHERE id = $1`,
      [req.user!.id]
    );
    const account = await loadAccountPayload(req.user!.id, req.user!.sessionId);
    res.json({
      ok: true,
      message: "Ticketing-specific marketing preferences were cleared.",
      account,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete personal data" });
  }
});

// ---- Health (registered via registerSpokeHealthRoutes) ----

registerConversationContextRoutes(app, requireAuthOrServiceActor);
registerTriageDataRoutes(app);
registerProactiveInternalRoutes(app);

// ---- Worktual co-worker (Python LangGraph multi-agent proxy) ----

const COWORKER_AGENTS_URL = (
  process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
).replace(/\/$/, "");

function coworkerAgentsHeaders(
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra || {}),
  };
  const secret =
    COWORKER_TASKS_SECRET ||
    process.env.COWORKER_TASKS_SECRET ||
    "worktual-tasks-dev-secret";
  headers["X-Coworker-Tasks-Key"] = secret;
  return headers;
}

const COWORKER_CHAT_TIMEOUT_MS = Math.max(
  15_000,
  Number(process.env.COWORKER_CHAT_TIMEOUT_MS || 120_000) || 120_000
);

async function fetchCoworkerAgents(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? COWORKER_CHAT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { timeoutMs: _drop, signal: _sig, ...rest } = init;
  try {
    return await fetch(`${COWORKER_AGENTS_URL}${path}`, {
      ...rest,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** LLM-phrased chat status — never paint the intent seed as the reply. */
async function phraseCoworkerStatus(input: {
  kind: string;
  fallback: string;
  userText?: string;
  context?: Record<string, string | number | boolean | null | undefined>;
}): Promise<string> {
  try {
    return await guidedChatReply({
      module: "ticket",
      kind: input.kind,
      fallback: input.fallback,
      userText: input.userText,
      pageLabel: "Tickets",
      context: input.context,
    });
  } catch {
    try {
      return await guidedChatReply({
        module: "nav",
        kind: input.kind,
        fallback: input.fallback,
        userText: input.userText,
        pageLabel: "Tickets",
        context: input.context,
      });
    } catch {
      return "";
    }
  }
}

app.post("/api/coworker/focus", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const sessionId = req.body?.session_id ? String(req.body.session_id) : "";
    const focused = req.body?.focused_entity;
    if (!sessionId) {
      return res.status(400).json({ error: "session_id is required" });
    }
    const upstream = await fetch(`${COWORKER_AGENTS_URL}/focus`, {
      method: "POST",
      headers: coworkerAgentsHeaders(),
      body: JSON.stringify({
        organization_id: req.user!.organizationId,
        user_id: req.user!.id,
        user_name: req.user!.name,
        user_role: req.user!.role,
        session_id: sessionId,
        focused_entity: focused && typeof focused === "object" ? focused : undefined,
      }),
    });
    const text = await upstream.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text.slice(0, 200) };
    }
    if (!upstream.ok) {
      return res.status(502).json({
        error: "Co-worker focus error",
        detail: data.detail || upstream.statusText,
      });
    }
    return res.json({ ok: true, last_entity: data.last_entity || null });
  } catch (err) {
    return res.status(502).json({
      error: "Co-worker focus error",
      detail: err instanceof Error ? err.message : "unknown",
    });
  }
});

app.post("/api/coworker/chat", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const page = req.body?.page ? String(req.body.page) : undefined;
    const sessionId = req.body?.session_id ? String(req.body.session_id) : undefined;
    const history = Array.isArray(req.body?.history) ? req.body.history : undefined;
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    // Role gate: resolvers (and other non-creators) never enter create-ticket —
    // Python chat_commands phrases the deny (no static string here).
    // Still forward the message so the LLM reply is produced upstream.

    const started = Date.now();
    const requestId =
      String(req.headers["x-request-id"] || "").trim() ||
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const upstream = await fetchCoworkerAgents("/chat", {
      method: "POST",
      headers: coworkerAgentsHeaders({ "X-Request-Id": requestId }),
      body: JSON.stringify({
        message,
        page,
        organization_id: req.user!.organizationId,
        user_id: req.user!.id,
        user_name: req.user!.name,
        user_role: req.user!.role,
        can_create_ticket: roleCanCreateTicket(req.user!.role),
        session_id: sessionId,
        history,
        ticket_draft: req.body?.ticket_draft || undefined,
        next_step: req.body?.next_step ? String(req.body.next_step) : undefined,
        focused_entity: req.body?.focused_entity || undefined,
        request_id: requestId,
      }),
    });

    const text = await upstream.text();
    let data: {
      reply?: string;
      agent?: string;
      session_id?: string;
      detail?: string;
      ui_actions?: unknown[];
      actions?: unknown[];
      request_id?: string;
      data?: Record<string, unknown>;
    } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text.slice(0, 200) };
    }

    recordLlmHit({
      source: `agents-chat:${data.agent || "general"}`,
      model: "coworker-agents",
      ok:
        upstream.ok &&
        (Boolean(data.reply) ||
          (Array.isArray(data.ui_actions) && data.ui_actions.length > 0)),
      ms: Date.now() - started,
      status: upstream.status,
      userPreview: message.slice(0, 160),
      replyPreview: String(data.reply || data.detail || "").slice(0, 160),
      error: upstream.ok ? undefined : String(data.detail || upstream.statusText).slice(0, 200),
      meta: { page: page || "" },
    });

    if (!upstream.ok) {
      return res.status(502).json({
        error: "Co-worker agents service error",
        detail: data.detail || upstream.statusText,
      });
    }

    let reply = String(data.reply || "");
    const actions = Array.isArray(data.ui_actions)
      ? data.ui_actions
      : Array.isArray(data.actions)
        ? data.actions
        : [];
    const uiActions: unknown[] = [];
    const correlationId = String(data.request_id || requestId).trim();

    // Execute mutate actions decided by LangGraph; pass UI actions to the client.
    for (const raw of actions) {
      if (!raw || typeof raw !== "object") continue;
      const action = raw as Record<string, unknown>;
      const type = String(action.type || "").trim().toLowerCase();
      if (type === "escalate") {
        // Phase 1: primary path is LangGraph → escalate_ticket tool → this API.
        // Legacy escalate actions (if any) reuse the same endpoint — no inline SQL.
        const ticketNumber = String(
          action.ticket_number || action.ticketNumber || ""
        ).trim();
        if (!ticketNumber) {
          if (!reply) {
            reply = await phraseCoworkerStatus({
              kind: "escalate_prompt",
              fallback: "Ask which ticket number to escalate.",
              userText: message,
            });
          }
          continue;
        }
        try {
          const escRes = await fetch(
            `http://127.0.0.1:${PORT}/api/tickets/${encodeURIComponent(ticketNumber)}/escalate`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Coworker-Tasks-Key":
                  COWORKER_TASKS_SECRET ||
                  process.env.COWORKER_TASKS_SECRET ||
                  "worktual-tasks-dev-secret",
                "X-Coworker-Actor-Id": req.user!.id,
                "X-Coworker-Org-Id": req.user!.organizationId,
                "X-Coworker-Actor-Role": req.user!.role,
                "X-Coworker-Actor-Name": req.user!.name,
                ...(correlationId ? { "X-Request-Id": correlationId } : {}),
              },
              body: JSON.stringify({
                assigneeId: action.assignee_id || action.assigneeId || undefined,
                assignee: action.assignee || undefined,
                assigneeName: action.assignee || undefined,
                agentId: action.agent_id || action.agentId || undefined,
                agentName: action.agent || undefined,
                rationale: action.rationale || undefined,
              }),
            }
          );
          const escText = await escRes.text();
          let escData: Record<string, unknown> = {};
          try {
            escData = escText ? JSON.parse(escText) : {};
          } catch {
            escData = {};
          }
          if (!escRes.ok) {
            reply = await phraseCoworkerStatus({
              kind: escRes.status === 403 ? "forbidden" : "escalate_prompt",
              fallback: String(escData.error || "Could not escalate that ticket."),
              userText: message,
              context: { ticketNumber, error: true },
            });
          } else if (!reply.trim()) {
            reply = await phraseCoworkerStatus({
              kind: "escalate_done",
              fallback: escData.unchanged
                ? `${ticketNumber} is already assigned that way.`
                : `Escalated ${ticketNumber}.`,
              userText: message,
              context: {
                ticketNumber,
                assignee: String(escData.resolver || ""),
                agent: String(escData.agent || ""),
                alreadyAssigned: Boolean(escData.unchanged),
              },
            });
          }
          uiActions.push({ type: "refresh_tickets" });
        } catch (escErr) {
          console.error("chat escalate via API failed", escErr);
          reply = await phraseCoworkerStatus({
            kind: "escalate_prompt",
            fallback: "Could not escalate that ticket right now; suggest retry.",
            userText: message,
            context: { error: true },
          });
        }
        continue;
      }
      if (type === "refresh_tickets") {
        uiActions.push({ type: "refresh_tickets" });
        continue;
      }
      if (type === "navigate") {
        let view = String(action.view || "").trim();
        if (view === "teams" || view === "team") view = "agent-queues";
        if (view === "home" || view === "overview") view = "dashboard";
        // Only remap the generic alias. Keep assigned / unassigned / team-inbox
        // explicit so "my tickets" and "unassigned" land on the right view.
        if (view === "tickets-list") {
          view = ticketsListModuleForRole(req.user!.role);
        } else if (
          view === "team-queue" &&
          !canAccessModule(req.user!.role, "team-queue")
        ) {
          view = ticketsListModuleForRole(req.user!.role);
        }
        if (!canAccessModule(req.user!.role, view)) {
          // Drop forbidden navigates; Python should already deny, but belt-and-suspenders.
          if (!reply.trim()) {
            reply = await phraseCoworkerStatus({
              kind: "forbidden",
              fallback:
                "Role cannot use that module. Suggest My Tickets, Search, or Knowledge Base.",
              userText: message,
              context: { feature: view, denied: true },
            });
          }
          continue;
        }
        uiActions.push({ ...action, view });
        continue;
      }
      uiActions.push(action);
    }

    res.json({
      reply,
      agent: data.agent || "general",
      session_id: data.session_id || sessionId,
      ui_actions: uiActions,
      request_id: correlationId || undefined,
      data: data.data || undefined,
    });
  } catch (err) {
    console.error("coworker chat proxy failed", err);
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || /aborted|timeout/i.test(err.message));
    recordLlmHit({
      source: "agents-chat",
      model: "coworker-agents",
      ok: false,
      ms: 0,
      error: err instanceof Error ? err.message : String(err),
      userPreview: String(req.body?.message || "").slice(0, 160),
    });
    res.status(isTimeout ? 504 : 502).json({
      error: isTimeout
        ? "Co-worker agents timed out"
        : "Co-worker agents unreachable",
      detail: err instanceof Error ? err.message : String(err),
      hint: isTimeout
        ? "The model or triage step took too long — try again in a moment."
        : `Start the Python service: uvicorn app.main:app --app-dir ai-agents --port 8012 (COWORKER_AGENTS_URL=${COWORKER_AGENTS_URL})`,
    });
  }
});

function remapStaffNavigateView(view: string, role: string): string | null {
  let next = String(view || "").trim();
  if (!next) return null;
  if (next === "teams" || next === "team") next = "agent-queues";
  if (next === "home" || next === "overview") next = "dashboard";
  if (next === "tickets-list") {
    next = ticketsListModuleForRole(role);
  } else if (next === "team-queue" && !canAccessModule(role, "team-queue")) {
    next = ticketsListModuleForRole(role);
  }
  if (!canAccessModule(role, next)) return null;
  return next;
}

app.post("/api/coworker/agent-turn", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const kind = req.body?.kind ? String(req.body.kind) : undefined;
    const confirmTool = req.body?.confirm_tool;
    if (!message && !confirmTool && kind !== "greeting") {
      return res.status(400).json({ error: "message is required" });
    }
    const page = req.body?.page ? String(req.body.page) : undefined;
    const sessionId = req.body?.session_id ? String(req.body.session_id) : undefined;
    const history = Array.isArray(req.body?.history) ? req.body.history : undefined;
    const started = Date.now();
    const requestId =
      String(req.headers["x-request-id"] || "").trim() ||
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const { runCoworkerAgentTurn } = await import("./src/server/ai/coworkerAgentTurn");
    let data: {
      assistantText?: string;
      toolProposals?: unknown[];
      patch?: Record<string, unknown> | null;
      sessionMemoryPatch?: Record<string, unknown> | null;
      uiRefresh?: Record<string, unknown> | null;
      reply?: string;
      agent?: string;
      session_id?: string;
      ui_actions?: unknown[];
      actions?: unknown[];
      request_id?: string;
      data?: Record<string, unknown>;
      detail?: string;
      serviceError?: Record<string, unknown>;
      source?: string;
    } = {};

    try {
      data = (await runCoworkerAgentTurn({
        user: req.user!,
        message:
          message || (kind === "greeting" ? "hello" : confirmTool ? "confirm" : "hello"),
        sessionId,
        requestId,
        module: req.body?.module ? String(req.body.module) : undefined,
        surface: "staff",
        page,
        pageSurface: req.body?.page_surface
          ? String(req.body.page_surface)
          : undefined,
        channel: (() => {
          const raw = String(req.body?.channel || "chat").trim().toLowerCase();
          return raw === "email" ? "email" : "chat";
        })(),
        history,
        focusedEntity: req.body?.focused_entity || null,
        ticketDraft: req.body?.ticket_draft || req.body?.draft || null,
        sessionMemory: req.body?.session_memory || {},
        confirmTool:
          confirmTool && typeof confirmTool === "object"
            ? (confirmTool as Record<string, unknown>)
            : null,
      })) as typeof data;
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status?: number }).status || 502)
          : 502;
      const payload =
        err && typeof err === "object" && "payload" in err
          ? ((err as { payload?: Record<string, unknown> }).payload || {})
          : {};
      recordLlmHit({
        source: "agents-turn:error",
        model: "coworker-agents",
        ok: false,
        ms: Date.now() - started,
        status,
        userPreview: message.slice(0, 160),
        replyPreview: "",
        error: err instanceof Error ? err.message : String(err),
        meta: { page: page || "" },
      });
      return res.status(status >= 400 ? status : 502).json({
        error: "Co-worker agents service error",
        detail: err instanceof Error ? err.message : String(err),
        serviceError: payload.serviceError || payload,
        assistantText: null,
        reply: null,
        source: "error",
      });
    }

    recordLlmHit({
      source: `agents-turn:${data.agent || "general"}`,
      model: "coworker-agents",
      ok: Boolean(data.assistantText || data.reply),
      ms: Date.now() - started,
      status: 200,
      userPreview: message.slice(0, 160),
      replyPreview: String(data.assistantText || data.reply || data.detail || "").slice(0, 160),
      error: undefined,
      meta: { page: page || "" },
    });

    if (data.serviceError || data.source === "error") {
      return res.status(502).json({
        error: "Co-worker agents service error",
        detail: data.detail || "LLM unavailable",
        serviceError: data.serviceError,
        assistantText: null,
        reply: null,
        source: "error",
      });
    }

    const role = req.user!.role;
    const rawActions = Array.isArray(data.ui_actions)
      ? data.ui_actions
      : Array.isArray(data.actions)
        ? data.actions
        : [];
    const uiActions: unknown[] = [];
    for (const raw of rawActions) {
      if (!raw || typeof raw !== "object") continue;
      const action = raw as Record<string, unknown>;
      const type = String(action.type || "").trim().toLowerCase();
      if (type === "escalate") {
        continue;
      }
      if (type === "navigate") {
        const view = remapStaffNavigateView(String(action.view || ""), role);
        if (!view) continue;
        uiActions.push({ ...action, view });
        continue;
      }
      uiActions.push(action);
    }

    const toolProposals = Array.isArray(data.toolProposals) ? data.toolProposals : [];
    const gatedProposals: unknown[] = [];
    for (const raw of toolProposals) {
      if (!raw || typeof raw !== "object") continue;
      const tool = raw as Record<string, unknown>;
      const name = String(tool.name || "").trim();
      const args =
        tool.args && typeof tool.args === "object"
          ? { ...(tool.args as Record<string, unknown>) }
          : {};
      if (name === "set_workspace" || name === "navigate") {
        const view = remapStaffNavigateView(String(args.view || ""), role);
        if (!view) continue;
        args.view = view;
        gatedProposals.push({ ...tool, args });
        continue;
      }
      gatedProposals.push(tool);
    }

    const assistantText = String(data.assistantText || data.reply || "").trim();
    if (!assistantText) {
      return res.status(502).json({
        error: "Co-worker agents service error",
        detail: "LLM_EMPTY_RESPONSE",
        assistantText: null,
        reply: null,
        source: "error",
      });
    }
    res.json({
      assistantText,
      toolProposals: gatedProposals,
      patch: data.patch || null,
      sessionMemoryPatch: data.sessionMemoryPatch || null,
      uiRefresh: data.uiRefresh || null,
      reply: assistantText,
      agent: data.agent || "general",
      session_id: data.session_id || sessionId,
      ui_actions: uiActions,
      request_id: String(data.request_id || requestId).trim() || undefined,
      data: data.data || undefined,
      source: "ai",
    });
  } catch (err) {
    console.error("coworker agent-turn proxy failed", err);
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || /aborted|timeout/i.test(err.message));
    res.status(isTimeout ? 504 : 502).json({
      error: isTimeout
        ? "Co-worker agents timed out"
        : "Co-worker agents unreachable",
      detail: err instanceof Error ? err.message : String(err),
      assistantText: null,
      reply: null,
      source: "error",
    });
  }
});

app.post("/api/coworker/agent-turn/stream", requireAuth, async (req: AuthedRequest, res) => {
  const message = String(req.body?.message || "").trim();
  const kind = req.body?.kind ? String(req.body.kind) : undefined;
  const confirmTool = req.body?.confirm_tool;
  if (!message && !confirmTool && kind !== "greeting") {
    return res.status(400).json({ error: "message is required" });
  }
  const page = req.body?.page ? String(req.body.page) : undefined;
  const sessionId = req.body?.session_id ? String(req.body.session_id) : undefined;
  const history = Array.isArray(req.body?.history) ? req.body.history : undefined;
  const requestId =
    String(req.headers["x-request-id"] || "").trim() ||
    `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
    (res as { flushHeaders: () => void }).flushHeaders();
  }

  const writeEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const { runCoworkerAgentTurnStream } = await import("./src/server/ai/coworkerAgentTurn");
    const data = await runCoworkerAgentTurnStream(
      {
        user: req.user!,
        message:
          message || (kind === "greeting" ? "hello" : confirmTool ? "confirm" : "hello"),
        sessionId,
        requestId,
        module: req.body?.module ? String(req.body.module) : undefined,
        surface: "staff",
        page,
        pageSurface: req.body?.page_surface
          ? String(req.body.page_surface)
          : undefined,
        channel: (() => {
          const raw = String(req.body?.channel || "chat").trim().toLowerCase();
          return raw === "email" ? "email" : "chat";
        })(),
        history,
        focusedEntity: req.body?.focused_entity || null,
        ticketDraft: req.body?.ticket_draft || req.body?.draft || null,
        sessionMemory: req.body?.session_memory || {},
        confirmTool:
          confirmTool && typeof confirmTool === "object"
            ? (confirmTool as Record<string, unknown>)
            : null,
      },
      (progress) => {
        writeEvent("progress", progress);
      }
    );

    if (data.serviceError || data.source === "error") {
      writeEvent("error", {
        status: 502,
        payload: {
          error: "Co-worker agents service error",
          detail: data.detail || "LLM unavailable",
          serviceError: data.serviceError,
        },
      });
      writeEvent("done", {});
      return res.end();
    }

    const role = req.user!.role;
    const rawActions = Array.isArray(data.ui_actions)
      ? data.ui_actions
      : Array.isArray(data.actions)
        ? data.actions
        : [];
    const uiActions: unknown[] = [];
    for (const raw of rawActions) {
      if (!raw || typeof raw !== "object") continue;
      const action = raw as Record<string, unknown>;
      const type = String(action.type || "").trim().toLowerCase();
      if (type === "escalate") continue;
      if (type === "navigate") {
        const view = remapStaffNavigateView(String(action.view || ""), role);
        if (!view) continue;
        uiActions.push({ ...action, view });
        continue;
      }
      uiActions.push(action);
    }

    const toolProposals = Array.isArray(data.toolProposals) ? data.toolProposals : [];
    const gatedProposals: unknown[] = [];
    for (const raw of toolProposals) {
      if (!raw || typeof raw !== "object") continue;
      const tool = raw as Record<string, unknown>;
      const name = String(tool.name || "").trim();
      const args =
        tool.args && typeof tool.args === "object"
          ? { ...(tool.args as Record<string, unknown>) }
          : {};
      if (name === "set_workspace" || name === "navigate") {
        const view = remapStaffNavigateView(String(args.view || ""), role);
        if (!view) continue;
        args.view = view;
        gatedProposals.push({ ...tool, args });
        continue;
      }
      gatedProposals.push(tool);
    }

    const assistantText = String(data.assistantText || data.reply || "").trim();
    if (!assistantText) {
      writeEvent("error", {
        status: 502,
        payload: { error: "LLM_EMPTY_RESPONSE" },
      });
      writeEvent("done", {});
      return res.end();
    }

    writeEvent("result", {
      assistantText,
      toolProposals: gatedProposals,
      patch: data.patch || null,
      sessionMemoryPatch: data.sessionMemoryPatch || null,
      uiRefresh: data.uiRefresh || null,
      reply: assistantText,
      agent: data.agent || "general",
      session_id: data.session_id || sessionId,
      ui_actions: uiActions,
      request_id: String(data.request_id || requestId).trim() || undefined,
      data: data.data || undefined,
      source: "ai",
    });
    writeEvent("done", {});
    res.end();
  } catch (err) {
    console.error("coworker agent-turn stream failed", err);
    writeEvent("error", {
      status: 502,
      payload: {
      error: "Co-worker agents unreachable",
      detail: err instanceof Error ? err.message : String(err),
      },
    });
    writeEvent("done", {});
    res.end();
  }
});

app.get("/api/coworker/llm-hits", requireAuth, (req: AuthedRequest, res) => {
  const limit = Number(req.query.limit || 50);
  const hits = listLlmHits(limit);
  res.json({ hits, count: hits.length });
});

app.delete("/api/coworker/llm-hits", requireAuth, (_req: AuthedRequest, res) => {
  clearLlmHits();
  res.json({ ok: true });
});

// ---- Public intake (API key auth) ----

app.post("/api/intake/tickets", async (req, res) => {
  try {
    let organizationId = resolveInternalServiceOrgId(req);
    let actorName = "InternalService";
    let apiKeyId: string | undefined;

    if (!organizationId) {
      const rawKey = extractApiKeyFromRequest(req);
      if (!rawKey) {
        return res.status(401).json({
          error:
            "Missing API key. Use Authorization: Bearer wt_live_…, X-Api-Key, or X-Internal-Service-Key.",
        });
      }
      const apiKey = await authenticateOrgApiKey(rawKey);
      if (!apiKey) {
        return res.status(401).json({ error: "Invalid or revoked API key" });
      }
      organizationId = apiKey.organizationId;
      actorName = `API:${apiKey.keyName}`;
      apiKeyId = apiKey.keyId;
    }

    const body = req.body || {};
    const bodyOrg = String(body.organizationId || body.organization_id || "").trim();
    if (bodyOrg && bodyOrg !== organizationId) {
      return res.status(403).json({
        error: "organizationId does not match API key tenant",
      });
    }

    const requester = body.requester || {
      name: body.customerName || body.customer_name,
      email: body.customerEmail || body.customer_email,
      phone: body.customerPhone || body.customer_phone,
    };

    const result = await createTicketFromIntake({
      organizationId,
      channel: String(body.channel || ""),
      requester: {
        name: requester?.name,
        email: requester?.email,
        phone: requester?.phone,
      },
      subject: body.subject,
      description: body.description,
      priority: body.priority,
      category: body.category,
      accountId: body.accountId || body.account_id,
      externalRef: body.externalRef || body.external_ref,
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : undefined,
      actorName,
      apiKeyId,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err && typeof err === "object" && (err as { deflected?: boolean }).deflected) {
      return res.status(409).json({
        deflected: true,
        agent: "dssa",
        reply: String((err as { reply?: string }).reply || (err as Error).message || ""),
        confidence: (err as { confidence?: number }).confidence,
      });
    }
    if (err instanceof TicketingProductError) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code });
    }
    const status = Number((err as { status?: number }).status || 500);
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: (err as Error).message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create intake ticket" });
  }
});

// ---- Webchat integration (org API key) ----
// Create ticket only when customer already exists (email or mobile).
// Fetch tickets by email or mobile for that customer.

async function resolveWebchatOrg(req: import("express").Request): Promise<
  | { ok: true; organizationId: string; actorName: string; apiKeyId?: string }
  | { ok: false; status: number; error: string }
> {
  let organizationId = resolveInternalServiceOrgId(req);
  let actorName = "InternalService";
  let apiKeyId: string | undefined;

  if (!organizationId) {
    const rawKey = extractApiKeyFromRequest(req);
    if (!rawKey) {
      return {
        ok: false,
        status: 401,
        error:
          "Missing API key. Use Authorization: Bearer wt_live_…, X-Api-Key, or X-Internal-Service-Key.",
      };
    }
    const apiKey = await authenticateOrgApiKey(rawKey);
    if (!apiKey) {
      return { ok: false, status: 401, error: "Invalid or revoked API key" };
    }
    organizationId = apiKey.organizationId;
    actorName = `API:${apiKey.keyName}`;
    apiKeyId = apiKey.keyId;
  }

  const body =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : {};
  const bodyOrg = String(body.organizationId || body.organization_id || "").trim();
  if (bodyOrg && bodyOrg !== organizationId) {
    return {
      ok: false,
      status: 403,
      error: "organizationId does not match API key tenant",
    };
  }

  return { ok: true, organizationId, actorName, apiKeyId };
}

/**
 * Public browsable docs for webchat ticket APIs (open in a browser).
 * POST endpoints still require an org API key.
 */
app.get("/api/webchat/tickets/docs", (_req, res) => {
  const host =
    String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "") ||
    "http://192.168.13.42:3000";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Webchat ticket APIs</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      line-height: 1.5; color: #171717; background: #fafafa; }
    main { max-width: 820px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { font-size: 1.75rem; margin: 0 0 0.35rem; }
    h2 { font-size: 1.2rem; margin: 2rem 0 0.75rem; border-top: 1px solid #e5e5e5; padding-top: 1.25rem; }
    p, li { color: #404040; }
    .lead { color: #525252; margin-bottom: 1.25rem; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 1rem 1.1rem; margin: 0.75rem 0; }
    .method { display: inline-block; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em;
      padding: 0.15rem 0.45rem; border-radius: 6px; background: #ecfdf5; color: #047857; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem; }
    code { background: #f5f5f5; padding: 0.1rem 0.35rem; border-radius: 4px; }
    pre { background: #0a0a0a; color: #f5f5f5; padding: 0.9rem 1rem; border-radius: 10px;
      overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
    th { color: #737373; font-weight: 600; font-size: 0.8rem; }
    .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 0.75rem 1rem; }
    a { color: #0369a1; }
  </style>
</head>
<body>
<main>
  <h1>Webchat ticket APIs</h1>
  <p class="lead">Server-to-server JSON APIs for webchat / CCaaS. Open this page in a browser; call the endpoints with <strong>POST</strong> from your backend (not by browsing the create/lookup URLs).</p>

  <div class="note">
    <strong>Auth:</strong> <code>Authorization: Bearer wt_live_…</code> or <code>X-Api-Key: wt_live_…</code><br />
    Create keys in Ticketing → Org preferences → integration keys.<br />
    <strong>Rule:</strong> customer must already exist (match by email or mobile). We do not auto-create customers.
  </div>

  <div class="card">
    <table>
      <tr><th>Base URL</th><td><code>${host}</code></td></tr>
      <tr><th>Content-Type</th><td><code>application/json</code></td></tr>
      <tr><th>Create</th><td><span class="method">POST</span> <code>${host}/api/webchat/tickets</code></td></tr>
      <tr><th>Lookup</th><td><span class="method">POST</span> <code>${host}/api/webchat/tickets/lookup</code></td></tr>
      <tr><th>Verify customer</th><td><span class="method">POST</span> <code>${host}/api/webchat/customers/verify</code></td></tr>
      <tr><th>This docs page</th><td><span class="method" style="background:#eff6ff;color:#1d4ed8">GET</span> <code>${host}/api/webchat/tickets/docs</code></td></tr>
    </table>
  </div>

  <h2>1. Create ticket</h2>
  <p><span class="method">POST</span> <code>/api/webchat/tickets</code></p>
  <p>Body fields: <code>name</code> (required), <code>email</code> <em>or</em> <code>mobile</code>/<code>phone</code> (required), <code>issue</code> (required). Channel is set to <code>Chat</code>.</p>
  <pre>curl -X POST ${host}/api/webchat/tickets \\
  -H "Authorization: Bearer wt_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Riya Sharma",
    "email": "riya@clienta.com",
    "issue": "VPN not connecting since morning"
  }'</pre>
  <p>Success <code>201</code> includes <code>success</code>, <code>ticketId</code>, <code>ticketNumber</code>, <code>status</code>, <code>channel</code>, <code>subject</code>, assignee/resolver fields, timestamps.</p>
  <p>Common errors: <code>400</code> missing fields; <code>404</code> <code>there is no account for this customer</code>; <code>401</code> bad/missing API key.</p>

  <h2>2. Lookup tickets</h2>
  <p><span class="method">POST</span> <code>/api/webchat/tickets/lookup</code></p>
  <p>Body: <code>email</code> <em>or</em> <code>mobile</code>/<code>phone</code>.</p>
  <pre>curl -X POST ${host}/api/webchat/tickets/lookup \\
  -H "Authorization: Bearer wt_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"riya@clienta.com"}'</pre>
  <p>Success <code>200</code> returns <code>customer</code> and a <code>tickets</code> array.</p>

  <h2>3. Verify customer (Ticketing + directory)</h2>
  <p><span class="method">POST</span> <code>/api/webchat/customers/verify</code></p>
  <p>Body: <code>email</code> <em>or</em> <code>mobile</code>/<code>phone</code>. Optional <code>organizationId</code> must match the API key tenant.</p>
  <p>Checks: (1) org has Ticketing in MyAccount, (2) customer exists and is Active for that org.</p>
  <pre>curl -X POST ${host}/api/webchat/customers/verify \\
  -H "Authorization: Bearer wt_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"riya@clienta.com"}'</pre>
  <p>Success <code>200</code>: <code>{"success":true,"organizationId":"…","customer":{…}}</code>. Failure <code>404</code> customer not found; <code>403</code> no Ticketing or inactive customer.</p>

  <h2>How to check</h2>
  <ol>
    <li>Open this docs page in a browser (you are here).</li>
    <li>Confirm the app is up: <a href="/api/health"><code>GET /api/health</code></a>.</li>
    <li>Create an org API key, then run the curl examples above (or Postman) with <strong>POST</strong>.</li>
  </ol>
  <p>Source of truth in the repo: <code>docs/README.md</code> → Webchat integration APIs.</p>
</main>
</body>
</html>`;
  res.type("html").status(200).send(html);
});

/**
 * Webchat → create ticket.
 * Body: { name, email? | mobile?/phone?, issue }
 * Customer must already exist (matched by email or phone).
 */
app.post("/api/webchat/tickets", async (req, res) => {
  try {
    const auth = await resolveWebchatOrg(req);
    if (auth.ok === false) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }

    const body = req.body || {};
    const name = String(body.name || body.customerName || body.customer_name || "").trim();
    const email = String(body.email || body.customerEmail || body.customer_email || "").trim();
    const phone = String(
      body.mobile ||
        body.phone ||
        body.mobileNumber ||
        body.mobile_number ||
        body.customerPhone ||
        body.customer_phone ||
        ""
    ).trim();
    const issue = String(body.issue || body.description || body.subject || "").trim();

    if (!name) {
      return res.status(400).json({ success: false, error: "name is required" });
    }
    if (!email && !phone) {
      return res
        .status(400)
        .json({ success: false, error: "email or mobile number is required" });
    }
    if (!issue) {
      return res.status(400).json({ success: false, error: "issue is required" });
    }

    // Webchat contract: existing customer → always create ticket (no DSSA deflect).
    const result = await createTicketFromIntake({
      organizationId: auth.organizationId,
      channel: "chat",
      requester: { name, email: email || undefined, phone: phone || undefined },
      subject: issue.slice(0, 200),
      description: issue,
      externalRef: body.externalRef || body.external_ref,
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : { source: "webchat" },
      actorName: auth.actorName,
      apiKeyId: auth.apiKeyId,
      skipDssa: true,
    });

    res.status(201).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof TicketingProductError) {
      return res.status(err.status).json({
        success: false,
        error: err.message,
        code: err.code,
      });
    }
    if (err instanceof CustomerDirectoryError || (err as { status?: number }).status === 422) {
      return res.status(404).json({
        success: false,
        error: "there is no account for this customer",
      });
    }
    if (err && typeof err === "object" && (err as { deflected?: boolean }).deflected) {
      return res.status(409).json({
        success: false,
        deflected: true,
        agent: "dssa",
        reply: String((err as { reply?: string }).reply || (err as Error).message || ""),
        confidence: (err as { confidence?: number }).confidence,
      });
    }
    const status = Number((err as { status?: number }).status || 500);
    if (status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        error: (err as Error).message,
      });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to create webchat ticket" });
  }
});

/**
 * Webchat → fetch tickets for a customer by email or mobile.
 * Body: { email? | mobile?/phone? }
 */
app.post("/api/webchat/tickets/lookup", async (req, res) => {
  try {
    const auth = await resolveWebchatOrg(req);
    if (auth.ok === false) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }

    const body = req.body || {};
    const email = String(body.email || body.customerEmail || body.customer_email || "").trim();
    const phone = String(
      body.mobile ||
        body.phone ||
        body.mobileNumber ||
        body.mobile_number ||
        body.customerPhone ||
        body.customer_phone ||
        body.number ||
        ""
    ).trim();

    if (!email && !phone) {
      return res
        .status(400)
        .json({ success: false, error: "email or mobile number is required" });
    }

    const result = await listTicketsByContact({
      organizationId: auth.organizationId,
      email: email || undefined,
      phone: phone || undefined,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof CustomerDirectoryError) {
      return res.status(404).json({
        success: false,
        error: "there is no account for this customer",
      });
    }
    const status = Number((err as { status?: number }).status || 500);
    if (status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        error: (err as Error).message,
      });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch webchat tickets" });
  }
});

/**
 * Webchat → verify org has Ticketing and customer exists (email or mobile).
 * Body: { email? | mobile?/phone?, organizationId? }
 */
app.post("/api/webchat/customers/verify", async (req, res) => {
  try {
    const auth = await resolveWebchatOrg(req);
    if (auth.ok === false) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }

    const body = req.body || {};
    const email = String(body.email || body.customerEmail || body.customer_email || "").trim();
    const phone = String(
      body.mobile ||
        body.phone ||
        body.mobileNumber ||
        body.mobile_number ||
        body.customerPhone ||
        body.customer_phone ||
        body.number ||
        ""
    ).trim();

    if (!email && !phone) {
      return res
        .status(400)
        .json({ success: false, error: "email or mobile number is required" });
    }

    const result = await verifyWebchatCustomer({
      organizationId: auth.organizationId,
      email: email || undefined,
      phone: phone || undefined,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof TicketingProductError) {
      return res.status(err.status).json({
        success: false,
        error: err.message,
        code: err.code,
      });
    }
    if (err instanceof CustomerDirectoryError) {
      const status = err.status === 422 ? 404 : err.status;
      const message =
        err.status === 422
          ? "there is no account for this customer"
          : err.message;
      return res.status(status).json({
        success: false,
        error: message,
        code: err.status === 403 ? "customer_inactive" : "customer_not_found",
      });
    }
    const status = Number((err as { status?: number }).status || 500);
    if (status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        error: (err as Error).message,
      });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to verify webchat customer" });
  }
});

/**
 * MCP / external tool auth bootstrap.
 * API key → organization + a real Active user actor Express can use.
 */
app.get("/api/mcp/session", async (req, res) => {
  try {
    const rawKey = extractApiKeyFromRequest(req);
    if (!rawKey) {
      return res.status(401).json({
        error: "Missing API key. Use Authorization: Bearer wt_live_… or X-Api-Key.",
      });
    }
    const apiKey = await authenticateOrgApiKey(rawKey);
    if (!apiKey) {
      return res.status(401).json({ error: "Invalid or revoked API key" });
    }
    const actor = (await listAssignableAgents(apiKey.organizationId)).find(
      (user) => String(user.role || "").toLowerCase() === "agent"
    );
    if (!actor) {
      return res.status(403).json({
        error:
          "No active agent user available for MCP API-key sessions. " +
          "Create an Active agent in the org (API keys do not run as admin).",
      });
    }
    res.json({
      organizationId: apiKey.organizationId,
      keyId: apiKey.keyId,
      keyName: apiKey.keyName,
      actorId: String(actor.id),
      actorName: String(actor.name || ""),
      actorEmail: String(actor.email || ""),
      actorRole: String(actor.role || "agent"),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to resolve MCP session" });
  }
});

/** Email adapter → same org intake (create or append reply). */
app.post("/api/intake/email", async (req, res) => {
  try {
    const rawKey = extractApiKeyFromRequest(req);
    if (!rawKey) {
      return res.status(401).json({
        error: "Missing API key. Use Authorization: Bearer wt_live_… or X-Api-Key.",
      });
    }
    const apiKey = await authenticateOrgApiKey(rawKey);
    if (!apiKey) {
      return res.status(401).json({ error: "Invalid or revoked API key" });
    }

    const result = await processInboundEmail({
      organizationId: apiKey.organizationId,
      body: (req.body || {}) as Record<string, unknown>,
      actorName: `Email:${apiKey.keyName}`,
      apiKeyId: apiKey.keyId,
    });

    res.status(result.action === "created" ? 201 : 200).json(result); // deflected|appended → 200
  } catch (err) {
    const status = Number((err as { status?: number }).status || 500);
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: (err as Error).message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to process inbound email" });
  }
});

// ---- Integration API keys (admin) ----

app.get(
  "/api/integration/keys",
  requireAuthOrServiceActor,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const keys = await listOrgApiKeys(req.user!.organizationId);
      res.json({ keys });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list API keys" });
    }
  }
);

app.post(
  "/api/integration/keys",
  requireAuth,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const name = String(req.body?.name || "Integration key").trim();
      const created = await createOrgApiKey({
        organizationId: req.user!.organizationId,
        name,
        createdById: req.user!.id,
        createdByName: req.user!.name,
      });
      await writeAuditEvent({
        organizationId: req.user!.organizationId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "integration.api_key_created",
        meta: { keyId: created.key.id, name: created.key.name },
      });
      res.status(201).json({
        key: created.key,
        secret: created.secret,
        warning: "Copy the secret now — it will not be shown again.",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create API key" });
    }
  }
);

app.delete(
  "/api/integration/keys/:id",
  requireAuth,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const ok = await revokeOrgApiKey(
        req.user!.organizationId,
        String(req.params.id)
      );
      if (!ok) {
        return res.status(404).json({ error: "API key not found or already revoked" });
      }
      await writeAuditEvent({
        organizationId: req.user!.organizationId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "integration.api_key_revoked",
        meta: { keyId: String(req.params.id) },
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  }
);

// ---- Help widgets (admin + public) ----

const EMBED_DIR = path.join(moduleDir, "public", "embed");
app.use(
  "/embed",
  express.static(EMBED_DIR, { index: false, dotfiles: "deny", fallthrough: false })
);

const DEV_DIR = path.join(moduleDir, "public", "dev");
app.use(
  "/dev",
  express.static(DEV_DIR, { index: false, dotfiles: "deny", fallthrough: false })
);

const HELP_DIR = path.join(moduleDir, "public", "help");
app.use(
  "/hc-assets",
  express.static(HELP_DIR, { index: false, dotfiles: "deny", fallthrough: false })
);

function sendHelpCenterPage(_req: Request, res: Response) {
  res.sendFile(path.join(HELP_DIR, "index.html"));
}

app.get("/hc/:slug", sendHelpCenterPage);
app.get("/hc/:slug/a/:articleId", sendHelpCenterPage);

app.get("/api/public/help/:slug", async (req, res) => {
  try {
    const org = await resolveHelpOrgBySlug(String(req.params.slug));
    if (!org) return res.status(404).json({ error: "Help center not found" });
    const categories = await listHelpCategories(org.id);
    res.json({
      slug: org.slug,
      title: org.portalLabel || org.name || "Help Center",
      organizationName: org.name,
      categories,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load help center" });
  }
});

app.get("/api/public/help/:slug/articles", async (req, res) => {
  try {
    const org = await resolveHelpOrgBySlug(String(req.params.slug));
    if (!org) return res.status(404).json({ error: "Help center not found" });
    const articles = await listPublishedHelpArticles({
      organizationId: org.id,
      q: String(req.query.q || ""),
      category: String(req.query.category || ""),
    });
    res.json({ articles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list articles" });
  }
});

app.get("/api/public/help/:slug/articles/:articleId", async (req, res) => {
  try {
    const org = await resolveHelpOrgBySlug(String(req.params.slug));
    if (!org) return res.status(404).json({ error: "Help center not found" });
    const article = await getPublishedHelpArticle({
      organizationId: org.id,
      articleId: decodeURIComponent(String(req.params.articleId)),
    });
    if (!article) return res.status(404).json({ error: "Article not found" });
    res.json(article);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load article" });
  }
});

function applyWidgetCors(
  req: Request,
  res: Response,
  widget: { allowedOrigins: string[]; enabled: boolean }
): boolean {
  if (!widget.enabled) {
    res.status(403).json({ error: "Widget disabled" });
    return false;
  }
  const origin = String(req.headers.origin || "").trim().replace(/\/$/, "");
  if (!originAllowed(widget, origin || undefined)) {
    res.status(403).json({ error: "Origin not allowed for this widget" });
    return false;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!widget.allowedOrigins.length) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

app.options("/api/public/widgets/:publicId", async (req, res) => {
  const widget = await getWidgetByPublicId(String(req.params.publicId));
  if (!widget || !applyWidgetCors(req, res, widget)) {
    if (!res.headersSent) res.status(404).end();
    return;
  }
  res.status(204).end();
});

app.options("/api/public/widgets/:publicId/tickets", async (req, res) => {
  const widget = await getWidgetByPublicId(String(req.params.publicId));
  if (!widget || !applyWidgetCors(req, res, widget)) {
    if (!res.headersSent) res.status(404).end();
    return;
  }
  res.status(204).end();
});

app.get("/api/public/widgets/:publicId", async (req, res) => {
  try {
    const widget = await getWidgetByPublicId(String(req.params.publicId));
    if (!widget) return res.status(404).json({ error: "Widget not found" });
    if (!applyWidgetCors(req, res, widget)) return;
    res.json({
      publicId: widget.publicId,
      name: widget.name,
      buttonLabel: widget.buttonLabel,
      enabled: widget.enabled,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load widget" });
  }
});

app.post("/api/public/widgets/:publicId/tickets", async (req, res) => {
  try {
    const widget = await getWidgetByPublicId(String(req.params.publicId));
    if (!widget) return res.status(404).json({ error: "Widget not found" });
    if (!applyWidgetCors(req, res, widget)) return;

    const origin = String(req.headers.origin || "").trim();
    if (
      widget.allowedOrigins.length &&
      origin &&
      !originAllowed(widget, origin)
    ) {
      return res.status(403).json({ error: "Origin not allowed for this widget" });
    }

    const body = req.body || {};
    const requester = body.requester || {};
    const result = await createTicketFromIntake({
      organizationId: widget.organizationId,
      channel: "web_form",
      requester: {
        name: requester.name || body.name,
        email: requester.email || body.email,
        phone: requester.phone || body.phone,
      },
      subject: body.subject,
      description: body.description,
      priority: body.priority,
      externalRef: body.externalRef,
      metadata: {
        ...(body.metadata && typeof body.metadata === "object"
          ? body.metadata
          : {}),
        widgetPublicId: widget.publicId,
        widgetName: widget.name,
      },
      actorName: `Widget:${widget.name}`,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err && typeof err === "object" && (err as { deflected?: boolean }).deflected) {
      return res.status(409).json({
        deflected: true,
        agent: "dssa",
        reply: String((err as { reply?: string }).reply || (err as Error).message || ""),
        confidence: (err as { confidence?: number }).confidence,
      });
    }
    if (err instanceof TicketingProductError) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code });
    }
    const status = Number((err as { status?: number }).status || 500);
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: (err as Error).message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create ticket from widget" });
  }
});

app.get(
  "/api/integration/widgets",
  requireAuthOrServiceActor,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const widgets = await listOrgWidgets(req.user!.organizationId);
      res.json({ widgets });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list widgets" });
    }
  }
);

app.post(
  "/api/integration/widgets",
  requireAuthOrServiceActor,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const originsRaw = body.allowedOrigins ?? body.allowed_origins ?? [];
      const origins = Array.isArray(originsRaw)
        ? originsRaw.map(String)
        : String(originsRaw || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      const widget = await createOrgWidget({
        organizationId: req.user!.organizationId,
        name: String(body.name || "Help widget"),
        allowedOrigins: origins,
        buttonLabel: body.buttonLabel || body.button_label,
        createdById: req.user!.id,
        createdByName: req.user!.name,
      });
      await writeAuditEvent({
        organizationId: req.user!.organizationId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "integration.widget_created",
        meta: { widgetId: widget.id, publicId: widget.publicId },
      });
      const host = `${req.protocol}://${req.get("host")}`;
      res.status(201).json({
        widget,
        embedSnippet: `<script src="${host}/embed/worktual-help.js" data-widget-id="${widget.publicId}" async></script>`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create widget" });
    }
  }
);

app.patch(
  "/api/integration/widgets/:id",
  requireAuth,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      let origins: string[] | undefined;
      if (body.allowedOrigins !== undefined || body.allowed_origins !== undefined) {
        const raw = body.allowedOrigins ?? body.allowed_origins;
        origins = Array.isArray(raw)
          ? raw.map(String)
          : String(raw || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
      }
      const widget = await updateOrgWidget({
        organizationId: req.user!.organizationId,
        widgetId: String(req.params.id),
        name: body.name,
        buttonLabel: body.buttonLabel || body.button_label,
        enabled: body.enabled,
        allowedOrigins: origins,
      });
      if (!widget) return res.status(404).json({ error: "Widget not found" });
      res.json({ widget });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update widget" });
    }
  }
);

// ---- Automation rules (admin) ----

app.get(
  "/api/automation/rules",
  requireAuth,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const rules = await listAutomationRules(req.user!.organizationId);
      res.json({ rules });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list automation rules" });
    }
  }
);

app.post(
  "/api/automation/rules",
  requireAuth,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const event: AutomationEvent =
        String(body.event || "") === "ticket.updated"
          ? "ticket.updated"
          : "ticket.created";
      const rule = await createAutomationRule({
        organizationId: req.user!.organizationId,
        name: String(body.name || "Untitled rule"),
        event,
        conditions: body.conditions || {},
        actions: body.actions || {},
        priority: body.priority,
        enabled: body.enabled,
        createdById: req.user!.id,
        createdByName: req.user!.name,
      });
      await writeAuditEvent({
        organizationId: req.user!.organizationId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "automation.rule_created",
        meta: { ruleId: rule.id, name: rule.name, event: rule.event },
      });
      res.status(201).json({ rule });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create automation rule" });
    }
  }
);

app.patch(
  "/api/automation/rules/:id",
  requireAuth,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const rule = await updateAutomationRule({
        organizationId: req.user!.organizationId,
        ruleId: String(req.params.id),
        name: body.name,
        event: body.event,
        conditions: body.conditions,
        actions: body.actions,
        priority: body.priority,
        enabled: body.enabled,
      });
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      res.json({ rule });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update automation rule" });
    }
  }
);

app.delete(
  "/api/automation/rules/:id",
  requireAuth,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const ok = await deleteAutomationRule(
        req.user!.organizationId,
        String(req.params.id)
      );
      if (!ok) return res.status(404).json({ error: "Rule not found" });
      await writeAuditEvent({
        organizationId: req.user!.organizationId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "automation.rule_deleted",
        meta: { ruleId: String(req.params.id) },
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete automation rule" });
    }
  }
);

// ---- Tickets ----

app.get("/api/tickets", requireAuthOrServiceActor, async (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    let filters: TicketListFilters;
    try {
      filters = parseTicketListFilters(req.query);
    } catch (e) {
      if (Number((e as { status?: number }).status) === 400) {
        return res.status(400).json({ error: (e as Error).message });
      }
      throw e;
    }
    if (
      filters.createdBySelf &&
      req.user!.role !== "admin" &&
      req.user!.role !== "agent"
    ) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (
      (filters.assignedToSelf || filters.assignedToName) &&
      !["admin", "agent", "resolver"].includes(req.user!.role)
    ) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const listScope =
      typeof req.query.scope === "string" ? req.query.scope : "default";
    if (
      !["default", "assignee", "team", "org", "search", "created", "unassigned"].includes(
        listScope.toLowerCase()
      )
    ) {
      return res.status(400).json({ error: "Unsupported ticket scope" });
    }
    let scope: { sql: string; params: unknown[] };
    try {
      scope = await ticketListScopeClause(req.user!, listScope);
    } catch (e) {
      const status = Number((e as { status?: number }).status || 500);
      if (status === 403) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      throw e;
    }
    const filter = ticketFilterClause(
      req.user!,
      filters,
      2 + scope.params.length
    );
    const params = [orgId, ...scope.params, ...filter.params, filters.limit];
    const limitParam = `$${params.length}`;
    const orderBy =
      filters.sort === "oldest"
        ? "ORDER BY created_at ASC"
        : filters.sort === "due"
          ? "ORDER BY due_at ASC NULLS LAST, created_at DESC"
          : filters.sort === "priority"
            ? `ORDER BY CASE lower(priority)
                 WHEN 'urgent' THEN 1
                 WHEN 'critical' THEN 1
                 WHEN 'high' THEN 2
                 WHEN 'medium' THEN 3
                 WHEN 'low' THEN 4
                 ELSE 5 END,
               created_at DESC`
            : "ORDER BY created_at DESC";
    const { rows } = await query(
      `SELECT * FROM tickets
       WHERE organization_id = $1
       ${scope.sql}
       ${filter.sql}
       ${orderBy}
       LIMIT ${limitParam}`,
      params
    );
    const hydrated = await hydrateTicketIdentityNames(orgId, rows);
    res.json(hydrated.map((r) => mapTicket(r)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load tickets" });
  }
});

/** Team members + skills for reassign / escalate pickers */
app.get(
  "/api/roster",
  requireAuth,
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const teamFilter = String(req.query.team || "").trim();
      const skillFilter = String(req.query.skill || "").trim().toLowerCase();

      let members = await filterRosterForActor({
        orgId,
        actorId: req.user!.id,
        actorRole: req.user!.role,
        teamFilter: teamFilter || undefined,
      });

      if (skillFilter) {
        members = members.filter((m) =>
          m.skills.some((s) => s.toLowerCase().includes(skillFilter))
        );
      }

      res.json(
        members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          role: m.role,
          skills: m.skills,
        }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load roster" });
    }
  }
);

app.post(
  "/api/coworker/guided-reply",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const fallback = String(body.fallback || "").trim();
      if (!fallback) {
        return res.status(400).json({ error: "fallback is required." });
      }
      const module = String(body.module || "ticket") as
        | "ticket"
        | "team"
        | "greeting"
        | "nav";
      const reply = await guidedChatReply({
        module:
          module === "team" ||
          module === "greeting" ||
          module === "ticket" ||
          module === "nav"
            ? module
            : "ticket",
        kind: String(body.kind || "start"),
        userText: body.userText,
        pageLabel: body.pageLabel,
        context: body.context && typeof body.context === "object" ? body.context : {},
        validationHint: body.validationHint,
        fallback,
      });
      res.json({ reply, source: "llm" });
    } catch (err) {
      console.error("guided-reply failed", err);
      res.status(503).json({
        error: "Co-worker LLM unavailable. Start ai-agents on :8012.",
      });
    }
  }
);

app.post(
  "/api/coworker/ui-actions",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const message = String(req.body?.message || "").trim();
      const page = req.body?.page ? String(req.body.page) : undefined;
      if (!message) {
        return res.status(400).json({ error: "message is required" });
      }
      const started = Date.now();
      const upstream = await fetch(`${COWORKER_AGENTS_URL}/ui-actions`, {
        method: "POST",
        headers: coworkerAgentsHeaders(),
        body: JSON.stringify({ message, page }),
      });
      const text = await upstream.text();
      let data: { reply_hint?: string; actions?: unknown; detail?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { detail: text.slice(0, 200) };
      }
      recordLlmHit({
        source: "ui-actions",
        model: "coworker-agents",
        ok: upstream.ok,
        ms: Date.now() - started,
        status: upstream.status,
        userPreview: message.slice(0, 160),
        replyPreview: JSON.stringify(data.actions || []).slice(0, 160),
        error: upstream.ok
          ? undefined
          : String(data.detail || upstream.statusText).slice(0, 200),
        meta: { page: page || "" },
      });
      if (!upstream.ok) {
        return res.status(502).json({
          error: "UI actions service error",
          detail: data.detail || upstream.statusText,
        });
      }
      res.json({
        reply_hint: data.reply_hint || "",
        actions: Array.isArray(data.actions) ? data.actions : [],
      });
    } catch (err) {
      console.error("ui-actions proxy failed", err);
      res.status(502).json({
        error: "UI actions unavailable",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

app.post(
  "/api/coworker/ticket-reason",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const userText = String(body.userText || "").trim();
      const stepId = String(body.stepId || "").trim();
      if (!userText || !stepId) {
        return res.status(400).json({ error: "userText and stepId are required." });
      }
      const reasoned = await guidedTicketReasonTurn({
        userText,
        stepId,
        customerName: body.customerName ? String(body.customerName) : undefined,
        customerEmail: body.customerEmail ? String(body.customerEmail) : undefined,
        customerPhone: body.customerPhone ? String(body.customerPhone) : undefined,
        issue: body.issue ? String(body.issue) : undefined,
        subject: body.subject ? String(body.subject) : undefined,
        fallbackReply: String(body.fallbackReply || "Let's continue."),
      });
      if (!reasoned) {
        return res.status(502).json({ error: "reason_unavailable" });
      }
      res.json(reasoned);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "reason_failed" });
    }
  }
);

app.post(
  "/api/tickets/chat-reply",
  requireAuth,
  canCreateTicket,
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const fallback = String(body.fallback || "").trim();
      if (!fallback) {
        return res.status(400).json({ error: "fallback is required." });
      }
      const reply = await guidedChatReply({
        module: "ticket",
        kind: String(body.kind || "start"),
        userText: body.userText,
        pageLabel: "Create Ticket",
        context: {
          customerName: body.customerName,
          contact: body.contact,
          subject: body.subject,
          priority: body.priority,
          assignee: body.assignee,
          queue: body.queue,
          rationale: body.rationale,
        },
        validationHint: body.validationHint,
        fallback,
      });
      res.json({ reply, source: "llm" });
    } catch (err) {
      console.error(err);
      // Never paint the Intent seed — callers must surface a service error.
      res.status(503).json({
        error: "Co-worker LLM unavailable. Start ai-agents on :8012.",
      });
    }
  }
);

app.post(
  "/api/tickets/enrich",
  requireAuthOrServiceActor,
  canCreateTicket,
  async (req: AuthedRequest, res) => {
    try {
      const { customerName, customerEmail, customerPhone, issue } =
        req.body || {};
      const name = String(customerName || "").trim();
      const email = String(customerEmail || "").trim();
      const phone = String(customerPhone || "").trim();
      const issueText = String(issue || "").trim();
      if (!name || !issueText) {
        return res.status(400).json({
          error: "customerName and issue are required.",
        });
      }
      if (!email && !phone) {
        return res.status(400).json({
          error: "Provide customerEmail or customerPhone.",
        });
      }

      const role = req.user!.role;
      const createdByRole =
        role === "agent" || role === "admin" ? role : "customer";
      const enrichMode = String(
        req.headers["x-ticket-enrich-mode"] || ""
      )
        .trim()
        .toLowerCase();
      const fromAgent =
        enrichMode === "preview"
          ? null
          : await triageAssignViaAgents({
        organizationId: req.user!.organizationId,
        customerName: name,
        customerEmail: email || undefined,
        customerPhone: phone || undefined,
        issue: issueText,
              createdByRole,
              forceAssigneeId: role === "agent" ? req.user!.id : undefined,
              forceAssigneeName: role === "agent" ? req.user!.name : undefined,
      });
      const enriched =
        fromAgent ||
        (await enrichTicketDraft({
          customerName: name,
          customerEmail: email || undefined,
          customerPhone: phone || undefined,
          issue: issueText,
          organizationId: req.user!.organizationId,
        }));

      // Agent enrich preview: L1 is always the creating agent.
      if (role === "agent") {
        enriched.assignee = req.user!.name;
        enriched.assignee_id = req.user!.id;
      }

      res.json({
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        ...enriched,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to enrich ticket draft" });
    }
  }
);

app.post(
  "/api/tickets",
  requireAuthOrServiceActor,
  canCreateTicket,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const idempotencyKey = String(
        req.headers["x-idempotency-key"] || req.body?.idempotencyKey || ""
      ).trim();
      if (idempotencyKey) {
        const existingIdempotent = await query(
          `SELECT * FROM tickets
           WHERE organization_id = $1 AND idempotency_key = $2
           LIMIT 1`,
          [orgId, idempotencyKey]
        );
        if (existingIdempotent.rows[0]) {
          return res.status(200).json(mapTicket(existingIdempotent.rows[0]));
        }
      }
      const {
        subject,
        description,
        customerName,
        customerEmail,
        customerPhone,
        channel,
        priority,
        status,
        queue,
        assignee,
        assigneeId: bodyAssigneeId,
        resolver: bodyResolver,
        resolverId: bodyResolverId,
        category: bodyCategory,
        skill: bodySkill,
        attachments,
      } = req.body || {};

      const bodyCustomerId = String(req.body?.customerId || "").trim();
      const name = String(customerName || "").trim();
      const emailRaw = String(customerEmail || "").trim();
      const phone = String(customerPhone || "").trim();
      let directoryCustomer;
      try {
        directoryCustomer = await requireExistingCustomer({
          organizationId: orgId,
          customerId: bodyCustomerId || undefined,
          email: emailRaw || undefined,
          phone: phone || undefined,
        });
      } catch (err) {
        if (err instanceof CustomerDirectoryError) {
          return res.status(err.status).json({ error: err.message });
        }
        if (err instanceof TicketingProductError) {
          return res
            .status(err.status)
            .json({ error: err.message, code: err.code });
        }
        throw err;
      }
      const resolvedEmail =
        directoryCustomer.email ||
        emailRaw ||
        `phone+${(directoryCustomer.phone || phone).replace(/[^\d+]/g, "") || "unknown"}@placeholder.local`;
      const resolvedName = directoryCustomer.name || name;
      const resolvedPhone = directoryCustomer.phone || phone || "";

      let subjectVal = String(subject || "").trim();
      let descriptionVal = String(description || "").trim();
      // Only admins may set an explicit create status; everyone else starts Open.
      let createStatus =
        req.user!.role === "admin" && status
          ? String(status)
          : "Open";
      if (!(await isActiveOrgStatus(orgId, createStatus))) {
        createStatus = (await isActiveOrgStatus(orgId, "Open"))
          ? "Open"
          : ((await listOrgTicketStatuses(orgId)).find((s) => !s.isTerminal)
              ?.status ?? "Open");
      } else {
        createStatus =
          (await resolveOrgStatusKey(orgId, createStatus)) || createStatus;
      }
      let prio = String(priority || "medium").trim() || "medium";
      if (!(await isActiveOrgPriority(orgId, prio))) {
        prio = "medium";
      }
      let queueName = String(queue || "").trim();
      let assigneeName =
        assignee && String(assignee) !== "Unassigned"
            ? String(assignee)
            : "Unassigned";
      let assigneeId: string | null = bodyAssigneeId
          ? String(bodyAssigneeId)
          : null;
      let resolverName: string | null = bodyResolver
        ? String(bodyResolver).trim() || null
        : null;
      let resolverId: string | null = bodyResolverId
        ? String(bodyResolverId)
        : null;
      let categoryVal = bodyCategory ? String(bodyCategory).trim() : "";
      let skillVal = bodySkill ? String(bodySkill).trim() : "";
      let channelVal = normalizeTicketChannel(channel || "Web");

      const creatorRole = req.user!.role;
      const coworkerServiceCall = Boolean(
        String(req.headers["x-coworker-tasks-key"] || "").trim()
      );

      // Customer self-create only: force requester identity from the authenticated user.
      if (creatorRole === "customer") {
        const selfEmail = String(req.user!.email || "").trim().toLowerCase();
        const selfName = String(req.user!.name || "").trim();
        if (
          directoryCustomer.email &&
          selfEmail &&
          String(directoryCustomer.email).trim().toLowerCase() !== selfEmail
        ) {
          return res.status(403).json({
            error: "Customers can only create tickets for themselves.",
          });
        }
        if (!directoryCustomer.email && selfEmail) {
          try {
            directoryCustomer = await requireExistingCustomer({
              organizationId: orgId,
              email: selfEmail,
            });
          } catch (err) {
            if (err instanceof CustomerDirectoryError) {
              return res.status(err.status).json({ error: err.message });
            }
            if (err instanceof TicketingProductError) {
              return res
                .status(err.status)
                .json({ error: err.message, code: err.code });
            }
            throw err;
          }
        }
        if (!String(directoryCustomer.name || "").trim() && selfName) {
          (directoryCustomer as { name?: string }).name = selfName;
        }
      }

      // Agent-created: L1 is always the creating agent (no agent auto-assign).
      if (creatorRole === "agent") {
        assigneeName = req.user!.name;
        assigneeId = req.user!.id;
      }

      // Coworker chat: lean INSERT (raw issue). Subject/description polish,
      // priority/category/queue, and L1/L2 run post-insert via triage Domain.
      // Skipping pre-insert triage also avoids deadlock while agents await this POST.
      const leanCoworkerCreate = coworkerServiceCall;
      let triageCompleteOnCreate = true;
      if (leanCoworkerCreate) {
        triageCompleteOnCreate = false;
        const issueText =
          descriptionVal ||
          subjectVal ||
          `Support request for ${resolvedName}`;
        descriptionVal = descriptionVal || issueText;
        if (!subjectVal) {
          subjectVal =
            issueText.length <= 80
              ? issueText
              : `${issueText.slice(0, 77).replace(/\s+\S*$/, "").trimEnd()}…`;
          if (!subjectVal || subjectVal === "…") {
            subjectVal = issueText.slice(0, 80);
          }
        }
        // Drop pre-file enrich leftovers — Domain classify/assign own these.
        if (!priority) prio = "medium";
        queueName = "";
        categoryVal = "";
        skillVal = "";
        resolverName = null;
        resolverId = null;
        if (creatorRole !== "agent") {
          assigneeName = "Unassigned";
          assigneeId = null;
        }
      } else {
        // UI / non-coworker create: triage when fields are incomplete.
      const needsTriage =
        !subjectVal ||
        assigneeName === "Unassigned" ||
          !queueName ||
          !resolverName ||
          creatorRole === "agent" ||
          creatorRole === "admin";
      if (needsTriage) {
        const issueText =
          descriptionVal ||
          subjectVal ||
            `Support request for ${resolvedName}`;
          const createdByRole =
            creatorRole === "agent" || creatorRole === "admin"
              ? creatorRole
              : "customer";
        const fromAgent = await triageAssignViaAgents({
          organizationId: orgId,
            customerName: resolvedName,
            customerEmail: directoryCustomer.email || emailRaw || undefined,
            customerPhone: directoryCustomer.phone || phone || undefined,
          issue: issueText,
            createdByRole,
            forceAssigneeId:
              creatorRole === "agent" ? req.user!.id : undefined,
            forceAssigneeName:
              creatorRole === "agent" ? req.user!.name : undefined,
        });
        const triage =
          fromAgent ||
          (await enrichTicketDraft({
              customerName: resolvedName,
              customerEmail: directoryCustomer.email || emailRaw || undefined,
              customerPhone: directoryCustomer.phone || phone || undefined,
            issue: issueText,
            organizationId: orgId,
          }));
        if (!subjectVal) subjectVal = triage.subject;
        if (!descriptionVal) descriptionVal = triage.description;
        if (!priority) prio = triage.priority;
        if (!queueName) queueName = String(triage.queue || "").trim();
          if (creatorRole === "agent") {
            assigneeName = req.user!.name;
            assigneeId = req.user!.id;
          } else if (assigneeName === "Unassigned") {
          assigneeName = triage.assignee;
          if ("assignee_id" in triage && triage.assignee_id) {
            assigneeId = String(triage.assignee_id);
          }
        }
          if (!resolverName && "resolver" in triage && triage.resolver) {
            resolverName = String(triage.resolver);
          }
          if (!resolverId && "resolver_id" in triage && triage.resolver_id) {
            resolverId = String(triage.resolver_id);
          }
          if (!categoryVal && triage.category) {
            categoryVal = String(triage.category);
          }
        if (!skillVal && triage.skill) skillVal = String(triage.skill);
          if (!channel) {
            channelVal = normalizeTicketChannel(triage.channel || "Web");
          }
        }
      }

      if (!subjectVal) {
        return res.status(400).json({
          error: "Subject is required.",
        });
      }

      const dueAt = await computeDueAt(orgId, prio);

      // Teams are owned by Ticketing (agent_queues). Resolve UUID by name/id.
      let queueId: string | null = null;
      if (queueName) {
        const team = await resolveTicketingTeam(orgId, queueName);
        if (team) {
          queueId = team.id;
          queueName = team.name;
          } else {
            // Never invent a team/queue name
            queueName = "";
            queueId = null;
        }
      }

      if (assigneeName !== "Unassigned") {
        const assigneeUser =
          (assigneeId
            ? await findLiveStaff(orgId, { id: assigneeId })
            : null) || (await findLiveStaff(orgId, { name: assigneeName }));
        assigneeId = assigneeUser?.id || null;
        if (assigneeUser) assigneeName = assigneeUser.name;
          } else {
            assigneeId = null;
          }

      if (resolverName) {
        const resolverUser =
          (resolverId
            ? await findLiveStaff(orgId, { id: resolverId })
            : null) || (await findLiveStaff(orgId, { name: resolverName }));
        resolverId = resolverUser?.id || null;
        resolverName = resolverUser?.name || null;
      } else {
        resolverId = null;
        resolverName = null;
      }

      // Assignment drives status unless admin explicitly set one on create.
      const adminForcedStatus = req.user!.role === "admin" && Boolean(status);
      if (!adminForcedStatus) {
        createStatus = statusFromAssignment({
          assigneeId,
          assigneeName,
          resolverId,
        });
      }

      const customerId = directoryCustomer.id;

      // Allocate ticket_number with retries — per-org unique index can race
      // when nextTicketNumber commits before INSERT.
      let ticketNumber = "";
      let insert: { rows: Record<string, unknown>[] } | null = null;
      let lastInsertErr: unknown = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        ticketNumber = await nextTicketNumber(orgId);
        try {
          insert = await query(
            `INSERT INTO tickets (
               organization_id, ticket_number, subject, description,
               customer_id, customer_name, customer_email, customer_phone,
               channel, assignee_id, assignee_name, resolver_id, resolver_name,
               queue_id, queue_name, priority, status,
               attachments, due_at, category, skill, created_by_id, created_by_name,
               idempotency_key
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
             ) RETURNING *`,
            [
              orgId,
              ticketNumber,
              subjectVal,
              descriptionVal || "No description provided.",
              customerId,
              resolvedName,
              resolvedEmail,
              resolvedPhone,
              channelVal || "Web",
              assigneeId,
              assigneeName,
              resolverId,
              resolverName,
              queueId,
              queueName,
              prio,
              createStatus,
              Array.isArray(attachments) ? attachments : [],
              dueAt,
              categoryVal || null,
              skillVal || null,
              req.user!.id,
              req.user!.name,
              idempotencyKey || null,
            ]
          );
          lastInsertErr = null;
          break;
        } catch (err) {
          lastInsertErr = err;
          const code = (err as { code?: string }).code;
          if (code === "23505") {
            if (idempotencyKey) {
              const duplicate = await query(
                `SELECT * FROM tickets
                 WHERE organization_id = $1 AND idempotency_key = $2
                 LIMIT 1`,
                [orgId, idempotencyKey]
              );
              if (duplicate.rows[0]) {
                return res.status(200).json(mapTicket(duplicate.rows[0]));
              }
            }
            continue;
          }
          throw err;
        }
      }
      if (!insert?.rows[0]) {
        throw lastInsertErr || new Error("Failed to allocate unique ticket number");
      }

      await logActivity(
        orgId,
        `New Ticket ${ticketNumber} created by ${resolvedName}`,
        String(insert.rows[0].id)
      );
      if (triageCompleteOnCreate) {
      await logActivity(
        orgId,
        `Ticket ${ticketNumber} triage: queue=${queueName}, assignee=${assigneeName}, priority=${prio}` +
          (categoryVal || skillVal
            ? `, category=${categoryVal || "—"}, skill=${skillVal || "—"}`
            : ""),
        String(insert.rows[0].id)
      );
      } else {
        await logActivity(
          orgId,
          `Ticket ${ticketNumber} lean create — post-insert triage pending`,
          String(insert.rows[0].id)
        );
      }
      const created = insert.rows[0];
      await incrementCustomerTickets(customerId);
      const actorId = req.user!.id;
      await writeAuditEvent({
        organizationId: orgId,
        actorId,
        actorName: req.user!.name,
        action: "ticket.created",
        ticketId: String(created.id),
        ticketNumber,
        meta: {
          subject: subjectVal,
          assignee: assigneeName,
          queue: queueName,
          harness: CANONICAL_INTAKE_TASK,
          idempotencyKey: idempotencyKey || null,
        },
      });

      const runCreatedSideEffects = async () => {
        try {
          await runSlaSweep(orgId);
          await refreshDashboardMetrics(orgId);
          await runTicketCreatedNotifyAndMail({
            organizationId: orgId,
            ticketId: String(created.id),
            ticketNumber,
            subject: subjectVal,
            customerName: resolvedName,
            customerEmail: resolvedEmail,
            assigneeId,
            assigneeName,
            resolverId,
            resolverName,
          excludeUserId: actorId,
        });
          await runAutomations({
            organizationId: orgId,
            event: "ticket.created",
            ticketId: String(created.id),
            ticketNumber,
          }).catch((e) =>
            console.warn("automation (created) failed:", (e as Error).message)
          );
        } catch (e) {
          console.warn(
            "ticket created side effects failed:",
            (e as Error).message
          );
        }
        const pnaPayload = await buildPnaNotifyPayload({
          organizationId: orgId,
          eventType: "ticket.created",
          assigneeId:
            assigneeId && assigneeName !== "Unassigned"
              ? String(assigneeId)
              : null,
          resolverId: resolverId ? String(resolverId) : null,
          actorId: req.user!.id,
          subject: subjectVal,
          customerName: resolvedName,
          ticketNumber,
        });
        // RKAA/STDA/ICPA need subject+description even if get_ticket later fails.
        void emitProactiveEvent({
          organizationId: orgId,
          eventType: "ticket.created",
          ticketId: String(created.id),
          ticketNumber,
          actor: req.user!.id,
          payload: {
            ...pnaPayload,
            ticket_number: ticketNumber,
            subject: subjectVal,
            description: descriptionVal || subjectVal || "",
            priority: prio,
            category: categoryVal || null,
            queue: queueName || null,
            assignee: assigneeName || null,
            triage_complete: triageCompleteOnCreate,
            harness_triage_complete: triageCompleteOnCreate,
            created_by_role: creatorRole,
            domain_triage_owned: !triageCompleteOnCreate,
            harness: CANONICAL_INTAKE_TASK,
          },
        });
      };

      // Coworker chat holds the agents worker while httpx waits on this POST.
      // SLA / SMTP / automations must not block the 201 or the turn times out
      // and the assistant re-asks fields that are already in the draft.
      if (coworkerServiceCall) {
      res.status(201).json(mapTicket(created));
        void runCreatedSideEffects();
        return;
      }

      await runCreatedSideEffects();
      const afterAuto = await query(`SELECT * FROM tickets WHERE id = $1`, [
        created.id,
      ]);
      res.status(201).json(mapTicket(afterAuto.rows[0] || created));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create ticket" });
    }
  }
);

app.get(
  "/api/tickets/:id",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const ticketNumber = decodeURIComponent(req.params.id);
    const existing = await query(
      `SELECT * FROM tickets WHERE organization_id = $1 AND ticket_number = $2`,
      [orgId, ticketNumber]
    );
    if (!existing.rows[0]) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    if (!(await userMayAccessTicket(req.user!, existing.rows[0]))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const [hydrated] = await hydrateTicketIdentityNames(orgId, [
      existing.rows[0],
    ]);
    res.json(mapTicket(hydrated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load ticket" });
  }
});

app.post(
  "/api/tickets/:id/auto-assign",
  requireAuthOrServiceActor,
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const ticketNumber = decodeURIComponent(req.params.id);
      const existing = await query(
        `SELECT * FROM tickets WHERE organization_id = $1 AND ticket_number = $2`,
        [orgId, ticketNumber]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      const old = existing.rows[0];
      if (!(await userMayAccessTicket(req.user!, old))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const issueText =
        String(old.description || "").trim() ||
        String(old.subject || "").trim() ||
        `Support request for ${old.customer_name || "customer"}`;
      const fromAgent = await triageAssignViaAgents({
        organizationId: orgId,
        customerName: String(old.customer_name || ""),
        customerEmail: old.customer_email ? String(old.customer_email) : undefined,
        customerPhone: old.customer_phone ? String(old.customer_phone) : undefined,
        issue: issueText,
        createdByRole:
          req.user!.role === "agent" || req.user!.role === "admin"
            ? req.user!.role
            : "customer",
      });
      const triage =
        fromAgent ||
        (await enrichTicketDraft({
          customerName: String(old.customer_name || ""),
          customerEmail: old.customer_email ? String(old.customer_email) : undefined,
          customerPhone: old.customer_phone ? String(old.customer_phone) : undefined,
          issue: issueText,
          organizationId: orgId,
        }));
      let assigneeName = String(triage.assignee || "").trim();
      let assigneeId =
        "assignee_id" in triage && triage.assignee_id
          ? String(triage.assignee_id)
          : null;
      let queueName = String(triage.queue || old.queue_name || "").trim();
      let resolverName =
        "resolver" in triage && triage.resolver ? String(triage.resolver) : null;
      let resolverId =
        "resolver_id" in triage && triage.resolver_id
          ? String(triage.resolver_id)
          : null;
      if (!assigneeName && !resolverName) {
        return res.status(409).json({
          error: "Routing could not choose an assignee. Pick someone manually.",
        });
      }
      if (assigneeName && assigneeName !== "Unassigned") {
        const assigneeUser =
          (assigneeId
            ? await findLiveStaff(orgId, { id: assigneeId })
            : null) || (await findLiveStaff(orgId, { name: assigneeName }));
        if (!assigneeUser) {
          return res.status(409).json({
            error: "Routing assignee is no longer available. Pick someone else.",
          });
        }
        try {
          await assertReassignTargetAllowed({
            orgId,
            actorId: req.user!.id,
            actorRole: req.user!.role,
            targetUserId: assigneeUser.id,
          });
        } catch (err) {
          const status = Number((err as { status?: number }).status || 403);
          return res.status(status).json({
            error: (err as Error).message || "Cannot assign to that agent",
          });
        }
        assigneeId = assigneeUser.id;
        assigneeName = assigneeUser.name;
      } else {
        assigneeId = null;
        assigneeName = "Unassigned";
      }
      let queueId = old.queue_id ? String(old.queue_id) : null;
      if (queueName) {
        const team = await resolveTicketingTeam(orgId, queueName);
        if (team) {
          queueId = team.id;
          queueName = team.name;
        }
      }
      if (resolverName) {
        const resolverUser =
          (resolverId
            ? await findLiveStaff(orgId, { id: resolverId })
            : null) || (await findLiveStaff(orgId, { name: resolverName }));
        resolverId = resolverUser?.id || null;
        resolverName = resolverUser?.name || null;
      }
      const prio = String(triage.priority || old.priority || "medium");
      const dueAt = await computeDueAt(orgId, prio);
      const assignStatus = mayApplyAssignmentStatus(String(old.status))
        ? statusFromAssignment({
            assigneeId,
            assigneeName,
            resolverId,
          })
        : null;
      const updated = await query(
        `UPDATE tickets SET
           assignee_id = $3,
           assignee_name = $4,
           resolver_id = $5,
           resolver_name = $6,
           queue_id = $7,
           queue_name = $8,
           priority = $9,
           due_at = COALESCE($10, due_at),
           status = COALESCE($11, status),
           first_response_at = CASE
             WHEN first_response_at IS NULL AND $11 IS NOT NULL AND $11::varchar <> 'Open'::varchar
             THEN NOW() ELSE first_response_at END,
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          old.id,
          orgId,
          assigneeId,
          assigneeName,
          resolverId,
          resolverName,
          queueId,
          queueName || null,
          prio,
          dueAt,
          assignStatus,
        ]
      );
      await logActivity(
        orgId,
        `Ticket ${ticketNumber} auto-assigned to ${assigneeName}`,
        String(old.id)
      );
      await writeAuditEvent({
        organizationId: orgId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "ticket.assigned",
        ticketId: String(old.id),
        ticketNumber,
        meta: { from: old.assignee_name, to: assigneeName, auto: true },
      });
      await refreshDashboardMetrics(orgId);
      const [hydrated] = await hydrateTicketIdentityNames(orgId, [
        updated.rows[0],
      ]);
      res.json(mapTicket(hydrated));
      void emitProactiveEvent({
        organizationId: orgId,
        eventType: "ticket.updated",
        ticketId: String(old.id),
        ticketNumber,
        actor: req.user!.id,
        payload: {
          ticket_number: ticketNumber,
          assignee_changed: true,
          resolver_changed: Boolean(resolverId),
          prev_status: String(old.status || ""),
          new_status: String(hydrated?.status || old.status || ""),
          auto_assign: true,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to auto-assign ticket" });
    }
  }
);

/** Heartbeat: mark current staff user as viewing this ticket; return other viewers. */
app.post(
  "/api/tickets/:id/presence",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const user = req.user!;
      if (user.role === "customer" || user.role === "viewer") {
        return res.json({ viewers: [] as Array<{ userId: string; name: string; lastSeenAt: string }> });
      }
      const orgId = user.organizationId;
      const ticketNumber = decodeURIComponent(req.params.id);
      const existing = await query(
        `SELECT * FROM tickets WHERE organization_id = $1 AND ticket_number = $2`,
        [orgId, ticketNumber]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      if (!(await userMayAccessTicket(user, existing.rows[0]))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const ticketUuid = String(existing.rows[0].id);
      await upsertTicketPresence({
        organizationId: orgId,
        ticketUuid,
        userId: user.id,
        userName: user.name,
      });
      const viewers = await listOtherTicketViewers({
        organizationId: orgId,
        ticketUuid,
        excludeUserId: user.id,
      });
      res.json({ viewers });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update presence" });
    }
  }
);

app.delete(
  "/api/tickets/:id/presence",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const user = req.user!;
      if (user.role === "customer" || user.role === "viewer") {
        return res.json({ ok: true });
      }
      const orgId = user.organizationId;
      const ticketNumber = decodeURIComponent(req.params.id);
      const existing = await query(
        `SELECT id FROM tickets WHERE organization_id = $1 AND ticket_number = $2`,
        [orgId, ticketNumber]
      );
      if (!existing.rows[0]) {
        return res.json({ ok: true });
      }
      await clearTicketPresence({
        organizationId: orgId,
        ticketUuid: String(existing.rows[0].id),
        userId: user.id,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to clear presence" });
    }
  }
);

app.put(
  "/api/tickets/:id",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const ticketNumber = decodeURIComponent(req.params.id);
      const { status, priority, assignee, resolver, subject, description, queue, csatScore, category, aiSummary } =
        req.body || {};

      const existing = await query(
        `SELECT * FROM tickets WHERE organization_id = $1 AND ticket_number = $2`,
        [orgId, ticketNumber]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      const old = existing.rows[0];

      const isCustomer = req.user!.role === "customer";
      const isStaff =
        req.user!.role === "admin" ||
        req.user!.role === "agent" ||
        req.user!.role === "resolver";

      if (!(await userMayAccessTicket(req.user!, old))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      if (isCustomer) {
        // Customers may only submit CSAT on resolved tickets
        if (
          csatScore === undefined ||
          csatScore === null ||
          csatScore === "" ||
          status ||
          priority ||
          assignee ||
          subject ||
          description ||
          queue
        ) {
          if (
            csatScore === undefined ||
            csatScore === null ||
            csatScore === ""
          ) {
            return res.status(403).json({ error: "Customers can only rate CSAT" });
          }
          if (status || priority || assignee || subject || description || queue) {
            return res.status(403).json({ error: "Customers can only rate CSAT" });
          }
        }
        if (!(await isTerminalOrgStatus(orgId, String(old.status)))) {
          return res
            .status(400)
            .json({ error: "CSAT is only available on resolved tickets" });
        }
      } else if (!isStaff) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      let assigneeId: string | null = old.assignee_id;
      let assigneeName = old.assignee_name;
      if (assignee && isStaff) {
        assigneeName = assignee;
        if (assignee === "Unassigned") {
          assigneeId = null;
        } else {
          const assigneeUser = await findLiveStaff(orgId, { name: assignee });
          assigneeId = assigneeUser?.id || null;
          if (!assigneeId) {
            return res.status(400).json({ error: "Unknown assignee" });
          }
          try {
            const allowed = await assertReassignTargetAllowed({
              orgId,
              actorId: req.user!.id,
              actorRole: req.user!.role,
              targetUserId: assigneeId,
            });
            assigneeName = allowed.name;
          } catch (err) {
            const status = Number((err as { status?: number }).status || 403);
            return res.status(status).json({
              error: (err as Error).message || "Reassign not allowed",
            });
          }
        }
      }

      let resolverId: string | null = old.resolver_id
        ? String(old.resolver_id)
        : null;
      let resolverName: string | null = old.resolver_name
        ? String(old.resolver_name)
        : null;
      if (resolver !== undefined && isStaff) {
        const rName = String(resolver || "").trim();
        if (!rName || rName === "Unassigned") {
          resolverId = null;
          resolverName = null;
        } else {
          const resolverUser = await findLiveStaff(orgId, { name: rName });
          resolverId = resolverUser?.id || null;
          if (!resolverId) {
            return res.status(400).json({ error: "Unknown resolver" });
          }
          try {
            const allowed = await assertReassignTargetAllowed({
              orgId,
              actorId: req.user!.id,
              actorRole: req.user!.role,
              targetUserId: resolverId,
            });
            resolverName = allowed.name;
          } catch (err) {
            const status = Number((err as { status?: number }).status || 403);
            return res.status(status).json({
              error: (err as Error).message || "Reassign not allowed",
            });
          }
        }
      }

      let queueId = old.queue_id;
      let queueName = old.queue_name;
      if (queue && isStaff) {
        const team = await resolveTicketingTeam(orgId, String(queue));
        if (team) {
          queueId = team.id;
          queueName = team.name;
        } else {
          queueId = null;
          queueName = null;
        }
      }

      const newPriority = String(priority || old.priority || "medium").trim();
      if (priority && !(await isActiveOrgPriority(orgId, newPriority))) {
        return res.status(400).json({ error: "Unknown or inactive priority" });
      }
      let dueAt = old.due_at;
      if (priority && priority !== old.priority && isStaff) {
        dueAt = await computeDueAt(orgId, newPriority);
      }

      let nextStatus: string | null = isStaff && status ? String(status) : null;
      let nextStatusTerminal = false;
      if (nextStatus) {
        if (!(await isActiveOrgStatus(orgId, nextStatus))) {
          return res.status(400).json({ error: "Unknown or inactive status" });
        }
        nextStatus =
          (await resolveOrgStatusKey(orgId, nextStatus)) || nextStatus;
        nextStatusTerminal = await isTerminalOrgStatus(orgId, nextStatus);
      } else if (
        isStaff &&
        (Boolean(assignee) || resolver !== undefined) &&
        mayApplyAssignmentStatus(String(old.status))
      ) {
        nextStatus = statusFromAssignment({
          assigneeId,
          assigneeName,
          resolverId,
        });
        nextStatusTerminal = false;
      }

      let csatValue = old.csat_score;
      let csatRatedAt = old.csat_rated_at;
      let csatComment = old.csat_comment;
      if (csatScore !== undefined && csatScore !== null && csatScore !== "") {
        // CSAT is customer/portal-only. Staff (admin/agent/resolver) cannot submit.
        if (!isCustomer) {
          return res.status(403).json({
            error: "CSAT can only be submitted by the customer from the support portal",
          });
        }
        const score = Number(csatScore);
        if (!Number.isInteger(score) || score < 1 || score > 5) {
          return res.status(400).json({ error: "CSAT score must be an integer from 1 to 5." });
        }
        if (!(await isTerminalOrgStatus(orgId, String(old.status)))) {
          return res.status(400).json({
            error: "CSAT is only available on resolved tickets",
          });
        }
        if (old.csat_score != null) {
          return res.status(400).json({
            error: "CSAT already submitted",
          });
        }
        const comment = String(
          (req.body as { csatComment?: unknown; comment?: unknown })?.csatComment ??
            (req.body as { comment?: unknown })?.comment ??
            ""
        )
          .trim()
          .slice(0, 2000);
        if (comment.length < 3) {
          return res.status(400).json({
            error: "Please add a short comment about your experience.",
          });
        }
        csatValue = score;
        csatRatedAt = new Date();
        csatComment = comment;
      }

      const updated = await query(
        `UPDATE tickets SET
           status = COALESCE($1, status),
           priority = COALESCE($2, priority),
           assignee_id = $3,
           assignee_name = $4,
           resolver_id = $13,
           resolver_name = $14,
           subject = COALESCE($5, subject),
           description = COALESCE($6, description),
           queue_id = $7,
           queue_name = $8,
           due_at = $9,
           csat_score = $10,
           csat_rated_at = $11,
           csat_comment = $16,
           first_response_at = CASE
             WHEN first_response_at IS NULL AND $1 IS NOT NULL AND $1::varchar <> 'Open'::varchar
             THEN NOW() ELSE first_response_at END,
           resolved_at = CASE
             WHEN $1 IS NOT NULL AND $15::boolean AND (status IS DISTINCT FROM $1 OR resolved_at IS NULL)
               THEN COALESCE(resolved_at, NOW())
             WHEN $1 IS NOT NULL AND NOT $15::boolean THEN NULL
             ELSE resolved_at
           END,
           updated_at = NOW()
         WHERE id = $12
         RETURNING *`,
        [
          nextStatus,
          isStaff ? priority || null : null,
          assigneeId,
          assigneeName,
          isStaff ? subject || null : null,
          isStaff ? description || null : null,
          queueId,
          queueName,
          dueAt,
          csatValue,
          csatRatedAt,
          old.id,
          resolverId,
          resolverName,
          nextStatusTerminal,
          csatComment ?? null,
        ]
      );

      let changeText = `Ticket ${ticketNumber} updated`;
      if (status && status !== old.status) {
        changeText = `Ticket ${ticketNumber} status changed to ${status}`;
      } else if (assignee && assignee !== old.assignee_name) {
        changeText = `Ticket ${ticketNumber} assigned to ${assignee}`;
      } else if (csatScore !== undefined && csatScore !== null && csatScore !== "") {
        changeText = `Ticket ${ticketNumber} rated CSAT ${csatValue}/5`;
      }
      await logActivity(orgId, changeText, String(old.id));
      await runSlaSweep(orgId);
      await refreshDashboardMetrics(orgId);

      const actorId = req.user!.id;
      const row = updated.rows[0];
      if (isStaff && (category != null || aiSummary != null)) {
        await query(
          `UPDATE tickets SET
             category = COALESCE($1, category),
             ai_summary = COALESCE($2, ai_summary),
             updated_at = NOW()
           WHERE id = $3`,
          [
            category != null && String(category).trim() ? String(category).trim() : null,
            aiSummary != null && String(aiSummary).trim() ? String(aiSummary).trim() : null,
            old.id,
          ]
        );
      }
      const assigneeChanged =
        Boolean(assignee) && String(assignee) !== String(old.assignee_name);
      const resolverChanged =
        resolver !== undefined &&
        String(resolverName || "") !== String(old.resolver_name || "");
      const statusChanged =
        Boolean(nextStatus) && String(nextStatus) !== String(old.status);
      const otherChanged =
        statusChanged ||
        resolverChanged ||
        (priority && priority !== old.priority) ||
        (queue && queue !== old.queue_name) ||
        (subject && subject !== old.subject) ||
        (description && description !== old.description);

      // TSAA writes only ai_summary — do not re-emit (feedback loop).
      const aiSummaryOnly =
        isStaff &&
        aiSummary != null &&
        String(aiSummary).trim() !== "" &&
        !statusChanged &&
        !assigneeChanged &&
        !resolverChanged &&
        !(priority && priority !== old.priority) &&
        !(queue && queue !== old.queue_name) &&
        !(subject && subject !== old.subject) &&
        !(description && description !== old.description) &&
        (category == null || category === undefined) &&
        (csatScore === undefined || csatScore === null || csatScore === "");

      if (assigneeChanged) {
        const escalate =
          Boolean(req.body?.escalate) ||
          String(req.body?.action || "").toLowerCase() === "escalate";
        await writeAuditEvent({
          organizationId: orgId,
          actorId,
          actorName: req.user!.name,
          action: escalate ? "ticket.escalated" : "ticket.assigned",
          ticketId: String(old.id),
          ticketNumber,
          meta: {
            from: old.assignee_name,
            to: assignee,
            assigneeId,
          },
        });
      }
      if (resolverChanged) {
        const escalate =
          Boolean(req.body?.escalate) ||
          String(req.body?.action || "").toLowerCase() === "escalate";
        await writeAuditEvent({
          organizationId: orgId,
          actorId,
          actorName: req.user!.name,
          action: escalate ? "ticket.escalated" : "ticket.resolver_set",
          ticketId: String(old.id),
          ticketNumber,
          meta: {
            from: old.resolver_name,
            to: resolverName,
            resolverId,
            agentKept: old.assignee_name,
          },
        });
        if (resolverId) {
          await notifyUsers({
            orgId,
            userIds: [String(resolverId)],
            kind: "assignment",
            title: escalate
              ? "Ticket escalated to you"
              : "Ticket assigned to you as resolver",
            message: `Ticket ${ticketNumber} ("${row.subject}") was set to you as resolver.`,
            ticketUuid: String(old.id),
            customerName: row.customer_name ? String(row.customer_name) : null,
            excludeUserId: actorId,
          });
        }
      }
      if (statusChanged) {
        await writeAuditEvent({
          organizationId: orgId,
          actorId,
          actorName: req.user!.name,
          action: "ticket.status_changed",
          ticketId: String(old.id),
          ticketNumber,
          meta: { from: old.status, to: nextStatus || status },
        });
        if (
          nextStatusTerminal &&
          !(await isTerminalOrgStatus(orgId, String(old.status))) &&
          row.customer_email &&
          !/@placeholder\.local$/i.test(String(row.customer_email))
        ) {
          // Fire-and-forget so SMTP latency never blocks the ticket update response.
          void emailCustomerTicketResolved({
            organizationId: orgId,
            ticketId: String(old.id),
            ticketNumber,
            subject: String(row.subject || ""),
            customerName: String(row.customer_name || ""),
            customerEmail: String(row.customer_email),
          }).catch((e) =>
            console.warn("customer mail (resolved) failed:", (e as Error).message)
          );
        }
      }
      if (otherChanged && !assigneeChanged && !statusChanged) {
        await writeAuditEvent({
          organizationId: orgId,
          actorId,
          actorName: req.user!.name,
          action: "ticket.updated",
          ticketId: String(old.id),
          ticketNumber,
          meta: { fields: { priority, queue, subject: Boolean(subject) } },
        });
      }

      if (assigneeChanged && assigneeId) {
        await notifyUsers({
          orgId,
          userIds: [String(assigneeId)],
          kind: "assignment",
          title: "Ticket assigned to you",
          message: `Ticket ${ticketNumber} ("${row.subject}") was assigned to you.`,
          ticketUuid: String(old.id),
          customerName: row.customer_name ? String(row.customer_name) : null,
          excludeUserId: actorId,
        });
      } else if (otherChanged) {
        const targetId =
          assigneeId ||
          (await resolveUserIdByName(orgId, String(row.assignee_name)));
        if (targetId) {
          await notifyUsers({
            orgId,
            userIds: [targetId],
            kind: "update",
            title: "Ticket updated",
            message: changeText,
            ticketUuid: String(old.id),
            customerName: row.customer_name ? String(row.customer_name) : null,
            excludeUserId: actorId,
          });
        }
      }

      if (assigneeChanged || resolverChanged) {
        await emailStaffOnAssignChange({
          organizationId: orgId,
          ticketId: String(old.id),
          ticketNumber,
          subject: String(row.subject || ""),
          customerName: row.customer_name ? String(row.customer_name) : "",
          assigneeId: assigneeId ? String(assigneeId) : null,
          assigneeName,
          resolverId: resolverId ? String(resolverId) : null,
          resolverName,
          prevAssigneeId: old.assignee_id ? String(old.assignee_id) : null,
          prevAssigneeName: old.assignee_name ? String(old.assignee_name) : null,
          prevResolverId: old.resolver_id ? String(old.resolver_id) : null,
        });
      }

      if (statusChanged || assigneeChanged || otherChanged) {
        await runAutomations({
          organizationId: orgId,
          event: "ticket.updated",
          ticketId: String(old.id),
          ticketNumber,
        }).catch((e) =>
          console.warn("automation (updated) failed:", (e as Error).message)
        );
      }

      const refreshed = await query(`SELECT * FROM tickets WHERE id = $1`, [
        old.id,
      ]);
      res.json(mapTicket(refreshed.rows[0] || row));
      if (!aiSummaryOnly) {
        const pnaPayload = await buildPnaNotifyPayload({
          organizationId: orgId,
          eventType: "ticket.updated",
          assigneeId: assigneeId ? String(assigneeId) : null,
          resolverId: resolverId ? String(resolverId) : null,
          actorId,
          ticketNumber,
          customerName: row.customer_name ? String(row.customer_name) : null,
          extra: {
            statusChanged,
            assigneeChanged,
            resolverChanged,
            prev_status: String(old.status || ""),
            new_status: String(nextStatus || old.status || ""),
            escalate:
              Boolean(req.body?.escalate) ||
              String(req.body?.action || "").toLowerCase() === "escalate",
          },
        });
        void emitProactiveEvent({
          organizationId: orgId,
          eventType: "ticket.updated",
          ticketId: String(old.id),
          ticketNumber,
          actor: actorId,
          payload: pnaPayload,
        });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update ticket" });
    }
  }
);

/** Chat / API escalate: pick best resolver (or named assignee) and reassign.
 * When LangGraph already chose assigneeId, trust that pick (Python ownership).
 * Optional agentId sets L1 assignee in the same transaction. */
app.post(
  "/api/tickets/:id/escalate",
  requireAuthOrServiceActor,
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const ticketNumber = decodeURIComponent(req.params.id);
      const namedAssignee = String(req.body?.assignee || "").trim();
      const preferredId = String(req.body?.assigneeId || req.body?.assignee_id || "").trim();
      const preferredName = String(
        req.body?.assigneeName || req.body?.assignee_name || namedAssignee || ""
      ).trim();
      const preferredRationale = String(req.body?.rationale || "").trim();
      const preferredAgentId = String(
        req.body?.agentId || req.body?.agent_id || ""
      ).trim();
      const preferredAgentName = String(
        req.body?.agentName || req.body?.agent_name || req.body?.agent || ""
      ).trim();
      const viaHeader = String(req.headers["x-coworker-tasks-key"] || "").trim()
        ? "chat-tool"
        : "chat";

      const existing = await query(
        `SELECT * FROM tickets WHERE organization_id = $1 AND ticket_number = $2`,
        [orgId, ticketNumber]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      const old = existing.rows[0];
      if (!(await userMayAccessTicket(req.user!, old))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      let nextAgentId: string | null = null;
      let nextAgentName: string | null = null;
      if (preferredAgentId || preferredAgentName) {
        const agentRow = preferredAgentId
          ? await findLiveStaff(orgId, { id: preferredAgentId })
          : await findLiveStaff(orgId, { name: preferredAgentName });
        if (agentRow) {
          try {
            const allowed = await assertReassignTargetAllowed({
              orgId,
              actorId: req.user!.id,
              actorRole: req.user!.role,
              targetUserId: String(agentRow.id),
            });
            nextAgentId = allowed.id;
            nextAgentName = allowed.name;
          } catch (err) {
            console.warn("escalate agent skip:", (err as Error).message);
          }
        }
      }

      let picked: {
        assigneeId: string | null;
        assignee: string;
        role?: string;
        rationale: string;
      };

      if (preferredId) {
        const row = await findLiveStaff(orgId, { id: preferredId });
        if (!row) {
          return res.status(422).json({
            error: preferredName
              ? `Could not find assignee “${preferredName}”.`
              : "No resolver available to escalate to.",
            rationale: preferredRationale || "LangGraph assignee not found in org.",
          });
        }
        try {
          await assertReassignTargetAllowed({
            orgId,
            actorId: req.user!.id,
            actorRole: req.user!.role,
            targetUserId: String(row.id),
          });
        } catch (err) {
          const status = Number((err as { status?: number }).status || 403);
          return res.status(status).json({
            error: (err as Error).message || "Escalate target not allowed",
          });
        }
        picked = {
          assigneeId: String(row.id),
          assignee: String(row.name),
          role: row.role ? String(row.role) : undefined,
          rationale:
            preferredRationale ||
            `Escalated via LangGraph to ${row.name}${row.role ? ` (${row.role})` : ""}.`,
        };
      } else if (!nextAgentId || namedAssignee || preferredName) {
        picked = await pickBestResolver({
        organizationId: orgId,
        skillHint: [old.skill, old.category, old.subject, old.description]
          .filter(Boolean)
          .join(" "),
        queueName: old.queue_name ? String(old.queue_name) : "",
          namedAssignee: namedAssignee || preferredName || undefined,
          // Escalate should move off the current resolver when possible.
          excludeUserId:
            (old.resolver_id && String(old.resolver_id)) ||
            (old.assignee_id && String(old.assignee_id)) ||
            null,
        });
      } else {
        picked = {
          assigneeId: null,
          assignee: "Unassigned",
          rationale: "Agent-only assign; no resolver requested.",
        };
      }

      if (
        (!picked.assigneeId || picked.assignee === "Unassigned") &&
        !nextAgentId
      ) {
        return res.status(422).json({
          error: namedAssignee || preferredName
            ? `Could not find assignee “${namedAssignee || preferredName}”.`
            : "No resolver available to escalate to.",
          rationale: picked.rationale,
        });
      }

      if (picked.assigneeId) {
        try {
          await assertReassignTargetAllowed({
            orgId,
            actorId: req.user!.id,
            actorRole: req.user!.role,
            targetUserId: picked.assigneeId,
          });
        } catch (err) {
          const status = Number((err as { status?: number }).status || 403);
          return res.status(status).json({
            error: (err as Error).message || "Escalate target not allowed",
          });
        }
      }

      const sameResolver =
        Boolean(picked.assigneeId) &&
        (String(old.resolver_id || "") === picked.assigneeId ||
          String(old.resolver_name || "") === picked.assignee);
      const sameAgent =
        Boolean(nextAgentId) &&
        (String(old.assignee_id || "") === nextAgentId ||
          String(old.assignee_name || "") === nextAgentName);

      if (
        (sameResolver || !picked.assigneeId) &&
        (sameAgent || !nextAgentId) &&
        (picked.assigneeId || nextAgentId)
      ) {
        await writeAuditEvent({
          organizationId: orgId,
          actorId: req.user!.id,
          actorName: req.user!.name,
          action: "ticket.escalated",
          ticketId: String(old.id),
          ticketNumber,
          meta: {
            from: old.resolver_name || old.assignee_name,
            to: picked.assignee || nextAgentName || old.resolver_name,
            resolverId: picked.assigneeId || old.resolver_id,
            via: viaHeader,
            rationale: preferredRationale || "Already assigned that way.",
            unchanged: true,
          },
        });
        void emitProactiveEvent({
          organizationId: orgId,
          eventType: "ticket.escalated",
          ticketId: String(old.id),
          ticketNumber,
          actor: req.user!.id,
          payload: {
            ticket_number: ticketNumber,
            escalate: true,
            escalated: true,
            unchanged: true,
          },
        });
        return res.json({
          ticket: mapTicket(old),
          assignee: old.assignee_name,
          agent: nextAgentName || old.assignee_name,
          resolver: picked.assigneeId ? picked.assignee : old.resolver_name,
          rationale: `Already assigned that way.`,
          unchanged: true,
        });
      }

      const sets: string[] = ["updated_at = NOW()"];
      const params: unknown[] = [];
      let pi = 1;
      if (picked.assigneeId && picked.assignee !== "Unassigned") {
        sets.push(`resolver_id = $${pi++}`);
        params.push(picked.assigneeId);
        sets.push(`resolver_name = $${pi++}`);
        params.push(picked.assignee);
      }
      if (nextAgentId && nextAgentName) {
        sets.push(`assignee_id = $${pi++}`);
        params.push(nextAgentId);
        sets.push(`assignee_name = $${pi++}`);
        params.push(nextAgentName);
      }
      const finalAssigneeId =
        nextAgentId || (old.assignee_id ? String(old.assignee_id) : null);
      const finalAssigneeName =
        nextAgentName || String(old.assignee_name || "");
      const finalResolverId = picked.assigneeId
        ? picked.assigneeId
        : old.resolver_id
          ? String(old.resolver_id)
          : null;
      if (mayApplyAssignmentStatus(String(old.status))) {
        const nextAssignStatus = statusFromAssignment({
          assigneeId: finalAssigneeId,
          assigneeName: finalAssigneeName,
          resolverId: finalResolverId,
        });
        const statusParam = pi++;
        sets.push(`status = $${statusParam}`);
        params.push(nextAssignStatus);
        sets.push(`first_response_at = CASE
          WHEN first_response_at IS NULL AND $${statusParam}::varchar <> 'Open'::varchar
          THEN NOW() ELSE first_response_at END`);
      }
      const orgParam = pi++;
      const tnParam = pi;
      params.push(orgId, ticketNumber);
      const updated = await query(
        `UPDATE tickets
         SET ${sets.join(", ")}
         WHERE organization_id = $${orgParam} AND ticket_number = $${tnParam}
         RETURNING *`,
        params
      );
      const row = updated.rows[0];

      await writeAuditEvent({
        organizationId: orgId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "ticket.escalated",
        ticketId: String(old.id),
        ticketNumber,
        meta: {
          from: old.resolver_name || old.assignee_name,
          to: picked.assignee || nextAgentName,
          resolverId: picked.assigneeId,
          agentId: nextAgentId,
          agentName: nextAgentName,
          agentKept: nextAgentName ? null : old.assignee_name,
          via: viaHeader,
          rationale: picked.rationale,
        },
      });

      if (picked.assigneeId) {
      await notifyUsers({
        orgId,
        userIds: [picked.assigneeId],
        kind: "assignment",
        title: "Ticket escalated to you",
          message: `Ticket ${ticketNumber} ("${row.subject}") was escalated to you as resolver.`,
        ticketUuid: String(old.id),
        customerName: row.customer_name ? String(row.customer_name) : null,
        excludeUserId: req.user!.id,
      });
      }
      if (nextAgentId) {
        await notifyUsers({
          orgId,
          userIds: [nextAgentId],
          kind: "assignment",
          title: "Ticket assigned to you",
          message: `Ticket ${ticketNumber} ("${row.subject}") was assigned to you as agent (skill match).`,
          ticketUuid: String(old.id),
          customerName: row.customer_name ? String(row.customer_name) : null,
          excludeUserId: req.user!.id,
        });
      }

      await emailStaffOnAssignChange({
        organizationId: orgId,
        ticketId: String(old.id),
        ticketNumber,
        subject: String(row.subject || ""),
        customerName: row.customer_name ? String(row.customer_name) : "",
        assigneeId: nextAgentId,
        assigneeName: nextAgentName,
        resolverId: picked.assigneeId,
        resolverName: picked.assigneeId ? picked.assignee : null,
        prevAssigneeId: old.assignee_id ? String(old.assignee_id) : null,
        prevAssigneeName: old.assignee_name ? String(old.assignee_name) : null,
        prevResolverId: old.resolver_id ? String(old.resolver_id) : null,
      });

      res.json({
        ticket: mapTicket(row),
        assignee: nextAgentName || old.assignee_name,
        agent: nextAgentName || old.assignee_name,
        resolver: picked.assigneeId ? picked.assignee : old.resolver_name,
        role: picked.role,
        rationale: picked.rationale,
        from: old.assignee_name,
      });
      void emitProactiveEvent({
        organizationId: orgId,
        eventType: "ticket.escalated",
        ticketId: String(old.id),
        ticketNumber,
        actor: req.user!.id,
        payload: {
          ticket_number: ticketNumber,
          escalate: true,
          escalated: true,
          prev_resolver: old.resolver_name,
          new_resolver: picked.assigneeId ? picked.assignee : old.resolver_name,
          rationale: picked.rationale,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to escalate ticket" });
    }
  }
);

// ---- Ticket notes ----

app.get(
  "/api/tickets/:id/notes",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const ticketNumber = decodeURIComponent(req.params.id);
      const t = await query(
        `SELECT id, customer_email, assignee_id, assignee_name, resolver_id, resolver_name,
                queue_id, queue_name, created_by_id
         FROM tickets
         WHERE organization_id = $1 AND ticket_number = $2`,
        [orgId, ticketNumber]
      );
      if (!t.rows[0]) return res.status(404).json({ error: "Ticket not found" });

      if (!(await userMayAccessTicket(req.user!, t.rows[0]))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const visibilitySql =
        req.user!.role === "customer"
          ? `AND COALESCE(visibility, 'internal') = 'public'`
          : "";

      const { rows } = await query(
        `SELECT id, author_id, author_name, body, created_at,
                COALESCE(visibility, 'internal') AS visibility
         FROM ticket_notes
         WHERE organization_id = $1 AND ticket_id = $2
         ${visibilitySql}
         ORDER BY created_at ASC`,
        [orgId, t.rows[0].id]
      );
      const roster = await listAssignableAgents(orgId);
      const staffById = new Map(roster.map((user) => [user.id, user]));
      res.json(
        rows.map((r) => ({
          id: String(r.id),
          author:
            (r.author_id
              ? staffById.get(String(r.author_id))?.name
              : undefined) || String(r.author_name),
          text: String(r.body),
          time: formatRelative(r.created_at as string),
          visibility:
            String(r.visibility || "internal") === "public" ? "public" : "internal",
        }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load notes" });
    }
  }
);

/** Ticket progress stepper + status history (all roles with ticket access). */
app.get(
  "/api/tickets/:id/progress",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const ticketNumber = decodeURIComponent(req.params.id);
      const t = await query(
        `SELECT id, ticket_number, status, assignee_name, created_at, updated_at,
                customer_email, assignee_id, queue_id, queue_name, created_by_id
         FROM tickets
         WHERE organization_id = $1 AND ticket_number = $2`,
        [orgId, ticketNumber]
      );
      if (!t.rows[0]) return res.status(404).json({ error: "Ticket not found" });
      if (!(await userMayAccessTicket(req.user!, t.rows[0]))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const ticket = t.rows[0];
      const status = String(ticket.status || "Open");
      const overdue = status === "Overdue";

      const { rows: auditRows } = await query(
        `SELECT action, actor_name, meta, created_at
         FROM ticketing.audit_events
         WHERE organization_id = $1
           AND (
             ticket_id = $2::bigint
             OR ticket_number = $3
           )
           AND action IN (
             'ticket.created',
             'ticket.status_changed',
             'ticket.assigned',
             'ticket.resolver_set',
             'ticket.escalated',
             'ticket.updated'
           )
         ORDER BY created_at ASC
         LIMIT 60`,
        [orgId, ticket.id, ticketNumber]
      );

      const { rows: activityRows } = await query(
        `SELECT text, created_at
           FROM activity_logs
          WHERE organization_id = $1
            AND ticket_id = $2
          ORDER BY created_at DESC
          LIMIT 20`,
        [orgId, ticket.id]
      );

      type Hist = {
        at: string;
        relative: string;
        label: string;
        actor: string | null;
      };
      const history: Hist[] = [];

      const pushHist = (
        at: unknown,
        label: string,
        actor: string | null
      ) => {
        const iso =
          at instanceof Date ? at.toISOString() : String(at || "");
        history.push({
          at: iso,
          relative: formatRelative(at as string),
          label,
          actor,
        });
      };

      if (!auditRows.some((r) => String(r.action) === "ticket.created")) {
        pushHist(ticket.created_at, "Ticket submitted", null);
      }

      for (const r of auditRows) {
        const action = String(r.action);
        const actor = r.actor_name ? String(r.actor_name) : null;
        const meta =
          r.meta && typeof r.meta === "object"
            ? (r.meta as Record<string, unknown>)
            : {};
        if (action === "ticket.created") {
          pushHist(r.created_at, "Ticket submitted", actor);
        } else if (action === "ticket.status_changed") {
          const to = String(meta.to || "");
          const label =
            to === "Pending"
              ? "Moved to In Progress"
                : to === "Resolved"
                  ? "Marked Resolved"
                : to === "Reopened" || to === "Open"
                    ? "Reopened"
                    : to === "Overdue"
                      ? "Marked Overdue"
                      : `Status changed to ${to || "unknown"}`;
          pushHist(r.created_at, label, actor);
        } else if (action === "ticket.assigned") {
          const to = String(meta.to || ticket.assignee_name || "teammate");
          pushHist(r.created_at, `Assigned to ${to}`, actor);
        } else if (action === "ticket.resolver_set") {
          const to = String(meta.to || "resolver");
          pushHist(r.created_at, `Resolver set to ${to}`, actor);
        } else if (action === "ticket.escalated") {
          const to = String(meta.to || "resolver");
          pushHist(r.created_at, `Escalated to ${to}`, actor);
        } else if (action === "ticket.updated") {
          pushHist(r.created_at, "Ticket fields updated", actor);
        }
      }

      // Merge recent activity_logs (system feed) not already covered by audit labels.
      const seenLabels = new Set(history.map((h) => h.label.toLowerCase()));
      for (const row of [...activityRows].reverse()) {
        const text = String(row.text || "").trim();
        if (!text) continue;
        const key = text.toLowerCase();
        if (seenLabels.has(key)) continue;
        seenLabels.add(key);
        pushHist(row.created_at, text, null);
      }
      history.sort(
        (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
      );

      const hasReopenedEvent = history.some((h) =>
        /reopened/i.test(h.label)
      );
      const showReopenPath = status === "Reopened" || hasReopenedEvent;

      type StepState = "done" | "current" | "upcoming";
      let steps: Array<{
        key: string;
        label: string;
        hint: string;
        state: StepState;
      }>;

      if (showReopenPath && status === "Resolved") {
        steps = [
          { key: "Open", label: "Submitted", hint: "Request received", state: "done" },
          { key: "Reopened", label: "Reopened", hint: "Work restarted", state: "done" },
          { key: "Resolved", label: "Resolved", hint: "Closed", state: "done" },
        ];
      } else if (showReopenPath) {
        const currentIdx =
          status === "Reopened" || status === "Pending" || status === "Overdue"
            ? 2
            : 0;
        const defs = [
          { key: "Open", label: "Submitted", hint: "Request received" },
          { key: "Resolved", label: "Resolved", hint: "Previously closed" },
          { key: "Reopened", label: "Reopened", hint: "Work restarted" },
        ] as const;
        steps = defs.map((s, i) => ({
          ...s,
          state:
            i < currentIdx
              ? ("done" as const)
              : i === currentIdx
                ? ("current" as const)
                : ("upcoming" as const),
        }));
      } else {
        let stepIndex = 0;
        if (status === "Open") stepIndex = 0;
        else if (status === "Resolved") stepIndex = 2;
        else stepIndex = 1;
        const defs = [
          { key: "Open", label: "Submitted", hint: "Request received" },
          { key: "Pending", label: "In Progress", hint: "Being worked on" },
          { key: "Resolved", label: "Resolved", hint: "Closed" },
        ] as const;
        steps = defs.map((s, i) => {
          let state: StepState = "upcoming";
          if (status === "Resolved") state = "done";
          else if (i < stepIndex) state = "done";
          else if (i === stepIndex) state = "current";
          return { ...s, state };
        });
      }

      const catalog = await listOrgTicketStatuses(orgId, {
        includeInactive: true,
      });
      const statusMeta = catalog.find(
        (s) => s.status.toLowerCase() === status.toLowerCase()
      );

      res.json({
        ticketId: ticketNumber,
        currentStatus: status,
        statusLabel: statusMeta?.displayName || status,
        onHold: false,
        overdue,
        steps,
        history,
        systemEvents: history,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load ticket progress" });
    }
  }
);

app.post(
  "/api/tickets/:id/notes",
  requireAuthOrServiceActor,
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const ticketNumber = decodeURIComponent(req.params.id);
      const { text, visibility } = req.body || {};
      if (!text?.trim()) {
        return res.status(400).json({ error: "Note text is required." });
      }
      const noteVisibility =
        String(visibility || "internal").toLowerCase() === "public"
          ? "public"
          : "internal";
      const t = await query(
        `SELECT id, assignee_id, assignee_name, queue_id, queue_name,
                customer_name, customer_email, subject, created_by_id, channel
         FROM tickets WHERE organization_id = $1 AND ticket_number = $2`,
        [orgId, ticketNumber]
      );
      if (!t.rows[0]) return res.status(404).json({ error: "Ticket not found" });
      if (!(await userMayAccessTicket(req.user!, t.rows[0]))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const ticket = t.rows[0];
      const { rows } = await query(
        `INSERT INTO ticket_notes (organization_id, ticket_id, author_id, author_name, body, visibility)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, author_name, body, created_at, visibility`,
        [orgId, ticket.id, req.user!.id, req.user!.name, text.trim(), noteVisibility]
      );
      const note = rows[0];
      await logActivity(
        orgId,
        `Note added on ${ticketNumber} by ${req.user!.name}`,
        String(ticket.id)
      );
      await writeAuditEvent({
        organizationId: orgId,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "ticket.note_added",
        ticketId: String(ticket.id),
        ticketNumber,
        meta: {
          preview: text.trim().slice(0, 120),
          visibility: noteVisibility,
        },
      });

      const assigneeId =
        ticket.assignee_id ||
        (await resolveUserIdByName(orgId, String(ticket.assignee_name)));
      if (assigneeId) {
        await notifyUsers({
          orgId,
          userIds: [String(assigneeId)],
          kind: "update",
          title: "New note on ticket",
          message: `${req.user!.name} added a note on ${ticketNumber} ("${ticket.subject}").`,
          ticketUuid: String(ticket.id),
          customerName: ticket.customer_name ? String(ticket.customer_name) : null,
          excludeUserId: req.user!.id,
        });
      }

      let customerNotified = false;
      if (noteVisibility === "public" && ticket.customer_email) {
        const customerUserId = await resolveUserIdByEmail(
          orgId,
          String(ticket.customer_email)
        );
        if (customerUserId) {
          await notifyUsers({
            orgId,
            userIds: [customerUserId],
            kind: "update",
            title: "New reply on your ticket",
            message: `${req.user!.name} replied on ${ticketNumber} ("${ticket.subject}").`,
            ticketUuid: String(ticket.id),
            customerName: ticket.customer_name ? String(ticket.customer_name) : null,
            excludeUserId: req.user!.id,
          });
          customerNotified = true;
        }
        // Portal / web customers see public notes in the support portal — no reply email.
        // Email-channel (and similar) tickets still get the same reply by email.
        const channelKey = String(ticket.channel || "")
          .trim()
          .toLowerCase()
          .replace(/-/g, "_");
        const portalChannel =
          channelKey === "web" ||
          channelKey === "portal" ||
          channelKey === "support_portal" ||
          channelKey === "portal_chat" ||
          channelKey === "chat";
        const skipEmail =
          portalChannel ||
          Boolean(req.body?.skipCustomerEmail) ||
          Boolean(req.body?.skip_customer_email);
        if (
          !skipEmail &&
          !/@placeholder\.local$/i.test(String(ticket.customer_email))
        ) {
          await emailCustomerTicketReply({
            organizationId: orgId,
            ticketId: String(ticket.id),
            ticketNumber,
            subject: String(ticket.subject || ""),
            customerName: String(ticket.customer_name || ""),
            customerEmail: String(ticket.customer_email),
            replyPreview: text.trim(),
            agentName: req.user!.name,
          }).catch((e) =>
            console.warn("customer mail (reply) failed:", (e as Error).message)
          );
          customerNotified = true;
        }
      }

      res.status(201).json({
        id: String(note.id),
        author: String(note.author_name),
        text: String(note.body),
        time: formatRelative(note.created_at as string),
        visibility:
          String(note.visibility || noteVisibility) === "public"
            ? "public"
            : "internal",
        customerNotified,
        customerPortalVisible: noteVisibility === "public",
      });
      const isCustomerActor = req.user!.role === "customer";
      if (isCustomerActor) {
        void emitCustomerReplied({
          organizationId: orgId,
          ticketId: String(ticket.id),
          ticketNumber,
          text: text.trim(),
          actorId: req.user!.id,
          customerName: ticket.customer_name
            ? String(ticket.customer_name)
            : req.user!.name,
          assigneeId: assigneeId ? String(assigneeId) : null,
          subject: ticket.subject ? String(ticket.subject) : null,
          channel: "staff_customer",
        });
      } else {
        const pnaPayload = await buildPnaNotifyPayload({
          organizationId: orgId,
          eventType: "ticket.comment_added",
          assigneeId: assigneeId ? String(assigneeId) : null,
          actorId: req.user!.id,
          ticketNumber,
          customerName: ticket.customer_name
            ? String(ticket.customer_name)
            : null,
          extra: {
            text: text.trim().slice(0, 500),
            visibility: noteVisibility,
          },
        });
        void emitProactiveEvent({
          organizationId: orgId,
          eventType: "ticket.comment_added",
          ticketId: String(ticket.id),
          ticketNumber,
          actor: req.user!.id,
          payload: pnaPayload,
        });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create note" });
    }
  }
);

// ---- Attachments upload ----

app.post(
  "/api/uploads",
  requireAuth,
  (req: AuthedRequest, res, next) => {
    const role = req.user!.role;
    if (
      role === "admin" ||
      role === "agent" ||
      role === "customer" ||
      canMutateKnowledge(role)
    ) {
      return next();
    }
    return res.status(403).json({ error: "Insufficient permissions" });
  },
  upload.array("files", 10),
  (req: AuthedRequest, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const urls = files.map((f) => `/uploads/${f.filename}`);
    res.status(201).json({
      files: files.map((f, i) => ({
        name: f.originalname,
        url: urls[i],
        size: f.size,
      })),
      urls,
    });
  }
);

// ---- Customers ----

app.get(
  "/api/customers",
  requireAuthOrServiceActor,
  requireModule("customers"),
  async (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const customerId = queryString(req.query.customerId, "customerId", 64);
    const exactEmail = queryString(req.query.exactEmail, "exactEmail", 320);
    const exactPhone = queryString(req.query.exactPhone, "exactPhone", 64);
    const exactSelectors = [customerId, exactEmail, exactPhone].filter(Boolean);
    if (exactSelectors.length > 1) {
      return res.status(400).json({
        error: "Use only one of customerId, exactEmail, or exactPhone",
      });
    }
    if (customerId && !/^\d+$/.test(customerId)) {
      return res.status(400).json({ error: "customerId must be a valid id" });
    }
    if (exactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(exactEmail)) {
      return res.status(400).json({ error: "exactEmail must be a valid email" });
    }
    if (exactPhone && exactPhone.replace(/\D/g, "").length < 7) {
      return res.status(400).json({ error: "exactPhone must contain at least 7 digits" });
    }
    if (exactSelectors.length === 1) {
      const row = await findDirectoryCustomer({
        organizationId: orgId,
        customerId,
        email: exactEmail,
        phone: exactPhone,
      });
      return res.json(row ? [mapDirectoryCustomer(row)] : []);
    }
    const rows = await listDirectoryCustomers({
      organizationId: orgId,
      q: String(req.query.q || ""),
      status: String(req.query.status || ""),
    });
    res.json(rows.map((r) => mapDirectoryCustomer(r)));
  } catch (err) {
    if (Number((err as { status?: number }).status) === 400) {
      return res.status(400).json({ error: (err as Error).message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load customers" });
  }
});

app.post(
  "/api/customers",
  requireAuthOrServiceActor,
  requireModule("customers"),
  async (req: AuthedRequest, res) => {
    try {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ error: "Only admins can add customers." });
      }
      const org = await query(
        `SELECT COALESCE(s.portal_slug, a.support_portal_slug) AS slug,
              COALESCE(s.portal_auth_mode, 'otp') AS portal_auth_mode
       FROM accounts.organizations a
       LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
       WHERE a.id = $1 LIMIT 1`,
        [req.user!.organizationId]
      );
      const slug = org.rows[0]?.slug ? String(org.rows[0].slug) : "";
      const mode =
        String(org.rows[0]?.portal_auth_mode || "otp") === "password"
          ? "password"
          : "otp";
      const result = await adminCreateCustomer({
        organizationId: req.user!.organizationId,
        slug,
        portalAuthMode: mode,
        body: req.body || {},
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof CustomerDirectoryError) {
        return res.status(err.status).json({
          error: err.message,
          conflict: err.conflict,
          customer: err.existing ? mapDirectoryCustomer(err.existing) : undefined,
        });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to add customer" });
    }
  }
);

app.post(
  "/api/customers/import",
  requireAuthOrServiceActor,
  requireModule("customers"),
  async (req: AuthedRequest, res) => {
    try {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ error: "Only admins can import customers." });
      }
      const csvText = String(req.body?.csv || req.body?.text || "");
      const filename = String(req.body?.filename || req.body?.fileName || "").trim();
      const contentBase64 = String(
        req.body?.contentBase64 || req.body?.content_base64 || ""
      ).trim();
      const org = await query(
        `SELECT COALESCE(s.portal_slug, a.support_portal_slug) AS slug,
              COALESCE(s.portal_auth_mode, 'otp') AS portal_auth_mode
       FROM accounts.organizations a
       LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
       WHERE a.id = $1 LIMIT 1`,
        [req.user!.organizationId]
      );
      const slug = org.rows[0]?.slug ? String(org.rows[0].slug) : "";
      const mode =
        String(org.rows[0]?.portal_auth_mode || "otp") === "password"
          ? "password"
          : "otp";
      const result = await adminImportCustomers({
        organizationId: req.user!.organizationId,
        slug,
        portalAuthMode: mode,
        csvText: csvText || undefined,
        filename: filename || undefined,
        contentBase64: contentBase64 || undefined,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof CustomerDirectoryError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to import customers" });
    }
  }
);

// ---- KB ----

app.get("/api/kb", requireAuthOrServiceActor, requireModule("kb"), async (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();
    const statusRaw = String(req.query.status || "").trim();
    const params: unknown[] = [orgId];
    let where = `organization_id = $1`;
    if (category && category.toLowerCase() !== "all") {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }
    if (statusRaw) {
      const st =
        statusRaw.toLowerCase() === "draft"
          ? "Draft"
          : statusRaw.toLowerCase() === "published"
            ? "Published"
            : "";
      if (st) {
        params.push(st);
        where += ` AND status = $${params.length}`;
      }
    }
    if (q) {
      // Prefer token OR so paraphrased titles still match (RKAA / chat search).
      // Full-phrase ILIKE misses "VPN Won't Connect" for "VPN not connecting…".
      const tokens = [
        ...new Set((q.toLowerCase().match(/[a-z0-9]{3,}/g) || []).slice(0, 8)),
      ];
      if (tokens.length <= 1) {
        params.push(`%${q}%`);
        where += ` AND (title ILIKE $${params.length} OR content ILIKE $${params.length} OR category ILIKE $${params.length})`;
      } else {
        const parts: string[] = [];
        for (const tok of tokens) {
          params.push(`%${tok}%`);
          const p = `$${params.length}`;
          parts.push(
            `(title ILIKE ${p} OR content ILIKE ${p} OR category ILIKE ${p})`
          );
        }
        where += ` AND (${parts.join(" OR ")})`;
      }
    }
    const { rows } = await query(
      `SELECT * FROM kb_articles WHERE ${where} ORDER BY updated_at DESC`,
      params
    );
    const roster = await listAssignableAgents(orgId);
    const staffById = new Map(roster.map((user) => [user.id, user]));
    res.json(
      rows.map((r) =>
        mapKb({
          ...r,
          author_name:
            (r.author_id
              ? staffById.get(String(r.author_id))?.name
              : undefined) || r.author_name,
        })
      )
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load KB articles" });
  }
});

function sanitizeKbAttachments(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item || "").trim();
    const m = s.match(/^\/uploads\/([^/]+)$/);
    if (!m) continue;
    const name = m[1];
    if (!name || name.includes("..") || name.includes("\\")) continue;
    const full = path.join(UPLOAD_DIR, name);
    if (!full.startsWith(UPLOAD_DIR + path.sep) && full !== UPLOAD_DIR) continue;
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        out.push(`/uploads/${name}`);
      }
    } catch {
      /* skip unreadable paths */
    }
  }
  return out;
}

app.post("/api/kb", requireAuthOrServiceActor, canMutate, async (req: AuthedRequest, res) => {
  try {
    if (!canMutateKnowledge(req.user!.role)) {
      return res.status(403).json({ error: "Resolvers have read-only KB access" });
    }
    const { title, content, category, author, attachments, status } = req.body || {};
    const titleStr = String(title || "").trim();
    const contentStr = String(content || "").trim();
    const categoryStr = String(category || "").trim();
    const statusStr =
      String(status || "Published").trim().toLowerCase() === "draft"
        ? "Draft"
        : "Published";
    if (!titleStr || !contentStr || !categoryStr) {
      return res
        .status(400)
        .json({ error: "Title, Content, and Category are required." });
    }
    if (titleStr.length < 2) {
      return res.status(400).json({ error: "Title must be at least 2 characters." });
    }
    if (contentStr.length < 10) {
      return res
        .status(400)
        .json({ error: "Content must be at least 10 characters." });
    }
    const files = sanitizeKbAttachments(attachments);
    let rows: Record<string, unknown>[] = [];
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const ext = `KB-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1e6
      )
        .toString(36)
        .toUpperCase()}`;
      try {
        const inserted = await query(
      `INSERT INTO kb_articles (
         organization_id, external_id, title, content, category,
         author_name, author_id, status, views, attachments
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$9,0,$8) RETURNING *`,
      [
        req.user!.organizationId,
        ext,
        titleStr,
        contentStr,
        categoryStr,
        author || req.user!.name,
        req.user!.id,
        files,
            statusStr,
          ]
        );
        rows = inserted.rows;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string }).code;
        if (code === "23505") continue;
        throw err;
      }
    }
    if (!rows[0]) {
      throw lastErr || new Error("Failed to allocate unique KB id");
    }
    res.status(201).json(mapKb(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create article" });
  }
});

app.get(
  "/api/kb/:id",
  requireAuthOrServiceActor,
  requireModule("kb"),
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const id = decodeURIComponent(req.params.id);
      const { rows } = await query(
        `SELECT * FROM kb_articles
         WHERE organization_id = $1 AND (external_id = $2 OR id::text = $2)
         LIMIT 1`,
        [orgId, id]
      );
      if (!rows[0]) return res.status(404).json({ error: "Article not found" });
      const roster = await listAssignableAgents(orgId);
      const author =
        (rows[0].author_id
          ? roster.find((u) => u.id === String(rows[0].author_id))?.name
          : undefined) || rows[0].author_name;
      res.json(mapKb({ ...rows[0], author_name: author }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load article" });
    }
  }
);

app.patch(
  "/api/kb/:id",
  requireAuthOrServiceActor,
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      if (!canMutateKnowledge(req.user!.role)) {
        return res.status(403).json({ error: "Resolvers have read-only KB access" });
      }
      const orgId = req.user!.organizationId;
      const id = decodeURIComponent(req.params.id);
      const existing = await query(
        `SELECT * FROM kb_articles
         WHERE organization_id = $1 AND (external_id = $2 OR id::text = $2)
         LIMIT 1`,
        [orgId, id]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ error: "Article not found" });
      }
      const body = req.body || {};
      const title =
        body.title !== undefined ? String(body.title || "").trim() : null;
      const content =
        body.content !== undefined ? String(body.content || "").trim() : null;
      const category =
        body.category !== undefined ? String(body.category || "").trim() : null;
      let status: string | null = null;
      if (body.status !== undefined) {
        const st = String(body.status || "").trim().toLowerCase();
        if (st === "draft") status = "Draft";
        else if (st === "published") status = "Published";
        else {
          return res.status(400).json({ error: "status must be Draft or Published" });
        }
      }
      const attachments =
        body.attachments !== undefined
          ? sanitizeKbAttachments(body.attachments)
          : null;
      if (title !== null && title.length < 2) {
        return res.status(400).json({ error: "Title must be at least 2 characters." });
      }
      if (content !== null && content.length < 10) {
        return res.status(400).json({ error: "Content must be at least 10 characters." });
      }
      const updated = await query(
        `UPDATE kb_articles SET
           title = COALESCE($3, title),
           content = COALESCE($4, content),
           category = COALESCE($5, category),
           status = COALESCE($6, status),
           attachments = COALESCE($7, attachments),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          existing.rows[0].id,
          orgId,
          title,
          content,
          category,
          status,
          attachments,
        ]
      );
      res.json(mapKb(updated.rows[0]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update article" });
    }
  }
);

// ---- Teams (ticketing.agent_queues; /api/queues kept for UI compatibility) ----

function teamMatchesDirectoryQuery(
  team: {
    name: string;
    description?: string;
    members: Array<{
      name?: string;
      email?: string;
      role?: string;
      skills?: string[];
    }>;
  },
  q: string,
  skill = ""
): boolean {
  const needle = String(q || "").trim().toLowerCase();
  const skillNeedle = String(skill || "").trim().toLowerCase();
  const memberHit = (
    pred: (m: {
      name?: string;
      email?: string;
      role?: string;
      skills?: string[];
    }) => boolean
  ) => team.members.some(pred);
  if (skillNeedle) {
    const hasSkill = memberHit((m) =>
      (m.skills || []).some((s) => String(s).toLowerCase().includes(skillNeedle))
    );
    if (!hasSkill) return false;
  }
  if (!needle) return true;
  return (
    team.name.toLowerCase().includes(needle) ||
    String(team.description || "").toLowerCase().includes(needle) ||
    memberHit(
      (m) =>
        String(m.name || "").toLowerCase().includes(needle) ||
        String(m.email || "").toLowerCase().includes(needle) ||
        String(m.role || "").toLowerCase().includes(needle) ||
        (m.skills || []).some((s) => String(s).toLowerCase().includes(needle))
    )
  );
}

app.get("/api/queues", requireAuthOrServiceActor, async (req: AuthedRequest, res) => {
  const role = req.user!.role;
  if (!["admin", "agent", "resolver", "viewer"].includes(role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  try {
    const orgId = req.user!.organizationId;
    const q = String(req.query.q || "").trim();
    let teams = await listTicketingTeams(orgId);
    if (q) {
      teams = teams.filter((t) => teamMatchesDirectoryQuery(t, q));
    }
    res.json(teams.map((t) => mapQueue(teamToQueuePayload(t))));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load teams" });
  }
});

app.post(
  "/api/queues",
  requireAuthOrServiceActor,
  requireRole("admin"),
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const body = req.body || {};
      const name = String(body.queueName || body.name || "").trim();
      const description = String(body.description || "").trim();
      let memberIds: string[] = Array.isArray(body.memberIds)
        ? body.memberIds.map((id: unknown) => String(id))
        : [];
      // Allow resolving members by name for guided create
      if ((!memberIds.length || body.members) && Array.isArray(body.members)) {
        const names = body.members.map((m: unknown) => String(m).trim()).filter(Boolean);
        if (names.length) {
          const agents = await listAssignableAgents(orgId);
          const resolved = names
            .map((n: string) => resolveAgentIdByName(agents, n))
            .filter(Boolean) as string[];
          memberIds = [...new Set([...memberIds, ...resolved])];
          if (!memberIds.length) {
            return res.status(400).json({
              error:
                "Could not match team members to staff. Use member_ids from list_agents, or staff display names / work emails from the org roster.",
              unresolved: names,
            });
          }
        }
      }
      if (!memberIds.length) {
        return res.status(400).json({
          error:
            "At least one team member is required. Select staff before creating the team.",
        });
      }
      const team = await createTicketingTeam({
        orgId,
        name,
        description,
        memberIds,
      });
      res.status(201).json(mapQueue(teamToQueuePayload(team)));
    } catch (err) {
      const status = Number((err as { status?: number }).status || 500);
      console.error(err);
      res.status(status).json({
        error: (err as Error).message || "Failed to create team",
      });
    }
  }
);

app.patch(
  "/api/queues/:id",
  requireAuthOrServiceActor,
  requireRole("admin"),
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user!.organizationId;
      const teamId = decodeURIComponent(req.params.id);
      const body = req.body || {};
      const patch: {
        orgId: string;
        teamId: string;
        name?: string;
        description?: string;
        memberIds?: string[];
      } = { orgId, teamId };
      if (body.queueName !== undefined || body.name !== undefined) {
        patch.name = String(body.queueName || body.name || "");
      }
      if (body.description !== undefined) {
        patch.description = String(body.description || "");
      }
      if (body.memberIds !== undefined || Array.isArray(body.members)) {
        const incomingIds = Array.isArray(body.memberIds)
          ? body.memberIds.map((id: unknown) => String(id))
          : [];
        const incomingNames = Array.isArray(body.members)
          ? body.members.map((m: unknown) => String(m).trim()).filter(Boolean)
          : [];
        const agents = await listAssignableAgents(orgId);
        const { resolved, unresolvedIds, unresolvedNames } =
          collectResolvedMemberIds(agents, {
            memberIds: incomingIds,
            members: incomingNames,
          });
        if (unresolvedNames.length) {
          return res.status(400).json({
            error: `Could not match staff: ${unresolvedNames.join(", ")}`,
            unresolved: unresolvedNames,
            availableStaff: agents.map((a) => a.name).filter(Boolean).slice(0, 40),
          });
        }
        if (!resolved.length) {
          return res.status(400).json({
            error: `Invalid team members: ${unresolvedIds.join(", ") || "(empty)"}`,
            unresolved: unresolvedIds,
            availableStaff: agents.map((a) => a.name).filter(Boolean).slice(0, 40),
          });
        }
        const append = Boolean(body.appendMembers || body.addMembers);
        if (append) {
          const existing = await resolveTicketingTeam(orgId, teamId);
          const cur = existing?.memberIds || [];
          patch.memberIds = [...new Set([...cur, ...resolved])];
        } else {
          patch.memberIds = resolved;
        }
      }
      const team = await updateTicketingTeam(patch);
      res.json(mapQueue(teamToQueuePayload(team)));
    } catch (err) {
      const status = Number((err as { status?: number }).status || 500);
      console.error(err);
      res.status(status).json({
        error: (err as Error).message || "Failed to update team",
      });
    }
  }
);

app.delete(
  "/api/queues/:id",
  requireAuthOrServiceActor,
  requireRole("admin"),
  async (req: AuthedRequest, res) => {
    try {
      await deleteTicketingTeam(
        req.user!.organizationId,
        decodeURIComponent(req.params.id)
      );
      res.status(204).end();
    } catch (err) {
      const status = Number((err as { status?: number }).status || 500);
      console.error(err);
      res.status(status).json({
        error: (err as Error).message || "Failed to delete team",
      });
    }
  }
);

// ---- Activities / Metrics ----

app.get("/api/activities", requireAuthOrServiceActor, async (req: AuthedRequest, res) => {
  try {
    if (!canAccessModule(req.user!.role, "dashboard")) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { rows } = await query(
      `SELECT * FROM activity_logs WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.user!.organizationId]
    );
    res.json(rows.map((r) => mapActivity(r)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load activities" });
  }
});

app.get("/api/metrics", requireAuthOrServiceActor, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    if (!canAccessModule(user.role, "dashboard")) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = user.organizationId;
    const scopeQ = String(req.query.scope || "").trim().toLowerCase();
    if (scopeQ === "self" || scopeQ === "assignee" || scopeQ === "mine") {
      return res.json(await metricsForAssignee(user));
    }
    // Admin/viewer: org-wide cached metrics; agent/resolver: own assignee scope
    if (scopeQ === "org" || dataScopeForRole(user.role) === "org") {
      if (dataScopeForRole(user.role) !== "org") {
        return res.json(await metricsForUser(user));
      }
      await refreshDashboardMetrics(orgId);
      const { rows } = await query(
        `SELECT * FROM dashboard_metrics WHERE organization_id = $1`,
        [orgId]
      );
      if (!rows[0]) {
        return res.json(
          await metricsWithBreakdown(
          mapMetrics({
            open_tickets: 0,
            on_hold: 0,
            overdue: 0,
            due_today: 0,
              created_today: 0,
            unassigned: 0,
            }),
            user,
            "org"
          )
        );
      }
      return res.json(
        await metricsWithBreakdown(mapMetrics(rows[0]), user, "org")
      );
    }
    return res.json(await metricsForAssignee(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load metrics" });
  }
});
app.get("/api/dashboard/chart", requireAuth, requireModule("dashboard"), async (req: AuthedRequest, res) => {
  try {
    const user = req.user;
    const orgId = user.organizationId;
    const range = String(req.query.range || "24hours");
    let hours = range === "7days" ? 24 * 7 : range === "30days" ? 24 * 30 : 24;
    const hoursQ = Number(req.query.hours);
    if (Number.isFinite(hoursQ) && hoursQ >= 1 && hoursQ <= 24 * 90) {
      hours = Math.round(hoursQ);
    }
    const trunc = hours <= 36 ? "hour" : "day";
    /**
     * Reports volume charts are org-wide for staff (Contact Center pattern).
     * Assignee filtering made "Tickets created" empty for agents/resolvers
     * even when the org had creates in range. Requester stays self-scoped.
     */
    const params: unknown[] = [orgId, String(hours), trunc];
    let ticketFilter = "";
    if (dataScopeForRole(user.role) === "requester") {
      ticketFilter = `AND lower(customer_email) = lower($4)`;
      params.push(user.email);
    }
    const { rows } = await query(
      `WITH bounds AS (
         SELECT
           date_trunc($3::text, NOW() - ($2 || ' hours')::interval) AS start_bucket,
           date_trunc($3::text, NOW()) AS end_bucket
       ),
       buckets AS (
         SELECT generate_series(
           (SELECT start_bucket FROM bounds),
           (SELECT end_bucket FROM bounds),
           CASE WHEN $3::text = 'hour' THEN interval '1 hour' ELSE interval '1 day' END
         ) AS bucket
       ),
       bucket_end AS (
         SELECT
           bucket,
           bucket + CASE WHEN $3::text = 'hour' THEN interval '1 hour' ELSE interval '1 day' END AS end_at
         FROM buckets
       ),
       filed AS (
         SELECT
           date_trunc($3::text, created_at) AS bucket,
           COUNT(*) FILTER (WHERE status IN ('Open', 'Pending', 'Reopened', 'Overdue'))::int AS new_count,
           COUNT(*) FILTER (WHERE status = 'On Hold')::int AS on_hold,
           COUNT(*) FILTER (WHERE status = 'Overdue')::int AS backlog,
           COUNT(*)::int AS filed
         FROM tickets
         WHERE organization_id = $1::bigint
           AND created_at >= NOW() - ($2 || ' hours')::interval
           ${ticketFilter}
         GROUP BY 1
       ),
       resolved AS (
         SELECT
           date_trunc($3::text, COALESCE(resolved_at, updated_at)) AS bucket,
           COUNT(*)::int AS resolved
         FROM tickets
         WHERE organization_id = $1::bigint
           AND status = 'Resolved'
           AND COALESCE(resolved_at, updated_at) >= NOW() - ($2 || ' hours')::interval
           ${ticketFilter}
         GROUP BY 1
       ),
       open_stock AS (
         SELECT
           be.bucket,
           COUNT(t.id)::int AS open_count
         FROM bucket_end be
         LEFT JOIN tickets t
           ON t.organization_id = $1::bigint
           AND t.created_at < be.end_at
           AND (
             t.status <> 'Resolved'
             OR COALESCE(t.updated_at, t.created_at) >= be.end_at
           )
           ${ticketFilter.replace(/\n/g, "\n           ")}
         GROUP BY be.bucket
       ),
       due_stock AS (
         SELECT
           be.bucket,
           COUNT(t.id) FILTER (
             WHERE t.status <> 'Resolved'
               AND t.due_at IS NOT NULL
               AND t.due_at >= be.bucket
               AND t.due_at < be.end_at
           )::int AS due_today,
           COUNT(t.id) FILTER (
             WHERE t.status <> 'Resolved'
               AND t.due_at IS NOT NULL
               AND t.due_at < be.bucket
           )::int AS overdue_stock
         FROM bucket_end be
         LEFT JOIN tickets t
           ON t.organization_id = $1::bigint
           AND t.created_at < be.end_at
           ${ticketFilter.replace(/\n/g, "\n           ")}
         GROUP BY be.bucket
       )
       SELECT
         b.bucket,
         COALESCE(f.new_count, 0)::int AS new_count,
         COALESCE(f.on_hold, 0)::int AS on_hold,
         COALESCE(f.backlog, 0)::int AS backlog,
         COALESCE(f.filed, 0)::int AS filed,
         COALESCE(r.resolved, 0)::int AS resolved,
         COALESCE(o.open_count, 0)::int AS open_count,
         COALESCE(d.due_today, 0)::int AS due_today,
         COALESCE(d.overdue_stock, 0)::int AS overdue_stock
       FROM buckets b
       LEFT JOIN filed f ON f.bucket = b.bucket
       LEFT JOIN resolved r ON r.bucket = b.bucket
       LEFT JOIN open_stock o ON o.bucket = b.bucket
       LEFT JOIN due_stock d ON d.bucket = b.bucket
       ORDER BY b.bucket`,
      params
    );
    const labels = rows.map((r) => {
      const d = new Date(r.bucket);
      return trunc === "hour" ? d.toLocaleTimeString([], { hour: "numeric" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
    });
    let series = {
      new: rows.map((r) => Number(r.new_count)),
      onHold: rows.map((r) => Number(r.on_hold)),
      resolved: rows.map((r) => Number(r.resolved)),
      backlog: rows.map((r) => Number(r.backlog)),
      filed: rows.map((r) => Number(r.filed)),
      open: rows.map((r) => Number(r.open_count)),
      dueToday: rows.map((r) => Number(r.due_today)),
      overdue: rows.map((r) => Number(r.overdue_stock))
    };
    let outLabels = labels;
    const collapse = (values, size) => {
      const out = [];
      for (let i = 0; i < values.length; i += size) {
        out.push(values[Math.min(i + size - 1, values.length - 1)] ?? 0);
      }
      return out;
    };
    const collapseSum = (values, size) => {
      const out = [];
      for (let i = 0; i < values.length; i += size) {
        out.push(values.slice(i, i + size).reduce((a, b) => a + b, 0));
      }
      return out;
    };
    /**
     * Hourly series already comes from DB generate_series + ticket counts.
     * Do not invent leading zeros or calendar labels (e.g. fixed "12 AM") —
     * collapse buckets and keep the real bucket start labels from SQL.
     */
    if (trunc === "hour") {
      if (series.filed.length > 8) {
        const size = Math.ceil(series.filed.length / 6);
        const labelOut: string[] = [];
        for (let i = 0; i < outLabels.length; i += size) {
          labelOut.push(outLabels[i]);
        }
      series = {
          new: collapseSum(series.new, size),
          onHold: collapseSum(series.onHold, size),
          resolved: collapseSum(series.resolved, size),
          backlog: collapseSum(series.backlog, size),
          filed: collapseSum(series.filed, size),
          open: collapse(series.open, size),
          dueToday: collapse(series.dueToday, size),
          overdue: collapse(series.overdue, size)
        };
        outLabels = labelOut.slice(0, series.filed.length);
      }
    } else if (series.new.length > 6) {
      const size = Math.ceil(series.new.length / 6);
      const labelOut = [];
      for (let i = 0; i < series.new.length; i += size) {
        labelOut.push(labels[i]);
      }
      series = {
        new: collapseSum(series.new, size),
        onHold: collapseSum(series.onHold, size),
        resolved: collapseSum(series.resolved, size),
        backlog: collapseSum(series.backlog, size),
        filed: collapseSum(series.filed, size),
        open: collapse(series.open, size),
        dueToday: collapse(series.dueToday, size),
        overdue: collapse(series.overdue, size)
      };
      outLabels = labelOut.slice(0, series.new.length);
    }
    const allValues = [
      ...series.new,
      ...series.onHold,
      ...series.resolved,
      ...series.backlog,
      ...series.filed,
      ...series.open
    ];
    const maxValue = Math.max(...allValues, 1);
    const filedTotal = series.filed.reduce((a, b) => a + b, 0);
    const resolvedTotal = series.resolved.reduce((a, b) => a + b, 0);
    const daySpan = Math.max(1, Math.ceil(hours / 24));
    const avgTicketsPerDay =
      Math.round((filedTotal / daySpan) * 10) / 10;

    const mixParams: unknown[] = [orgId, String(hours)];
    let mixFilter = "";
    if (dataScopeForRole(user.role) === "requester") {
      mixFilter = `AND lower(customer_email) = lower($3)`;
      mixParams.push(user.email);
    }
    const channelsQ = await query(
      `SELECT COALESCE(NULLIF(TRIM(channel), ''), 'Web') AS channel, COUNT(*)::int AS count
       FROM tickets
       WHERE organization_id = $1::bigint
         AND created_at >= NOW() - ($2 || ' hours')::interval
         ${mixFilter}
       GROUP BY 1
       ORDER BY count DESC`,
      mixParams
    );
    const statusQ = await query(
      `SELECT status, COUNT(*)::int AS count
       FROM tickets
       WHERE organization_id = $1::bigint
         AND created_at >= NOW() - ($2 || ' hours')::interval
         ${mixFilter}
       GROUP BY 1
       ORDER BY count DESC`,
      mixParams
    );
    const resolveQ = await query(
      `SELECT
         AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, updated_at) - created_at)) / 3600)
           FILTER (WHERE status = 'Resolved') AS avg_resolve_hours,
         COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved_n
       FROM tickets
       WHERE organization_id = $1::bigint
         AND COALESCE(resolved_at, updated_at) >= NOW() - ($2 || ' hours')::interval
         ${mixFilter}`,
      mixParams
    );
    const avgResolveHoursRaw = Number(resolveQ.rows[0]?.avg_resolve_hours);
    const avgResolveHours = Number.isFinite(avgResolveHoursRaw)
      ? Math.round(avgResolveHoursRaw * 10) / 10
      : null;

    const channelTotal = channelsQ.rows.reduce((s, r) => s + Number(r.count || 0), 0) || 1;
    const statusTotal = statusQ.rows.reduce((s, r) => s + Number(r.count || 0), 0) || 1;

    res.json({
      range,
      labels: outLabels,
      series,
      maxValue,
      totals: {
        new: series.new.reduce((a, b) => a + b, 0),
        onHold: series.onHold.reduce((a, b) => a + b, 0),
        resolved: resolvedTotal,
        backlog: series.backlog.reduce((a, b) => a + b, 0),
        filed: filedTotal,
        open: series.open[series.open.length - 1] || 0,
        dueToday: series.dueToday[series.dueToday.length - 1] || 0,
        overdue: series.overdue[series.overdue.length - 1] || 0,
        avgTicketsPerDay,
        avgResolveHours,
      },
      channels: channelsQ.rows.map((r) => {
        const count = Number(r.count || 0);
        const name = r.channel === "Web" ? "Web Portal" : String(r.channel);
        return {
          name,
          count,
          pct: Math.round((count / channelTotal) * 100),
        };
      }),
      statusOutcomes: statusQ.rows.map((r) => {
        const count = Number(r.count || 0);
        return {
          name: String(r.status || "Unknown"),
          count,
          pct: Math.round((count / statusTotal) * 100),
        };
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard chart" });
  }
});
app.get("/api/analytics", requireAuthOrServiceActor, requireModule("analytics"), async (req: AuthedRequest, res) => {
  try {
    const orgId = req.user.organizationId;
    const range = String(req.query.range || "7days");
    let hours = range === "24hours" ? 24 : range === "30days" ? 24 * 30 : 24 * 7;
    const hoursQ = Number(req.query.hours);
    if (Number.isFinite(hoursQ) && hoursQ >= 1 && hoursQ <= 24 * 90) {
      hours = Math.round(hoursQ);
    }
    const prevHours = hours;
    const trunc = hours <= 36 ? "hour" : "day";
    const current = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
         AVG(EXTRACT(EPOCH FROM (COALESCE(first_response_at, updated_at) - created_at))/60)
           FILTER (WHERE first_response_at IS NOT NULL) AS avg_first_mins,
         AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, updated_at) - created_at))/3600)
           FILTER (WHERE status = 'Resolved') AS avg_resolve_hours,
         AVG(csat_score)::float AS avg_csat,
         COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::int AS csat_count
       FROM tickets
       WHERE organization_id = $1 AND created_at >= NOW() - ($2 || ' hours')::interval`,
      [orgId, String(hours)]
    );
    const previous = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
              AVG(csat_score)::float AS avg_csat,
              COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::int AS csat_count
       FROM tickets
       WHERE organization_id = $1
         AND created_at >= NOW() - ($2 || ' hours')::interval
         AND created_at < NOW() - ($3 || ' hours')::interval`,
      [orgId, String(hours + prevHours), String(hours)]
    );
    const channels = await query(
      `SELECT channel, COUNT(*)::int AS count
       FROM tickets
       WHERE organization_id = $1 AND created_at >= NOW() - ($2 || ' hours')::interval
       GROUP BY channel ORDER BY count DESC`,
      [orgId, String(hours)]
    );
    const series = await query(
      `SELECT date_trunc($3, created_at) AS bucket, COUNT(*)::int AS count
       FROM tickets
       WHERE organization_id = $1 AND created_at >= NOW() - ($2 || ' hours')::interval
       GROUP BY 1 ORDER BY 1`,
      [orgId, String(hours), trunc]
    );
    const agents = await query(
      `SELECT
         assignee_name AS name,
         COUNT(*)::int AS assigned,
         COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
         COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue,
         AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, updated_at) - created_at))/3600)
           FILTER (WHERE status = 'Resolved') AS avg_resolve_hours,
         AVG(csat_score)::float AS avg_csat,
         COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::int AS ratings
       FROM tickets
       WHERE organization_id = $1
         AND created_at >= NOW() - ($2 || ' hours')::interval
         AND assignee_name IS NOT NULL
         AND assignee_name <> 'Unassigned'
       GROUP BY assignee_name
       ORDER BY assigned DESC
       LIMIT 25`,
      [orgId, String(hours)]
    );
    const slaStats = await query(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'Overdue'
              OR (due_at IS NOT NULL AND due_at < COALESCE(
                    CASE WHEN status = 'Resolved' THEN COALESCE(resolved_at, updated_at) END, NOW()
                  ) AND status <> 'Resolved')
         )::int AS breached,
         COUNT(*) FILTER (WHERE status = 'Overdue')::int AS open_overdue,
         COUNT(*)::int AS total
       FROM tickets
       WHERE organization_id = $1 AND created_at >= NOW() - ($2 || ' hours')::interval`,
      [orgId, String(hours)]
    );
    const slaRecent = await query(
      `SELECT ticket_number, subject, assignee_name, customer_name, due_at
       FROM tickets
       WHERE organization_id = $1
         AND status = 'Overdue'
       ORDER BY due_at ASC NULLS LAST
       LIMIT 10`,
      [orgId]
    );
    const cur = current.rows[0] || { total: 0, resolved: 0 };
    const prev = previous.rows[0] || { total: 0, resolved: 0 };
    const total = Number(cur.total || 0);
    const resolved = Number(cur.resolved || 0);
    const prevTotal = Number(prev.total || 0);
    const prevResolved = Number(prev.resolved || 0);
    const csatCount = Number(cur.csat_count || 0);
    const avgCsat = Number(cur.avg_csat);
    const prevCsatCount = Number(prev.csat_count || 0);
    const prevAvgCsat = Number(prev.avg_csat);
    const pctChange = (now, before) => {
      if (before === 0) return now > 0 ? "+100%" : "0%";
      const p = Math.round((now - before) / before * 100);
      return `${p >= 0 ? "+" : ""}${p}%`;
    };
    const label =
      range === "custom"
        ? "vs prior period"
        : range === "24hours"
        ? "vs yesterday"
        : range === "30days"
          ? "vs last month"
          : "vs last week";
    const channelColors = {
      Email: "bg-[#4F46E5]",
      Chat: "bg-[#0EA5E9]",
      Phone: "bg-[#10B981]",
      Web: "bg-[#F59E0B]"
    };
    const channelTotal = channels.rows.reduce(
      (s, r) => s + Number(r.count),
      0
    ) || 1;
    const maxCount = Math.max(...series.rows.map((r) => Number(r.count)), 1);
    const points = series.rows.map(
      (r) => Math.round(Number(r.count) / maxCount * 100)
    );
    const labels = series.rows.map((r) => {
      const d = new Date(r.bucket);
      if (trunc === "hour") {
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    });
    const avgFirst = Number(cur.avg_first_mins);
    const avgResolve = Number(cur.avg_resolve_hours);
    let csatDisplay = "\u2014";
    let csatChange = "No ratings yet";
    let csatUp = true;
    if (csatCount > 0 && Number.isFinite(avgCsat)) {
      const pct = Math.round(avgCsat / 5 * 100);
      csatDisplay = `${pct}%`;
      csatChange = `${avgCsat.toFixed(1)}/5 \xB7 ${csatCount} rating${csatCount === 1 ? "" : "s"}`;
      if (prevCsatCount > 0 && Number.isFinite(prevAvgCsat)) {
        const diff = avgCsat - prevAvgCsat;
        csatUp = diff >= 0;
        csatChange = `${avgCsat.toFixed(1)}/5 (${diff >= 0 ? "+" : ""}${diff.toFixed(1)} ${label}) \xB7 ${csatCount} ratings`;
      }
    }
    const sla = slaStats.rows[0] || { breached: 0, open_overdue: 0, total: 0 };
    const breached = Number(sla.breached || 0);
    const openOverdue = Number(sla.open_overdue || 0);
    const slaTotal = Number(sla.total || 0);
    const breachRate = slaTotal === 0 ? "0%" : `${Math.round(breached / slaTotal * 100)}%`;

    // Snapshot for Diagnostic / Predictive / Prescriptive (ticket + SLA only).
    const liveSnap = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status NOT IN ('Resolved', 'Closed'))::int AS open_now,
         COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue_now,
         COUNT(*) FILTER (
           WHERE status NOT IN ('Resolved', 'Closed')
             AND (
               assignee_id IS NULL
               OR assignee_name IS NULL
               OR assignee_name = ''
               OR assignee_name = 'Unassigned'
               OR resolver_id IS NULL
               OR resolver_name IS NULL
               OR resolver_name = ''
               OR resolver_name = 'Unassigned'
             )
         )::int AS unassigned_now,
         COUNT(*) FILTER (
           WHERE status NOT IN ('Resolved', 'Closed')
             AND lower(priority) IN ('high', 'urgent')
         )::int AS high_open_now,
         COUNT(*) FILTER (
           WHERE status = 'Overdue' AND lower(priority) IN ('high', 'urgent')
         )::int AS high_overdue_now
       FROM tickets
       WHERE organization_id = $1`,
      [orgId]
    );
    const dailySeries = await query(
      `SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS created
       FROM tickets
       WHERE organization_id = $1 AND created_at >= NOW() - ($2 || ' hours')::interval
       GROUP BY 1 ORDER BY 1`,
      [orgId, String(Math.max(hours, 24 * 7))]
    );
    const dailyResolved = await query(
      `SELECT date_trunc('day', COALESCE(resolved_at, updated_at))::date AS day, COUNT(*)::int AS resolved
       FROM tickets
       WHERE organization_id = $1
         AND status = 'Resolved'
         AND COALESCE(resolved_at, updated_at) >= NOW() - ($2 || ' hours')::interval
       GROUP BY 1 ORDER BY 1`,
      [orgId, String(Math.max(hours, 24 * 7))]
    );
    const topChannel = channels.rows[0]
      ? {
          name:
            channels.rows[0].channel === "Web"
              ? "Web Portal"
              : String(channels.rows[0].channel),
          count: Number(channels.rows[0].count || 0),
        }
      : null;
    const worstAgent = [...agents.rows]
      .filter((r) => Number(r.overdue || 0) > 0)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue))[0];

    const snap = liveSnap.rows[0] || {};
    const openNow = Number(snap.open_now || 0);
    const overdueNow = Number(snap.overdue_now || 0);
    const unassignedNow = Number(snap.unassigned_now || 0);
    const highOpenNow = Number(snap.high_open_now || 0);
    const highOverdueNow = Number(snap.high_overdue_now || 0);

    const createdByDay = dailySeries.rows.map((r) => ({
      day: String(r.day),
      n: Number(r.created || 0),
    }));
    const resolvedByDayMap = new Map(
      dailyResolved.rows.map((r) => [String(r.day), Number(r.resolved || 0)])
    );
    const lastN = createdByDay.slice(-7);
    const avgCreated =
      lastN.length > 0
        ? lastN.reduce((s, d) => s + d.n, 0) / lastN.length
        : 0;
    const recentCreated = lastN.slice(-3).reduce((s, d) => s + d.n, 0);
    const olderCreated = lastN.slice(0, Math.max(0, lastN.length - 3)).reduce((s, d) => s + d.n, 0);
    const olderDays = Math.max(1, lastN.length - 3);
    const recentAvg = lastN.length ? recentCreated / Math.min(3, lastN.length) : 0;
    const olderAvg = olderCreated / olderDays;
    const volumeUpPct =
      olderAvg > 0 ? Math.round(((recentAvg - olderAvg) / olderAvg) * 100) : recentAvg > 0 ? 100 : 0;

    const forecastDays = [1, 2, 3].map((i) => ({
      label: `+${i}d`,
      created: Math.max(0, Math.round(avgCreated + (recentAvg - avgCreated) * (i / 3))),
    }));

    const factorRaw = [
      { label: "Open overdue tickets", weight: overdueNow * 3 },
      { label: "Unassigned backlog", weight: unassignedNow * 2.5 },
      { label: "High/urgent open work", weight: highOpenNow * 1.5 },
      { label: "SLA breaches in range", weight: breached * 2 },
    ].filter((f) => f.weight > 0);
    const factorSum = factorRaw.reduce((s, f) => s + f.weight, 0) || 1;
    const factors = factorRaw.map((f) => ({
      label: f.label,
      sharePct: Math.round((f.weight / factorSum) * 100),
    }));

    const needsAttention =
      overdueNow > 0 || unassignedNow > 5 || breached > 0 || volumeUpPct >= 25;
    const diagnosticHeadline = needsAttention
      ? overdueNow > 0
        ? `Overdue queue at ${overdueNow} ticket${overdueNow === 1 ? "" : "s"}`
        : volumeUpPct >= 25
          ? `Ticket volume up ${volumeUpPct}% vs earlier in range`
          : unassignedNow > 0
            ? `${unassignedNow} unassigned ticket${unassignedNow === 1 ? "" : "s"} waiting`
            : `SLA breaches detected in this range (${breached})`
      : "No major anomaly in this range";
    const diagnosticSummary = needsAttention
      ? [
          openOverdue > 0 ? `${openOverdue} currently marked Overdue.` : null,
          unassignedNow > 0 ? `${unassignedNow} still unassigned.` : null,
          highOverdueNow > 0
            ? `${highOverdueNow} high/urgent are overdue.`
            : null,
          topChannel
            ? `Top channel this range: ${topChannel.name} (${topChannel.count}).`
            : null,
          worstAgent
            ? `${worstAgent.name} has ${worstAgent.overdue} overdue assigned.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : "Open, overdue, and SLA signals look stable versus the selected range. Keep monitoring unassigned and high-priority work.";

    const evidence = [
      {
        title: "Open tickets",
        detail: `${openNow} active · not resolved/closed`,
      },
      {
        title: "Open overdue",
        detail: `${overdueNow} ticket${overdueNow === 1 ? "" : "s"} · live status`,
      },
      {
        title: "Unassigned",
        detail: `${unassignedNow} open without an assignee`,
      },
      {
        title: "Breach rate (range)",
        detail: `${breachRate} · ${breached} breached of ${slaTotal} created`,
      },
      ...(worstAgent
        ? [
            {
              title: "Assignee load",
              detail: `${worstAgent.name}: ${worstAgent.overdue} overdue / ${worstAgent.assigned} assigned`,
            },
          ]
        : []),
    ];

    const riskSignals = [
      ...(overdueNow > 0 || forecastDays.some((d) => d.created > avgCreated * 1.2)
        ? [
            {
              level: overdueNow > 3 || volumeUpPct >= 40 ? "high" : "medium",
              title: "SLA / backlog risk",
              detail:
                overdueNow > 0
                  ? `Forecast volume ~${forecastDays[0]?.created ?? 0}/day with ${overdueNow} already overdue.`
                  : `Create volume trending up (${volumeUpPct}%); watch capacity.`,
            },
          ]
        : []),
      ...(unassignedNow > 0
        ? [
            {
              level: unassignedNow > 10 ? "high" : "info",
              title: "Unassigned backlog",
              detail: `${unassignedNow} tickets may age into overdue without owners.`,
            },
          ]
        : []),
    ];

    const actions: Array<{
      priority: "high" | "medium" | "low";
      title: string;
      impact: string;
      detail: string;
      navigate: string;
    }> = [];
    if (unassignedNow > 0) {
      actions.push({
        priority: unassignedNow > 5 ? "high" : "medium",
        title: `Assign ${unassignedNow} unassigned ticket${unassignedNow === 1 ? "" : "s"}`,
        impact: "Cuts queue aging and overdue risk",
        detail: "Route unassigned work to teams with capacity before SLA clocks burn down.",
        navigate: "unassigned",
      });
    }
    if (highOverdueNow > 0 || overdueNow > 0) {
      actions.push({
        priority: "high",
        title: "Clear high/urgent overdue first",
        impact: `Focus ${highOverdueNow || overdueNow} overdue item${(highOverdueNow || overdueNow) === 1 ? "" : "s"}`,
        detail: "Prioritize overdue high and urgent tickets, then remaining overdue.",
        navigate: "team-queue",
      });
    }
    if (worstAgent && Number(worstAgent.overdue) >= 2) {
      actions.push({
        priority: "medium",
        title: `Rebalance load for ${worstAgent.name}`,
        impact: "Lower assignee overdue concentration",
        detail: `${worstAgent.overdue} overdue on one assignee — redistribute or escalate.`,
        navigate: "agent-queues",
      });
    }
    if (breached > 0 && actions.length < 3) {
      actions.push({
        priority: "low",
        title: "Review priority SLA hours",
        impact: "Reduce repeat breaches on the same priority band",
        detail: `${breached} breach(es) in range — check Priorities / SLA targets for noisy bands.`,
        navigate: "priorities",
      });
    }
    if (actions.length === 0) {
      actions.push({
        priority: "low",
        title: "Keep monitoring queue health",
        impact: "Maintain current SLA posture",
        detail: "No urgent backlog signals. Spot-check unassigned and due-today daily.",
        navigate: "dashboard",
      });
    }

    res.json({
      totalTickets: total.toLocaleString(),
      totalTicketsChange: `${pctChange(total, prevTotal)} ${label}`,
      totalTicketsUp: total >= prevTotal,
      resolvedTickets: resolved.toLocaleString(),
      resolvedTicketsChange: `${pctChange(resolved, prevResolved)} ${label}`,
      resolvedTicketsUp: resolved >= prevResolved,
      firstResponse: Number.isFinite(avgFirst) ? `${Math.round(avgFirst)}m` : "\u2014",
      firstResponseChange: `vs prior period`,
      firstResponseUp: false,
      resolutionTime: Number.isFinite(avgResolve) ? `${avgResolve.toFixed(1)}h` : "\u2014",
      resolutionTimeChange: `vs prior period`,
      resolutionTimeUp: false,
      csat: csatDisplay,
      csatChange,
      csatUp,
      csatRatings: csatCount,
      weeklyPoints: points.length ? points : [0],
      weeklyLabels: labels.length ? labels : ["Now"],
      channels: channels.rows.map((r) => {
        const count = Number(r.count);
        const pct = Math.round(count / channelTotal * 100);
        const name = r.channel === "Web" ? "Web Portal" : String(r.channel);
        return {
          name,
          percentage: `${pct}%`,
          count: String(count),
          colorClass: channelColors[String(r.channel)] || "bg-neutral-500"
        };
      }),
      totalChannelsText: `Total active channels analyzed: ${channels.rows.length}`,
      agentPerformance: agents.rows.map((r) => ({
        name: String(r.name),
        assigned: Number(r.assigned || 0),
        resolved: Number(r.resolved || 0),
        overdue: Number(r.overdue || 0),
        avgResolveHours: Number.isFinite(Number(r.avg_resolve_hours)) ? `${Number(r.avg_resolve_hours).toFixed(1)}h` : "\u2014",
        avgCsat: Number(r.ratings || 0) > 0 && Number.isFinite(Number(r.avg_csat)) ? `${Number(r.avg_csat).toFixed(1)}/5` : "\u2014",
        ratings: Number(r.ratings || 0)
      })),
      slaReport: {
        breached,
        openOverdue,
        breachRate,
        recent: slaRecent.rows.map((r) => ({
          id: String(r.ticket_number),
          subject: String(r.subject),
          assignee: String(r.assignee_name || "Unassigned"),
          customerName: String(r.customer_name || ""),
          dueAt: r.due_at ? formatRelative(r.due_at) : "\u2014"
        }))
      },
      insights: {
        diagnostic: {
          status: needsAttention ? "needs_attention" : "stable",
          headline: diagnosticHeadline,
          summary: diagnosticSummary,
          deltaLabel:
            volumeUpPct !== 0
              ? `${volumeUpPct >= 0 ? "+" : ""}${volumeUpPct}% create volume vs earlier days`
              : "Volume flat vs earlier days",
          factors,
          evidence,
        },
        predictive: {
          volumeForecast: forecastDays,
          avgDailyCreated: Math.round(avgCreated * 10) / 10,
          resolvedSample: lastN.map((d) => ({
            day: d.day,
            created: d.n,
            resolved: resolvedByDayMap.get(d.day) || 0,
          })),
          riskSignals,
        },
        prescriptive: {
          banner:
            "Recommendations use live ticket and SLA signals. Ask the co-worker to explore alternatives.",
          actions: actions.slice(0, 3),
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});
app.get("/api/analytics/export", requireAuth, requireModule("analytics"), async (req: AuthedRequest, res) => {
  try {
    const orgId = req.user.organizationId;
    const range = String(req.query.range || "7days");
    let hours = range === "24hours" ? 24 : range === "30days" ? 24 * 30 : 24 * 7;
    const hoursQ = Number(req.query.hours);
    if (Number.isFinite(hoursQ) && hoursQ >= 1 && hoursQ <= 24 * 90) {
      hours = Math.round(hoursQ);
    }
    const summary = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
         COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue,
         AVG(csat_score)::float AS avg_csat,
         COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::int AS csat_count
       FROM tickets
       WHERE organization_id = $1 AND created_at >= NOW() - ($2 || ' hours')::interval`,
      [orgId, String(hours)]
    );
    const agents = await query(
      `SELECT
         assignee_name AS name,
         COUNT(*)::int AS assigned,
         COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
         COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue,
         ROUND(AVG(csat_score)::numeric, 2) AS avg_csat
       FROM tickets
       WHERE organization_id = $1
         AND created_at >= NOW() - ($2 || ' hours')::interval
         AND assignee_name IS NOT NULL AND assignee_name <> 'Unassigned'
       GROUP BY assignee_name
       ORDER BY assigned DESC`,
      [orgId, String(hours)]
    );
    const breaches = await query(
      `SELECT ticket_number, subject, assignee_name, customer_name, status, due_at, created_at
       FROM tickets
       WHERE organization_id = $1
         AND created_at >= NOW() - ($2 || ' hours')::interval
         AND (status = 'Overdue' OR (due_at IS NOT NULL AND due_at < NOW() AND status <> 'Resolved'))
       ORDER BY due_at ASC NULLS LAST`,
      [orgId, String(hours)]
    );
    const s = summary.rows[0] || {};
    const esc = (v) => {
      const str = v == null ? "" : String(v);
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };
    const lines = [];
    lines.push("Section,Metric,Value");
    lines.push(`Summary,Range,${esc(range)}`);
    lines.push(`Summary,Total tickets,${esc(s.total)}`);
    lines.push(`Summary,Resolved,${esc(s.resolved)}`);
    lines.push(`Summary,Open overdue,${esc(s.overdue)}`);
    lines.push(
      `Summary,Avg CSAT,${Number(s.csat_count) > 0 ? esc(Number(s.avg_csat).toFixed(2)) : ""}`
    );
    lines.push(`Summary,CSAT ratings,${esc(s.csat_count)}`);
    lines.push("");
    lines.push("Agent,Assigned,Resolved,Overdue,Avg CSAT");
    for (const a of agents.rows) {
      lines.push(
        [a.name, a.assigned, a.resolved, a.overdue, a.avg_csat ?? ""].map(esc).join(",")
      );
    }
    lines.push("");
    lines.push("Ticket,Subject,Assignee,Customer,Status,Due At,Created At");
    for (const b of breaches.rows) {
      lines.push(
        [
          b.ticket_number,
          b.subject,
          b.assignee_name,
          b.customer_name,
          b.status,
          b.due_at,
          b.created_at
        ].map(esc).join(",")
      );
    }
    const filename = `worktual-analytics-${range}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n"));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export analytics" });
  }
});
app.get("/api/agents", requireAuthOrServiceActor, async (req: AuthedRequest, res) => {
  try {
    const role = req.user.role;
    if (role !== "admin" && role !== "agent" && role !== "resolver") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const agents = await listAssignableAgents(req.user.organizationId);
    res.json(
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        skills: a.skills
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load agents" });
  }
});
app.post(
  "/api/ai-insights",
  requireAuth,
  async (req: AuthedRequest, res) => {
    if (req.user.role !== "admin" && req.user.role !== "agent" && !canAccessModule(req.user.role, "analytics")) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const orgId = req.user.organizationId;
    const scope = await ticketListScopeClause(
      req.user,
      req.user.role === "admin" || req.user.role === "viewer" ? "org" : req.user.role === "agent" ? "team" : "assignee"
    );
    const { rows: tickets } = await query(
      `SELECT ticket_number, subject, priority, status, customer_name, channel
       FROM tickets
       WHERE organization_id = $1 ${scope.sql}
       ORDER BY created_at DESC LIMIT 50`,
      [orgId, ...scope.params]
    );
    try {
      const upstream = await fetch(`${COWORKER_AGENTS_URL}/insights`, {
        method: "POST",
        headers: coworkerAgentsHeaders(),
        body: JSON.stringify({
          tickets: tickets.map((t) => ({
            ticket_number: t.ticket_number,
            subject: t.subject,
            priority: t.priority,
            status: t.status,
            customer_name: t.customer_name,
            channel: t.channel
          }))
        })
      });
      if (!upstream.ok) {
        throw new Error(`insights HTTP ${upstream.status}`);
      }
      const data = await upstream.json();
      if (!Array.isArray(data.insights) || !data.insights.length) {
        throw new Error("empty insights");
      }
      res.json({
        insights: data.insights,
        source: data.source || "coworker-agents LLM"
      });
    } catch (err) {
      console.warn("ai-insights Python proxy failed", err);
      res.json({
        insights: [
          `**Ticket load**: ${tickets.length} recent tickets in scope.`,
          "**SLA focus**: Prioritize overdue and unassigned high-priority items.",
          "**Ops tip**: Start ai-agents on :8012 for live LLM insights."
        ],
        source: "Express fallback (Python unavailable)"
      });
    }
  }
);
app.get(
  "/api/audit",
  requireAuth,
  requireModule("audit"),
  async (req: AuthedRequest, res) => {
    try {
      const limit = Number(req.query.limit || 100);
      const events = await listAuditEvents(req.user.organizationId, {
        limit: Number.isFinite(limit) ? limit : 100,
        action: String(req.query.action || ""),
        actor: String(req.query.actor || ""),
        ticket: String(req.query.ticket || ""),
        range: String(req.query.range || ""),
      });
      res.json(events);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load audit log" });
    }
  }
);
app.get(
  "/api/csat-reports",
  requireAuth,
  requireModule("csat-reports"),
  async (req: AuthedRequest, res) => {
    try {
      const orgId = req.user.organizationId;
      const range = String(req.query.range || "30days");
      const days = range === "7days" ? 7 : range === "90days" ? 90 : 30;
      const summaryRated = await query(
        `SELECT
           COUNT(*)::int AS ratings,
           AVG(csat_score)::float AS avg_score,
           COUNT(*) FILTER (WHERE status = 'Resolved')::int AS rated_resolved,
           COUNT(*) FILTER (WHERE csat_score <= 2)::int AS low_scores
         FROM tickets
         WHERE organization_id = $1
           AND csat_score IS NOT NULL
           AND COALESCE(csat_rated_at, updated_at) >= NOW() - ($2 || ' days')::interval`,
        [orgId, String(days)]
      );
      const byAssignee = await query(
        `SELECT
           COALESCE(NULLIF(TRIM(assignee_name), ''), 'Unassigned') AS name,
           COUNT(*)::int AS ratings,
           AVG(csat_score)::float AS avg_score
         FROM tickets
         WHERE organization_id = $1
           AND csat_score IS NOT NULL
           AND COALESCE(csat_rated_at, updated_at) >= NOW() - ($2 || ' days')::interval
         GROUP BY 1
         ORDER BY ratings DESC, name ASC
         LIMIT 50`,
        [orgId, String(days)]
      );
      const byTeam = await query(
        `SELECT
           COALESCE(NULLIF(TRIM(queue_name), ''), 'No team') AS name,
           COUNT(*)::int AS ratings,
           AVG(csat_score)::float AS avg_score
         FROM tickets
         WHERE organization_id = $1
           AND csat_score IS NOT NULL
           AND COALESCE(csat_rated_at, updated_at) >= NOW() - ($2 || ' days')::interval
         GROUP BY 1
         ORDER BY ratings DESC, name ASC
         LIMIT 50`,
        [orgId, String(days)]
      );
      const trend = await query(
        `SELECT date_trunc('day', COALESCE(csat_rated_at, updated_at)) AS day,
                AVG(csat_score)::float AS avg_score,
                COUNT(*)::int AS ratings
         FROM tickets
         WHERE organization_id = $1
           AND csat_score IS NOT NULL
           AND COALESCE(csat_rated_at, updated_at) >= NOW() - ($2 || ' days')::interval
         GROUP BY 1
         ORDER BY 1`,
        [orgId, String(days)]
      );
      const s = summaryRated.rows[0] || {};
      res.json({
        range,
        ratings: Number(s.ratings || 0),
        avgScore: s.avg_score != null ? Number(Number(s.avg_score).toFixed(2)) : null,
        ratedResolved: Number(s.rated_resolved || 0),
        lowScores: Number(s.low_scores || 0),
        reopenRate: Number(s.ratings || 0) > 0 ? `${Math.round(
          Number(s.low_scores || 0) / Number(s.ratings || 1) * 100
        )}% low CSAT` : "\u2014",
        byAssignee: byAssignee.rows.map((r) => ({
          name: String(r.name),
          ratings: Number(r.ratings || 0),
          avgScore: r.avg_score != null ? Number(Number(r.avg_score).toFixed(2)) : null
        })),
        byTeam: byTeam.rows.map((r) => ({
          name: String(r.name),
          ratings: Number(r.ratings || 0),
          avgScore: r.avg_score != null ? Number(Number(r.avg_score).toFixed(2)) : null
        })),
        trend: trend.rows.map((r) => ({
          day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
          avgScore: r.avg_score != null ? Number(Number(r.avg_score).toFixed(2)) : null,
          ratings: Number(r.ratings || 0)
        }))
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load CSAT report" });
    }
  }
);
app.get(
  "/api/macros",
  requireAuthOrServiceActor,
  requireModule("macros"),
  async (req: AuthedRequest, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const params: unknown[] = [req.user.organizationId];
      let where = "organization_id = $1";
      if (q) {
        const escaped = q.replace(/[\\%_]/g, "\\$&");
        params.push(`%${escaped}%`);
        const p = `$${params.length}`;
        where += ` AND (
          title ILIKE ${p} ESCAPE '\\'
          OR body ILIKE ${p} ESCAPE '\\'
          OR COALESCE(created_by_name, '') ILIKE ${p} ESCAPE '\\'
        )`;
      }
      const { rows } = await query(
        `SELECT id, title, body, created_by_id, created_by_name, created_at, updated_at
         FROM ticketing.macros
         WHERE ${where}
         ORDER BY updated_at DESC NULLS LAST, title ASC`,
        params
      );
      const roster = await listAssignableAgents(req.user.organizationId);
      const staffById = new Map(roster.map((user) => [user.id, user]));
      res.json(
        rows.map((r) => ({
          id: String(r.id),
          title: String(r.title),
          body: String(r.body),
          createdByName: (r.created_by_id ? staffById.get(String(r.created_by_id))?.name : void 0) || (r.created_by_name ? String(r.created_by_name) : null),
          createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)
        }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load macros" });
    }
  }
);
app.post(
  "/api/macros",
  requireAuthOrServiceActor,
  requireModule("macros"),
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      const title = String(req.body?.title || "").trim();
      const body = String(req.body?.body || "").trim();
      if (!title || !body) {
        return res.status(400).json({ error: "Title and body are required." });
      }
      const { rows } = await query(
        `INSERT INTO ticketing.macros (
           organization_id, title, body, created_by_id, created_by_name
         ) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, title, body, created_by_name, created_at, updated_at`,
        [
          req.user.organizationId,
          title,
          body,
          req.user.id,
          req.user.name
        ]
      );
      const r = rows[0];
      res.status(201).json({
        id: String(r.id),
        title: String(r.title),
        body: String(r.body),
        createdByName: r.created_by_name ? String(r.created_by_name) : null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create macro" });
    }
  }
);
app.delete(
  "/api/macros/:id",
  requireAuthOrServiceActor,
  requireModule("macros"),
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      const result = await query(
        `DELETE FROM ticketing.macros
         WHERE id = $1 AND organization_id = $2
         RETURNING id`,
        [req.params.id, req.user.organizationId]
      );
      if (!result.rows[0]) {
        return res.status(404).json({ error: "Macro not found" });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete macro" });
    }
  }
);
app.get(
  "/api/priorities",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
    try {
      const includeInactive = req.user.role === "admin" && (String(req.query.all || "") === "1" || String(req.query.all || "").toLowerCase() === "true");
      const list = await listOrgPriorities(req.user.organizationId, {
        includeInactive
      });
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load priorities" });
    }
  }
);
app.post(
  "/api/priorities",
  requireAuthOrServiceActor,
  requireModule("priorities"),
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const displayName = String(
        req.body?.displayName || req.body?.label || ""
      ).trim();
      const resolutionHours = Number(
        req.body?.resolutionHours ?? req.body?.slaHours
      );
      const created = await createOrgPriority(req.user.organizationId, {
        displayName,
        resolutionHours
      });
      res.status(201).json(created);
    } catch (err) {
      const status = Number(err.status || 500);
      if (status >= 400 && status < 500) {
        return res.status(status).json({
          error: err.message || "Invalid priority"
        });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to create priority" });
    }
  }
);
app.patch(
  "/api/priorities/:id",
  requireAuthOrServiceActor,
  requireModule("priorities"),
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const patch = {};
      if (req.body?.displayName !== void 0 || req.body?.label !== void 0) {
        patch.displayName = String(req.body.displayName ?? req.body.label);
      }
      if (req.body?.resolutionHours !== void 0 || req.body?.slaHours !== void 0) {
        patch.resolutionHours = Number(
          req.body.resolutionHours ?? req.body.slaHours
        );
      }
      if (req.body?.active !== void 0) {
        patch.active = Boolean(req.body.active);
      }
      const updated = await updateOrgPriority(
        req.user.organizationId,
        String(req.params.id),
        patch
      );
      if (!updated) {
        return res.status(404).json({ error: "Priority not found" });
      }
      res.json(updated);
    } catch (err) {
      const status = Number(err.status || 500);
      if (status >= 400 && status < 500) {
        return res.status(status).json({
          error: err.message || "Invalid priority update"
        });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to update priority" });
    }
  }
);
app.delete(
  "/api/priorities/:id",
  requireAuthOrServiceActor,
  requireModule("priorities"),
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const result = await deleteOrgPriority(
        req.user.organizationId,
        String(req.params.id)
      );
      res.json(result);
    } catch (err) {
      const status = Number(err.status || 500);
      if (status >= 400 && status < 500) {
        return res.status(status).json({
          error: err.message || "Cannot delete priority"
        });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to delete priority" });
    }
  }
);
app.get(
  "/api/statuses",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
    try {
      const includeInactive = req.user.role === "admin" && (String(req.query.all || "") === "1" || String(req.query.all || "").toLowerCase() === "true");
      const list = await listOrgTicketStatuses(req.user.organizationId, {
        includeInactive
      });
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load statuses" });
    }
  }
);
app.post(
  "/api/statuses",
  requireAuthOrServiceActor,
  requireModule("priorities"),
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const displayName = String(
        req.body?.displayName || req.body?.label || ""
      ).trim();
      const created = await createOrgTicketStatus(req.user.organizationId, {
        displayName
      });
      res.status(201).json(created);
    } catch (err) {
      const status = Number(err.status || 500);
      if (status >= 400 && status < 500) {
        return res.status(status).json({
          error: err.message || "Invalid status"
        });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to create status" });
    }
  }
);
app.patch(
  "/api/statuses/:id",
  requireAuthOrServiceActor,
  requireModule("priorities"),
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const patch = {};
      if (req.body?.displayName !== void 0 || req.body?.label !== void 0) {
        patch.displayName = String(req.body.displayName ?? req.body.label);
      }
      if (req.body?.active !== void 0) {
        patch.active = Boolean(req.body.active);
      }
      const updated = await updateOrgTicketStatus(
        req.user.organizationId,
        String(req.params.id),
        patch
      );
      if (!updated) {
        return res.status(404).json({ error: "Status not found" });
      }
      res.json(updated);
    } catch (err) {
      const status = Number(err.status || 500);
      if (status >= 400 && status < 500) {
        return res.status(status).json({
          error: err.message || "Invalid status update"
        });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to update status" });
    }
  }
);
app.delete(
  "/api/statuses/:id",
  requireAuthOrServiceActor,
  requireModule("priorities"),
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const result = await deleteOrgTicketStatus(
        req.user.organizationId,
        String(req.params.id)
      );
      res.json(result);
    } catch (err) {
      const status = Number(err.status || 500);
      if (status >= 400 && status < 500) {
        return res.status(status).json({
          error: err.message || "Cannot delete status"
        });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to delete status" });
    }
  }
);
app.get(
  "/api/customers/360",
  requireAuth,
  canMutate,
  async (req: AuthedRequest, res) => {
    try {
      const email = String(req.query.email || "").trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ error: "email is required" });
      }
      const orgId = req.user.organizationId;
      const role = req.user.role;
      let scopeSql = "";
      const scopeParams = [orgId, email];
      if (role === "resolver") {
        scopeSql = `AND (
          assignee_id = $3::bigint
          OR lower(COALESCE(assignee_name, '')) = lower($4)
        )`;
        scopeParams.push(req.user.id, req.user.name);
      } else if (role === "agent") {
        const teams = await listTicketingTeams(orgId);
        const mine = teams.filter(
          (t) => t.memberIds.includes(req.user.id) || t.members.some((m) => m.id === req.user.id)
        );
        const ids = mine.map((t) => t.id);
        const names = mine.map((t) => t.name.toLowerCase());
        scopeSql = `AND (
          assignee_id = $3::bigint
          OR lower(COALESCE(assignee_name, '')) = lower($4)
          OR queue_id = ANY($5::bigint[])
          OR lower(COALESCE(queue_name, '')) = ANY($6::text[])
        )`;
        scopeParams.push(req.user.id, req.user.name, ids, names);
      }
      const { rows } = await query(
        `SELECT ticket_number, subject, status, priority, assignee_name,
                queue_name, csat_score, created_at, updated_at
         FROM tickets
         WHERE organization_id = $1 AND lower(customer_email) = $2
         ${scopeSql}
         ORDER BY created_at DESC
         LIMIT 25`,
        scopeParams
      );
      const ratings = rows.filter((r) => r.csat_score != null);
      const avgCsat = ratings.length > 0 ? Number(
        (ratings.reduce((s, r) => s + Number(r.csat_score), 0) / ratings.length).toFixed(2)
      ) : null;
      res.json({
        email,
        totalTickets: rows.length,
        avgCsat,
        ratingsCount: ratings.length,
        tickets: rows.map((r) => ({
          id: String(r.ticket_number),
          subject: String(r.subject),
          status: String(r.status),
          priority: String(r.priority),
          assignee: String(r.assignee_name || "Unassigned"),
          queue: r.queue_name ? String(r.queue_name) : null,
          csatScore: r.csat_score != null ? Number(r.csat_score) : null,
          createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)
        }))
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load customer 360" });
    }
  }
);
app.get(
  "/api/agent/triage-stats",
  requireAuthOrServiceActor,
  async (req: AuthedRequest, res) => {
    try {
      const role = req.user.role;
      if (role !== "agent" && role !== "admin") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const orgId = req.user.organizationId;
      const userId = req.user.id;
      const created = await query(
        `SELECT COUNT(*)::int AS n FROM tickets
         WHERE organization_id = $1 AND created_by_id = $2::bigint`,
        [orgId, userId]
      );
      const createdAudit = await query(
        `SELECT COUNT(*)::int AS n FROM ticketing.audit_events
         WHERE organization_id = $1 AND actor_id = $2::bigint AND action = 'ticket.created'`,
        [orgId, userId]
      );
      const reassigned = await query(
        `SELECT COUNT(*)::int AS n FROM ticketing.audit_events
         WHERE organization_id = $1
           AND actor_id = $2::bigint
           AND action IN ('ticket.assigned', 'ticket.escalated')
           AND COALESCE(meta->>'to', '') <> $3`,
        [orgId, userId, req.user.name]
      );
      const teams = await listTicketingTeams(orgId);
      const mine = teams.filter(
        (t) => t.memberIds.includes(userId) || t.members.some((m) => m.id === userId)
      );
      let openOnTeams = 0;
      if (mine.length) {
        const ids = mine.map((t) => t.id);
        const names = mine.map((t) => t.name.toLowerCase());
        const open = await query(
          `SELECT COUNT(*)::int AS n FROM tickets
           WHERE organization_id = $1
             AND status <> 'Resolved'
             AND (
               queue_id = ANY($2::bigint[])
               OR lower(COALESCE(queue_name, '')) = ANY($3::text[])
             )`,
          [orgId, ids, names]
        );
        openOnTeams = Number(open.rows[0]?.n || 0);
      }
      res.json({
        createdByMe: Math.max(
          Number(created.rows[0]?.n || 0),
          Number(createdAudit.rows[0]?.n || 0)
        ),
        reassignedOut: Number(reassigned.rows[0]?.n || 0),
        openOnMyTeams: openOnTeams
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load triage stats" });
    }
  }
);
app.get("/api/org-branding", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const slug = await ensureOrgPortalSlug(String(req.user!.organizationId));
    const { rows } = await query(
      `SELECT COALESCE(s.ticket_prefix, '#') AS ticket_prefix,
              s.portal_label,
              COALESCE(s.display_timezone, 'UTC') AS display_timezone,
              a.company_name AS name,
              COALESCE(s.portal_slug, a.support_portal_slug) AS slug,
              COALESCE(s.portal_auth_mode, 'otp') AS portal_auth_mode,
              COALESCE(a.business_type, 'b2c') AS business_type
       FROM accounts.organizations a
       LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
       WHERE a.id = $1`,
      [req.user.organizationId]
    );
    const r = rows[0] || {};
    const resolvedSlug = String(r.slug || slug || "");
    res.json({
      ticketPrefix: String(r.ticket_prefix || "#"),
      portalLabel: r.portal_label ? String(r.portal_label) : "",
      displayTimezone: String(r.display_timezone || "UTC"),
      organizationName: req.user.organizationName || (r.name ? String(r.name) : ""),
      slug: resolvedSlug,
      helpCenterPath: resolvedSlug ? `/hc/${encodeURIComponent(resolvedSlug)}` : "",
      supportPortalPath: resolvedSlug
        ? `/support/${encodeURIComponent(resolvedSlug)}`
        : "",
      portalAuthMode: String(r.portal_auth_mode || "otp") === "password" ? "password" : "otp",
      businessType: String(r.business_type || "b2c") === "b2b" ? "b2b" : "b2c"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load org branding" });
  }
});
app.get(
  "/api/org-preferences",
  requireAuthOrServiceActor,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      const slug = await ensureOrgPortalSlug(String(req.user!.organizationId));
      const { rows } = await query(
        `SELECT COALESCE(s.ticket_prefix, '#') AS ticket_prefix,
              s.portal_label,
              COALESCE(s.display_timezone, 'UTC') AS display_timezone,
              a.company_name AS name,
              COALESCE(s.portal_slug, a.support_portal_slug) AS slug,
              COALESCE(s.portal_auth_mode, 'otp') AS portal_auth_mode,
              COALESCE(a.business_type, 'b2c') AS business_type
       FROM accounts.organizations a
       LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
       WHERE a.id = $1`,
        [req.user.organizationId]
      );
      const r = rows[0] || {};
      const resolvedSlug = String(r.slug || slug || "");
      res.json({
        ticketPrefix: String(r.ticket_prefix || "#"),
        portalLabel: r.portal_label ? String(r.portal_label) : "",
        displayTimezone: String(r.display_timezone || "UTC"),
        organizationName: req.user.organizationName || (r.name ? String(r.name) : ""),
        slug: resolvedSlug,
        helpCenterPath: resolvedSlug ? `/hc/${encodeURIComponent(resolvedSlug)}` : "",
        supportPortalPath: resolvedSlug
          ? `/support/${encodeURIComponent(resolvedSlug)}`
          : "",
        portalAuthMode: String(r.portal_auth_mode || "otp") === "password" ? "password" : "otp",
        businessType: String(r.business_type || "b2c") === "b2b" ? "b2b" : "b2c"
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load org preferences" });
    }
  }
);
app.put(
  "/api/org-preferences",
  requireAuthOrServiceActor,
  requireModule("org-preferences"),
  async (req: AuthedRequest, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Admin only" });
      }
      const ticketPrefix = String(req.body?.ticketPrefix ?? "#").slice(0, 8);
      const portalLabel = String(req.body?.portalLabel ?? "").slice(0, 80);
      const displayTimezone = String(req.body?.displayTimezone ?? "UTC").slice(
        0,
        64
      );
      const portalAuthMode = String(req.body?.portalAuthMode || "").trim() === "password" ? "password" : "otp";
      const ensuredSlug = await ensureOrgPortalSlug(String(req.user.organizationId));
      const { rows } = await query(
        `INSERT INTO ticketing.org_settings (
           organization_id, ticket_prefix, portal_label, display_timezone, portal_auth_mode, portal_slug
         ) VALUES ($5::bigint, $1, NULLIF($2, ''), $3, $4, NULLIF($6, ''))
         ON CONFLICT (organization_id) DO UPDATE SET
           ticket_prefix = EXCLUDED.ticket_prefix,
           portal_label = EXCLUDED.portal_label,
           display_timezone = EXCLUDED.display_timezone,
           portal_auth_mode = EXCLUDED.portal_auth_mode,
           portal_slug = COALESCE(
             NULLIF(ticketing.org_settings.portal_slug, ''),
             EXCLUDED.portal_slug
           ),
           updated_at = NOW()
         RETURNING ticket_prefix, portal_label, display_timezone, portal_auth_mode, portal_slug`,
        [
          ticketPrefix || "#",
          portalLabel,
          displayTimezone || "UTC",
          portalAuthMode,
          req.user.organizationId,
          ensuredSlug,
        ]
      );
      const hub = await query(
        `SELECT company_name AS name,
                COALESCE(support_portal_slug, '') AS hub_slug,
                COALESCE(business_type, 'b2c') AS business_type
         FROM accounts.organizations WHERE id = $1::bigint`,
        [req.user.organizationId]
      );
      const r = rows[0] || {};
      const h = hub.rows[0] || {};
      const slug = String(r.portal_slug || h.hub_slug || ensuredSlug || "");
      res.json({
        ticketPrefix: String(r.ticket_prefix || "#"),
        portalLabel: r.portal_label ? String(r.portal_label) : "",
        displayTimezone: String(r.display_timezone || "UTC"),
        organizationName: req.user.organizationName || (h.name ? String(h.name) : ""),
        slug,
        helpCenterPath: slug ? `/hc/${encodeURIComponent(slug)}` : "",
        supportPortalPath: slug ? `/support/${encodeURIComponent(slug)}` : "",
        portalAuthMode: String(r.portal_auth_mode || "otp") === "password" ? "password" : "otp",
        businessType: String(h.business_type || "b2c") === "b2b" ? "b2b" : "b2c"
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save org preferences" });
    }
  }
);
app.get(
  "/api/escalation-directory",
  requireAuthOrServiceActor,
  requireModule("escalation-directory"),
  async (req: AuthedRequest, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const skill = String(req.query.skill || "").trim();
      let teams = await listTicketingTeams(req.user.organizationId);
      if (q || skill) {
        teams = teams.filter((t) => teamMatchesDirectoryQuery(t, q, skill));
      }
      res.json(
        teams.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          openTickets: t.openTickets,
          members: t.members.map((m) => ({
            id: m.id,
            name: m.name,
            email: m.email,
            role: m.role,
            skills: m.skills
          }))
        }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load escalation directory" });
    }
  }
);

async function startServer() {
  let sweepStarted = false;
  const beginSweepTimer = () => {
    if (sweepStarted) return;
    sweepStarted = true;
    startSlaSweepTimer();
  };

  bootstrap()
    .then(async () => {
      beginSweepTimer();
      try {
        await ensureTicketEventOutboxTable();
        startTicketEventOutboxWorker();
      } catch (err) {
        console.warn("ticket event outbox bootstrap:", (err as Error).message);
      }
      console.log("Startup bootstrap finished.");
    })
    .catch((err) => {
      console.error("Startup bootstrap failed:", err);
    });

  registerPortalRoutes(app);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const frameAncestors =
    process.env.TICKETING_FRAME_ANCESTORS || "frame-ancestors 'self' *";

  if (API_ONLY) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Ticketing API running on http://0.0.0.0:${PORT} (API-only mode)`
      );
    });
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: FRONTEND_ROOT,
      configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
      server: {
        middlewareMode: true,
        fs: {
          deny: [
            ".env",
            ".env.*",
            "**/.env",
            "**/.env.*",
            "**/server.ts",
            "**/package.json",
            "**/package-lock.json",
            "**/*.pem",
            "**/*.key",
          ],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(FRONTEND_ROOT, "dist");
    app.use((req, res, next) => {
      if (!req.path.startsWith("/api")) {
        res.setHeader("Content-Security-Policy", frameAncestors);
      }
      next();
    });
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `Server running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || "development"} mode`
    );
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
