import type { Priority } from "../types";
import { query } from "./db";

const SYSTEM_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const SYSTEM_SORT: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};
const SYSTEM_DISPLAY: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function requireCatalogNumericId(id: string, label = "priority id"): string {
  const raw = String(id || "").trim();
  if (!/^\d+$/.test(raw)) {
    throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  }
  return raw;
}

let slaTableReady = false;
let slaTableEnsurePromise: Promise<void> | null = null;
const ensuredPriorityOrgs = new Set<string>();
const orgEnsurePromises = new Map<string, Promise<void>>();

export type SlaPolicy = {
  priority: string;
  resolutionHours: number;
  firstResponseHours: number;
};

export type OrgPriority = {
  id: string;
  priority: string;
  displayName: string;
  resolutionHours: number;
  firstResponseHours: number;
  isSystem: boolean;
  sortOrder: number;
  active: boolean;
};

function mapOrgPriority(row: Record<string, unknown>): OrgPriority {
  const priority = String(row.priority);
  return {
    id: String(row.id),
    priority,
    displayName: String(
      row.display_name || SYSTEM_DISPLAY[priority] || priority
    ),
    resolutionHours: Number(row.resolution_hours),
    firstResponseHours: Number(row.first_response_hours),
    isSystem: Boolean(row.is_system),
    sortOrder: Number(row.sort_order ?? 100),
    active: row.active !== false,
  };
}

/** Slug for custom priority keys stored on tickets.priority */
export function slugifyPriorityKey(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return s || "custom";
}

export function defaultFirstResponseHours(resolutionHours: number): number {
  return Math.max(1, Math.ceil(resolutionHours / 4));
}

/** Catalog SLA hours are stored as whole hours (INTEGER). Sub-hour values round up to 1. */
export function normalizeCatalogResolutionHours(raw: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error("SLA breach hours must be a positive number"), {
      status: 400,
    });
  }
  if (n < 1) return 1;
  return Math.round(n);
}

async function dropPriorityCheckConstraint(): Promise<void> {
  // Drop legacy CHECKs that only allow low|medium|high|urgent on sla_policies.
  await query(`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'ticketing'
          AND t.relname = 'sla_policies'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%priority%'
          AND pg_get_constraintdef(c.oid) ILIKE '%low%'
      LOOP
        EXECUTE format('ALTER TABLE ticketing.sla_policies DROP CONSTRAINT IF EXISTS %I', r.conname);
      END LOOP;
    END $$;
  `);
}

export async function ensureSlaPoliciesTable(): Promise<void> {
  if (slaTableReady) return;
  if (slaTableEnsurePromise) {
    await slaTableEnsurePromise;
    return;
  }
  slaTableEnsurePromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS ticketing.sla_policy_defaults (
        priority               TEXT PRIMARY KEY
                                 CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        resolution_hours       INTEGER NOT NULL CHECK (resolution_hours > 0),
        first_response_hours   INTEGER NOT NULL CHECK (first_response_hours > 0),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      INSERT INTO ticketing.sla_policy_defaults (priority, resolution_hours, first_response_hours)
      VALUES
        ('urgent',  4,  1),
        ('high',    8,  2),
        ('medium', 24,  4),
        ('low',    72,  8)
      ON CONFLICT (priority) DO NOTHING
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS ticketing.sla_policies (
        id                     BIGSERIAL PRIMARY KEY,
        organization_id        BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
        priority               TEXT NOT NULL,
        resolution_hours       INTEGER NOT NULL CHECK (resolution_hours > 0),
        first_response_hours   INTEGER NOT NULL CHECK (first_response_hours > 0),
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, priority)
      )
    `);
    await dropPriorityCheckConstraint();
    await query(
      `CREATE INDEX IF NOT EXISTS idx_sla_policies_organization_id
       ON ticketing.sla_policies(organization_id)`
    );

    await query(
      `ALTER TABLE ticketing.sla_policies ADD COLUMN IF NOT EXISTS display_name TEXT`
    );
    await query(
      `ALTER TABLE ticketing.sla_policies ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false`
    );
    await query(
      `ALTER TABLE ticketing.sla_policies ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100`
    );
    await query(
      `ALTER TABLE ticketing.sla_policies ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`
    );

    // One-time backfill for system defaults (all orgs)
    for (const p of SYSTEM_PRIORITIES) {
      await query(
        `UPDATE ticketing.sla_policies
         SET display_name = COALESCE(NULLIF(display_name, ''), $2),
             is_system = true,
             sort_order = $3,
             updated_at = NOW()
         WHERE priority = $1
           AND (
             display_name IS NULL OR display_name = '' OR is_system = false
             OR sort_order IS DISTINCT FROM $3
           )`,
        [p, SYSTEM_DISPLAY[p], SYSTEM_SORT[p]]
      );
    }
    await query(
      `UPDATE ticketing.sla_policies
       SET display_name = COALESCE(NULLIF(display_name, ''), initcap(priority))
       WHERE display_name IS NULL OR display_name = ''`
    );
    slaTableReady = true;
  })();
  try {
    await slaTableEnsurePromise;
  } catch (err) {
    slaTableEnsurePromise = null;
    throw err;
  }
}

/** Copy any missing system priority rows for an org from sla_policy_defaults. */
export async function ensureSlaPoliciesForOrg(organizationId: string): Promise<void> {
  await ensureSlaPoliciesTable();
  if (ensuredPriorityOrgs.has(organizationId)) return;

  let pending = orgEnsurePromises.get(organizationId);
  if (!pending) {
    pending = (async () => {
      await query(
        `INSERT INTO ticketing.sla_policies
           (organization_id, priority, resolution_hours, first_response_hours,
            display_name, is_system, sort_order, active)
         SELECT $1, d.priority, d.resolution_hours, d.first_response_hours,
                CASE d.priority
                  WHEN 'urgent' THEN 'Urgent'
                  WHEN 'high' THEN 'High'
                  WHEN 'medium' THEN 'Medium'
                  WHEN 'low' THEN 'Low'
                  ELSE initcap(d.priority)
                END,
                true,
                CASE d.priority
                  WHEN 'urgent' THEN 1
                  WHEN 'high' THEN 2
                  WHEN 'medium' THEN 3
                  WHEN 'low' THEN 4
                  ELSE 100
                END,
                true
         FROM ticketing.sla_policy_defaults d
         ON CONFLICT (organization_id, priority) DO NOTHING`,
        [organizationId]
      );
      ensuredPriorityOrgs.add(organizationId);
      orgEnsurePromises.delete(organizationId);
    })();
    orgEnsurePromises.set(organizationId, pending);
  }
  await pending;
}

/** Ensure every org has a full priority policy set. */
export async function ensureSlaPoliciesForAllOrgs(): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `SELECT organization_id::text AS id FROM ticketing.org_settings`
  );
  for (const org of rows) {
    await ensureSlaPoliciesForOrg(org.id);
  }
}

export async function getSlaPolicy(
  organizationId: string,
  priority: string
): Promise<SlaPolicy> {
  await ensureSlaPoliciesForOrg(organizationId);
  const key = String(priority || "medium").trim().toLowerCase() || "medium";
  const { rows } = await query(
    `SELECT priority, resolution_hours, first_response_hours
     FROM ticketing.sla_policies
     WHERE organization_id = $1 AND lower(priority) = lower($2)
     LIMIT 1`,
    [organizationId, key]
  );
  let row = rows[0];
  if (!row && key !== "medium") {
    const fallback = await query(
      `SELECT priority, resolution_hours, first_response_hours
       FROM ticketing.sla_policies
       WHERE organization_id = $1 AND priority = 'medium'
       LIMIT 1`,
      [organizationId]
    );
    row = fallback.rows[0];
  }
  if (!row) {
    throw new Error(
      `SLA policy missing for org ${organizationId} priority ${priority}`
    );
  }
  return {
    priority: String(row.priority),
    resolutionHours: Number(row.resolution_hours),
    firstResponseHours: Number(row.first_response_hours),
  };
}

export async function listSlaPolicies(
  organizationId: string
): Promise<SlaPolicy[]> {
  const list = await listOrgPriorities(organizationId, { includeInactive: true });
  return list.map((p) => ({
    priority: p.priority as Priority,
    resolutionHours: p.resolutionHours,
    firstResponseHours: p.firstResponseHours,
  }));
}

export async function listOrgPriorities(
  organizationId: string,
  opts?: { includeInactive?: boolean }
): Promise<OrgPriority[]> {
  await ensureSlaPoliciesForOrg(organizationId);
  const { rows } = await query(
    `SELECT id, priority, display_name, resolution_hours, first_response_hours,
            is_system, sort_order, active
     FROM ticketing.sla_policies
     WHERE organization_id = $1
       AND ($2::boolean OR active = true)
     ORDER BY sort_order ASC, display_name ASC`,
    [organizationId, Boolean(opts?.includeInactive)]
  );
  return rows.map((r) => mapOrgPriority(r));
}

export async function isActiveOrgPriority(
  organizationId: string,
  priority: string
): Promise<boolean> {
  await ensureSlaPoliciesForOrg(organizationId);
  const key = String(priority || "").trim();
  if (!key) return false;
  const { rows } = await query(
    `SELECT 1 FROM ticketing.sla_policies
     WHERE organization_id = $1 AND lower(priority) = lower($2) AND active = true
     LIMIT 1`,
    [organizationId, key]
  );
  return rows.length > 0;
}

export async function createOrgPriority(
  organizationId: string,
  input: { displayName: string; resolutionHours: number; priorityKey?: string }
): Promise<OrgPriority> {
  await ensureSlaPoliciesForOrg(organizationId);
  const displayName = String(input.displayName || "").trim();
  const resolutionHours = normalizeCatalogResolutionHours(
    Number(input.resolutionHours)
  );
  if (!displayName) throw Object.assign(new Error("Label is required"), { status: 400 });
  let key = slugifyPriorityKey(input.priorityKey || displayName);
  if (SYSTEM_PRIORITIES.includes(key as (typeof SYSTEM_PRIORITIES)[number])) {
    key = `${key}_custom`;
  }
  // Ensure uniqueness
  const existing = await query(
    `SELECT 1 FROM ticketing.sla_policies
     WHERE organization_id = $1 AND lower(priority) = lower($2)`,
    [organizationId, key]
  );
  if (existing.rows.length) {
    throw Object.assign(new Error("A priority with this key already exists"), {
      status: 409,
    });
  }
  const first = defaultFirstResponseHours(resolutionHours);
  const { rows } = await query(
    `INSERT INTO ticketing.sla_policies (
       organization_id, priority, resolution_hours, first_response_hours,
       display_name, is_system, sort_order, active
     ) VALUES ($1,$2,$3,$4,$5,false,
       COALESCE((SELECT MAX(sort_order) + 1 FROM ticketing.sla_policies WHERE organization_id = $1), 100),
       true)
     RETURNING id, priority, display_name, resolution_hours, first_response_hours,
               is_system, sort_order, active`,
    [organizationId, key, resolutionHours, first, displayName]
  );
  return mapOrgPriority(rows[0]);
}

export async function updateOrgPriority(
  organizationId: string,
  id: string,
  input: {
    displayName?: string;
    resolutionHours?: number;
    active?: boolean;
  }
): Promise<OrgPriority | null> {
  id = requireCatalogNumericId(id);
  await ensureSlaPoliciesForOrg(organizationId);
  const { rows: found } = await query(
    `SELECT id, priority, display_name, resolution_hours, first_response_hours,
            is_system, sort_order, active
     FROM ticketing.sla_policies
     WHERE organization_id = $1 AND id = $2::bigint
     LIMIT 1`,
    [organizationId, id]
  );
  if (!found[0]) return null;
  const cur = mapOrgPriority(found[0]);

  let displayName = cur.displayName;
  if (input.displayName !== undefined) {
    if (cur.isSystem) {
      throw Object.assign(new Error("System priority labels cannot be renamed"), {
        status: 400,
      });
    }
    displayName = String(input.displayName).trim();
    if (!displayName) {
      throw Object.assign(new Error("Label is required"), { status: 400 });
    }
  }

  let resolutionHours = cur.resolutionHours;
  let firstResponse = cur.firstResponseHours;
  if (input.resolutionHours !== undefined) {
    resolutionHours = normalizeCatalogResolutionHours(Number(input.resolutionHours));
    firstResponse = defaultFirstResponseHours(resolutionHours);
  }

  let active = cur.active;
  if (input.active !== undefined) {
    active = Boolean(input.active);
    // Keep at least one active priority so ticket create always has a valid option.
    if (!active) {
      const { rows: others } = await query(
        `SELECT 1 FROM ticketing.sla_policies
         WHERE organization_id = $1 AND id <> $2::bigint AND active = true
         LIMIT 1`,
        [organizationId, id]
      );
      if (!others.length) {
        throw Object.assign(
          new Error("At least one priority must stay enabled"),
          { status: 400 }
        );
      }
    }
  }

  const { rows } = await query(
    `UPDATE ticketing.sla_policies
     SET display_name = $3,
         resolution_hours = $4,
         first_response_hours = $5,
         active = $6,
         updated_at = NOW()
     WHERE organization_id = $1 AND id = $2::bigint
     RETURNING id, priority, display_name, resolution_hours, first_response_hours,
               is_system, sort_order, active`,
    [organizationId, id, displayName, resolutionHours, firstResponse, active]
  );
  return rows[0] ? mapOrgPriority(rows[0]) : null;
}

export async function deactivateOrgPriority(
  organizationId: string,
  id: string
): Promise<OrgPriority | null> {
  return updateOrgPriority(organizationId, id, { active: false });
}

/** Permanently remove a custom priority; remap tickets to medium. */
export async function deleteOrgPriority(
  organizationId: string,
  id: string
): Promise<{ ok: true; priority: string }> {
  id = requireCatalogNumericId(id);
  await ensureSlaPoliciesForOrg(organizationId);
  const { rows: found } = await query(
    `SELECT id, priority, is_system
     FROM ticketing.sla_policies
     WHERE organization_id = $1 AND id = $2::bigint
     LIMIT 1`,
    [organizationId, id]
  );
  if (!found[0]) {
    throw Object.assign(new Error("Priority not found"), { status: 404 });
  }
  if (found[0].is_system) {
    throw Object.assign(new Error("System priorities cannot be removed"), {
      status: 400,
    });
  }
  const key = String(found[0].priority);
  await query(
    `UPDATE ticketing.tickets
     SET priority = 'medium', updated_at = NOW()
     WHERE organization_id = $1 AND lower(priority) = lower($2)`,
    [organizationId, key]
  );
  const del = await query(
    `DELETE FROM ticketing.sla_policies
     WHERE organization_id = $1 AND id = $2::bigint AND is_system = false
     RETURNING id`,
    [organizationId, id]
  );
  if (!del.rows[0]) {
    throw Object.assign(new Error("Priority not found"), { status: 404 });
  }
  return { ok: true, priority: key };
}

/** Resolution SLA due time from org policy (DB). */
export async function computeDueAt(
  organizationId: string,
  priority: string,
  from: Date = new Date()
): Promise<Date> {
  const policy = await getSlaPolicy(organizationId, priority);
  return new Date(from.getTime() + policy.resolutionHours * 60 * 60 * 1000);
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  if (Number.isNaN(diffMs)) return "—";
  if (diffMs < 0) {
    const ahead = Math.abs(diffMs);
    const mins = Math.floor(ahead / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `in ${hours}h`;
    return d.toISOString().slice(0, 10);
  }
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export function isDueToday(dueAt: Date | string | null | undefined): boolean {
  if (!dueAt) return false;
  const d = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
