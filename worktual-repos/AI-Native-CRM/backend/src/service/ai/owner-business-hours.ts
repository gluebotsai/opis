/**
 * Read accounts.setup_business_hours for a rep's business_hours_id.
 * CRM does not own this table — SELECT only.
 */

import { accountQuery } from "@/dao/db/account-pool";
import {
  calendarFromBusinessHours,
  describeCalendar,
  fallbackWorkingCalendar,
  type WorkingCalendar,
} from "@/lib/owner-working-hours";

type HoursRow = {
  id: string;
  timezone: string | null;
  working_days: unknown;
  open_time: string | null;
  close_time: string | null;
  day_timings: unknown;
};

function toCalendar(row: HoursRow | undefined): WorkingCalendar {
  if (!row) return fallbackWorkingCalendar("UTC");
  return calendarFromBusinessHours({
    timezone: row.timezone,
    workingDays: row.working_days,
    openTime: row.open_time,
    closeTime: row.close_time,
    dayTimings: row.day_timings,
  });
}

async function loadHoursRows(ids: string[]): Promise<Map<string, HoursRow>> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, HoursRow>();
  if (unique.length === 0) return out;
  const { rows } = await accountQuery<HoursRow>(
    `SELECT id::text AS id,
            timezone,
            working_days,
            open_time::text AS open_time,
            close_time::text AS close_time,
            day_timings
     FROM accounts.setup_business_hours
     WHERE id = ANY($1::bigint[])`,
    [unique],
  );
  for (const row of rows) out.set(row.id, row);
  return out;
}

async function orgDefaultHours(organizationId: string): Promise<HoursRow | null> {
  const { rows } = await accountQuery<HoursRow>(
    `SELECT id::text AS id,
            timezone,
            working_days,
            open_time::text AS open_time,
            close_time::text AS close_time,
            day_timings
     FROM accounts.setup_business_hours
     WHERE organization_id = $1::bigint
       AND status = 'active'
     ORDER BY id
     LIMIT 1`,
    [organizationId],
  );
  return rows[0] ?? null;
}

export async function loadBusinessHoursSummaries(
  organizationId: string,
  hoursIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  try {
    const rows = await loadHoursRows(
      hoursIds.filter((id): id is string => Boolean(id?.trim())),
    );
    const out = new Map<string, string>();
    for (const [id, row] of rows) {
      out.set(id, describeCalendar(toCalendar(row)));
    }
    return out;
  } catch (err) {
    console.error("loadBusinessHoursSummaries failed", organizationId, err);
    return new Map();
  }
}

export async function loadOwnerWorkingCalendar(
  organizationId: string,
  ownerUserId: string,
): Promise<WorkingCalendar> {
  try {
    const { rows } = await accountQuery<{ business_hours_id: string | null }>(
      `SELECT business_hours_id::text AS business_hours_id
       FROM accounts.setup_users
       WHERE id = $1::bigint
         AND organization_id = $2::bigint
       LIMIT 1`,
      [ownerUserId, organizationId],
    );
    const hoursId = rows[0]?.business_hours_id?.trim() || null;
    if (hoursId) {
      const loaded = await loadHoursRows([hoursId]);
      const row = loaded.get(hoursId);
      if (row) return toCalendar(row);
    }
    const orgHours = await orgDefaultHours(organizationId);
    return orgHours ? toCalendar(orgHours) : fallbackWorkingCalendar("UTC");
  } catch (err) {
    console.error("loadOwnerWorkingCalendar failed", ownerUserId, err);
    return fallbackWorkingCalendar("UTC");
  }
}
