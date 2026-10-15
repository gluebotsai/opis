import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import type { NextFunction, Request, Response } from "express";
import { query } from "./db";
import { sendCustomerEmail } from "./customerMail";
import { sendCustomerSms } from "./smsNotify";
import { requireOrganizationHasTicketingProduct } from "./accountsSync";
import {
  findActiveCustomer,
  findDirectoryCustomer,
  findDirectoryCustomerByPortalEmail,
  normalizeEmail,
  normalizePhone,
  type DirectoryCustomer,
} from "./customersDirectory";

export const PORTAL_COOKIE = "wt_portal";
export const PORTAL_JWT_TYP = "portal";

export type PortalAuthMode = "password" | "otp";

export type PortalCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  organizationId: string;
  sessionId?: string;
};

export type PortalAuthedRequest = Request & {
  portalCustomer?: PortalCustomer;
};

/** Service actor for portal chat memory/tools (not staff users table). */
export async function resolvePortalServiceActor(
  actorId: string,
  orgId: string
): Promise<{
  id: string;
  name: string;
  email: string;
  initials: string;
  role: "portal_guest" | "portal_customer";
  organizationId: string;
} | null> {
  const id = String(actorId || "").trim();
  const org = String(orgId || "").trim();
  if (!id || !org) return null;

  if (id.toLowerCase().startsWith("portal-guest:")) {
    return {
      id,
      name: "Visitor",
      email: "",
      initials: "V",
      role: "portal_guest",
      organizationId: org,
    };
  }

  // Hub A2A uses hub:<client_id> — not a CDP/customer bigint id.
  if (id.toLowerCase().startsWith("hub:")) {
    return null;
  }

  const customer = await findActiveCustomer({
    organizationId: org,
    customerId: id,
  });
  if (customer && String(customer.organizationId) === org) {
    const name = String(customer.name || "Customer").trim() || "Customer";
    const initials =
      name
        .split(/\s+/)
        .map((part) => part[0] || "")
        .join("")
        .slice(0, 2)
        .toUpperCase() || "C";
    return {
      id: String(customer.id),
      name,
      email: String(customer.email || ""),
      initials,
      role: "portal_customer",
      organizationId: org,
    };
  }
  return null;
}

/** Hub A2A client credentials actor (X-Coworker-Actor-Id = hub:<client_id>). */
export function resolveHubServiceActor(
  actorId: string,
  orgId: string
): {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: "admin";
  organizationId: string;
} | null {
  const id = String(actorId || "").trim();
  const org = String(orgId || "").trim();
  if (!id || !org) return null;
  if (!id.toLowerCase().startsWith("hub:")) return null;
  if (!/^\d+$/.test(org)) return null;
  return {
    id,
    name: "Hub",
    email: "",
    initials: "H",
    role: "admin",
    organizationId: org,
  };
}

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_WINDOW_MS = 10 * 60 * 1000;
const OTP_RATE_MAX = 3;
const PASSWORD_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

function portalDeliveryError(raw: string | undefined, channel: "email" | "sms"): string {
  const err = String(raw || "").toLowerCase();
  if (
    err.includes("too many login") ||
    err.includes("454") ||
    err.includes("smtp_temporarily_blocked")
  ) {
    return "The mail provider blocked sending after too many failed logins. Wait about an hour, then request a new code.";
  }
  if (err.includes("invalid login") || err.includes("535") || err.includes("auth")) {
    return "Email delivery is misconfigured. Contact support, or try again after SMTP is updated.";
  }
  if (err.includes("smtp_not_configured") || err.includes("twilio_not_configured")) {
    return channel === "sms"
      ? "SMS delivery is not configured. Use email sign-in if you have an email on file."
      : "Email delivery is not configured. Contact support.";
  }
  if (err.includes("timeout")) {
    return "The verification code could not be sent in time. Try again.";
  }
  return "Could not send a verification code. Try again shortly.";
}

function jwtSecret(): string {
  return String(process.env.JWT_SECRET || "worktual-dev-secret");
}

export function cookieShouldBeSecure(req?: Request): boolean {
  /**
   * Secure cookies are dropped by browsers on plain HTTP.
   * Prefer the browser Origin/Referer (Vite proxy → Express is always HTTP locally)
   * over APP_URL, so LAN access via http://192.168.x.x keeps sessions.
   * Override: COOKIE_SECURE=1|0.
   */
  const force = String(process.env.COOKIE_SECURE || "").trim();
  if (force === "1") return true;
  if (force === "0") return false;

  if (req) {
    const origin = String(req.headers.origin || "").trim().toLowerCase();
    const referer = String(req.headers.referer || "").trim().toLowerCase();
    const browserUrl = origin || referer;
    if (browserUrl.startsWith("http://")) return false;
    if (browserUrl.startsWith("https://")) return true;
    const xf = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    if (xf === "http") return false;
    if (xf === "https") return true;
    // Vite proxy: browser may omit Origin; private LAN hosts are almost always HTTP.
    const xfHost = String(
      req.headers["x-forwarded-host"] || req.headers.host || ""
    )
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    if (
      xf !== "https" &&
      (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(xfHost) ||
        xfHost.endsWith(".local") ||
        xfHost.startsWith("localhost"))
    ) {
      return false;
    }
    if (req.protocol === "https" || req.secure) return true;
  }

  const appUrl = String(
    process.env.APP_URL || process.env.PUBLIC_APP_URL || ""
  )
    .trim()
    .toLowerCase();
  return appUrl.startsWith("https://");
}

export function portalCookieOptions(req?: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieShouldBeSecure(req),
    path: "/",
  };
}

export function publicAppUrl(): string {
  const raw = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return "http://127.0.0.1:5173";
}

export function extractPortalToken(req: Request): string | null {
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    PORTAL_COOKIE
  ];
  if (cookie) return String(cookie);
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) {
    try {
      const payload = jwt.decode(h.slice(7)) as { typ?: string } | null;
      if (payload?.typ === PORTAL_JWT_TYP) return h.slice(7);
    } catch {
      return null;
    }
  }
  return null;
}

export function signPortalToken(customer: PortalCustomer): string {
  return jwt.sign(
    {
      typ: PORTAL_JWT_TYP,
      id: customer.id,
      customerId: customer.id,
      name: customer.name,
      email: customer.email,
      organizationId: customer.organizationId,
      sessionId: customer.sessionId,
    },
    jwtSecret(),
    { expiresIn: "7d" }
  );
}

export function setPortalCookie(res: Response, token: string, req?: Request) {
  res.cookie(PORTAL_COOKIE, token, {
    ...portalCookieOptions(req),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearPortalCookie(res: Response, req?: Request) {
  res.clearCookie(PORTAL_COOKIE, portalCookieOptions(req));
}

const PORTAL_LOGO_EXT = /\.(png|jpe?g|jfif|pjpeg|webp|gif|svg|avif|bmp)$/i;

export function sanitizePortalLogoUrl(raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (!s.startsWith("/uploads/")) return "";
  if (s.includes("..") || s.includes("\\")) return "";
  const name = s.slice("/uploads/".length);
  if (!name || name.includes("/")) return "";
  if (!PORTAL_LOGO_EXT.test(name)) return "";
  return s.slice(0, 240);
}

/** Same folder Express writes with multer and serves at /uploads. */
export function uploadsDirectory(): string {
  const fromEnv = String(process.env.UPLOAD_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../uploads"),
    path.resolve(process.cwd(), "uploads"),
    path.resolve(here, "../../uploads"),
    path.resolve(here, "../../../uploads"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* try next */
    }
  }
  return path.resolve(process.cwd(), "uploads");
}

export function resolveUploadedFile(name: string): string | null {
  const base = String(name || "").trim();
  if (!base || base.includes("/") || base.includes("..") || base.includes("\\")) {
    return null;
  }
  const root = path.resolve(uploadsDirectory());
  const full = path.resolve(root, base);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  } catch {
    return null;
  }
  return null;
}

export function publicSupportLogoUrl(slug: string, storedUrl: string): string {
  const stored = sanitizePortalLogoUrl(storedUrl);
  const s = String(slug || "").trim();
  if (!stored || !s) return "";
  return `/api/public/support/${encodeURIComponent(s)}/logo?v=${encodeURIComponent(stored)}`;
}

export async function getOrgPortalConfig(organizationId: string): Promise<{
  id: string;
  slug: string;
  name: string;
  portalAuthMode: PortalAuthMode;
  businessType: "b2b" | "b2c";
  portalLabel: string;
  portalLogoUrl: string;
} | null> {
  const { rows } = await query(
    `SELECT a.id,
            COALESCE(s.portal_slug, a.support_portal_slug) AS slug,
            a.company_name AS name,
            COALESCE(s.portal_auth_mode, 'otp') AS portal_auth_mode,
            COALESCE(a.business_type, 'b2c') AS business_type,
            COALESCE(s.portal_label, a.support_portal_welcome) AS portal_label,
            COALESCE(s.portal_logo_url, '') AS portal_logo_url
     FROM accounts.organizations a
     LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
     WHERE a.id = $1::bigint
     LIMIT 1`,
    [organizationId]
  );
  if (!rows[0]) return null;
  const mode = String(rows[0].portal_auth_mode || "otp");
  const biz = String(rows[0].business_type || "b2c").toLowerCase();
  return {
    id: String(rows[0].id),
    slug: String(rows[0].slug || ""),
    name: String(rows[0].name || ""),
    portalAuthMode: mode === "password" ? "password" : "otp",
    businessType: biz === "b2b" ? "b2b" : "b2c",
    portalLabel: rows[0].portal_label ? String(rows[0].portal_label) : "",
    portalLogoUrl: sanitizePortalLogoUrl(rows[0].portal_logo_url),
  };
}

export async function getOrgPortalConfigBySlug(slugRaw: string): Promise<{
  id: string;
  slug: string;
  name: string;
  portalAuthMode: PortalAuthMode;
  businessType: "b2b" | "b2c";
  portalLabel: string;
  portalLogoUrl: string;
} | null> {
  const slug = String(slugRaw || "").trim().toLowerCase();
  if (!slug) return null;
  const { rows } = await query(
    `SELECT a.id
     FROM accounts.organizations a
     LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
     WHERE lower(COALESCE(s.portal_slug, a.support_portal_slug, '')) = $1
     LIMIT 1`,
    [slug]
  );
  if (!rows[0]) return null;
  return getOrgPortalConfig(String(rows[0].id));
}

export async function createPortalSession(input: {
  customer: DirectoryCustomer;
  ipAddress?: string;
  userAgent?: string;
  deviceLabel?: string;
}): Promise<PortalCustomer> {
  let sessionId: string | undefined;
  if (/^\d+$/.test(String(input.customer.id || ""))) {
    const sess = await query(
      `INSERT INTO ticketing.customer_portal_sessions (
         organization_id, customer_id, device_label, ip_address, user_agent
       ) VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [
        input.customer.organizationId,
        input.customer.id,
        input.deviceLabel || null,
        input.ipAddress || null,
        (input.userAgent || "").slice(0, 400) || null,
      ]
    );
    sessionId = String(sess.rows[0].id);
    await query(
      `UPDATE ticketing.contact_profile SET last_portal_login_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [input.customer.id]
    );
  }
  return {
    id: input.customer.id,
    name: input.customer.name,
    email: input.customer.email,
    phone: input.customer.phone,
    organizationId: input.customer.organizationId,
    sessionId,
  };
}

export async function peekPortalCustomer(
  req: Request
): Promise<PortalCustomer | null> {
  const token = extractPortalToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret()) as {
      typ?: string;
      customerId?: string;
      id?: string;
      organizationId?: string;
      name?: string;
      email?: string;
      sessionId?: string;
    };
    if (payload.typ !== PORTAL_JWT_TYP || !payload.organizationId) return null;
    const customerId = String(payload.customerId || payload.id || "");
    if (!customerId) return null;
    if (payload.sessionId) {
      const { rows } = await query(
        `SELECT id FROM ticketing.customer_portal_sessions
         WHERE id = $1 AND customer_id = $2 AND revoked_at IS NULL`,
        [payload.sessionId, customerId]
      );
      if (!rows[0]) return null;
    }
    return {
      id: customerId,
      name: String(payload.name || ""),
      email: String(payload.email || ""),
      phone: "",
      organizationId: String(payload.organizationId),
      sessionId: payload.sessionId,
    };
  } catch {
    return null;
  }
}

export function requirePortalAuth(
  req: PortalAuthedRequest,
  res: Response,
  next: NextFunction
) {
  const token = extractPortalToken(req);
  if (!token) {
    return res.status(401).json({ error: "Sign in to continue." });
  }
  try {
    const payload = jwt.verify(token, jwtSecret()) as {
      typ?: string;
      customerId?: string;
      id?: string;
      organizationId?: string;
      name?: string;
      email?: string;
      sessionId?: string;
    };
    if (payload.typ !== PORTAL_JWT_TYP || !payload.organizationId) {
      return res.status(401).json({ error: "Invalid portal session." });
    }
    const customerId = String(payload.customerId || payload.id || "");
    if (!customerId) {
      return res.status(401).json({ error: "Invalid portal session." });
    }
    if (!payload.sessionId) {
      req.portalCustomer = {
        id: customerId,
        name: String(payload.name || ""),
        email: String(payload.email || ""),
        phone: "",
        organizationId: String(payload.organizationId),
      };
      return next();
    }
    query(
      `SELECT id FROM ticketing.customer_portal_sessions
       WHERE id = $1 AND customer_id = $2 AND revoked_at IS NULL`,
      [payload.sessionId, customerId]
    )
      .then(({ rows }) => {
        if (!rows[0]) {
          clearPortalCookie(res, req);
          return res.status(401).json({ error: "Session expired. Please sign in again." });
        }
        query(
          `UPDATE ticketing.customer_portal_sessions
           SET last_active_at = NOW() WHERE id = $1`,
          [payload.sessionId]
        ).catch(() => undefined);
        req.portalCustomer = {
          id: customerId,
          name: String(payload.name || ""),
          email: String(payload.email || ""),
          phone: "",
          organizationId: String(payload.organizationId),
          sessionId: payload.sessionId,
        };
        next();
      })
      .catch((err) => {
        console.error("portal session check failed", err);
        return res.status(503).json({ error: "Authentication temporarily unavailable" });
      });
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

function parsePortalIdentifier(raw: string): {
  kind: "email" | "phone" | "";
  email?: string;
  phone?: string;
} {
  let s = String(raw || "").trim();
  if (!s) return { kind: "" };
  s = s.replace(/^mailto:/i, "").trim();
  const angled = s.match(/<([^<>@\s]+@[^<>\s]+)>/);
  if (angled) s = angled[1].trim();
  if (s.includes("@")) {
    const email = normalizeEmail(s);
    return email ? { kind: "email", email } : { kind: "" };
  }
  const phone = normalizePhone(s);
  return phone ? { kind: "phone", phone } : { kind: "" };
}

export type PortalAuthFailure = {
  ok: false;
  error: string;
  status: number;
  code?:
    | "customer_not_found"
    | "customer_inactive"
    | "invalid_identifier"
    | "otp_expired"
    | "otp_inactive"
    | "otp_locked";
  identifierKind?: "email" | "phone";
};

async function resolvePortalDirectoryCustomer(input: {
  organizationId: string;
  identifier: string;
  logMiss?: boolean;
}): Promise<
  | { ok: true; customer: DirectoryCustomer; kind: "email" | "phone" }
  | PortalAuthFailure
> {
  const parsed = parsePortalIdentifier(input.identifier);
  if (!parsed.kind) {
    return {
      ok: false,
      error: "Enter your email or phone number.",
      status: 400,
      code: "invalid_identifier",
    };
  }
  try {
    await requireOrganizationHasTicketingProduct(input.organizationId);
  } catch {
    return {
      ok: false,
      error: "No customer record exists for this email or phone in our system.",
      status: 404,
      code: "customer_not_found",
      identifierKind: parsed.kind,
    };
  }
  const found = await findDirectoryCustomer({
    organizationId: input.organizationId,
    email: parsed.email,
    phone: parsed.phone,
    activeOnly: false,
  });
  if (!found) {
    if (input.logMiss) {
      console.warn("portal customer lookup miss", {
        organizationId: input.organizationId,
        kind: parsed.kind,
        foundInOrg: false,
      });
    }
    return {
      ok: false,
      error: "No customer record exists for this email or phone in our system.",
      status: 404,
      code: "customer_not_found",
      identifierKind: parsed.kind,
    };
  }
  if (found.status !== "Active") {
    if (input.logMiss) {
      console.warn("portal customer lookup miss", {
        organizationId: input.organizationId,
        kind: parsed.kind,
        foundInOrg: true,
        status: found.status,
      });
    }
    return {
      ok: false,
      error: "This customer account is inactive. Contact support if you need access.",
      status: 403,
      code: "customer_inactive",
      identifierKind: parsed.kind,
    };
  }
  return { ok: true, customer: found, kind: parsed.kind };
}

/** OTP only. Primary and every secondary email on the customer can receive the code. */
async function resolvePortalOtpCustomer(input: {
  organizationId: string;
  identifier: string;
  logMiss?: boolean;
}): Promise<
  | {
      ok: true;
      customer: DirectoryCustomer;
      channel: "email" | "phone";
      deliverTo: string;
    }
  | PortalAuthFailure
> {
  const parsed = parsePortalIdentifier(input.identifier);
  if (parsed.kind !== "email") {
    const resolved = await resolvePortalDirectoryCustomer(input);
    if (resolved.ok === false) return resolved;
    return {
      ok: true,
      customer: resolved.customer,
      channel: "phone",
      deliverTo: resolved.customer.phone,
    };
  }

  const deliverTo = normalizeEmail(parsed.email || "");
  try {
    await requireOrganizationHasTicketingProduct(input.organizationId);
  } catch {
    return {
      ok: false,
      error: "No customer record exists for this email or phone in our system.",
      status: 404,
      code: "customer_not_found",
      identifierKind: "email",
    };
  }

  const found = await findDirectoryCustomerByPortalEmail(
    input.organizationId,
    deliverTo
  );
  if (!found) {
    if (input.logMiss) {
      console.warn("portal customer lookup miss", {
        organizationId: input.organizationId,
        kind: "email",
        foundInOrg: false,
      });
    }
    return {
      ok: false,
      error: "No customer record exists for this email or phone in our system.",
      status: 404,
      code: "customer_not_found",
      identifierKind: "email",
    };
  }
  if (found.status !== "Active") {
    if (input.logMiss) {
      console.warn("portal customer lookup miss", {
        organizationId: input.organizationId,
        kind: "email",
        foundInOrg: true,
        status: found.status,
      });
    }
    return {
      ok: false,
      error: "This customer account is inactive. Contact support if you need access.",
      status: 403,
      code: "customer_inactive",
      identifierKind: "email",
    };
  }
  return { ok: true, customer: found, channel: "email", deliverTo };
}

export async function requestPortalOtp(input: {
  organizationId: string;
  identifier: string;
}): Promise<
  | { ok: true; channel: "email" | "phone"; masked: string }
  | PortalAuthFailure
> {
  const resolved = await resolvePortalOtpCustomer({
    organizationId: input.organizationId,
    identifier: input.identifier,
    logMiss: true,
  });
  if (resolved.ok === false) return resolved;
  const customer = resolved.customer;
  const isEmail = resolved.channel === "email";

  const channel: "email" | "phone" = resolved.channel;
  const key = isEmail ? resolved.deliverTo : customer.phone;
  const recent = await query(
    `SELECT COUNT(*)::int AS n
     FROM ticketing.customer_otp_challenges
     WHERE organization_id = $1 AND identifier = $2
       AND created_at > NOW() - ($3::int * INTERVAL '1 millisecond')`,
    [input.organizationId, key, OTP_RATE_WINDOW_MS]
  );
  const recentCount = Number(recent.rows[0]?.n || 0);
  const maskedId = isEmail
    ? `${String(key).slice(0, 1)}***${key.includes("@") ? key.slice(key.indexOf("@")) : ""}`
    : "***";
  console.info("[portal-otp] request", {
    organizationId: input.organizationId,
    channel,
    identifier: maskedId,
    recentCodesInWindow: recentCount,
    rateWindowMin: Math.round(OTP_RATE_WINDOW_MS / 60000),
  });
  if (recentCount >= OTP_RATE_MAX) {
    console.warn("[portal-otp] blocked: too many codes in window", {
      organizationId: input.organizationId,
      identifier: maskedId,
      recentCodesInWindow: recentCount,
    });
    return {
      ok: false,
      error: "Too many codes requested. Try again in a few minutes.",
      status: 429,
    };
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 8);
  const spokeId = /^\d+$/.test(String(customer.id || "")) ? customer.id : null;
  await query(
    `INSERT INTO ticketing.customer_otp_challenges (
       organization_id, customer_id, identifier, channel, code_hash, expires_at
     ) VALUES ($1,$2,$3,$4,$5, NOW() + ($6::int * INTERVAL '1 millisecond'))`,
    [input.organizationId, spokeId, key, channel, codeHash, OTP_TTL_MS]
  );

  const text = `Your support portal code is ${code}. It expires in 10 minutes.`;
  if (channel === "email") {
    const mailed = await sendCustomerEmail({
      organizationId: input.organizationId,
      toEmail: resolved.deliverTo,
      toName: customer.name,
      kind: "portal_otp",
      subject: "Your support portal verification code",
      text,
    });
    if (!mailed.sent) {
      const userError = portalDeliveryError(mailed.error, "email");
      console.warn("[portal-otp] email not sent", {
        organizationId: input.organizationId,
        identifier: maskedId,
        mailMode: mailed.mode,
        smtpError: String(mailed.error || "").slice(0, 240),
        userError,
      });
      return {
        ok: false,
        error: userError,
        status: 503,
      };
    }
  } else {
    const sms = await sendCustomerSms({ toPhone: customer.phone, text });
    if (!sms.sent) {
      return {
        ok: false,
        error: portalDeliveryError(sms.error, "sms"),
        status: 503,
      };
    }
  }

  return {
    ok: true,
    channel,
    masked: channel === "email" ? maskEmail(resolved.deliverTo) : maskPhone(customer.phone),
  };
}

export async function verifyPortalOtp(input: {
  organizationId: string;
  identifier: string;
  code: string;
}): Promise<
  { ok: true; customer: DirectoryCustomer } | PortalAuthFailure
> {
  const code = String(input.code || "").trim();
  if (!String(input.identifier || "").trim() || !code) {
    return { ok: false, error: "Email/phone and code are required.", status: 400 };
  }
  const resolved = await resolvePortalOtpCustomer({
    organizationId: input.organizationId,
    identifier: input.identifier,
  });
  if (resolved.ok === false) {
    return resolved;
  }
  const customer = resolved.customer;
  const isEmail = resolved.channel === "email";
  const key = isEmail ? resolved.deliverTo : customer.phone;
  const { rows } = await query(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
     FROM ticketing.customer_otp_challenges
     WHERE organization_id = $1 AND identifier = $2
       AND consumed_at IS NULL
       AND (
         customer_id IS NULL
         OR ($3 ~ '^[0-9]+$' AND customer_id = $3::bigint)
       )
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.organizationId, key, String(customer.id || "")]
  );
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      error: "No active code. Request a new one.",
      status: 400,
      code: "otp_inactive",
    };
  }
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    return {
      ok: false,
      error: "That code expired. Request a new one.",
      status: 400,
      code: "otp_expired",
    };
  }
  if (Number(row.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    return {
      ok: false,
      error: "Too many attempts. Request a new code.",
      status: 429,
      code: "otp_locked",
    };
  }
  const ok = await bcrypt.compare(code, String(row.code_hash));
  await query(
    `UPDATE ticketing.customer_otp_challenges
     SET attempts = attempts + 1, consumed_at = CASE WHEN $2 THEN NOW() ELSE consumed_at END
     WHERE id = $1`,
    [row.id, ok]
  );
  if (!ok) {
    return { ok: false, error: "Invalid code.", status: 401 };
  }
  return { ok: true, customer };
}

export async function loginPortalPassword(input: {
  organizationId: string;
  email: string;
  password: string;
}): Promise<
  { ok: true; customer: DirectoryCustomer } | PortalAuthFailure
> {
  const password = String(input.password || "");
  if (!String(input.email || "").trim() || !password) {
    return { ok: false, error: "Email and password are required.", status: 400 };
  }
  const resolved = await resolvePortalDirectoryCustomer({
    organizationId: input.organizationId,
    identifier: input.email,
  });
  if (resolved.ok === false) {
    return resolved;
  }
  if (resolved.kind !== "email") {
    return { ok: false, error: "Email and password are required.", status: 400 };
  }
  const customer = resolved.customer;
  const { rows } = await query(
    `SELECT password_hash FROM ticketing.contact_profile
     WHERE organization_id = $1
       AND (
         ($2 ~ '^[0-9]+$' AND id = $2::bigint)
         OR cdp_id = $2
       )
     LIMIT 1`,
    [customer.organizationId, customer.id]
  );
  const hash = rows[0]?.password_hash ? String(rows[0].password_hash) : "";
  if (!hash) {
    return {
      ok: false,
      error: "Password is not set yet. Use Forgot password to get a reset link.",
      status: 401,
    };
  }
  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    return { ok: false, error: "Invalid email or password.", status: 401 };
  }
  return { ok: true, customer };
}

export async function issueSetPasswordLink(input: {
  organizationId: string;
  customer: DirectoryCustomer;
  slug: string;
}): Promise<{ sent: boolean }> {
  if (!input.customer.email) return { sent: false };
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await query(
    `UPDATE ticketing.customer_password_tokens
     SET consumed_at = NOW()
     WHERE customer_id = $1 AND consumed_at IS NULL`,
    [input.customer.id]
  );
  await query(
    `INSERT INTO ticketing.customer_password_tokens (
       organization_id, customer_id, token_hash, expires_at
     ) VALUES ($1,$2,$3, NOW() + ($4::int * INTERVAL '1 millisecond'))`,
    [input.organizationId, input.customer.id, tokenHash, PASSWORD_TOKEN_TTL_MS]
  );
  const url = `${publicAppUrl()}/support/${encodeURIComponent(input.slug)}/set-password?token=${token}`;
  await sendCustomerEmail({
    organizationId: input.organizationId,
    toEmail: input.customer.email,
    toName: input.customer.name,
    kind: "portal_set_password",
    subject: "Reset your support portal password",
    text: [
      `Hi ${input.customer.name || "there"},`,
      "",
      "Use this link to set or reset your support portal password (valid for 48 hours):",
      url,
      "",
      "If you did not request this, you can ignore this email.",
      "",
      "— Support",
    ].join("\n"),
  });
  return { sent: true };
}

export async function requestPortalPasswordReset(input: {
  organizationId: string;
  email: string;
  slug: string;
}): Promise<{ ok: true }> {
  const resolved = await resolvePortalDirectoryCustomer({
    organizationId: input.organizationId,
    identifier: input.email,
    logMiss: false,
  });
  if (resolved.ok && resolved.kind === "email" && resolved.customer.email) {
    await issueSetPasswordLink({
      organizationId: input.organizationId,
      customer: resolved.customer,
      slug: input.slug,
    });
  }
  return { ok: true };
}

export async function consumeSetPasswordToken(input: {
  token: string;
  password: string;
}): Promise<
  { ok: true; customer: DirectoryCustomer; slug: string } | { ok: false; error: string; status: number }
> {
  const token = String(input.token || "").trim();
  const password = String(input.password || "");
  if (!token || password.length < 8) {
    return {
      ok: false,
      error: "A valid token and a password of at least 8 characters are required.",
      status: 400,
    };
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const { rows } = await query(
    `SELECT t.id, t.customer_id, t.organization_id, t.expires_at, t.consumed_at,
            COALESCE(s.portal_slug, a.support_portal_slug) AS slug
     FROM ticketing.customer_password_tokens t
     JOIN accounts.organizations a ON a.id = t.organization_id
     LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id
     WHERE t.token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row || row.consumed_at) {
    return { ok: false, error: "This link is invalid or already used.", status: 400 };
  }
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    return { ok: false, error: "This link has expired.", status: 400 };
  }
  const hash = await bcrypt.hash(password, 10);
  await query(
    `UPDATE ticketing.contact_profile
     SET password_hash = $1, password_set_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [hash, row.customer_id]
  );
  await query(
    `UPDATE ticketing.customer_password_tokens SET consumed_at = NOW() WHERE id = $1`,
    [row.id]
  );
  const customer = await findActiveCustomer({
    organizationId: String(row.organization_id),
    customerId: String(row.customer_id),
  });
  if (!customer) {
    return { ok: false, error: "Customer not found.", status: 404 };
  }
  return { ok: true, customer, slug: String(row.slug || "") };
}

export async function revokePortalSession(sessionId?: string, customerId?: string) {
  if (!sessionId || !customerId) return;
  await query(
    `UPDATE ticketing.customer_portal_sessions
     SET revoked_at = NOW()
     WHERE id = $1 AND customer_id = $2 AND revoked_at IS NULL`,
    [sessionId, customerId]
  );
}

function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  if (!d) return email;
  const keep = u.slice(0, 1);
  return `${keep}***@${d}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}
