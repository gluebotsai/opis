export type ShiftWindow = {
  shiftType: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
};

function parseMinutes(time: string): number {
  const [hourPart, minutePart] = time.split(":");
  const hours = Number(hourPart ?? 0);
  const minutes = Number(minutePart ?? 0);
  return hours * 60 + minutes;
}

function localDayAndMinutes(at: Date, timezone: string): { dayOfWeek: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(at);
  const dayOfWeek = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { dayOfWeek, minutes: hour * 60 + minute };
}

function isMinutesInWindow(minutes: number, window: ShiftWindow): boolean {
  const start = parseMinutes(window.startTime);
  const end = parseMinutes(window.endTime);
  if (window.crossesMidnight) {
    return minutes >= start || minutes <= end;
  }
  return minutes >= start && minutes <= end;
}

/** Returns true when shift windows are undefined/empty (no gating). */
export function hasShiftSchedule(windows: ShiftWindow[] | null | undefined): boolean {
  return (windows?.length ?? 0) > 0;
}

/** Pure helper used by tests; mirrors the SQL shift gate in routing. */
export function isAgentShiftActiveAt(
  shiftType: string,
  windows: ShiftWindow[],
  timezone: string,
  at: Date = new Date(),
): boolean {
  if (!hasShiftSchedule(windows)) return true;

  const local = localDayAndMinutes(at, timezone);
  const todaysWindows = windows.filter(
    (window) => window.shiftType === shiftType && window.dayOfWeek === local.dayOfWeek,
  );
  if (todaysWindows.length === 0) return false;
  return todaysWindows.some((window) => isMinutesInWindow(local.minutes, window));
}

/**
 * SQL fragment: queue member is eligible when the queue has no shift schedule,
 * or the member's shift_type matches an active business-hours shift row.
 */
export const QUEUE_MEMBER_ACTIVE_SHIFT_SQL = `
  (
    queue.business_hours_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM accounts.setup_business_hour_shifts schedule_shift
      WHERE schedule_shift.business_hours_id = queue.business_hours_id
    )
    OR EXISTS (
      SELECT 1
      FROM accounts.setup_business_hour_shifts schedule_shift
      INNER JOIN accounts.setup_business_hours schedule_hours
        ON schedule_hours.id = queue.business_hours_id
      WHERE schedule_shift.business_hours_id = queue.business_hours_id
        AND schedule_shift.shift_type = qm.shift_type
        AND trim(to_char(NOW() AT TIME ZONE COALESCE(schedule_hours.timezone, 'UTC'), 'Day'))
          = schedule_shift.day_of_week
        AND CASE
          WHEN schedule_shift.crosses_midnight THEN
            (NOW() AT TIME ZONE COALESCE(schedule_hours.timezone, 'UTC'))::time
              >= schedule_shift.start_time::time
            OR (NOW() AT TIME ZONE COALESCE(schedule_hours.timezone, 'UTC'))::time
              <= schedule_shift.end_time::time
          ELSE
            (NOW() AT TIME ZONE COALESCE(schedule_hours.timezone, 'UTC'))::time
              BETWEEN schedule_shift.start_time::time AND schedule_shift.end_time::time
        END
    )
  )
`;

/** Same gate with another queue_members alias, for a one-row-per-agent pick. */
export function queueMemberActiveShiftSql(memberAlias = "qm"): string {
  if (memberAlias === "qm") return QUEUE_MEMBER_ACTIVE_SHIFT_SQL;
  return QUEUE_MEMBER_ACTIVE_SHIFT_SQL.replaceAll("qm.shift_type", `${memberAlias}.shift_type`);
}
