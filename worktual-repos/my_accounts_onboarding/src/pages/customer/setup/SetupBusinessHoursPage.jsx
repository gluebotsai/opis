import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import {
  SetupPageHeader,
  SetupStatCard,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { SetupTimeInput } from "../../../components/customer/setup/SetupTimeInput.jsx";
import {
  SHIFT_TYPE_DEFAULT_TIMES,
  SETUP_HOLIDAY_COUNTRIES,
  SETUP_SHIFT_TYPES,
  holidaysForCountry,
} from "../../../lib/setup/countryHolidays.js";
import {
  createBusinessHours,
  createHolidayCalendar,
  deleteBusinessHours,
  listBusinessHours,
  listHolidayCalendars,
  listSetupUsers,
  listTeams,
  SETUP_DAYS,
  SETUP_TIMEZONES,
  updateBusinessHours,
} from "../../../lib/setup/setupApi.js";

const MAX_BREAKS = 2;

const EMPTY_BREAK = { startTime: "", endTime: "" };

function emptyDayTiming(startTime = "09:00", endTime = "18:00", breaks = []) {
  return {
    startTime,
    endTime,
    breaks: normalizeBreaks(breaks),
  };
}

function normalizeBreaks(breaks = []) {
  return (Array.isArray(breaks) ? breaks : [])
    .slice(0, MAX_BREAKS)
    .map((entry) => ({
      startTime: String(entry?.startTime || "").slice(0, 5),
      endTime: String(entry?.endTime || "").slice(0, 5),
    }));
}

function breaksFromColumns(row = {}) {
  const list = [];
  const firstStart = String(row.breakStartTime || row.break_start_time || "").slice(0, 5);
  const firstEnd = String(row.breakEndTime || row.break_end_time || "").slice(0, 5);
  const secondStart = String(row.breakStartTime2 || row.break_start_time_2 || "").slice(0, 5);
  const secondEnd = String(row.breakEndTime2 || row.break_end_time_2 || "").slice(0, 5);
  if (firstStart || firstEnd) list.push({ startTime: firstStart, endTime: firstEnd });
  if (secondStart || secondEnd) list.push({ startTime: secondStart, endTime: secondEnd });
  return normalizeBreaks(list);
}

function breaksToColumns(breaks = []) {
  const normalized = normalizeBreaks(breaks).filter(
    (entry) => entry.startTime || entry.endTime,
  );
  return {
    breakStartTime: normalized[0]?.startTime || null,
    breakEndTime: normalized[0]?.endTime || null,
    breakStartTime2: normalized[1]?.startTime || null,
    breakEndTime2: normalized[1]?.endTime || null,
  };
}

const EMPTY_SHIFT = {
  shiftType: "Regular",
  timingMode: "same",
  daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  startTime: "09:00",
  endTime: "18:00",
  breaks: [],
  dayTimings: {
    Monday: emptyDayTiming(),
    Tuesday: emptyDayTiming(),
    Wednesday: emptyDayTiming(),
    Thursday: emptyDayTiming(),
    Friday: emptyDayTiming(),
  },
};

const EMPTY_FORM = {
  name: "",
  description: "",
  timezone: "Asia/Kolkata",
  openTime: "09:00",
  closeTime: "22:00",
  daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  holidayCalendarId: "",
  status: "active",
  shifts: [{ ...EMPTY_SHIFT, daysOfWeek: [...EMPTY_SHIFT.daysOfWeek], dayTimings: { ...EMPTY_SHIFT.dayTimings } }],
};

function orderedWeekDays(days = []) {
  const set = new Set(days);
  return SETUP_DAYS.filter((day) => set.has(day));
}

function pruneShiftToAllowedDays(shift, allowedDays) {
  const next = cloneShift(shift);
  const allowed = new Set(allowedDays);
  next.daysOfWeek = orderedWeekDays(next.daysOfWeek.filter((day) => allowed.has(day)));
  next.dayTimings = Object.fromEntries(
    Object.entries(next.dayTimings || {}).filter(([day]) => next.daysOfWeek.includes(day)),
  );
  return next;
}

const TIMEZONE_LABELS = {
  "Asia/Kolkata": "IST (UTC+05:30)",
  UTC: "UTC (UTC+00:00)",
  "Europe/London": "GMT (UTC+00:00)",
  "America/New_York": "EST (UTC−05:00)",
  "Asia/Dubai": "GST (UTC+04:00)",
  "Asia/Singapore": "SGT (UTC+08:00)",
};

function autoCrossesMidnight(startTime, endTime) {
  const [sh, sm] = String(startTime || "00:00").split(":").map(Number);
  const [eh, em] = String(endTime || "00:00").split(":").map(Number);
  return eh * 60 + em < sh * 60 + sm;
}

function timeToMinutes(value) {
  const [hourRaw, minuteRaw] = String(value || "00:00").slice(0, 5).split(":");
  return Number(hourRaw) * 60 + Number(minuteRaw || 0);
}

/** Expand a time range so end is after start (supports midnight crossing). */
function expandTimeRange(startTime, endTime) {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return { start, end };
}

function rangeWithinWindow(innerStart, innerEnd, windowStart, windowEnd) {
  if (!innerStart || !innerEnd || !windowStart || !windowEnd) return false;
  if (String(innerStart).slice(0, 5) === String(innerEnd).slice(0, 5)) return false;
  const window = expandTimeRange(windowStart, windowEnd);
  let inner = expandTimeRange(innerStart, innerEnd);
  if (inner.start < window.start && inner.end <= window.start) {
    inner = { start: inner.start + 24 * 60, end: inner.end + 24 * 60 };
  }
  return inner.start >= window.start && inner.end <= window.end;
}

function shiftOutsideBusinessHours(shift, openTime, closeTime) {
  if (shift.timingMode === "different") {
    return (shift.daysOfWeek || []).some((day) => {
      const timing = shift.dayTimings?.[day];
      if (!timing?.startTime || !timing?.endTime) return false;
      if (!rangeWithinWindow(timing.startTime, timing.endTime, openTime, closeTime)) {
        return true;
      }
      return (timing.breaks || []).some(
        (entry) =>
          entry.startTime &&
          entry.endTime &&
          !rangeWithinWindow(entry.startTime, entry.endTime, openTime, closeTime),
      );
    });
  }
  if (!rangeWithinWindow(shift.startTime, shift.endTime, openTime, closeTime)) {
    return true;
  }
  return (shift.breaks || []).some(
    (entry) =>
      entry.startTime &&
      entry.endTime &&
      !rangeWithinWindow(entry.startTime, entry.endTime, openTime, closeTime),
  );
}

function blankForm() {
  const daysOfWeek = [...EMPTY_FORM.daysOfWeek];
  return {
    ...EMPTY_FORM,
    daysOfWeek,
    shifts: [
      {
        ...EMPTY_SHIFT,
        daysOfWeek: [...daysOfWeek],
        dayTimings: buildDayTimings(daysOfWeek, EMPTY_SHIFT.startTime, EMPTY_SHIFT.endTime),
      },
    ],
  };
}

function buildDayTimings(days, startTime, endTime, existing = {}, breaks = []) {
  const timings = {};
  for (const day of days) {
    timings[day] = {
      startTime: existing[day]?.startTime || startTime || "09:00",
      endTime: existing[day]?.endTime || endTime || "18:00",
      breaks: normalizeBreaks(existing[day]?.breaks ?? breaks),
    };
  }
  return timings;
}

function cloneShift(shift) {
  return {
    ...shift,
    breaks: normalizeBreaks(shift.breaks),
    daysOfWeek: [...(shift.daysOfWeek || [])],
    dayTimings: Object.fromEntries(
      Object.entries(shift.dayTimings || {}).map(([day, timing]) => [
        day,
        {
          startTime: timing.startTime,
          endTime: timing.endTime,
          breaks: normalizeBreaks(timing.breaks),
        },
      ]),
    ),
  };
}

function breaksAreIncomplete(breaks = []) {
  return normalizeBreaks(breaks).some(
    (entry) => Boolean(entry.startTime) !== Boolean(entry.endTime),
  );
}

function formatTimezoneLabel(timezone) {
  return TIMEZONE_LABELS[timezone] || timezone || "—";
}

function collectShiftDays(shifts) {
  const daySet = new Set();
  for (const shift of shifts || []) {
    if (Array.isArray(shift.daysOfWeek) && shift.daysOfWeek.length) {
      shift.daysOfWeek.forEach((day) => daySet.add(day));
    } else if (shift.dayOfWeek) {
      daySet.add(shift.dayOfWeek);
    }
  }
  return SETUP_DAYS.filter((day) => daySet.has(day));
}

function formatDaysList(days) {
  const ordered = orderedWeekDays(days);
  if (!ordered.length) return "—";
  if (ordered.length === 7) return "Mon - Sun";
  if (ordered.length === 1) return ordered[0].slice(0, 3);
  const first = ordered[0].slice(0, 3);
  const last = ordered[ordered.length - 1].slice(0, 3);
  const contiguous =
    ordered.length > 1 &&
    SETUP_DAYS.indexOf(ordered[ordered.length - 1]) - SETUP_DAYS.indexOf(ordered[0]) ===
      ordered.length - 1;
  if (contiguous) return `${first} - ${last}`;
  return ordered.map((day) => day.slice(0, 3)).join(", ");
}

function formatWorkingDays(shifts) {
  return formatDaysList(collectShiftDays(shifts));
}

function formatClockTime(value) {
  const [hourRaw, minuteRaw] = String(value || "00:00").split(":");
  let hour = Number(hourRaw);
  const minute = minuteRaw || "00";
  if (!Number.isFinite(hour)) return value || "—";
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${String(hour).padStart(2, "0")}:${minute} ${suffix}`;
}

function isTwentyFourHourShift(shift) {
  const start = String(shift.startTime || "").slice(0, 5);
  const end = String(shift.endTime || "").slice(0, 5);
  return (
    (start === "00:00" && (end === "23:59" || end === "24:00")) ||
    (start === "00:00" && end === "00:00" && shift.crossesMidnight)
  );
}

function formatShiftHoursSummary(shifts) {
  if (!shifts?.length) return "—";
  const windows = new Map();
  for (const shift of shifts) {
    const key = `${String(shift.startTime).slice(0, 5)}|${String(shift.endTime).slice(0, 5)}|${Boolean(shift.crossesMidnight)}`;
    windows.set(key, shift);
  }
  if (windows.size === 1) {
    const only = [...windows.values()][0];
    if (isTwentyFourHourShift(only)) return "24 Hours";
    return `${formatClockTime(only.startTime)} - ${formatClockTime(only.endTime)}`;
  }
  return `${windows.size} shifts`;
}

function buildAssignmentUsage(teams = [], users = []) {
  const usage = new Map();

  for (const team of teams) {
    const businessHoursId = team.businessHoursId;
    if (!businessHoursId) continue;
    if (!usage.has(businessHoursId)) {
      usage.set(businessHoursId, {
        teamIds: new Set(),
        productIds: new Set(),
        branchIds: new Set(),
      });
    }
    const entry = usage.get(businessHoursId);
    entry.teamIds.add(team.id);
    for (const productId of team.availableProducts || []) {
      if (productId) entry.productIds.add(productId);
    }
  }

  for (const user of users) {
    const locationId = user.locationId;
    if (!locationId) continue;
    const userTeamIds = new Set(
      (user.productAccess || []).map((grant) => grant.teamId).filter(Boolean),
    );
    if (!userTeamIds.size) continue;
    for (const entry of usage.values()) {
      for (const teamId of entry.teamIds) {
        if (userTeamIds.has(teamId)) {
          entry.branchIds.add(locationId);
          break;
        }
      }
    }
  }

  return usage;
}

function getUsageCounts(usageMap, businessHoursId) {
  const entry = usageMap.get(businessHoursId);
  return {
    branches: entry?.branchIds.size || 0,
    teams: entry?.teamIds.size || 0,
    products: entry?.productIds.size || 0,
  };
}

/** Collapse per-day DB rows back into form rows for editing. */
function groupShiftsForForm(shifts) {
  const byType = new Map();

  for (const shift of shifts || []) {
    const shiftType = shift.shiftType || "Regular";
    const day = shift.dayOfWeek || shift.daysOfWeek?.[0];
    if (!day) continue;
    if (!byType.has(shiftType)) {
      byType.set(shiftType, []);
    }
    byType.get(shiftType).push({
      day,
      startTime: String(shift.startTime || "09:00").slice(0, 5),
      endTime: String(shift.endTime || "18:00").slice(0, 5),
      breaks: breaksFromColumns(shift),
    });
  }

  const orderedTypes = SETUP_SHIFT_TYPES.filter((type) => byType.has(type));
  for (const type of byType.keys()) {
    if (!orderedTypes.includes(type)) orderedTypes.push(type);
  }

  const grouped = orderedTypes.map((shiftType) => {
    const rows = byType.get(shiftType) || [];
    const daysOfWeek = SETUP_DAYS.filter((day) => rows.some((row) => row.day === day));
    const windows = new Set(
      rows.map(
        (row) =>
          `${row.startTime}|${row.endTime}|${JSON.stringify(normalizeBreaks(row.breaks))}`,
      ),
    );
    const first = rows[0] || {
      startTime: "09:00",
      endTime: "18:00",
      breaks: [],
    };
    const dayTimings = buildDayTimings(
      daysOfWeek,
      first.startTime,
      first.endTime,
      Object.fromEntries(rows.map((row) => [row.day, row])),
      first.breaks,
    );

    return {
      shiftType,
      timingMode: windows.size > 1 ? "different" : "same",
      daysOfWeek,
      startTime: first.startTime,
      endTime: first.endTime,
      breaks: normalizeBreaks(first.breaks),
      dayTimings,
    };
  });

  return grouped.length
    ? grouped
    : [
        {
          ...EMPTY_SHIFT,
          daysOfWeek: [...EMPTY_SHIFT.daysOfWeek],
          dayTimings: { ...EMPTY_SHIFT.dayTimings },
        },
      ];
}

function ensureUniqueShiftTypes(shifts) {
  const used = new Set();
  return shifts.map((shift) => {
    const cloned = cloneShift(shift);
    if (!used.has(cloned.shiftType)) {
      used.add(cloned.shiftType);
      return cloned;
    }
    const nextType = SETUP_SHIFT_TYPES.find((type) => !used.has(type));
    if (!nextType) return cloned;
    used.add(nextType);
    return { ...cloned, shiftType: nextType };
  });
}

export function SetupBusinessHoursPage() {
  const [businessHours, setBusinessHours] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [creatingCalendar, setCreatingCalendar] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [newCalendarName, setNewCalendarName] = useState("");
  const [holidayCountry, setHolidayCountry] = useState("India");
  const [selectedHolidayNames, setSelectedHolidayNames] = useState(() =>
    holidaysForCountry("India").slice(0, 3).map((h) => h.name),
  );
  const [customHoliday, setCustomHoliday] = useState({ name: "", holidayDate: "" });
  const [customHolidays, setCustomHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingCal, setCreatingCal] = useState(false);
  const [error, setError] = useState("");
  const [descriptionTip, setDescriptionTip] = useState(null);

  function showDescriptionTip(event, text) {
    const rect = event.currentTarget.getBoundingClientRect();
    const maxWidth = 280;
    const padding = 12;
    const preferredLeft = rect.left;
    const left = Math.min(
      Math.max(padding, preferredLeft),
      Math.max(padding, window.innerWidth - maxWidth - padding),
    );
    const top = rect.bottom + 8;
    setDescriptionTip({ text, left, top, maxWidth });
  }

  function hideDescriptionTip() {
    setDescriptionTip(null);
  }

  useEffect(() => {
    if (!descriptionTip) return undefined;
    const hide = () => setDescriptionTip(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [descriptionTip]);

  const countryHolidayOptions = useMemo(() => holidaysForCountry(holidayCountry), [holidayCountry]);
  const selectedCalendar = calendars.find((cal) => cal.id === form.holidayCalendarId);
  const assignmentUsage = useMemo(() => buildAssignmentUsage(teams, users), [teams, users]);

  const filteredBusinessHours = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return businessHours.filter((entry) => {
      if (!query) return true;
      const haystack = [
        entry.name,
        entry.description,
        entry.timezone,
        formatTimezoneLabel(entry.timezone),
        formatWorkingDays(entry.shifts),
        formatShiftHoursSummary(entry.shifts),
        formatClockTime(entry.openTime || "09:00"),
        formatClockTime(entry.closeTime || "22:00"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [businessHours, searchQuery]);

  const usageTotals = useMemo(() => {
    let branches = 0;
    let assignedTeams = 0;
    let products = 0;
    for (const entry of businessHours) {
      const counts = getUsageCounts(assignmentUsage, entry.id);
      branches += counts.branches;
      assignedTeams += counts.teams;
      products += counts.products;
    }
    return { branches, teams: assignedTeams, products };
  }, [assignmentUsage, businessHours]);

  async function refresh() {
    const [hours, cals, teamRows, userRows] = await Promise.all([
      listBusinessHours(),
      listHolidayCalendars(),
      listTeams(),
      listSetupUsers(),
    ]);
    setBusinessHours(hours);
    setCalendars(cals);
    setTeams(teamRows);
    setUsers(userRows);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (!cancelled) setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load business hours.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetFormState() {
    setForm(blankForm());
    setEditingId(null);
    setCreatingCalendar(false);
    setNewCalendarName("");
    setCustomHolidays([]);
    setError("");
  }

  function closeForm() {
    resetFormState();
    setShowForm(false);
  }

  function openCreateForm() {
    resetFormState();
    setShowForm(true);
  }

  function handleEdit(entry) {
    setEditingId(entry.id);
    setCreatingCalendar(false);
    setError("");
    const shifts = ensureUniqueShiftTypes(groupShiftsForForm(entry.shifts));
    const daysOfWeek = orderedWeekDays(
      Array.isArray(entry.workingDays) && entry.workingDays.length
        ? entry.workingDays
        : collectShiftDays(entry.shifts),
    );
    const allowed = daysOfWeek.length ? daysOfWeek : [...EMPTY_FORM.daysOfWeek];
    setForm({
      name: entry.name || "",
      description: entry.description || "",
      timezone: entry.timezone || "Asia/Kolkata",
      openTime: String(entry.openTime || "09:00").slice(0, 5),
      closeTime: String(entry.closeTime || "22:00").slice(0, 5),
      daysOfWeek: allowed,
      holidayCalendarId: entry.holidayCalendarId || "",
      status: entry.status || "active",
      shifts: shifts.map((shift) => pruneShiftToAllowedDays(shift, allowed)),
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleBusinessDay(day) {
    setForm((current) => {
      const has = current.daysOfWeek.includes(day);
      const daysOfWeek = orderedWeekDays(
        has ? current.daysOfWeek.filter((item) => item !== day) : [...current.daysOfWeek, day],
      );
      return {
        ...current,
        daysOfWeek,
        shifts: current.shifts.map((shift) => pruneShiftToAllowedDays(shift, daysOfWeek)),
      };
    });
  }

  function updateShift(index, key, value) {
    setForm((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        next[key] = value;

        if (key === "shiftType" && SHIFT_TYPE_DEFAULT_TIMES[value]) {
          const defaults = SHIFT_TYPE_DEFAULT_TIMES[value];
          next.startTime = defaults.startTime;
          next.endTime = defaults.endTime;
          next.dayTimings = buildDayTimings(
            next.daysOfWeek,
            defaults.startTime,
            defaults.endTime,
            next.dayTimings,
            next.breaks,
          );
        }

        if (
          (key === "startTime" || key === "endTime" || key === "breaks") &&
          (next.timingMode || "same") === "same"
        ) {
          next.dayTimings = buildDayTimings(
            next.daysOfWeek,
            next.startTime,
            next.endTime,
            {},
            next.breaks,
          );
        }

        if (key === "timingMode") {
          if (value === "same") {
            const firstDay = next.daysOfWeek[0];
            const timing = next.dayTimings[firstDay] || {
              startTime: next.startTime,
              endTime: next.endTime,
              breaks: next.breaks,
            };
            next.startTime = timing.startTime;
            next.endTime = timing.endTime;
            next.breaks = normalizeBreaks(timing.breaks);
            next.dayTimings = buildDayTimings(
              next.daysOfWeek,
              timing.startTime,
              timing.endTime,
              {},
              next.breaks,
            );
          } else {
            next.dayTimings = buildDayTimings(
              next.daysOfWeek,
              next.startTime,
              next.endTime,
              next.dayTimings,
              next.breaks,
            );
          }
        }

        return next;
      });
      return { ...current, shifts };
    });
  }

  function toggleShiftDay(index, day) {
    setForm((current) => {
      if (!current.daysOfWeek.includes(day)) return current;
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        const has = next.daysOfWeek.includes(day);
        const daysOfWeek = has
          ? next.daysOfWeek.filter((item) => item !== day)
          : [...next.daysOfWeek, day];
        next.daysOfWeek = orderedWeekDays(daysOfWeek);
        if (!has) {
          next.dayTimings[day] = emptyDayTiming(
            next.startTime || "09:00",
            next.endTime || "18:00",
            next.breaks,
          );
        } else {
          delete next.dayTimings[day];
        }
        return next;
      });
      return { ...current, shifts };
    });
  }

  function updateDayTiming(index, day, key, value) {
    setForm((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        next.dayTimings[day] = {
          startTime: next.dayTimings[day]?.startTime || next.startTime || "09:00",
          endTime: next.dayTimings[day]?.endTime || next.endTime || "18:00",
          breaks: normalizeBreaks(next.dayTimings[day]?.breaks),
          [key]: value,
        };
        return next;
      });
      return { ...current, shifts };
    });
  }

  function addShiftBreak(index) {
    setForm((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        if (next.breaks.length >= MAX_BREAKS) return next;
        next.breaks = [...next.breaks, { ...EMPTY_BREAK }];
        if ((next.timingMode || "same") === "same") {
          next.dayTimings = buildDayTimings(
            next.daysOfWeek,
            next.startTime,
            next.endTime,
            {},
            next.breaks,
          );
        }
        return next;
      });
      return { ...current, shifts };
    });
  }

  function updateShiftBreak(index, breakIndex, key, value) {
    setForm((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        next.breaks = next.breaks.map((entry, bi) =>
          bi === breakIndex ? { ...entry, [key]: value } : entry,
        );
        if ((next.timingMode || "same") === "same") {
          next.dayTimings = buildDayTimings(
            next.daysOfWeek,
            next.startTime,
            next.endTime,
            {},
            next.breaks,
          );
        }
        return next;
      });
      return { ...current, shifts };
    });
  }

  function removeShiftBreak(index, breakIndex) {
    setForm((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        next.breaks = next.breaks.filter((_, bi) => bi !== breakIndex);
        if ((next.timingMode || "same") === "same") {
          next.dayTimings = buildDayTimings(
            next.daysOfWeek,
            next.startTime,
            next.endTime,
            {},
            next.breaks,
          );
        }
        return next;
      });
      return { ...current, shifts };
    });
  }

  function addDayBreak(index, day) {
    setForm((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        const timing = next.dayTimings[day] || emptyDayTiming(next.startTime, next.endTime);
        if (timing.breaks.length >= MAX_BREAKS) return next;
        next.dayTimings[day] = {
          ...timing,
          breaks: [...timing.breaks, { ...EMPTY_BREAK }],
        };
        return next;
      });
      return { ...current, shifts };
    });
  }

  function updateDayBreak(index, day, breakIndex, key, value) {
    setForm((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        const timing = next.dayTimings[day] || emptyDayTiming(next.startTime, next.endTime);
        next.dayTimings[day] = {
          ...timing,
          breaks: timing.breaks.map((entry, bi) =>
            bi === breakIndex ? { ...entry, [key]: value } : entry,
          ),
        };
        return next;
      });
      return { ...current, shifts };
    });
  }

  function removeDayBreak(index, day, breakIndex) {
    setForm((current) => {
      const shifts = current.shifts.map((shift, i) => {
        if (i !== index) return shift;
        const next = cloneShift(shift);
        const timing = next.dayTimings[day] || emptyDayTiming(next.startTime, next.endTime);
        next.dayTimings[day] = {
          ...timing,
          breaks: timing.breaks.filter((_, bi) => bi !== breakIndex),
        };
        return next;
      });
      return { ...current, shifts };
    });
  }

  function unusedShiftTypes(exceptIndex = -1) {
    const used = new Set(
      form.shifts
        .map((shift, index) => (index === exceptIndex ? null : shift.shiftType))
        .filter(Boolean),
    );
    return SETUP_SHIFT_TYPES.filter((type) => !used.has(type));
  }

  function availableTypesForShift(index) {
    const current = form.shifts[index]?.shiftType;
    const unused = unusedShiftTypes(index);
    if (current && !unused.includes(current)) {
      return [current, ...unused];
    }
    return unused;
  }

  function addShiftRow() {
    const nextType = unusedShiftTypes()[0];
    if (!nextType) {
      setError("All shift types are already used (Regular, Morning, Evening, Night).");
      return;
    }
    const defaults = SHIFT_TYPE_DEFAULT_TIMES[nextType] || {
      startTime: "09:00",
      endTime: "18:00",
    };
    setForm((current) => {
      const daysOfWeek = orderedWeekDays(current.daysOfWeek);
      return {
        ...current,
        shifts: [
          ...current.shifts,
          {
            shiftType: nextType,
            timingMode: "same",
            daysOfWeek,
            startTime: defaults.startTime,
            endTime: defaults.endTime,
            breaks: [],
            dayTimings: buildDayTimings(daysOfWeek, defaults.startTime, defaults.endTime),
          },
        ],
      };
    });
  }

  function removeShiftRow(index) {
    setForm((current) => ({
      ...current,
      shifts: current.shifts.filter((_, i) => i !== index),
    }));
  }

  function handleCountryChange(country) {
    setHolidayCountry(country);
    const holidays = holidaysForCountry(country);
    setSelectedHolidayNames(holidays.slice(0, 3).map((h) => h.name));
    setCustomHolidays([]);
  }

  function toggleHoliday(name) {
    setSelectedHolidayNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  function addCustomHoliday() {
    if (!customHoliday.name.trim() || !customHoliday.holidayDate) return;
    setCustomHolidays((current) => [
      ...current,
      { name: customHoliday.name.trim(), holidayDate: customHoliday.holidayDate },
    ]);
    setCustomHoliday({ name: "", holidayDate: "" });
  }

  async function handleCreateCalendar() {
    if (!newCalendarName.trim()) {
      setError("Holiday calendar name is required.");
      return;
    }
    try {
      setCreatingCal(true);
      setError("");
      const fromCountry = countryHolidayOptions
        .filter((holiday) => selectedHolidayNames.includes(holiday.name))
        .map((holiday) => ({ name: holiday.name, holidayDate: holiday.holidayDate }));
      const calendar = await createHolidayCalendar({
        name: newCalendarName.trim(),
        country: holidayCountry,
        holidays: [...fromCountry, ...customHolidays],
      });
      setCalendars((current) => [...current, calendar]);
      setForm((current) => ({ ...current, holidayCalendarId: calendar.id }));
      setNewCalendarName("");
      setCustomHolidays([]);
      setCreatingCalendar(false);
    } catch (err) {
      setError(err.message || "Failed to create holiday calendar.");
    } finally {
      setCreatingCal(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    if (!form.daysOfWeek.length) {
      setError("Select at least one business day of the week.");
      return;
    }
    if (form.shifts.some((shift) => !shift.daysOfWeek.length)) {
      setError("Each shift must include at least one day of the week.");
      return;
    }
    if (
      form.shifts.some((shift) =>
        shift.daysOfWeek.some((day) => !form.daysOfWeek.includes(day)),
      )
    ) {
      setError("Shift days must be within the selected business hours days.");
      return;
    }
    if (
      form.shifts.some(
        (shift) =>
          shift.timingMode === "different" &&
          shift.daysOfWeek.some(
            (day) => !shift.dayTimings?.[day]?.startTime || !shift.dayTimings?.[day]?.endTime,
          ),
      )
    ) {
      setError("Set start and end times for every selected day.");
      return;
    }

    if (
      form.shifts.some((shift) => {
        if (shift.timingMode === "different") {
          return shift.daysOfWeek.some((day) =>
            breaksAreIncomplete(shift.dayTimings?.[day]?.breaks),
          );
        }
        return breaksAreIncomplete(shift.breaks);
      })
    ) {
      setError("Provide both start and end for each break, or remove incomplete breaks.");
      return;
    }

    if (!form.openTime || !form.closeTime) {
      setError("Set business hours start and end times.");
      return;
    }
    if (String(form.openTime).slice(0, 5) === String(form.closeTime).slice(0, 5)) {
      setError("Business hours start and end times cannot be the same.");
      return;
    }
    if (form.shifts.some((shift) => shiftOutsideBusinessHours(shift, form.openTime, form.closeTime))) {
      setError(
        `Each shift (and its breaks) must stay within business hours (${formatClockTime(form.openTime)} – ${formatClockTime(form.closeTime)}) and cannot collapse to zero duration.`,
      );
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      timezone: form.timezone,
      openTime: form.openTime,
      closeTime: form.closeTime,
      workingDays: orderedWeekDays(form.daysOfWeek),
      holidayCalendarId: form.holidayCalendarId || null,
      status: form.status,
      shifts: form.shifts.map((shift) => {
        if (shift.timingMode === "different") {
          return {
            shiftType: shift.shiftType,
            daySchedules: shift.daysOfWeek.map((day) => {
              const startTime = shift.dayTimings[day].startTime;
              const endTime = shift.dayTimings[day].endTime;
              return {
                dayOfWeek: day,
                startTime,
                endTime,
                ...breaksToColumns(shift.dayTimings[day].breaks),
                crossesMidnight: autoCrossesMidnight(startTime, endTime),
              };
            }),
          };
        }

        return {
          shiftType: shift.shiftType,
          daysOfWeek: shift.daysOfWeek,
          startTime: shift.startTime,
          endTime: shift.endTime,
          ...breaksToColumns(shift.breaks),
          crossesMidnight: autoCrossesMidnight(shift.startTime, shift.endTime),
        };
      }),
    };
    try {
      setSaving(true);
      setError("");
      if (editingId) {
        await updateBusinessHours(editingId, payload);
      } else {
        await createBusinessHours(payload);
      }
      await refresh();
      closeForm();
    } catch (err) {
      setError(err.message || "Failed to save business hours.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry) {
    if (!window.confirm(`Delete schedule “${entry.name}”?`)) return;
    try {
      setError("");
      await deleteBusinessHours(entry.id);
      if (editingId === entry.id) {
        closeForm();
      }
      await refresh();
    } catch (err) {
      setError(err.message || "Failed to delete business hours.");
    }
  }

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          <button
            className="primary-button"
            onClick={() => (showForm ? closeForm() : openCreateForm())}
            type="button"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? "Close form" : "Create business hours"}
          </button>
        }
        copy="Create, manage and assign reusable weekly business hours templates across teams and products."
        title="Business Hours"
      />

      {error ? <div className="form-error-banner">{error}</div> : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          {showForm ? (
            <form className="setup-form-panel" onSubmit={handleSubmit}>
              <h2>{editingId ? "Edit business hours" : "Add business hours"}</h2>

              <div className="setup-form-grid">
                <label className="field field--full">
                  <span>Business hour name</span>
                  <input
                    onChange={(event) => updateField("name", event.target.value)}
                    required
                    value={form.name}
                  />
                </label>
                <label className="field field--full">
                  <span>Description</span>
                  <textarea
                    onChange={(event) => updateField("description", event.target.value)}
                    rows="2"
                    value={form.description}
                  />
                </label>
                <label className="field">
                  <span>Timezone</span>
                  <select
                    onChange={(event) => updateField("timezone", event.target.value)}
                    value={form.timezone}
                  >
                    {SETUP_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Business start time</span>
                  <SetupTimeInput
                    onChange={(value) => updateField("openTime", value)}
                    value={form.openTime}
                  />
                </label>
                <label className="field">
                  <span>Business end time</span>
                  <SetupTimeInput
                    onChange={(value) => updateField("closeTime", value)}
                    value={form.closeTime}
                  />
                </label>
                <div className="field field--full">
                  <span>Day of week</span>
                  <div className="setup-chip-row" style={{ marginTop: "8px" }}>
                    {SETUP_DAYS.map((day) => {
                      const active = form.daysOfWeek.includes(day);
                      return (
                        <button
                          className={`setup-chip ${active ? "is-active" : ""}`}
                          key={day}
                          onClick={() => toggleBusinessDay(day)}
                          style={
                            active
                              ? {
                                  background: "var(--color-neutral-900, #111)",
                                  color: "#fff",
                                }
                              : undefined
                          }
                          type="button"
                        >
                          {day.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <h3 style={{ fontSize: "14px", margin: "24px 0 8px" }}>Shifts</h3>
              <p style={{ color: "var(--text-caption)", fontSize: "12px", margin: "0 0 12px" }}>
                Add shifts inside the business hours window (
                {formatClockTime(form.openTime)} – {formatClockTime(form.closeTime)}). Shift days
                can only be chosen from the business days above. Gaps between shifts are allowed, but
                shifts cannot overlap or collapse. Use timing mode for same or different per-day
                times.
              </p>

              {form.shifts.map((shift, index) => (
                <div
                  className="onboarding-card lead-dashboard-panel"
                  key={`shift-${index}`}
                  style={{ marginBottom: "12px" }}
                >
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                    }}
                  >
                    <strong>Shift {index + 1}</strong>
                    <button
                      className="secondary-button"
                      disabled={form.shifts.length <= 1}
                      onClick={() => removeShiftRow(index)}
                      type="button"
                    >
                      <Trash2 size={14} />
                      Remove
                    </button>
                  </div>

                  <div className="setup-form-grid">
                    <label className="field">
                      <span>Shift type</span>
                      <select
                        onChange={(event) => updateShift(index, "shiftType", event.target.value)}
                        value={shift.shiftType}
                      >
                        {availableTypesForShift(index).map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Timing mode</span>
                      <select
                        onChange={(event) => updateShift(index, "timingMode", event.target.value)}
                        value={shift.timingMode || "same"}
                      >
                        <option value="same">Same for all days</option>
                        <option value="different">Different timings per day</option>
                      </select>
                    </label>

                    {(shift.timingMode || "same") === "same" ? (
                      <>
                        <label className="field">
                          <span>Start time</span>
                          <SetupTimeInput
                            onChange={(value) => updateShift(index, "startTime", value)}
                            value={shift.startTime}
                          />
                        </label>
                        <label className="field">
                          <span>End time</span>
                          <SetupTimeInput
                            onChange={(value) => updateShift(index, "endTime", value)}
                            value={shift.endTime}
                          />
                        </label>
                        <div className="field field--full setup-break-block">
                          {(shift.breaks || []).map((entry, breakIndex) => (
                            <div className="setup-break-row" key={`break-${index}-${breakIndex}`}>
                              <label className="field">
                                <span>Break {breakIndex + 1} start</span>
                                <SetupTimeInput
                                  onChange={(value) =>
                                    updateShiftBreak(index, breakIndex, "startTime", value)
                                  }
                                  value={entry.startTime}
                                />
                              </label>
                              <label className="field">
                                <span>Break {breakIndex + 1} end</span>
                                <SetupTimeInput
                                  onChange={(value) =>
                                    updateShiftBreak(index, breakIndex, "endTime", value)
                                  }
                                  value={entry.endTime}
                                />
                              </label>
                              <button
                                className="secondary-button setup-break-remove"
                                onClick={() => removeShiftBreak(index, breakIndex)}
                                type="button"
                              >
                                <Trash2 size={14} />
                                Remove
                              </button>
                            </div>
                          ))}
                          {(shift.breaks || []).length < MAX_BREAKS ? (
                            <button
                              className="secondary-button setup-break-add"
                              onClick={() => addShiftBreak(index)}
                              type="button"
                            >
                              <Plus size={14} />
                              Add break
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : null}

                    <div className="field field--full">
                      <span>Day of week</span>
                      {!form.daysOfWeek.length ? (
                        <p
                          style={{
                            color: "var(--text-caption)",
                            fontSize: "12px",
                            margin: "8px 0 0",
                          }}
                        >
                          Select business days above first.
                        </p>
                      ) : (
                        <div className="setup-chip-row" style={{ marginTop: "8px" }}>
                          {form.daysOfWeek.map((day) => {
                            const active = shift.daysOfWeek.includes(day);
                            return (
                              <button
                                className={`setup-chip ${active ? "is-active" : ""}`}
                                key={day}
                                onClick={() => toggleShiftDay(index, day)}
                                style={
                                  active
                                    ? {
                                        background: "var(--color-neutral-900, #111)",
                                        color: "#fff",
                                      }
                                    : undefined
                                }
                                type="button"
                              >
                                {day.slice(0, 3)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {(shift.timingMode || "same") === "different" ? (
                      <div className="field field--full">
                        <span>Day-wise timings</span>
                        {!shift.daysOfWeek.length ? (
                          <p
                            style={{
                              color: "var(--text-caption)",
                              fontSize: "12px",
                              margin: "8px 0 0",
                            }}
                          >
                            Select one or more days to set timings.
                          </p>
                        ) : (
                          <div className="setup-day-timing-grid">
                            {shift.daysOfWeek.map((day) => {
                              const dayBreaks = shift.dayTimings?.[day]?.breaks || [];
                              return (
                                <div className="setup-day-timing-row" key={`${index}-${day}`}>
                                  <div className="setup-day-timing-main">
                                    <strong>{day}</strong>
                                    <label className="field">
                                      <span>Start</span>
                                      <SetupTimeInput
                                        onChange={(value) =>
                                          updateDayTiming(index, day, "startTime", value)
                                        }
                                        value={
                                          shift.dayTimings?.[day]?.startTime || shift.startTime
                                        }
                                      />
                                    </label>
                                    <label className="field">
                                      <span>End</span>
                                      <SetupTimeInput
                                        onChange={(value) =>
                                          updateDayTiming(index, day, "endTime", value)
                                        }
                                        value={shift.dayTimings?.[day]?.endTime || shift.endTime}
                                      />
                                    </label>
                                  </div>
                                  {dayBreaks.map((entry, breakIndex) => (
                                    <div
                                      className="setup-break-row setup-break-row--day"
                                      key={`${index}-${day}-break-${breakIndex}`}
                                    >
                                      <label className="field">
                                        <span>Break {breakIndex + 1} start</span>
                                        <SetupTimeInput
                                          onChange={(value) =>
                                            updateDayBreak(
                                              index,
                                              day,
                                              breakIndex,
                                              "startTime",
                                              value,
                                            )
                                          }
                                          value={entry.startTime}
                                        />
                                      </label>
                                      <label className="field">
                                        <span>Break {breakIndex + 1} end</span>
                                        <SetupTimeInput
                                          onChange={(value) =>
                                            updateDayBreak(
                                              index,
                                              day,
                                              breakIndex,
                                              "endTime",
                                              value,
                                            )
                                          }
                                          value={entry.endTime}
                                        />
                                      </label>
                                      <button
                                        className="secondary-button setup-break-remove"
                                        onClick={() => removeDayBreak(index, day, breakIndex)}
                                        type="button"
                                      >
                                        <Trash2 size={14} />
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                                  {dayBreaks.length < MAX_BREAKS ? (
                                    <button
                                      className="secondary-button setup-break-add"
                                      onClick={() => addDayBreak(index, day)}
                                      type="button"
                                    >
                                      <Plus size={14} />
                                      Add break
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              <button
                className="secondary-button"
                disabled={unusedShiftTypes().length === 0}
                onClick={addShiftRow}
                type="button"
              >
                <Plus size={14} />
                Add shift
              </button>

              <h3 style={{ fontSize: "14px", margin: "24px 0 8px" }}>Holiday calendar</h3>
              <div className="setup-form-grid">
                <label className="field field--full">
                  <span>Holiday calendar name</span>
                  <select
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "__create__") {
                        setCreatingCalendar(true);
                        updateField("holidayCalendarId", "");
                        return;
                      }
                      setCreatingCalendar(false);
                      updateField("holidayCalendarId", value);
                    }}
                    value={creatingCalendar ? "__create__" : form.holidayCalendarId}
                  >
                    <option value="">None</option>
                    {calendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.country ? `${cal.name} (${cal.country})` : cal.name}
                      </option>
                    ))}
                    <option value="__create__">Create new calendar…</option>
                  </select>
                </label>
              </div>

              {selectedCalendar && !creatingCalendar ? (
                <div style={{ fontSize: "13px", marginTop: "8px" }}>
                  <strong>Holidays in this calendar:</strong>
                  <div className="setup-chip-row" style={{ marginTop: "8px" }}>
                    {(selectedCalendar.holidays || []).length ? (
                      selectedCalendar.holidays.map((holiday) => (
                        <span className="setup-chip" key={holiday.id || holiday.name}>
                          {holiday.name}
                          {holiday.holidayDate ? ` (${holiday.holidayDate})` : ""}
                        </span>
                      ))
                    ) : (
                      <span className="setup-chip">No holidays yet</span>
                    )}
                  </div>
                </div>
              ) : null}

              {creatingCalendar ? (
                <div
                  className="onboarding-card lead-dashboard-panel"
                  style={{ marginTop: "12px" }}
                >
                  <strong style={{ display: "block", marginBottom: "12px" }}>
                    Create holiday calendar
                  </strong>
                  <div className="setup-form-grid">
                    <label className="field">
                      <span>Holiday calendar name</span>
                      <input
                        onChange={(event) => setNewCalendarName(event.target.value)}
                        placeholder="e.g. India Public Holidays"
                        value={newCalendarName}
                      />
                    </label>
                    <label className="field">
                      <span>Country</span>
                      <select
                        onChange={(event) => handleCountryChange(event.target.value)}
                        value={holidayCountry}
                      >
                        {SETUP_HOLIDAY_COUNTRIES.map((country) => (
                          <option key={country} value={country}>
                            {country}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <p style={{ fontSize: "13px", margin: "12px 0 8px" }}>
                    Select holidays for {holidayCountry}, or add custom ones below.
                  </p>
                  <div className="setup-chip-row" style={{ marginBottom: "12px" }}>
                    {countryHolidayOptions.map((holiday) => (
                      <label
                        className="setup-chip"
                        key={holiday.name}
                        style={{ alignItems: "center", display: "inline-flex", gap: "6px" }}
                      >
                        <input
                          checked={selectedHolidayNames.includes(holiday.name)}
                          onChange={() => toggleHoliday(holiday.name)}
                          type="checkbox"
                        />
                        {holiday.name}
                        <span style={{ color: "var(--text-caption)", fontSize: "11px" }}>
                          {holiday.holidayDate}
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="setup-form-grid">
                    <label className="field">
                      <span>Holiday name</span>
                      <input
                        onChange={(event) =>
                          setCustomHoliday((current) => ({ ...current, name: event.target.value }))
                        }
                        placeholder="Custom holiday"
                        value={customHoliday.name}
                      />
                    </label>
                    <label className="field">
                      <span>Holiday date</span>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <input
                          onChange={(event) =>
                            setCustomHoliday((current) => ({
                              ...current,
                              holidayDate: event.target.value,
                            }))
                          }
                          type="date"
                          value={customHoliday.holidayDate}
                        />
                        <button className="secondary-button" onClick={addCustomHoliday} type="button">
                          Add
                        </button>
                      </div>
                    </label>
                  </div>

                  {customHolidays.length ? (
                    <div className="setup-chip-row" style={{ margin: "8px 0 12px" }}>
                      {customHolidays.map((holiday) => (
                        <span className="setup-chip" key={`${holiday.name}-${holiday.holidayDate}`}>
                          {holiday.name} ({holiday.holidayDate})
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <button
                    className="secondary-button"
                    disabled={creatingCal}
                    onClick={handleCreateCalendar}
                    type="button"
                  >
                    {creatingCal ? "Creating…" : "Save holiday calendar"}
                  </button>
                </div>
              ) : null}

              <div className="setup-form-actions">
                <button className="secondary-button" onClick={closeForm} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={saving} type="submit">
                  {editingId ? <Pencil size={16} /> : <Plus size={16} />}
                  {saving ? "Saving…" : editingId ? "Save changes" : "Save business hours"}
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <p style={{ fontSize: "13px" }}>Loading schedules…</p>
          ) : (
            <div className="setup-bh-list">
              <div className="setup-list-toolbar">
                <label className="setup-search-field">
                  <Search size={16} />
                  <input
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search business hours templates..."
                    type="search"
                    value={searchQuery}
                  />
                </label>
              </div>

              <div className="setup-table-wrap">
                <table className="setup-table setup-bh-table">
                  <thead>
                    <tr>
                      <th>Business hours name</th>
                      <th>Timezone</th>
                      <th>Operating hours</th>
                      <th>Working days</th>
                      <th>Shift hours</th>
                      <th>Branches</th>
                      <th>Teams</th>
                      <th>Products</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBusinessHours.map((entry) => {
                      const counts = getUsageCounts(assignmentUsage, entry.id);
                      const description = String(entry.description || "").trim();
                      return (
                        <tr key={entry.id}>
                          <td>
                            <div className="setup-bh-name">
                              <strong>{entry.name}</strong>
                              {description ? (
                                <button
                                  aria-label={`Show description for ${entry.name}`}
                                  className="setup-bh-info"
                                  onBlur={hideDescriptionTip}
                                  onFocus={(event) => showDescriptionTip(event, description)}
                                  onMouseEnter={(event) => showDescriptionTip(event, description)}
                                  onMouseLeave={hideDescriptionTip}
                                  type="button"
                                >
                                  <Info aria-hidden size={14} strokeWidth={2} />
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td>{formatTimezoneLabel(entry.timezone)}</td>
                          <td>
                            {formatClockTime(entry.openTime || "09:00")} –{" "}
                            {formatClockTime(entry.closeTime || "22:00")}
                          </td>
                          <td>
                            {formatDaysList(
                              (entry.workingDays || []).length
                                ? entry.workingDays
                                : collectShiftDays(entry.shifts),
                            )}
                          </td>
                          <td>{formatShiftHoursSummary(entry.shifts)}</td>
                          <td className="setup-count-cell">{counts.branches}</td>
                          <td className="setup-count-cell">{counts.teams}</td>
                          <td className="setup-count-cell">{counts.products}</td>
                          <td>
                            <div className="setup-row-actions">
                              <button
                                className="secondary-button setup-icon-button"
                                onClick={() => handleEdit(entry)}
                                title="Edit"
                                type="button"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                className="secondary-button setup-icon-button"
                                onClick={() => handleDelete(entry)}
                                title="Delete"
                                type="button"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!filteredBusinessHours.length ? (
                      <tr>
                        <td colSpan={9}>
                          {businessHours.length
                            ? "No templates match your search."
                            : "No business hours yet."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <aside className="setup-workspace-aside">
          <section className="setup-usage-panel">
            <h2>Template usage</h2>
            <p>{businessHours.length} templates in this organization.</p>
            <div className="setup-usage-panel__stats">
              <div>
                <span>Total templates</span>
                <strong>{businessHours.length}</strong>
              </div>
              <div>
                <span>Assigned branches</span>
                <strong>{usageTotals.branches}</strong>
              </div>
              <div>
                <span>Assigned teams</span>
                <strong>{usageTotals.teams}</strong>
              </div>
              <div>
                <span>Assigned products</span>
                <strong>{usageTotals.products}</strong>
              </div>
            </div>
          </section>
          <SetupStatCard label="Holiday calendars" value={calendars.length} />
        </aside>
      </div>
      {descriptionTip
        ? createPortal(
            <div
              className="setup-bh-info-tip"
              role="tooltip"
              style={{
                left: descriptionTip.left,
                maxWidth: descriptionTip.maxWidth,
                top: descriptionTip.top,
              }}
            >
              {descriptionTip.text}
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
