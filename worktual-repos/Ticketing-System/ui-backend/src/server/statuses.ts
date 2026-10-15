import { query } from "./db";

function requireCatalogNumericId(id: string, label = "status id"): string {
  const raw = String(id || "").trim();
  if (!/^\d+$/.test(raw)) {
    throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  }
  return raw;
}

const SYSTEM_STATUSES = [
  "Open",
  "Pending",
  "Reopened",
  "Resolved",
  "Overdue",
] as const;

const SYSTEM_SORT: Record<string, number> = {
  Open: 1,
  Pending: 2,
  Reopened: 3,
  Resolved: 4,
  Overdue: 5,
};

const SYSTEM_DISPLAY: Record<string, string> = {
  Open: "Open",
  Pending: "In Progress",
  Reopened: "Reopened",
  Resolved: "Resolved",
  Overdue: "Overdue",
};

export type OrgTicketStatus = {
  id: string;
  status: string;
  displayName: string;
  isSystem: boolean;
  isTerminal: boolean;
  sortOrder: number;
  active: boolean;
};

function mapOrgStatus(row: Record<string, unknown>): OrgTicketStatus {
  const status = String(row.status);
  return {
    id: String(row.id),
    status,
    displayName: String(
      row.display_name || SYSTEM_DISPLAY[status] || status
    ),
    isSystem: Boolean(row.is_system),
    isTerminal: Boolean(row.is_terminal) || status === "Resolved",
    sortOrder: Number(row.sort_order ?? 100),
    active: row.active !== false,
  };
}

/** Slug for custom status keys stored on tickets.status */
export function slugifyStatusKey(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return s || "custom";
}

async function dropTicketsStatusCheckConstraint(): Promise<void> {
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
          AND t.relname = 'tickets'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%status%'
          AND (
            pg_get_constraintdef(c.oid) ILIKE '%Open%'
            OR pg_get_constraintdef(c.oid) ILIKE '%Pending%'
          )
      LOOP
        EXECUTE format('ALTER TABLE ticketing.tickets DROP CONSTRAINT IF EXISTS %I', r.conname);
      END LOOP;
    END $$;
  `);
}

let statusesTableReady = false;
let statusesTableEnsurePromise: Promise<void> | null = null;
const ensuredOrgs = new Set<string>();
const statusOrgEnsurePromises = new Map<string, Promise<void>>();
let onHoldPurged = false;

export async function ensureTicketStatusesTable(): Promise<void> {
  if (statusesTableReady) return;
  if (statusesTableEnsurePromise) {
    await statusesTableEnsurePromise;
    return;
  }
  statusesTableEnsurePromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS ticketing.ticket_statuses (
        id               BIGSERIAL PRIMARY KEY,
        organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
        status           TEXT NOT NULL,
        display_name     TEXT NOT NULL,
        is_system        BOOLEAN NOT NULL DEFAULT false,
        is_terminal      BOOLEAN NOT NULL DEFAULT false,
        sort_order       INTEGER NOT NULL DEFAULT 100,
        active           BOOLEAN NOT NULL DEFAULT true,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, status)
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_ticket_statuses_organization_id
       ON ticketing.ticket_statuses(organization_id)`
    );
    await dropTicketsStatusCheckConstraint();

    // One-shot legacy On Hold purge (all orgs)
    if (!onHoldPurged) {
      await query(
        `UPDATE ticketing.tickets
         SET status = 'Pending', updated_at = NOW()
         WHERE status = 'On Hold'`
      );
      await query(
        `DELETE FROM ticketing.ticket_statuses WHERE status = 'On Hold'`
      );
      onHoldPurged = true;
    }
    statusesTableReady = true;
  })();
  try {
    await statusesTableEnsurePromise;
  } catch (err) {
    statusesTableEnsurePromise = null;
    throw err;
  }
}

/** Seed system status rows for an org (cheap after first call). */
export async function ensureTicketStatusesForOrg(
  organizationId: string
): Promise<void> {
  await ensureTicketStatusesTable();
  if (ensuredOrgs.has(organizationId)) return;

  let pending = statusOrgEnsurePromises.get(organizationId);
  if (!pending) {
    pending = (async () => {
      await query(
        `INSERT INTO ticketing.ticket_statuses
           (organization_id, status, display_name, is_system, is_terminal, sort_order, active)
         VALUES
           ($1, 'Open',     'Open',         true, false, 1, true),
           ($1, 'Pending',  'In Progress',  true, false, 2, true),
           ($1, 'Reopened', 'Reopened',     true, false, 3, true),
           ($1, 'Resolved', 'Resolved',     true, true,  4, true),
           ($1, 'Overdue',  'Overdue',      true, false, 5, true)
         ON CONFLICT (organization_id, status) DO NOTHING`,
        [organizationId]
      );

      await query(
        `UPDATE ticketing.ticket_statuses AS t
         SET display_name = v.display_name,
             is_system = true,
             is_terminal = v.is_terminal,
             sort_order = v.sort_order,
             updated_at = NOW()
         FROM (VALUES
           ('Open',     'Open',         false, 1),
           ('Pending',  'In Progress',  false, 2),
           ('Reopened', 'Reopened',     false, 3),
           ('Resolved', 'Resolved',     true,  4),
           ('Overdue',  'Overdue',      false, 5)
         ) AS v(status, display_name, is_terminal, sort_order)
         WHERE t.organization_id = $1
           AND t.status = v.status
           AND t.is_system = true
           AND (
             t.display_name IS DISTINCT FROM v.display_name
             OR t.is_terminal IS DISTINCT FROM v.is_terminal
             OR t.sort_order IS DISTINCT FROM v.sort_order
           )`,
        [organizationId]
      );

      ensuredOrgs.add(organizationId);
      statusOrgEnsurePromises.delete(organizationId);
    })();
    statusOrgEnsurePromises.set(organizationId, pending);
  }
  await pending;
}

export async function ensureTicketStatusesForAllOrgs(): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `SELECT organization_id::text AS id FROM ticketing.org_settings`
  );
  for (const org of rows) {
    await ensureTicketStatusesForOrg(org.id);
  }
}

export async function listOrgTicketStatuses(
  organizationId: string,
  opts?: { includeInactive?: boolean }
): Promise<OrgTicketStatus[]> {
  await ensureTicketStatusesForOrg(organizationId);
  const { rows } = await query(
    `SELECT id, status, display_name, is_system, is_terminal, sort_order, active
     FROM ticketing.ticket_statuses
     WHERE organization_id = $1
       AND ($2::boolean OR active = true)
     ORDER BY sort_order ASC, display_name ASC`,
    [organizationId, Boolean(opts?.includeInactive)]
  );
  return rows.map((r) => mapOrgStatus(r));
}

export async function isActiveOrgStatus(
  organizationId: string,
  status: string
): Promise<boolean> {
  await ensureTicketStatusesForOrg(organizationId);
  const key = String(status || "").trim();
  if (!key) return false;
  const { rows } = await query(
    `SELECT 1 FROM ticketing.ticket_statuses
     WHERE organization_id = $1 AND lower(status) = lower($2) AND active = true
     LIMIT 1`,
    [organizationId, key]
  );
  return rows.length > 0;
}

/** Resolve canonical stored key for a status label/key (case-insensitive). */
export async function resolveOrgStatusKey(
  organizationId: string,
  status: string
): Promise<string | null> {
  await ensureTicketStatusesForOrg(organizationId);
  const key = String(status || "").trim();
  if (!key) return null;
  const { rows } = await query(
    `SELECT status FROM ticketing.ticket_statuses
     WHERE organization_id = $1 AND lower(status) = lower($2) AND active = true
     LIMIT 1`,
    [organizationId, key]
  );
  return rows[0] ? String(rows[0].status) : null;
}

export async function isTerminalOrgStatus(
  organizationId: string,
  status: string
): Promise<boolean> {
  await ensureTicketStatusesForOrg(organizationId);
  const key = String(status || "").trim();
  if (!key) return false;
  if (key === "Resolved") return true;
  const { rows } = await query(
    `SELECT is_terminal FROM ticketing.ticket_statuses
     WHERE organization_id = $1 AND lower(status) = lower($2)
     LIMIT 1`,
    [organizationId, key]
  );
  return rows[0] ? Boolean(rows[0].is_terminal) : false;
}

/**
 * Agent-only (or unassigned) → Open.
 * Both L1 assignee and L2 resolver set → Pending (UI: In Progress).
 */
export function statusFromAssignment(input: {
  assigneeId?: string | null;
  assigneeName?: string | null;
  resolverId?: string | null;
}): "Open" | "Pending" {
  const name = String(input.assigneeName || "").trim();
  const hasAssignee =
    Boolean(input.assigneeId) && name !== "" && name !== "Unassigned";
  const hasResolver = Boolean(input.resolverId);
  if (hasAssignee && hasResolver) return "Pending";
  return "Open";
}

/** Only auto-flip Open / Pending / Reopened from assignment (not Resolved / Overdue). */
export function mayApplyAssignmentStatus(currentStatus: string): boolean {
  const s = String(currentStatus || "").trim();
  return s === "Open" || s === "Pending" || s === "Reopened" || s === "";
}

export async function createOrgTicketStatus(
  organizationId: string,
  input: { displayName: string; statusKey?: string }
): Promise<OrgTicketStatus> {
  await ensureTicketStatusesForOrg(organizationId);
  const displayName = String(input.displayName || "").trim();
  if (!displayName) {
    throw Object.assign(new Error("Label is required"), { status: 400 });
  }
  let key = slugifyStatusKey(input.statusKey || displayName);
  const systemLower = SYSTEM_STATUSES.map((s) => s.toLowerCase());
  if (systemLower.includes(key.toLowerCase())) {
    key = `${key}_custom`;
  }
  const existing = await query(
    `SELECT 1 FROM ticketing.ticket_statuses
     WHERE organization_id = $1 AND lower(status) = lower($2)`,
    [organizationId, key]
  );
  if (existing.rows.length) {
    throw Object.assign(new Error("A status with this key already exists"), {
      status: 409,
    });
  }
  const { rows } = await query(
    `INSERT INTO ticketing.ticket_statuses (
       organization_id, status, display_name, is_system, is_terminal, sort_order, active
     ) VALUES ($1, $2, $3, false, false,
       COALESCE((SELECT MAX(sort_order) + 1 FROM ticketing.ticket_statuses WHERE organization_id = $1), 100),
       true)
     RETURNING id, status, display_name, is_system, is_terminal, sort_order, active`,
    [organizationId, key, displayName]
  );
  return mapOrgStatus(rows[0]);
}

export async function updateOrgTicketStatus(
  organizationId: string,
  id: string,
  input: { displayName?: string; active?: boolean }
): Promise<OrgTicketStatus | null> {
  id = requireCatalogNumericId(id);
  await ensureTicketStatusesForOrg(organizationId);
  const { rows: found } = await query(
    `SELECT id, status, display_name, is_system, is_terminal, sort_order, active
     FROM ticketing.ticket_statuses
     WHERE organization_id = $1 AND id = $2::bigint
     LIMIT 1`,
    [organizationId, id]
  );
  if (!found[0]) return null;
  const cur = mapOrgStatus(found[0]);

  let displayName = cur.displayName;
  if (input.displayName !== undefined) {
    if (cur.isSystem) {
      throw Object.assign(new Error("System status labels cannot be renamed"), {
        status: 400,
      });
    }
    displayName = String(input.displayName).trim();
    if (!displayName) {
      throw Object.assign(new Error("Label is required"), { status: 400 });
    }
  }

  let active = cur.active;
  if (input.active !== undefined) {
    active = Boolean(input.active);
    if (!active && !cur.isTerminal) {
      // Keep at least one active non-terminal status for open work.
      const { rows: others } = await query(
        `SELECT 1 FROM ticketing.ticket_statuses
         WHERE organization_id = $1
           AND id <> $2::bigint
           AND active = true
           AND COALESCE(is_terminal, false) = false
           AND status <> 'Resolved'
         LIMIT 1`,
        [organizationId, id]
      );
      if (!others.length) {
        throw Object.assign(
          new Error("At least one non-terminal status must stay enabled"),
          { status: 400 }
        );
      }
    }
  }

  const { rows } = await query(
    `UPDATE ticketing.ticket_statuses
     SET display_name = $3,
         active = $4,
         updated_at = NOW()
     WHERE organization_id = $1 AND id = $2::bigint
     RETURNING id, status, display_name, is_system, is_terminal, sort_order, active`,
    [organizationId, id, displayName, active]
  );
  return rows[0] ? mapOrgStatus(rows[0]) : null;
}

export async function deactivateOrgTicketStatus(
  organizationId: string,
  id: string
): Promise<OrgTicketStatus | null> {
  id = requireCatalogNumericId(id);
  const { rows: found } = await query(
    `SELECT is_system FROM ticketing.ticket_statuses
     WHERE organization_id = $1 AND id = $2::bigint
     LIMIT 1`,
    [organizationId, id]
  );
  if (!found[0]) return null;
  if (found[0].is_system) {
    throw Object.assign(new Error("System statuses cannot be removed"), {
      status: 400,
    });
  }
  return updateOrgTicketStatus(organizationId, id, { active: false });
}

/** Permanently remove a custom status; remap tickets to Open. */
export async function deleteOrgTicketStatus(
  organizationId: string,
  id: string
): Promise<{ ok: true; status: string }> {
  id = requireCatalogNumericId(id);
  await ensureTicketStatusesForOrg(organizationId);
  const { rows: found } = await query(
    `SELECT id, status, is_system
     FROM ticketing.ticket_statuses
     WHERE organization_id = $1 AND id = $2::bigint
     LIMIT 1`,
    [organizationId, id]
  );
  if (!found[0]) {
    throw Object.assign(new Error("Status not found"), { status: 404 });
  }
  if (found[0].is_system) {
    throw Object.assign(new Error("System statuses cannot be removed"), {
      status: 400,
    });
  }
  const key = String(found[0].status);
  await query(
    `UPDATE ticketing.tickets
     SET status = 'Open',
         resolved_at = NULL,
         updated_at = NOW()
     WHERE organization_id = $1 AND lower(status) = lower($2)`,
    [organizationId, key]
  );
  const del = await query(
    `DELETE FROM ticketing.ticket_statuses
     WHERE organization_id = $1 AND id = $2::bigint AND is_system = false
     RETURNING id`,
    [organizationId, id]
  );
  if (!del.rows[0]) {
    throw Object.assign(new Error("Status not found"), { status: 404 });
  }
  return { ok: true, status: key };
}
