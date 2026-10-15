import type { Response } from "express";
import { query } from "./db";
import { formatRelative } from "./sla";
import {
  CRITICAL_ALERT_SCENARIOS,
  type CriticalAlertPrimaryAction,
  type CriticalAlertScenario,
  type CriticalAlertSeverity,
} from "./criticalAlertHelpers";

export {
  CRITICAL_ALERT_SCENARIOS,
  buildReopenAlertCopy,
  isTicketReopen,
  type CriticalAlertScenario,
  type CriticalAlertSeverity,
  type CriticalAlertPrimaryAction,
} from "./criticalAlertHelpers";

export type CriticalAlertRow = {
  id: string;
  scenario: CriticalAlertScenario;
  title: string;
  message: string;
  ticketNumber?: string;
  customerName?: string;
  severity: CriticalAlertSeverity;
  primaryAction: CriticalAlertPrimaryAction;
  acknowledged: boolean;
  createdAt: string;
  payload?: Record<string, unknown>;
};

type PrefColumn =
  | "notify_ticket_assignments"
  | "notify_ticket_updates"
  | "notify_sla_alerts";

type SseClient = { res: Response };
const sseByUser = new Map<string, Set<SseClient>>();

function sseKey(orgId: string, userId: string): string {
  return `${orgId}:${userId}`;
}

export function addCriticalAlertSseClient(
  orgId: string,
  userId: string,
  res: Response
): () => void {
  const key = sseKey(orgId, userId);
  let set = sseByUser.get(key);
  if (!set) {
    set = new Set();
    sseByUser.set(key, set);
  }
  const client: SseClient = { res };
  set.add(client);
  return () => {
    set!.delete(client);
    if (!set!.size) sseByUser.delete(key);
  };
}

function emitSse(
  orgId: string,
  userId: string,
  event: string,
  payload: unknown
): void {
  const set = sseByUser.get(sseKey(orgId, userId));
  if (!set) return;
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const { res } of set) {
    try {
      res.write(chunk);
    } catch {
      /* closed */
    }
  }
}

function mapRow(row: Record<string, unknown>): CriticalAlertRow {
  const scenario = String(row.scenario || "") as CriticalAlertScenario;
  const config = CRITICAL_ALERT_SCENARIOS[scenario];
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : undefined;
  return {
    id: String(row.id),
    scenario,
    title: String(row.title),
    message: String(row.message),
    ticketNumber: row.ticket_number ? String(row.ticket_number) : undefined,
    customerName: row.customer_name ? String(row.customer_name) : undefined,
    severity: config?.severity || "warning",
    primaryAction: config?.primaryAction || "open_ticket",
    acknowledged: row.acknowledged_at != null,
    createdAt: formatRelative(row.created_at as string),
    payload,
  };
}

async function filterRecipientsByPref(
  orgId: string,
  userIds: string[],
  pref: PrefColumn,
  ignorePreferences?: boolean
): Promise<string[]> {
  const ids = [...new Set(userIds.filter(Boolean))].filter((id) =>
    /^\d+$/.test(id)
  );
  if (!ids.length) return [];
  const prefClause = ignorePreferences
    ? "TRUE"
    : `COALESCE(${pref}, TRUE) = TRUE`;
  const { rows } = await query<{ id: string }>(
    `SELECT id::text AS id FROM agents
     WHERE organization_id = $1::bigint
       AND id = ANY($2::bigint[])
       AND lower(COALESCE(status, 'Active')) = 'active'
       AND ${prefClause}`,
    [orgId, ids]
  );
  return rows.map((r) => String(r.id));
}

export async function shouldDedupeCriticalAlert(opts: {
  orgId: string;
  userId: string;
  scenario: CriticalAlertScenario;
  ticketUuid?: string | null;
  dedupeWindowMs: number;
}): Promise<boolean> {
  const ticketId = String(opts.ticketUuid || "").trim();
  if (!ticketId || !/^\d+$/.test(ticketId)) {
    const { rows } = await query(
      `SELECT 1 FROM critical_alerts
       WHERE organization_id = $1::bigint
         AND user_id = $2::bigint
         AND scenario = $3
         AND ticket_id IS NULL
         AND acknowledged_at IS NULL
       LIMIT 1`,
      [opts.orgId, opts.userId, opts.scenario]
    );
    return rows.length > 0;
  }
  const { rows } = await query(
    `SELECT 1 FROM critical_alerts
     WHERE organization_id = $1::bigint
       AND user_id = $2::bigint
       AND scenario = $3
       AND ticket_id = $4::bigint
       AND (
         acknowledged_at IS NULL
         OR created_at > NOW() - ($5::bigint * INTERVAL '1 millisecond')
       )
     LIMIT 1`,
    [
      opts.orgId,
      opts.userId,
      opts.scenario,
      ticketId,
      opts.dedupeWindowMs,
    ]
  );
  return rows.length > 0;
}

export async function emitCriticalAlert(opts: {
  scenario: CriticalAlertScenario;
  orgId: string;
  userIds: string[];
  title: string;
  message: string;
  ticketUuid?: string | null;
  ticketNumber?: string | null;
  customerName?: string | null;
  excludeUserId?: string | null;
  payload?: Record<string, unknown>;
  /** Direct assignment / escalation must still popup when assignment prefs are off. */
  ignorePreferences?: boolean;
}): Promise<CriticalAlertRow[]> {
  const config = CRITICAL_ALERT_SCENARIOS[opts.scenario];
  const exclude = String(opts.excludeUserId || "").trim();
  const candidates = opts.userIds.filter(
    (id) => id && id !== exclude && /^\d+$/.test(id)
  );
  const recipients = await filterRecipientsByPref(
    opts.orgId,
    candidates,
    config.pref,
    opts.ignorePreferences
  );
  const created: CriticalAlertRow[] = [];

  for (const userId of recipients) {
    const dup = await shouldDedupeCriticalAlert({
      orgId: opts.orgId,
      userId,
      scenario: opts.scenario,
      ticketUuid: opts.ticketUuid,
      dedupeWindowMs: config.dedupeWindowMs,
    });
    if (dup) continue;

    const { rows } = await query(
      `INSERT INTO critical_alerts (
         organization_id, user_id, scenario, title, message,
         ticket_id, ticket_number, customer_name, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [
        opts.orgId,
        userId,
        opts.scenario,
        opts.title,
        opts.message,
        opts.ticketUuid && /^\d+$/.test(String(opts.ticketUuid))
          ? opts.ticketUuid
          : null,
        opts.ticketNumber ? String(opts.ticketNumber) : null,
        opts.customerName ? String(opts.customerName) : null,
        opts.payload ? JSON.stringify(opts.payload) : null,
      ]
    );
    const row = mapRow(rows[0] as Record<string, unknown>);
    created.push(row);
    emitSse(opts.orgId, userId, "alert", { type: "alert", alert: row });
  }

  return created;
}

export async function listPendingCriticalAlerts(opts: {
  orgId: string;
  userId: string;
  limit?: number;
}): Promise<CriticalAlertRow[]> {
  const limit = opts.limit ?? 50;
  const { rows } = await query(
    `SELECT * FROM critical_alerts
     WHERE organization_id = $1::bigint
       AND user_id = $2::bigint
       AND acknowledged_at IS NULL
     ORDER BY created_at ASC
     LIMIT $3`,
    [opts.orgId, opts.userId, limit]
  );
  return rows.map((r) => mapRow(r as Record<string, unknown>));
}

export async function acknowledgeCriticalAlert(opts: {
  orgId: string;
  userId: string;
  alertId: string;
}): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE critical_alerts
     SET acknowledged_at = NOW()
     WHERE id = $1::bigint
       AND organization_id = $2::bigint
       AND user_id = $3::bigint
       AND acknowledged_at IS NULL`,
    [opts.alertId, opts.orgId, opts.userId]
  );
  const ok = Number(rowCount || 0) > 0;
  if (ok) {
    emitSse(opts.orgId, opts.userId, "ack", {
      type: "ack",
      id: opts.alertId,
    });
  }
  return ok;
}

/** Test hook: reset in-memory SSE registry between tests. */
export function resetCriticalAlertSseClientsForTests(): void {
  sseByUser.clear();
}
