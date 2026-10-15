/**
 * MyAccount (`accounts`) owns staff identity, credentials, and organizations.
 *
 * Ticketing never inserts into accounts.setup_users / organizations. It only
 * creates thin spoke bridges:
 * - ticketing.agents → accounts.setup_users (setup_user_id)
 * - ticketing.org_settings → accounts.organizations
 *
 * Exception: product-scoped rows on shared `accounts.auth_sessions` with
 * product_id = 'ticketing' only. token is ticketing.user_sessions.id
 * (varchar(128) key), never the cookie JWT. Never write a column default.
 * Never update or delete NULL / contact-center / crm rows.
 *
 * Staff passwords live ONLY in accounts.setup_users.
 */
import bcrypt from "bcryptjs";
import { query } from "./db";
import { ensureSlaPoliciesForOrg } from "./sla";
import { ensureTicketStatusesForOrg } from "./statuses";

const ROLE_MAP: Record<string, string> = {
  admin: "admin",
  agent: "agent",
  resolver: "resolver",
  customer: "customer",
};

type EligibleRow = {
  id: string;
  organization_id: string;
  company_name: string | null;
  name: string;
  email: string;
  phone: string | null;
  role_name: string;
  password_hash: string;
};

/** Thin profile after MyAccount auth (no password). `id` is ticketing agents.id. */
export type MyAccountStaffProfile = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string;
  initials: string;
  role: string;
  companyName: string | null;
  accountsUserId: string;
};

export type AuthoritativeIdentity = MyAccountStaffProfile & {
  status: "Active";
};

/**
 * A user may log into Ticketing once MyAccount finished onboarding:
 * active, has ticketing product access, and credentials were set
 * (password_hash exists — i.e. the mailed invite/credentials are usable).
 */
const ELIGIBLE_SQL = `
  SELECT DISTINCT ON (u.id)
         u.id::text AS id,
         a.organization_id::text AS organization_id,
         o.company_name,
         NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
         lower(u.work_email) AS email,
         u.mobile_number AS phone,
         lower(r.name) AS role_name,
         u.password_hash
  FROM accounts.setup_user_product_access a
  JOIN accounts.setup_users u ON u.id = a.user_id
  JOIN accounts.setup_roles r ON r.id = a.role_id
  LEFT JOIN accounts.organizations o ON o.id = a.organization_id
  WHERE a.product_id = 'ticketing'
    AND lower(COALESCE(u.status, '')) = 'active'
    AND u.password_hash IS NOT NULL
    AND u.work_email IS NOT NULL
`;

/** Same grant/active rules as login, but password may still be unset (409 for mint). */
const ONBOARDING_CANDIDATE_SQL = `
  SELECT DISTINCT ON (u.id)
         u.id::text AS id,
         a.organization_id::text AS organization_id,
         o.company_name,
         NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
         lower(u.work_email) AS email,
         u.mobile_number AS phone,
         lower(r.name) AS role_name,
         u.password_hash
  FROM accounts.setup_user_product_access a
  JOIN accounts.setup_users u ON u.id = a.user_id
  JOIN accounts.setup_roles r ON r.id = a.role_id
  LEFT JOIN accounts.organizations o ON o.id = a.organization_id
  WHERE a.product_id = 'ticketing'
    AND lower(COALESCE(u.status, '')) = 'active'
    AND u.work_email IS NOT NULL
`;

export type OnboardingStaffLookup =
  | {
      kind: "ready";
      profile: Omit<MyAccountStaffProfile, "id"> & { accountsUserId: string };
    }
  | { kind: "not_ready" }
  | { kind: "not_found" };

/**
 * Resolve a Setup People user for Accounts → Ticketing dashboard mint.
 * Does not read or copy the password — only whether a hash exists.
 */
export async function lookupMyAccountTicketingOnboarding(opts: {
  email?: string;
  userId?: string;
}): Promise<OnboardingStaffLookup> {
  if (!(await accountsSchemaAvailable())) return { kind: "not_found" };
  const email = String(opts.email || "").trim();
  const userId = String(opts.userId || "").trim();
  if (!email && !userId) return { kind: "not_found" };

  const params: unknown[] = [];
  const clauses: string[] = [];
  if (email) {
    params.push(email);
    clauses.push(`lower(u.work_email) = lower($${params.length})`);
  }
  if (userId) {
    if (!isDigitId(userId)) return { kind: "not_found" };
    params.push(userId);
    clauses.push(`u.id = $${params.length}::bigint`);
  }

  const { rows } = await query<EligibleRow>(
    `${ONBOARDING_CANDIDATE_SQL} AND ${clauses.join(" AND ")}`,
    params
  );
  if (rows.length !== 1) return { kind: "not_found" };
  const row = rows[0];
  const role = mappedRole(row.role_name);
  if (role === "customer") return { kind: "not_found" };
  if (!row.password_hash) return { kind: "not_ready" };
  const name = row.name || row.email.split("@")[0];
  return {
    kind: "ready",
    profile: {
      accountsUserId: String(row.id),
      organizationId: String(row.organization_id),
      name,
      email: String(row.email).toLowerCase(),
      phone: String(row.phone || ""),
      initials: initialsFromName(name),
      role,
      companyName: row.company_name,
    },
  };
}

function isDigitId(value: string): boolean {
  return /^\d+$/.test(String(value || "").trim());
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function accountsSchemaAvailable(): Promise<boolean> {
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'accounts' AND table_name = 'setup_users'
       ) AS exists`
    );
    return Boolean(rows[0]?.exists);
  } catch {
    return false;
  }
}

/** Org has not purchased / been granted Ticketing in MyAccount. */
export class TicketingProductError extends Error {
  status: number;
  code: string;
  constructor(
    message = "This organization has not purchased Ticketing.",
    status = 403,
    code = "ticketing_not_purchased"
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * True when MyAccount granted product_id = 'ticketing' for this organization_id.
 * Uses accounts.setup_user_product_access (same columns as staff eligibility).
 */
export async function organizationHasTicketingProduct(
  organizationId: string
): Promise<boolean> {
  const orgId = String(organizationId || "").trim();
  if (!isDigitId(orgId)) return false;
  if (!(await accountsSchemaAvailable())) return false;
  const { rows } = await query<{ has_ticketing: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM accounts.setup_user_product_access a
       WHERE a.organization_id = $1::bigint
         AND a.product_id = 'ticketing'
     ) AS has_ticketing`,
    [orgId]
  );
  return Boolean(rows[0]?.has_ticketing);
}

/** Fail closed before ticket create when the org has no Ticketing product. */
export async function requireOrganizationHasTicketingProduct(
  organizationId: string
): Promise<void> {
  const orgId = String(organizationId || "").trim();
  if (!isDigitId(orgId)) {
    throw new TicketingProductError(
      "Organization is not provisioned in MyAccount.",
      403,
      "organization_not_provisioned"
    );
  }
  if (!(await accountsSchemaAvailable())) {
    throw new TicketingProductError(
      "MyAccount is unavailable; cannot verify Ticketing entitlement.",
      503,
      "myaccount_unavailable"
    );
  }
  const org = await query<{ id: string }>(
    `SELECT id::text AS id FROM accounts.organizations WHERE id = $1::bigint`,
    [orgId]
  );
  if (!org.rows[0]?.id) {
    throw new TicketingProductError(
      "Organization is not provisioned in MyAccount.",
      403,
      "organization_not_provisioned"
    );
  }
  if (!(await organizationHasTicketingProduct(orgId))) {
    throw new TicketingProductError();
  }
}

/**
 * Require an existing MyAccount org. Never inserts into accounts.*.
 * Ensures spoke org_settings + SLA/status catalogs for that org id.
 */
async function requireAccountsOrg(accountsOrgId: string): Promise<string> {
  const orgId = String(accountsOrgId || "").trim();
  if (!isDigitId(orgId)) {
    throw new Error("Organization not provisioned in MyAccount");
  }
  const { rows } = await query<{ id: string }>(
    `SELECT id::text AS id FROM accounts.organizations WHERE id = $1::bigint`,
    [orgId]
  );
  if (!rows[0]?.id) {
    throw new Error("Organization not provisioned in MyAccount");
  }
  await query(
    `INSERT INTO ticketing.org_settings (organization_id)
     VALUES ($1::bigint)
     ON CONFLICT (organization_id) DO NOTHING`,
    [orgId]
  );
  await ensureSlaPoliciesForOrg(orgId);
  await ensureTicketStatusesForOrg(orgId);
  return orgId;
}

async function upsertAgent(row: EligibleRow): Promise<{ id: string; organizationId: string }> {
  const role = ROLE_MAP[row.role_name] || mappedRole(row.role_name) || "agent";
  const orgId = await requireAccountsOrg(String(row.organization_id));

  const existing = await query<{ id: string; organization_id: string }>(
    `SELECT id::text AS id, organization_id::text AS organization_id
     FROM ticketing.agents
     WHERE setup_user_id = $1::bigint
     LIMIT 1`,
    [String(row.id)]
  );
  if (existing.rows[0]?.id) {
    await query(
      `UPDATE ticketing.agents
       SET support_email = COALESCE(NULLIF($1, ''), support_email),
           support_phone = COALESCE(NULLIF($2, ''), support_phone),
           role = $3,
           status = 'Active',
           updated_at = NOW()
       WHERE id = $4::bigint`,
      [row.email || null, row.phone || null, role, existing.rows[0].id]
    );
    return {
      id: String(existing.rows[0].id),
      organizationId: String(existing.rows[0].organization_id),
    };
  }

  const inserted = await query<{ id: string }>(
    `INSERT INTO ticketing.agents
       (organization_id, setup_user_id, support_email, support_phone, role, status)
     VALUES ($1::bigint, $2::bigint, $3, $4, $5, 'Active')
     RETURNING id::text AS id`,
    [
      orgId,
      String(row.id),
      row.email || null,
      row.phone || null,
      role,
    ]
  );
  return { id: String(inserted.rows[0].id), organizationId: orgId };
}

function mappedRole(roleName: string): string {
  return ROLE_MAP[String(roleName || "").toLowerCase()] || "agent";
}

/**
 * Validate staff email+password against MyAccount only.
 * Returns null when schema missing, user ineligible, or password wrong.
 */
export async function authenticateMyAccountStaff(
  email: string,
  password: string
): Promise<Omit<MyAccountStaffProfile, "id"> & { accountsUserId: string } | null> {
  if (!(await accountsSchemaAvailable())) return null;
  const { rows } = await query<EligibleRow>(
    `${ELIGIBLE_SQL} AND lower(u.work_email) = lower($1)`,
    [email]
  );
  if (rows.length !== 1) return null;
  const row = rows[0];
  const hash = String(row.password_hash || "");
  if (!hash) return null;
  const ok = await bcrypt.compare(String(password), hash);
  if (!ok) return null;
  const name = row.name || row.email.split("@")[0];
  return {
    accountsUserId: String(row.id),
    organizationId: String(row.organization_id),
    name,
    email: String(row.email).toLowerCase(),
    phone: String(row.phone || ""),
    initials: initialsFromName(name),
    role: mappedRole(row.role_name),
    companyName: row.company_name,
  };
}

/**
 * Ensure thin ticketing agent exists for an authenticated MyAccount profile.
 * Requires setup_users + accounts.organizations already exist — never inserts into accounts.*.
 */
export async function ensureThinTicketingUser(profile: {
  accountsUserId: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string;
  initials: string;
  role: string;
  companyName: string | null;
}): Promise<MyAccountStaffProfile> {
  const thin = await upsertAgent({
    id: profile.accountsUserId,
    organization_id: profile.organizationId,
    company_name: profile.companyName,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    role_name: profile.role,
    password_hash: "",
  });
  return {
    id: thin.id,
    organizationId: thin.organizationId,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    initials: profile.initials,
    role: profile.role,
    companyName: profile.companyName,
    accountsUserId: profile.accountsUserId,
  };
}

/**
 * Resolve current identity/access from MyAccount for an existing Ticketing agent FK.
 */
export async function getAuthoritativeIdentity(
  ticketingUserId: string,
  ticketingOrganizationId?: string
): Promise<AuthoritativeIdentity | null> {
  if (!isDigitId(ticketingUserId)) return null;
  if (ticketingOrganizationId && !isDigitId(ticketingOrganizationId)) return null;
  if (!(await accountsSchemaAvailable())) return null;
  const params: unknown[] = [ticketingUserId];
  let orgClause = "";
  if (ticketingOrganizationId) {
    params.push(ticketingOrganizationId);
    orgClause = `AND ag.organization_id = $${params.length}::bigint`;
  }
  const { rows } = await query<
    EligibleRow & { ticketing_user_id: string; ticketing_organization_id: string }
  >(
    `SELECT DISTINCT ON (au.id)
            ag.id::text AS ticketing_user_id,
            ag.organization_id::text AS ticketing_organization_id,
            au.id::text AS id,
            a.organization_id::text AS organization_id,
            o.company_name,
            NULLIF(TRIM(COALESCE(au.first_name, '') || ' ' || COALESCE(au.last_name, '')), '') AS name,
            lower(au.work_email) AS email,
            au.mobile_number AS phone,
            lower(r.name) AS role_name,
            au.password_hash
     FROM ticketing.agents ag
     JOIN accounts.setup_users au ON au.id = ag.setup_user_id
     JOIN accounts.setup_user_product_access a
       ON a.user_id = au.id
      AND a.product_id = 'ticketing'
      AND a.organization_id = ag.organization_id
     JOIN accounts.setup_roles r ON r.id = a.role_id
     LEFT JOIN accounts.organizations o ON o.id = a.organization_id
     WHERE ag.id = $1::bigint
       ${orgClause}
       AND lower(COALESCE(au.status, '')) = 'active'
       AND au.work_email IS NOT NULL
     ORDER BY au.id`,
    params
  );
  const row = rows[0];
  if (!row) return null;
  const name = row.name || row.email.split("@")[0];
  await query(
    `UPDATE ticketing.agents
     SET support_email = COALESCE(NULLIF($1, ''), support_email),
         support_phone = COALESCE(NULLIF($2, ''), support_phone),
         role = $3,
         updated_at = NOW()
     WHERE id = $4::bigint`,
    [
      String(row.email).toLowerCase(),
      row.phone || null,
      mappedRole(row.role_name),
      row.ticketing_user_id,
    ]
  );
  return {
    id: String(row.ticketing_user_id),
    organizationId: String(row.ticketing_organization_id),
    accountsUserId: String(row.id),
    name,
    email: String(row.email).toLowerCase(),
    phone: String(row.phone || ""),
    initials: initialsFromName(name),
    role: mappedRole(row.role_name),
    companyName: row.company_name,
    status: "Active",
  };
}

/** Seed/local identity removed — MyAccount-only. */
export async function getSeedIdentity(
  _ticketingUserId: string,
  _ticketingOrganizationId?: string
): Promise<AuthoritativeIdentity | null> {
  return null;
}

export async function getEffectiveIdentity(
  ticketingUserId: string,
  ticketingOrganizationId?: string
): Promise<AuthoritativeIdentity | null> {
  return getAuthoritativeIdentity(ticketingUserId, ticketingOrganizationId);
}

/**
 * Service-actor fallback when MyAccount join is unavailable but the thin
 * ticketing.agents row exists (local dev / partial accounts linkage).
 */
export async function resolveStaffServiceActor(
  actorId: string,
  orgId: string
): Promise<AuthoritativeIdentity | null> {
  if (!isDigitId(actorId) || !isDigitId(orgId)) return null;
  const { rows } = await query<{
    id: string;
    organization_id: string;
    email: string;
    phone: string | null;
    role: string;
    name: string | null;
  }>(
    `SELECT a.id::text AS id,
            a.organization_id::text AS organization_id,
            lower(COALESCE(au.work_email, a.support_email, '')) AS email,
            COALESCE(au.mobile_number, a.support_phone) AS phone,
            COALESCE(a.role, 'agent') AS role,
            NULLIF(
              TRIM(COALESCE(au.first_name, '') || ' ' || COALESCE(au.last_name, '')),
              ''
            ) AS name
     FROM ticketing.agents a
     LEFT JOIN accounts.setup_users au ON au.id = a.setup_user_id
     WHERE a.id = $1::bigint
       AND a.organization_id = $2::bigint
       AND lower(COALESCE(a.status, 'active')) = 'active'
     LIMIT 1`,
    [actorId, orgId]
  );
  const row = rows[0];
  if (!row?.id) return null;
  const email = String(row.email || "").trim().toLowerCase();
  const name =
    String(row.name || "").trim() ||
    (email ? email.split("@")[0] : "") ||
    "Agent";
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    accountsUserId: "",
    name,
    email,
    phone: String(row.phone || ""),
    initials: initialsFromName(name),
    role: mappedRole(row.role),
    companyName: null,
    status: "Active",
  };
}

/**
 * Resolve staff identity from Accounts user id + org (CRM JWT Path A).
 * Does not insert into MyAccount — returns null when product access / agent missing.
 */
export async function getIdentityByAccountsUserId(
  accountsUserId: string,
  accountsOrganizationId: string
): Promise<AuthoritativeIdentity | null> {
  if (!(await accountsSchemaAvailable())) return null;
  const accountsUser = String(accountsUserId || "").trim();
  const accountsOrg = String(accountsOrganizationId || "").trim();
  if (!accountsUser || !accountsOrg) return null;

  const { rows } = await query<{ ticketing_user_id: string; ticketing_organization_id: string }>(
    `SELECT ag.id::text AS ticketing_user_id,
            ag.organization_id::text AS ticketing_organization_id
     FROM ticketing.agents ag
     WHERE ag.setup_user_id = $1::bigint
       AND ag.organization_id = $2::bigint
     LIMIT 1`,
    [accountsUser, accountsOrg]
  );
  const row = rows[0];
  if (!row?.ticketing_user_id) return null;
  return getAuthoritativeIdentity(
    String(row.ticketing_user_id),
    String(row.ticketing_organization_id)
  );
}

/**
 * Verify + update password on accounts.setup_users only (by work email).
 */
export async function changeMyAccountPassword(
  email: string,
  currentPassword: string,
  newPasswordHash: string
): Promise<boolean> {
  if (!(await accountsSchemaAvailable())) return false;
  const { rows } = await query<{ id: string; password_hash: string }>(
    `SELECT id::text AS id, password_hash
     FROM accounts.setup_users
     WHERE lower(work_email) = lower($1)
     LIMIT 1`,
    [email]
  );
  const row = rows[0];
  if (!row?.password_hash) return false;
  const ok = await bcrypt.compare(String(currentPassword), String(row.password_hash));
  if (!ok) return false;
  await query(
    `UPDATE accounts.setup_users
     SET password_hash = $1,
         password_set_at = NOW(),
         updated_at = NOW()
     WHERE id::text = $2`,
    [newPasswordHash, row.id]
  );
  return true;
}

/** True when email has an eligible MyAccount ticketing user (any password). */
export async function hasEligibleMyAccountUser(email: string): Promise<boolean> {
  try {
    if (!(await accountsSchemaAvailable())) return false;
    const { rows } = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM (${ELIGIBLE_SQL} AND lower(u.work_email) = lower($1)) e`,
      [email]
    );
    return Number(rows[0]?.n || 0) > 0;
  } catch {
    return false;
  }
}

async function syncRows(rows: EligibleRow[]): Promise<number> {
  let synced = 0;
  for (const row of rows) {
    try {
      await upsertAgent(row);
      synced += 1;
    } catch (err) {
      console.warn(
        `accounts sync skipped user ${row.email}:`,
        (err as Error).message
      );
    }
  }
  return synced;
}

/** One-time compatibility backfill of explicit MyAccount mappings. */
async function backfillMyAccountMappings(): Promise<number> {
  try {
    if (!(await accountsSchemaAvailable())) return 0;
    const { rows } = await query<EligibleRow>(ELIGIBLE_SQL);
    return await syncRows(rows);
  } catch (err) {
    console.warn("accounts full sync failed:", (err as Error).message);
    return 0;
  }
}

export type AssignableAgent = {
  id: string;
  name: string;
  email: string;
  role?: string;
  skills: string[];
  skillDetails: Array<{ skill: string; description: string }>;
  teamIds?: string[];
  /** accounts.setup_users.id — accept on writes; list_agents still exposes agents.id */
  setupUserId?: string;
};

export type AccountsTeam = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  status: string;
  memberIds: string[];
  members: AssignableAgent[];
  openTickets: number;
  assigned: number;
  slaStatus: "At Risk" | "On Track";
};

function parseSkills(skillText: unknown, skillsJson: unknown): string[] {
  const out: string[] = [];
  if (skillText) {
    for (const s of String(skillText).split(",")) {
      if (s.trim()) out.push(s.trim());
    }
  }
  let values = skillsJson;
  if (typeof values === "string") {
    try {
      values = JSON.parse(values);
    } catch {
      values = null;
    }
  }
  if (Array.isArray(values)) {
    for (const item of values) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
      else if (item && typeof item === "object") {
        const name = String(
          (item as Record<string, unknown>).name ||
            (item as Record<string, unknown>).skill ||
            ""
        ).trim();
        if (name) out.push(name);
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** member_ids may be a JSON array, a JSON object map, or null. */
function parseMemberIds(raw: unknown): string[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((v) => String(v || "").trim())
      .filter(Boolean);
  }
  return [];
}

async function setupTeamsAvailable(): Promise<boolean> {
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'accounts' AND table_name = 'setup_teams'
       ) AS exists`
    );
    return Boolean(rows[0]?.exists);
  } catch {
    return false;
  }
}

/** Assignable staff roster with identity, role, status and skills live from MyAccount. */
export async function listAssignableAgents(orgId: string): Promise<AssignableAgent[]> {
  if (!(await accountsSchemaAvailable())) return [];
  const live = await query(
    `SELECT DISTINCT ON (ag.id)
            ag.id,
            ag.setup_user_id,
            NULLIF(TRIM(COALESCE(au.first_name, '') || ' ' || COALESCE(au.last_name, '')), '') AS name,
            lower(au.work_email) AS email,
            lower(r.name) AS role,
            NULL AS skill_text,
            au.skills AS skills_json
     FROM ticketing.agents ag
     JOIN accounts.setup_users au ON au.id = ag.setup_user_id
     JOIN accounts.setup_user_product_access a
       ON a.user_id = au.id
      AND a.product_id = 'ticketing'
      AND a.organization_id = ag.organization_id
     JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE ag.organization_id = $1::bigint
       AND ag.status = 'Active'
       AND lower(COALESCE(au.status, '')) = 'active'
       AND lower(r.name) IN ('admin', 'agent', 'resolver')
     ORDER BY ag.id, 2`,
    [orgId]
  );

  return live.rows.map((r) => {
    const skills = parseSkills(r.skill_text, r.skills_json);
    const effective = skills.length ? skills : ["General"];
    return {
      id: String(r.id),
      name: String(r.name),
      email: String(r.email),
      role: String(r.role || ""),
      skills: effective,
      skillDetails: effective.map((skill) => ({ skill, description: "" })),
      setupUserId: r.setup_user_id != null ? String(r.setup_user_id) : undefined,
    };
  });
}

/**
 * Read-only teams from MyAccount (`accounts.setup_teams`).
 * Members are agents/resolvers already mirrored into ticketing.agents.
 * Ticket stats are computed from ticketing.tickets keyed by team UUID/name.
 */
export async function listAccountsTeams(orgId: string): Promise<AccountsTeam[]> {
  if (!(await setupTeamsAvailable())) return [];

  const { rows: teamRows } = await query(
    `SELECT id, organization_id, name, description, status, member_ids
     FROM accounts.setup_teams
     WHERE organization_id = $1
       AND lower(COALESCE(status, 'active')) = 'active'
     ORDER BY name`,
    [orgId]
  );

  if (!teamRows.length) return [];

  const agents = await listAssignableAgents(orgId);
  const byId = new Map(agents.map((a) => [a.id, a]));

  const { rows: statsRows } = await query(
    `SELECT
       COALESCE(queue_id::text, '') AS team_id,
       COALESCE(queue_name, '') AS team_name,
       COUNT(*) FILTER (WHERE status NOT IN ('Resolved', 'Closed'))::int AS open_tickets,
       COUNT(*) FILTER (
         WHERE status NOT IN ('Resolved', 'Closed')
           AND assignee_name IS NOT NULL
           AND assignee_name <> ''
           AND assignee_name <> 'Unassigned'
       )::int AS assigned,
       COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue
     FROM ticketing.tickets
     WHERE organization_id = $1
     GROUP BY queue_id, queue_name`,
    [orgId]
  );

  const statsById = new Map<string, { open: number; assigned: number; overdue: number }>();
  const statsByName = new Map<string, { open: number; assigned: number; overdue: number }>();
  for (const s of statsRows) {
    const payload = {
      open: Number(s.open_tickets || 0),
      assigned: Number(s.assigned || 0),
      overdue: Number(s.overdue || 0),
    };
    if (s.team_id) statsById.set(String(s.team_id), payload);
    if (s.team_name) statsByName.set(String(s.team_name).toLowerCase(), payload);
  }

  return teamRows.map((t) => {
    const id = String(t.id);
    const name = String(t.name || "").trim();
    const memberIds = parseMemberIds(t.member_ids);
    const members = memberIds
      .map((mid) => byId.get(mid))
      .filter((m): m is AssignableAgent => Boolean(m));
    const stats =
      statsById.get(id) ||
      statsByName.get(name.toLowerCase()) || {
        open: 0,
        assigned: 0,
        overdue: 0,
      };
    return {
      id,
      organizationId: String(t.organization_id),
      name,
      description: String(t.description || ""),
      status: String(t.status || "active"),
      memberIds,
      members,
      openTickets: stats.open,
      assigned: stats.assigned,
      slaStatus: stats.overdue > 0 ? "At Risk" : "On Track",
    };
  });
}

/**
 * Mirror Accounts teams into ticketing.agent_queues with the SAME UUIDs so
 * tickets.queue_id can reference them. Members → agent_queue_members.
 * Never writes to accounts.*. Safe no-op when accounts schema is absent.
 */
export async function syncAccountsTeamsToTicketing(orgId?: string): Promise<number> {
  try {
    if (!(await setupTeamsAvailable())) return 0;

    const params: unknown[] = [];
    let where = `lower(COALESCE(status, 'active')) = 'active'`;
    if (orgId) {
      params.push(orgId);
      where += ` AND organization_id = $${params.length}`;
    }

    const { rows } = await query(
      `SELECT id, organization_id, name, description, member_ids
       FROM accounts.setup_teams
       WHERE ${where}`,
      params
    );

    let synced = 0;
    const orgTeamIds = new Map<string, Set<string>>();

    for (const t of rows) {
      const teamId = String(t.id);
      const teamOrg = String(t.organization_id);
      const teamName = String(t.name || "").trim();
      if (!teamName) continue;

      if (!orgTeamIds.has(teamOrg)) orgTeamIds.set(teamOrg, new Set());
      orgTeamIds.get(teamOrg)!.add(teamId);

      try {
        if (!isDigitId(teamOrg) || !isDigitId(teamId)) {
          throw new Error(`accounts team/org ids must be digit bigint, got org=${teamOrg} team=${teamId}`);
        }
        const ticketingOrgId = await requireAccountsOrg(teamOrg);

        // Drop local seed queues with the same name but a different id so
        // Accounts ids win.
        await query(
          `DELETE FROM ticketing.agent_queues
           WHERE organization_id = $1::bigint
             AND lower(queue_name) = lower($2)
             AND id <> $3::bigint`,
          [ticketingOrgId, teamName, teamId]
        );

        await query(
          `INSERT INTO ticketing.agent_queues (
             id, organization_id, external_id, queue_name, type,
             open_tickets, assigned, sla_status
           ) VALUES ($1::bigint, $2::bigint, $3, $4, 'Shared', 0, 0, 'On Track')
           ON CONFLICT (id) DO UPDATE SET
             queue_name = EXCLUDED.queue_name,
             organization_id = EXCLUDED.organization_id,
             updated_at = NOW()`,
          [teamId, ticketingOrgId, `TEAM-${teamId.slice(0, 8)}`, teamName]
        );

        // Keep membership in sync with Accounts member_ids
        await query(`DELETE FROM ticketing.agent_queue_members WHERE queue_id = $1::bigint`, [teamId]);
        const memberIds = parseMemberIds(t.member_ids);
        for (const userId of memberIds) {
          if (!isDigitId(userId)) continue;
          // member_ids in Accounts are setup_users ids — map to agents
          const exists = await query(
            `SELECT id FROM ticketing.agents
             WHERE setup_user_id = $1::bigint AND organization_id = $2::bigint`,
            [userId, ticketingOrgId]
          );
          if (!exists.rows[0]) continue;
          await query(
            `INSERT INTO ticketing.agent_queue_members (organization_id, queue_id, user_id)
             VALUES ($1::bigint, $2::bigint, $3::bigint)
             ON CONFLICT (queue_id, user_id) DO NOTHING`,
            [ticketingOrgId, teamId, exists.rows[0].id]
          );
        }
        synced += 1;
      } catch (err) {
        console.warn(
          `accounts team sync skipped ${teamName}:`,
          (err as Error).message
        );
      }
    }

    // For orgs that have MyAccount teams, hide leftover seed queues
    // (only when no tickets still point at them).
    for (const [teamOrg, ids] of orgTeamIds) {
      if (!ids.size) continue;
      const idList = [...ids];
      await query(
        `DELETE FROM ticketing.agent_queues q
         WHERE q.organization_id = $1
           AND NOT (q.id = ANY($2::bigint[]))
           AND NOT EXISTS (
             SELECT 1 FROM ticketing.tickets t
             WHERE t.queue_id = q.id
           )`,
        [teamOrg, idList]
      );
    }

    return synced;
  } catch (err) {
    console.warn("accounts team sync failed:", (err as Error).message);
    return 0;
  }
}

/** Resolve a team by exact name or UUID for an org (Accounts first). */
export async function resolveAccountsTeam(
  orgId: string,
  teamNameOrId: string
): Promise<AccountsTeam | null> {
  const wanted = String(teamNameOrId || "").trim();
  if (!wanted) return null;
  const teams = await listAccountsTeams(orgId);
  const byId = teams.find((t) => t.id === wanted);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  return teams.find((t) => t.name.toLowerCase() === lower) || null;
}

/** Same id as accounts.setup_user_product_access for this spoke. */
export const TICKETING_AUTH_PRODUCT_ID = "ticketing";

export class ProductSessionConflictError extends Error {
  status = 409;
  code = "already_signed_in_product";
  constructor(
    message = "You are already signed in to Ticketing in another browser. Sign out there, or continue here to end only that Ticketing session."
  ) {
    super(message);
    this.name = "ProductSessionConflictError";
  }
}

let authSessionsReady: boolean | null = null;
let hubUsersColumns: Set<string> | null = null;
let authSessionsUserIdNullable: boolean | null = null;

async function hubUsersColumnSet(): Promise<Set<string> | null> {
  if (hubUsersColumns) return hubUsersColumns;
  const { rows: tables } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'accounts' AND table_name = 'users'
     ) AS exists`
  );
  if (!tables[0]?.exists) return null;
  const { rows } = await query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'accounts' AND table_name = 'users'`
  );
  hubUsersColumns = new Set(
    rows.map((row) => String(row.column_name || "").toLowerCase())
  );
  return hubUsersColumns;
}

/** auth_sessions.user_id → accounts.users, not setup_users / agents. */
async function resolveHubAuthSessionsUserId(
  setupUserId: string,
  email: string
): Promise<string | null> {
  const cols = await hubUsersColumnSet();
  if (!cols || !cols.has("id")) return null;
  const setupId = String(setupUserId || "").trim();
  const addr = String(email || "").trim();
  if (isDigitId(setupId)) {
    const { rows } = await query<{ id: string }>(
      `SELECT id::text AS id
         FROM accounts.users
        WHERE id = $1::bigint
        LIMIT 1`,
      [setupId]
    );
    if (rows[0]?.id) return String(rows[0].id);
    if (cols.has("setup_user_id")) {
      const mapped = await query<{ id: string }>(
        `SELECT id::text AS id
           FROM accounts.users
          WHERE setup_user_id = $1::bigint
          LIMIT 1`,
        [setupId]
      );
      if (mapped.rows[0]?.id) return String(mapped.rows[0].id);
    }
  }
  if (addr && cols.has("email")) {
    const { rows } = await query<{ id: string }>(
      `SELECT id::text AS id
         FROM accounts.users
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [addr]
    );
    if (rows[0]?.id) return String(rows[0].id);
  }
  return null;
}

async function isAuthSessionsUserIdNullable(): Promise<boolean> {
  if (authSessionsUserIdNullable != null) return authSessionsUserIdNullable;
  const { rows } = await query<{ is_nullable: string }>(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'accounts'
        AND table_name = 'auth_sessions'
        AND column_name = 'user_id'`
  );
  authSessionsUserIdNullable = String(rows[0]?.is_nullable || "YES") !== "NO";
  return authSessionsUserIdNullable;
}

async function ensureTicketingAuthSessionsTable(): Promise<boolean> {
  if (authSessionsReady === true) return true;
  if (!(await accountsSchemaAvailable())) {
    authSessionsReady = false;
    return false;
  }
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'accounts' AND table_name = 'auth_sessions'
       ) AS exists`
    );
    if (!rows[0]?.exists) {
      authSessionsReady = false;
      return false;
    }
    // Contact Center owns the column. No DEFAULT — a default would mislabel CRM rows.
    await query(
      `ALTER TABLE accounts.auth_sessions
         ADD COLUMN IF NOT EXISTS product_id VARCHAR(128)`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_auth_sessions_email_product
         ON accounts.auth_sessions (email, product_id)`
    );
    authSessionsReady = true;
    return true;
  } catch (err) {
    console.warn(
      "accounts.auth_sessions unavailable:",
      (err as Error).message
    );
    authSessionsReady = false;
    return false;
  }
}

export async function hasActiveTicketingAuthSession(
  email: string
): Promise<boolean> {
  const addr = String(email || "").trim();
  if (!addr || !(await ensureTicketingAuthSessionsTable())) return false;
  const { rows } = await query<{ ok: number }>(
    `SELECT 1 AS ok
       FROM accounts.auth_sessions
      WHERE lower(email) = lower($1)
        AND expires_at > now()
        AND product_id = $2
      LIMIT 1`,
    [addr, TICKETING_AUTH_PRODUCT_ID]
  );
  return Boolean(rows[0]);
}

/** Logout / force — Ticketing rows only. Never NULL or another product. */
export async function releaseTicketingAuthSession(
  email: string,
  token?: string
): Promise<void> {
  const addr = String(email || "").trim();
  const tok = String(token || "").trim();
  if ((!addr && !tok) || !(await ensureTicketingAuthSessionsTable())) return;
  await query(
    `DELETE FROM accounts.auth_sessions
      WHERE product_id = $1
        AND (
          ($2 <> '' AND lower(email) = lower($2))
          OR ($3 <> '' AND token = $3)
        )`,
    [TICKETING_AUTH_PRODUCT_ID, addr, tok]
  );
}

export async function assertTicketingProductSession(
  email: string,
  force: boolean
): Promise<void> {
  const addr = String(email || "").trim();
  if (!addr) return;
  if (force) {
    await releaseTicketingAuthSession(addr);
    return;
  }
  if (await hasActiveTicketingAuthSession(addr)) {
    throw new ProductSessionConflictError();
  }
}

export async function recordTicketingAuthSession(opts: {
  token: string;
  email: string;
  role: string;
  displayName?: string | null;
  accountsUserId?: string | null;
  expiresAt: Date;
}): Promise<void> {
  // Hub token is varchar(128): Ticketing session id, never the cookie JWT.
  const token = String(opts.token || "").trim();
  const email = String(opts.email || "").trim();
  const role = String(opts.role || "").trim();
  if (!token || !email || !role) return;
  if (token.length > 128) return;
  if (!(await ensureTicketingAuthSessionsTable())) return;
  await query(
    `DELETE FROM accounts.auth_sessions
      WHERE lower(email) = lower($1)
        AND product_id = $2
        AND expires_at <= now()`,
    [email, TICKETING_AUTH_PRODUCT_ID]
  );
  const userId = await resolveHubAuthSessionsUserId(
    String(opts.accountsUserId || "").trim(),
    email
  );
  if (!userId && !(await isAuthSessionsUserIdNullable())) return;
  const displayName = String(opts.displayName || "").trim().slice(0, 128) || null;
  await query(
    `INSERT INTO accounts.auth_sessions (
       token, email, role, display_name, expires_at, user_id, product_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      token,
      email.toLowerCase(),
      role,
      displayName,
      opts.expiresAt,
      userId,
      TICKETING_AUTH_PRODUCT_ID,
    ]
  );
}

async function runMappingBackfill(): Promise<void> {
  const users = await backfillMyAccountMappings();
  if (users > 0) console.log(`MyAccount mapping backfill: ${users} user(s) linked.`);
}

/** One-time boot mapping backfill. Identity/profile fields are never mirrored. */
export function startAccountsIdentityMappingBackfill(): void {
  void runMappingBackfill();
}
