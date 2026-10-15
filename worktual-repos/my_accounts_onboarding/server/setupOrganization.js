import { pool, withTransaction } from "./db/pool.js";
import { isOrgAdminCustomer } from "./customerAuth.js";
import * as repo from "./repositories/raw/setupOrganization.repo.js";
import { getProductName } from "../src/lib/productCatalog.js";
import {
  isCrmProduct,
  normalizeCrmModulePermissions,
  resolveCrmBusinessTypeKey,
} from "../src/lib/setup/crmModules.js";
import {
  CUSTOM_SETUP_ROLES_ENABLED,
  isDefaultSetupRole,
} from "../src/lib/setup/defaultRoles.js";

function mapProfile(row) {
  if (!row) return null;
  return {
    companyName: row.company_name || "",
    industryType: row.industry_type || "",
    businessType: row.business_type || "",
    country: row.country || "",
    companySize: row.company_size || "",
    websiteUrl: row.website_url || "",
    contactName: row.contact_name || "",
    workEmail: row.work_email || "",
    mobileNumber: row.mobile_number || "",
    mobileCountryCode: row.mobile_country_code || "",
  };
}

function mapBranch(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.label || "",
    address: row.address || "",
    city: row.city || "",
    country: row.country || "",
    timezone: row.timezone || "",
    isPrimary: Boolean(row.is_primary),
    status: row.status || "active",
  };
}

function toDateOnly(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function mapHolidayCalendar(row) {
  const holidays = Array.isArray(row.holidays) ? row.holidays : [];
  return {
    id: row.id,
    name: row.name,
    country: row.country || "",
    holidays: holidays.map((h) => ({
      id: h.id,
      name: h.name,
      holidayDate: toDateOnly(h.holidayDate || h.holiday_date),
    })),
  };
}

function mapBusinessHours(row) {
  const shifts = Array.isArray(row.shifts) ? row.shifts : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    timezone: row.timezone || "",
    openTime: String(row.openTime || row.open_time || "09:00").slice(0, 5),
    closeTime: String(row.closeTime || row.close_time || "22:00").slice(0, 5),
    workingDays: Array.isArray(row.workingDays || row.working_days)
      ? row.workingDays || row.working_days
      : [],
    holidayCalendarId: row.holiday_calendar_id || null,
    status: row.status || "active",
    shifts: shifts.map((s) => {
      const day = s.startDayOfWeek || s.start_day_of_week || s.dayOfWeek || s.day_of_week;
      return {
        id: s.id,
        shiftType: s.shiftType || s.shift_type,
        dayOfWeek: day,
        daysOfWeek: [day].filter(Boolean),
        startTime: String(s.startTime || s.start_time || "").slice(0, 5),
        endTime: String(s.endTime || s.end_time || "").slice(0, 5),
        breakStartTime: String(s.breakStartTime || s.break_start_time || "").slice(0, 5),
        breakEndTime: String(s.breakEndTime || s.break_end_time || "").slice(0, 5),
        breakStartTime2: String(s.breakStartTime2 || s.break_start_time_2 || "").slice(0, 5),
        breakEndTime2: String(s.breakEndTime2 || s.break_end_time_2 || "").slice(0, 5),
        crossesMidnight: Boolean(s.crossesMidnight ?? s.crosses_midnight),
      };
    }),
  };
}

function mapTeam(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    businessHoursId: row.business_hours_id || null,
    memberIds: Array.isArray(row.member_ids || row.memberIds) ? row.member_ids || row.memberIds : [],
    availableProducts: row.available_products || [],
    status: row.status || "active",
  };
}

function mapRole(row) {
  const productId =
    row.product_id ||
    (Array.isArray(row.accessible_products) && row.accessible_products.length === 1
      ? row.accessible_products[0]
      : "") ||
    "";
  const modulePermissions = Array.isArray(row.module_permissions)
    ? row.module_permissions.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    productId,
    canView: Boolean(row.can_view),
    canCreate: Boolean(row.can_create),
    canEdit: Boolean(row.can_edit),
    canDelete: Boolean(row.can_delete),
    canExport: Boolean(row.can_export),
    modulePermissions,
  };
}

async function resolveOrgBusinessType(organizationId) {
  const profile = await repo.selectBusinessProfile(pool, organizationId);
  return profile?.business_type || "";
}

async function resolveRolePermissionFields(organizationId, productId, body) {
  if (isCrmProduct(productId)) {
    const businessType = await resolveOrgBusinessType(organizationId);
    if (!resolveCrmBusinessTypeKey(businessType)) {
      const error = new Error(
        "Set your organization business type in Business Profile before creating CRM roles.",
      );
      error.statusCode = 400;
      throw error;
    }
    const incoming = Array.isArray(body?.modulePermissions) ? body.modulePermissions : [];
    const unknown = incoming
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .filter((id) => !normalizeCrmModulePermissions([id], businessType).includes(id));
    if (unknown.length) {
      const error = new Error(`Unknown CRM module(s) for this business type: ${unknown.join(", ")}.`);
      error.statusCode = 400;
      throw error;
    }
    return {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      modulePermissions: normalizeCrmModulePermissions(incoming, businessType),
    };
  }
  return {
    canView: body.canView !== false,
    canCreate: Boolean(body.canCreate),
    canEdit: Boolean(body.canEdit),
    canDelete: Boolean(body.canDelete),
    canExport: Boolean(body.canExport),
    modulePermissions: [],
  };
}

function normalizeProductAccess(rawAccess = []) {
  if (!Array.isArray(rawAccess)) return [];
  return rawAccess
    .map((entry) => ({
      productId: String(entry?.productId || "").trim(),
      roleId: String(entry?.roleId || "").trim(),
    }))
    .filter((entry) => entry.productId && entry.roleId);
}

/** Compare previous vs next product grants by productId (and role changes). */
export function diffProductAccess(previousAccess = [], nextAccess = []) {
  const prev = normalizeProductAccess(previousAccess);
  const next = normalizeProductAccess(nextAccess);
  const prevById = new Map(prev.map((entry) => [entry.productId, entry.roleId]));
  const nextById = new Map(next.map((entry) => [entry.productId, entry.roleId]));
  const prevIds = new Set(prevById.keys());
  const nextIds = new Set(nextById.keys());
  const added = [...nextIds].filter((id) => !prevIds.has(id));
  const removed = [...prevIds].filter((id) => !nextIds.has(id));
  const roleChanged = [...nextIds].filter(
    (id) => prevIds.has(id) && prevById.get(id) !== nextById.get(id),
  );
  const current = [...nextIds];
  return {
    added,
    removed,
    roleChanged,
    current,
    addedNames: added.map((id) => getProductName(id)),
    removedNames: removed.map((id) => getProductName(id)),
    currentNames: current.map((id) => getProductName(id)),
    changed: added.length > 0 || removed.length > 0 || roleChanged.length > 0,
  };
}

function mapUser(row) {
  return {
    id: row.id,
    employeeId: row.employee_id || "",
    firstName: row.first_name,
    lastName: row.last_name,
    workEmail: row.work_email,
    mobileNumber: row.mobile_number || "",
    teamId: row.team_id || null,
    businessHoursId: row.business_hours_id || null,
    shiftTypes: Array.isArray(row.shift_types) ? row.shift_types : [],
    productAccess: normalizeProductAccess(row.product_access || []),
    primaryLanguage: row.primary_language || "",
    secondaryLanguage: row.secondary_language || "",
    skill: row.skill || "",
    locationId: row.location_id || "",
    status: row.status || "active",
    inviteStatus: row.invite_status || "pending",
    invitedAt: row.invited_at || null,
    passwordSetAt: row.password_set_at || null,
  };
}

function assertOrgAdmin(customerUser) {
  if (!isOrgAdminCustomer(customerUser)) {
    const error = new Error("Only organization admins can modify setup workspace.");
    error.statusCode = 403;
    throw error;
  }
}

const WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const WEEK_DAY_LABELS = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const ALLOWED_SHIFT_TYPES = new Set(["Regular", "Morning", "Evening", "Night"]);

function normalizeDayLabel(value) {
  const key = String(value || "").toLowerCase();
  return WEEK_DAY_LABELS[key] || null;
}

function resolveShiftDays(shift) {
  if (Array.isArray(shift.daysOfWeek) && shift.daysOfWeek.length) {
    return shift.daysOfWeek.map(normalizeDayLabel).filter(Boolean);
  }
  const start = normalizeDayLabel(shift.startDayOfWeek || shift.dayOfWeek);
  const end = normalizeDayLabel(shift.endDayOfWeek || start);
  if (!start) return [];
  if (!end || start === end) return [start];
  const startIndex = WEEK_DAYS.indexOf(start.toLowerCase());
  const endIndex = WEEK_DAYS.indexOf(end.toLowerCase());
  if (startIndex < 0 || endIndex < 0) return [start];
  const days = [];
  let index = startIndex;
  for (let step = 0; step < 7; step += 1) {
    days.push(WEEK_DAY_LABELS[WEEK_DAYS[index]]);
    if (index === endIndex) break;
    index = (index + 1) % 7;
  }
  return days;
}

function timeToMinutes(value) {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
}

function normalizeShiftTiming(shift) {
  const start = timeToMinutes(shift.startTime);
  let end = timeToMinutes(shift.endTime);
  let crossesMidnight = Boolean(shift.crossesMidnight);
  if (end < start) {
    crossesMidnight = true;
  }
  if (crossesMidnight && end <= start) {
    end += 24 * 60;
  }
  return { ...shift, crossesMidnight, _start: start, _end: end };
}

function normalizeOptionalTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.slice(0, 5);
}

const MAX_BREAKS = 2;

function collectBreakEntries(source = {}) {
  if (Array.isArray(source.breaks)) {
    return source.breaks
      .slice(0, MAX_BREAKS)
      .map((entry) => ({
        startTime: normalizeOptionalTime(entry?.startTime || entry?.breakStartTime),
        endTime: normalizeOptionalTime(entry?.endTime || entry?.breakEndTime),
      }))
      .filter((entry) => entry.startTime || entry.endTime);
  }

  const list = [];
  const firstStart = normalizeOptionalTime(source.breakStartTime);
  const firstEnd = normalizeOptionalTime(source.breakEndTime);
  const secondStart = normalizeOptionalTime(source.breakStartTime2);
  const secondEnd = normalizeOptionalTime(source.breakEndTime2);
  if (firstStart || firstEnd) list.push({ startTime: firstStart, endTime: firstEnd });
  if (secondStart || secondEnd) list.push({ startTime: secondStart, endTime: secondEnd });
  return list.slice(0, MAX_BREAKS);
}

function validateSingleBreakWithinShift(shift, breakStart, breakEnd, label = "Break") {
  if (!breakStart && !breakEnd) {
    return null;
  }
  if (!breakStart || !breakEnd) {
    const error = new Error(
      `Provide both start and end for ${label.toLowerCase()}, or remove it.`,
    );
    error.statusCode = 400;
    throw error;
  }

  const start = timeToMinutes(shift.startTime);
  let end = timeToMinutes(shift.endTime);
  let breakStartMinutes = timeToMinutes(breakStart);
  let breakEndMinutes = timeToMinutes(breakEnd);

  if (end < start) end += 24 * 60;
  if (breakEndMinutes < breakStartMinutes) breakEndMinutes += 24 * 60;

  if (breakStartMinutes < start || breakEndMinutes > end) {
    const error = new Error(`${label} must fall within the shift start and end times.`);
    error.statusCode = 400;
    throw error;
  }
  if (breakStartMinutes === breakEndMinutes) {
    const error = new Error(`${label} end time must be after break start time.`);
    error.statusCode = 400;
    throw error;
  }

  return {
    startTime: breakStart,
    endTime: breakEnd,
    _start: breakStartMinutes,
    _end: breakEndMinutes,
  };
}

function validateBreaksWithinShift(shift) {
  const entries = collectBreakEntries(shift);
  if (entries.length > MAX_BREAKS) {
    const error = new Error("You can add at most two breaks per shift day.");
    error.statusCode = 400;
    throw error;
  }

  const validated = [];
  for (let i = 0; i < entries.length; i += 1) {
    const label = `Break ${i + 1}`;
    const next = validateSingleBreakWithinShift(
      shift,
      entries[i].startTime,
      entries[i].endTime,
      label,
    );
    if (!next) continue;
    for (const prior of validated) {
      if (next._start < prior._end && prior._start < next._end) {
        const error = new Error("Break times cannot overlap.");
        error.statusCode = 400;
        throw error;
      }
    }
    validated.push(next);
  }

  return {
    breakStartTime: validated[0]?.startTime || null,
    breakEndTime: validated[0]?.endTime || null,
    breakStartTime2: validated[1]?.startTime || null,
    breakEndTime2: validated[1]?.endTime || null,
  };
}

function resolveDaySchedules(raw) {
  if (Array.isArray(raw?.daySchedules) && raw.daySchedules.length) {
    return raw.daySchedules
      .map((schedule) => {
        const day = normalizeDayLabel(schedule.dayOfWeek || schedule.day);
        if (!day || !schedule.startTime || !schedule.endTime) return null;
        const breakSource = {
          breaks: schedule.breaks,
          breakStartTime: schedule.breakStartTime ?? raw.breakStartTime,
          breakEndTime: schedule.breakEndTime ?? raw.breakEndTime,
          breakStartTime2: schedule.breakStartTime2 ?? raw.breakStartTime2,
          breakEndTime2: schedule.breakEndTime2 ?? raw.breakEndTime2,
        };
        return {
          dayOfWeek: day,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          breaks: collectBreakEntries(breakSource),
          crossesMidnight: schedule.crossesMidnight,
        };
      })
      .filter(Boolean);
  }

  const days = resolveShiftDays(raw);
  if (!days.length || !raw?.startTime || !raw?.endTime) {
    return [];
  }

  const breaks = collectBreakEntries(raw);
  return days.map((day) => ({
    dayOfWeek: day,
    startTime: raw.startTime,
    endTime: raw.endTime,
    breaks,
    crossesMidnight: raw.crossesMidnight,
  }));
}

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

function normalizeWorkingDays(rawDays) {
  if (!Array.isArray(rawDays)) return [];
  const labels = new Set(rawDays.map(normalizeDayLabel).filter(Boolean));
  return WEEK_DAYS.map((key) => WEEK_DAY_LABELS[key]).filter((day) => labels.has(day));
}

function assertShiftsWithinBusinessHours(openTime, closeTime, expandedShifts, workingDays = []) {
  const open = normalizeOptionalTime(openTime);
  const close = normalizeOptionalTime(closeTime);
  if (!open || !close) {
    const error = new Error("Business hours start and end times are required.");
    error.statusCode = 400;
    throw error;
  }
  if (open === close) {
    const error = new Error("Business hours start and end times cannot be the same.");
    error.statusCode = 400;
    throw error;
  }

  const allowedDays = normalizeWorkingDays(workingDays);
  if (!allowedDays.length) {
    const error = new Error("Select at least one business day of the week.");
    error.statusCode = 400;
    throw error;
  }
  const allowedSet = new Set(allowedDays.map((day) => day.toLowerCase()));

  for (const shift of expandedShifts || []) {
    if (!allowedSet.has(String(shift.dayOfWeek || "").toLowerCase())) {
      const error = new Error(
        `Shift “${shift.shiftType}” includes ${shift.dayOfWeek}, which is outside the business days.`,
      );
      error.statusCode = 400;
      throw error;
    }
    if (!rangeWithinWindow(shift.startTime, shift.endTime, open, close)) {
      const error = new Error(
        `Shift “${shift.shiftType}” on ${shift.dayOfWeek} must stay within business hours (${open}–${close}) and cannot collapse.`,
      );
      error.statusCode = 400;
      throw error;
    }
    for (const [breakStart, breakEnd] of [
      [shift.breakStartTime, shift.breakEndTime],
      [shift.breakStartTime2, shift.breakEndTime2],
    ]) {
      if (!breakStart && !breakEnd) continue;
      if (!rangeWithinWindow(breakStart, breakEnd, open, close)) {
        const error = new Error(
          `Break on ${shift.dayOfWeek} for shift “${shift.shiftType}” must stay within business hours (${open}–${close}).`,
        );
        error.statusCode = 400;
        throw error;
      }
    }
  }
}

export function validateShiftsNonOverlap(shifts) {
  const byDay = new Map();
  const expanded = [];
  const seenTypes = new Set();

  for (const raw of shifts || []) {
    const shiftType = raw.shiftType || "Regular";
    if (!ALLOWED_SHIFT_TYPES.has(shiftType)) {
      const error = new Error("Shift type must be Regular, Morning, Evening, or Night.");
      error.statusCode = 400;
      throw error;
    }
    if (seenTypes.has(shiftType)) {
      const error = new Error(`Shift type “${shiftType}” is already used. Each type can only be added once.`);
      error.statusCode = 400;
      throw error;
    }
    seenTypes.add(shiftType);

    const schedules = resolveDaySchedules(raw);
    if (!schedules.length) {
      const error = new Error("Each shift needs at least one day, start time, and end time.");
      error.statusCode = 400;
      throw error;
    }

    for (const schedule of schedules) {
      const shift = normalizeShiftTiming({
        ...raw,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        crossesMidnight: schedule.crossesMidnight,
      });
      const breakTimes = validateBreaksWithinShift({
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        breaks: schedule.breaks,
      });
      const day = schedule.dayOfWeek;
      const dayKey = day.toLowerCase();
      const list = byDay.get(dayKey) || [];
      for (const other of list) {
        if (shift._start < other._end && other._start < shift._end) {
          const error = new Error(`Shifts overlap on ${day}.`);
          error.statusCode = 400;
          throw error;
        }
      }
      list.push(shift);
      byDay.set(dayKey, list);
      expanded.push({
        shiftType,
        dayOfWeek: day,
        startDayOfWeek: day,
        endDayOfWeek: day,
        startTime: shift.startTime,
        endTime: shift.endTime,
        breakStartTime: breakTimes.breakStartTime,
        breakEndTime: breakTimes.breakEndTime,
        breakStartTime2: breakTimes.breakStartTime2,
        breakEndTime2: breakTimes.breakEndTime2,
        crossesMidnight: shift.crossesMidnight,
      });
    }
  }

  return expanded;
}

export async function getBusinessProfile(organizationId) {
  return mapProfile(await repo.selectBusinessProfile(pool, organizationId));
}

export async function saveBusinessProfile(customerUser, body) {
  assertOrgAdmin(customerUser);
  const row = await repo.updateBusinessProfile(pool, customerUser.organizationId, {
    companyName: body.companyName,
    industryType: body.industryType,
    businessType: body.businessType,
    country: body.country,
    companySize: body.companySize,
    websiteUrl: body.websiteUrl,
    contactName: body.contactName,
    workEmail: body.workEmail,
    mobileNumber: body.mobileNumber,
    mobileCountryCode: body.mobileCountryCode,
  });
  const profile = mapProfile(row);
  // Seed product default roles (CRM needs business type; CCaaS only needs active sub).
  const { ensureProductDefaultRoles } = await import("./ensureProductDefaultRoles.js");
  await ensureProductDefaultRoles(customerUser.organizationId);
  return profile;
}

export async function getBranches(organizationId) {
  const rows = await repo.listBranches(pool, organizationId);
  return rows.map(mapBranch);
}

export async function createBranch(customerUser, body) {
  assertOrgAdmin(customerUser);
  if (!body?.name?.trim()) {
    const error = new Error("Branch name is required.");
    error.statusCode = 400;
    throw error;
  }
  const row = await repo.insertBranch(pool, customerUser.organizationId, {
    name: body.name.trim(),
    address: body.address,
    city: body.city,
    country: body.country,
    timezone: body.timezone,
    isPrimary: body.isPrimary,
  });
  return mapBranch(row);
}

export async function patchBranch(customerUser, branchId, body) {
  assertOrgAdmin(customerUser);
  const row = await repo.updateBranch(pool, customerUser.organizationId, branchId, {
    name: body.name,
    address: body.address,
    city: body.city,
    country: body.country,
    timezone: body.timezone,
    isPrimary: body.isPrimary,
  });
  if (!row) {
    const error = new Error("Branch not found.");
    error.statusCode = 404;
    throw error;
  }
  return mapBranch(row);
}

export async function removeBranch(customerUser, branchId) {
  assertOrgAdmin(customerUser);
  const ok = await repo.deleteBranch(pool, customerUser.organizationId, branchId);
  if (!ok) {
    const error = new Error("Branch not found or primary branch cannot be deleted.");
    error.statusCode = 400;
    throw error;
  }
}

export async function getHolidayCalendars(organizationId) {
  const rows = await repo.listHolidayCalendars(pool, organizationId);
  return rows.map(mapHolidayCalendar);
}

export async function createHolidayCalendar(customerUser, body) {
  assertOrgAdmin(customerUser);
  if (!body?.name?.trim()) {
    const error = new Error("Holiday calendar name is required.");
    error.statusCode = 400;
    throw error;
  }
  const calendar = await repo.insertHolidayCalendar(pool, customerUser.organizationId, {
    name: body.name.trim(),
    country: body.country,
  });
  const holidays = [];
  for (const holiday of body.holidays || []) {
    if (!holiday?.name || !holiday?.holidayDate) continue;
    holidays.push(
      await repo.insertHoliday(pool, calendar.id, {
        name: holiday.name,
        holidayDate: holiday.holidayDate,
      }),
    );
  }
  return mapHolidayCalendar({ ...calendar, holidays });
}

export async function addHolidaysToCalendar(customerUser, calendarId, holidays) {
  assertOrgAdmin(customerUser);
  const created = [];
  for (const holiday of holidays || []) {
    created.push(
      await repo.insertHoliday(pool, calendarId, {
        name: holiday.name,
        holidayDate: holiday.holidayDate,
      }),
    );
  }
  return created.map((h) => ({
    id: h.id,
    name: h.name,
    holidayDate: toDateOnly(h.holiday_date),
  }));
}

export async function getBusinessHoursList(organizationId) {
  const rows = await repo.listBusinessHours(pool, organizationId);
  return rows.map(mapBusinessHours);
}

export async function createBusinessHours(customerUser, body) {
  assertOrgAdmin(customerUser);
  if (!body?.name?.trim()) {
    const error = new Error("Business hours name is required.");
    error.statusCode = 400;
    throw error;
  }
  const openTime = normalizeOptionalTime(body.openTime) || "09:00";
  const closeTime = normalizeOptionalTime(body.closeTime) || "22:00";
  const workingDays = normalizeWorkingDays(body.workingDays || body.daysOfWeek);
  const shifts = validateShiftsNonOverlap(body.shifts || []);
  assertShiftsWithinBusinessHours(openTime, closeTime, shifts, workingDays);
  const row = await repo.insertBusinessHours(pool, customerUser.organizationId, {
    name: body.name.trim(),
    description: body.description,
    timezone: body.timezone,
    openTime,
    closeTime,
    workingDays,
    holidayCalendarId: body.holidayCalendarId,
    status: body.status || "active",
  });
  const savedShifts = await repo.replaceShifts(pool, row.id, shifts);
  return mapBusinessHours({ ...row, shifts: savedShifts });
}

export async function patchBusinessHours(customerUser, id, body) {
  assertOrgAdmin(customerUser);
  const openTime =
    body.openTime !== undefined ? normalizeOptionalTime(body.openTime) || null : undefined;
  const closeTime =
    body.closeTime !== undefined ? normalizeOptionalTime(body.closeTime) || null : undefined;
  const workingDays =
    body.workingDays !== undefined || body.daysOfWeek !== undefined
      ? normalizeWorkingDays(body.workingDays || body.daysOfWeek)
      : undefined;
  const row = await repo.updateBusinessHours(pool, customerUser.organizationId, id, {
    name: body.name,
    description: body.description,
    timezone: body.timezone,
    openTime,
    closeTime,
    workingDays,
    holidayCalendarId: body.holidayCalendarId,
    status: body.status,
  });
  if (!row) {
    const error = new Error("Business hours not found.");
    error.statusCode = 404;
    throw error;
  }
  let shifts = row.shifts;
  if (Array.isArray(body.shifts)) {
    const normalized = validateShiftsNonOverlap(body.shifts);
    assertShiftsWithinBusinessHours(
      openTime || row.open_time || "09:00",
      closeTime || row.close_time || "22:00",
      normalized,
      workingDays || row.working_days || [],
    );
    shifts = await repo.replaceShifts(pool, id, normalized);
  } else {
    const full = await repo.listBusinessHours(pool, customerUser.organizationId);
    const match = full.find((item) => item.id === id);
    shifts = match?.shifts || [];
  }
  return mapBusinessHours({ ...row, shifts });
}

export async function removeBusinessHours(customerUser, id) {
  assertOrgAdmin(customerUser);
  const ok = await repo.deleteBusinessHours(pool, customerUser.organizationId, id);
  if (!ok) {
    const error = new Error("Business hours not found.");
    error.statusCode = 404;
    throw error;
  }
}

export async function getTeams(organizationId) {
  return (await repo.listTeams(pool, organizationId)).map(mapTeam);
}

export async function getTeam(organizationId, id) {
  const row = await repo.getTeamById(pool, organizationId, id);
  if (!row) {
    const error = new Error("Team not found.");
    error.statusCode = 404;
    throw error;
  }
  return mapTeam(row);
}

function normalizeMemberIds(memberIds = []) {
  if (!Array.isArray(memberIds)) return [];
  return [...new Set(memberIds.map((id) => String(id || "").trim()).filter(Boolean))];
}

function teamMemberIds(team) {
  return Array.isArray(team?.member_ids) ? team.member_ids.map(String) : [];
}

async function assertExclusiveTeamMembers(organizationId, teamId, memberIds, runner = pool) {
  const teams = await repo.listTeams(runner, organizationId);
  const users = await repo.listUsers(runner, organizationId);
  const usersById = new Map(users.map((user) => [user.id, user]));

  for (const memberId of memberIds) {
    const user = usersById.get(memberId);
    if (!user) {
      const error = new Error("One or more selected members were not found.");
      error.statusCode = 400;
      throw error;
    }
    const displayName =
      [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
      user.work_email ||
      "This user";

    for (const team of teams) {
      if (team.id === teamId) continue;
      if (teamMemberIds(team).includes(memberId)) {
        const error = new Error(
          `${displayName} is already on team “${team.name}”. A user can only belong to one team.`,
        );
        error.statusCode = 400;
        throw error;
      }
    }

    if (user.team_id && user.team_id !== teamId) {
      const other = teams.find((team) => team.id === user.team_id);
      const error = new Error(
        `${displayName} is already on team “${other?.name || "another team"}”. A user can only belong to one team.`,
      );
      error.statusCode = 400;
      throw error;
    }
  }
}

async function syncUsersForTeamMembers(
  organizationId,
  teamId,
  previousMemberIds,
  nextMemberIds,
  runner = pool,
) {
  const previous = new Set(previousMemberIds.map(String));
  const next = new Set(nextMemberIds.map(String));

  for (const userId of previous) {
    if (next.has(userId)) continue;
    const user = await repo.getUserById(runner, organizationId, userId);
    if (user?.team_id === teamId) {
      await repo.updateUser(runner, organizationId, userId, { teamId: null });
    }
  }

  for (const userId of next) {
    await repo.updateUser(runner, organizationId, userId, { teamId });
  }
}

export async function createTeam(customerUser, body) {
  assertOrgAdmin(customerUser);
  if (!body?.name?.trim()) {
    const error = new Error("Team name is required.");
    error.statusCode = 400;
    throw error;
  }
  const memberIds = normalizeMemberIds(body.memberIds);
  const row = await withTransaction(async (client) => {
    await assertExclusiveTeamMembers(customerUser.organizationId, null, memberIds, client);
    const created = await repo.insertTeam(client, customerUser.organizationId, {
      name: body.name.trim(),
      description: body.description,
      businessHoursId: null,
      memberIds,
      availableProducts: body.availableProducts || [],
      status: body.status || "active",
    });
    await syncUsersForTeamMembers(
      customerUser.organizationId,
      created.id,
      [],
      memberIds,
      client,
    );
    return created;
  });
  return mapTeam(row);
}

export async function patchTeam(customerUser, id, body) {
  assertOrgAdmin(customerUser);
  const existing = await repo.getTeamById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("Team not found.");
    error.statusCode = 404;
    throw error;
  }
  const previousMemberIds = teamMemberIds(existing);
  const memberIds =
    body.memberIds !== undefined ? normalizeMemberIds(body.memberIds) : previousMemberIds;
  const row = await withTransaction(async (client) => {
    if (body.memberIds !== undefined) {
      await assertExclusiveTeamMembers(customerUser.organizationId, id, memberIds, client);
    }
    const updated = await repo.updateTeam(client, customerUser.organizationId, id, {
      name: body.name,
      description: body.description,
      businessHoursId: null,
      clearBusinessHours: true,
      memberIds: body.memberIds !== undefined ? memberIds : undefined,
      availableProducts: body.availableProducts,
      status: body.status,
    });
    if (!updated) return null;
    if (body.memberIds !== undefined) {
      await syncUsersForTeamMembers(
        customerUser.organizationId,
        id,
        previousMemberIds,
        memberIds,
        client,
      );
    }
    return updated;
  });
  if (!row) {
    const error = new Error("Team not found.");
    error.statusCode = 404;
    throw error;
  }
  return mapTeam(row);
}

export async function removeTeam(customerUser, id) {
  assertOrgAdmin(customerUser);
  const existing = await repo.getTeamById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("Team not found.");
    error.statusCode = 404;
    throw error;
  }
  await withTransaction(async (client) => {
    await syncUsersForTeamMembers(
      customerUser.organizationId,
      id,
      teamMemberIds(existing),
      [],
      client,
    );
    const ok = await repo.deleteTeam(client, customerUser.organizationId, id);
    if (!ok) {
      const error = new Error("Team not found.");
      error.statusCode = 404;
      throw error;
    }
  });
}

export async function getRoles(organizationId) {
  return (await repo.listRoles(pool, organizationId)).map(mapRole);
}

function assertRolePayload(body) {
  if (!body?.name?.trim()) {
    const error = new Error("Role name is required.");
    error.statusCode = 400;
    throw error;
  }
  if (!String(body.productId || "").trim()) {
    const error = new Error("Product is required for a role.");
    error.statusCode = 400;
    throw error;
  }
}

const ROLE_NAME_CONFLICT_MESSAGE =
  "This role name can’t be used twice for the same product. Choose a different name, or assign it under another product.";

async function assertUniqueRoleName(organizationId, productId, name, excludeId = null) {
  const existing = await repo.findRoleByProductAndName(
    pool,
    organizationId,
    productId,
    name,
    excludeId,
  );
  if (existing) {
    const error = new Error(ROLE_NAME_CONFLICT_MESSAGE);
    error.statusCode = 400;
    throw error;
  }
}

function assertCustomRolesAllowed(action = "modify") {
  if (CUSTOM_SETUP_ROLES_ENABLED) return;
  const error = new Error(
    `Custom roles are not available yet. You can only use default product roles (cannot ${action}).`,
  );
  error.statusCode = 403;
  throw error;
}

function assertRoleNotDefaultLocked(roleRow, action = "modify") {
  const mapped = mapRole(roleRow);
  if (isDefaultSetupRole(mapped.productId, mapped.name)) {
    const error = new Error(`Default roles cannot be ${action}d.`);
    error.statusCode = 403;
    throw error;
  }
}

export async function createRole(customerUser, body) {
  assertOrgAdmin(customerUser);
  assertCustomRolesAllowed("create");
  assertRolePayload(body);
  const name = body.name.trim();
  const productId = String(body.productId).trim();
  await assertUniqueRoleName(customerUser.organizationId, productId, name);
  const permissions = await resolveRolePermissionFields(
    customerUser.organizationId,
    productId,
    body,
  );
  try {
    return mapRole(
      await repo.insertRole(pool, customerUser.organizationId, {
        name,
        description: body.description,
        productId,
        ...permissions,
      }),
    );
  } catch (error) {
    if (error?.code === "23505") {
      const conflict = new Error(ROLE_NAME_CONFLICT_MESSAGE);
      conflict.statusCode = 400;
      throw conflict;
    }
    throw error;
  }
}

export async function patchRole(customerUser, id, body) {
  assertOrgAdmin(customerUser);
  assertCustomRolesAllowed("edit");
  if (body?.name !== undefined && !String(body.name || "").trim()) {
    const error = new Error("Role name is required.");
    error.statusCode = 400;
    throw error;
  }
  if (body?.productId !== undefined && !String(body.productId || "").trim()) {
    const error = new Error("Product is required for a role.");
    error.statusCode = 400;
    throw error;
  }
  const existing = await repo.getRoleById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("Role not found.");
    error.statusCode = 404;
    throw error;
  }
  assertRoleNotDefaultLocked(existing, "edit");
  const nextName =
    body.name !== undefined ? String(body.name).trim() : String(existing.name || "").trim();
  const nextProductId =
    body.productId !== undefined
      ? String(body.productId).trim()
      : String(existing.product_id || "").trim();
  if (nextName && nextProductId) {
    await assertUniqueRoleName(customerUser.organizationId, nextProductId, nextName, id);
  }

  const permissionsTouched =
    body.modulePermissions !== undefined ||
    body.canView !== undefined ||
    body.canCreate !== undefined ||
    body.canEdit !== undefined ||
    body.canDelete !== undefined ||
    body.canExport !== undefined ||
    body.productId !== undefined;

  let permissionFields = {};
  if (permissionsTouched) {
    const permissionBody = isCrmProduct(nextProductId)
      ? {
          modulePermissions:
            body.modulePermissions !== undefined
              ? body.modulePermissions
              : existing.module_permissions,
        }
      : {
          canView: body.canView !== undefined ? body.canView : existing.can_view,
          canCreate: body.canCreate !== undefined ? body.canCreate : existing.can_create,
          canEdit: body.canEdit !== undefined ? body.canEdit : existing.can_edit,
          canDelete: body.canDelete !== undefined ? body.canDelete : existing.can_delete,
          canExport: body.canExport !== undefined ? body.canExport : existing.can_export,
        };
    permissionFields = await resolveRolePermissionFields(
      customerUser.organizationId,
      nextProductId,
      permissionBody,
    );
  }

  let row;
  try {
    row = await repo.updateRole(pool, customerUser.organizationId, id, {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      description: body.description,
      productId: body.productId !== undefined ? String(body.productId).trim() : undefined,
      ...(permissionsTouched ? permissionFields : {}),
    });
  } catch (error) {
    if (error?.code === "23505") {
      const conflict = new Error(ROLE_NAME_CONFLICT_MESSAGE);
      conflict.statusCode = 400;
      throw conflict;
    }
    throw error;
  }
  if (!row) {
    const error = new Error("Role not found.");
    error.statusCode = 404;
    throw error;
  }
  return mapRole(row);
}

export async function removeRole(customerUser, id) {
  assertOrgAdmin(customerUser);
  assertCustomRolesAllowed("delete");
  const existing = await repo.getRoleById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("Role not found.");
    error.statusCode = 404;
    throw error;
  }
  assertRoleNotDefaultLocked(existing, "delete");
  const ok = await repo.deleteRole(pool, customerUser.organizationId, id);
  if (!ok) {
    const error = new Error("Role not found.");
    error.statusCode = 404;
    throw error;
  }
}

async function assertUserAssignments(organizationId, body) {
  const productAccess = normalizeProductAccess(body.productAccess || []);
  for (const grant of productAccess) {
    const role = await repo.getRoleById(pool, organizationId, grant.roleId);
    if (!role) {
      const error = new Error(`Role not found for product “${grant.productId}”.`);
      error.statusCode = 400;
      throw error;
    }
    const mapped = mapRole(role);
    const roleProductId = mapped.productId;
    if (roleProductId !== grant.productId) {
      const error = new Error(
        `Role “${role.name}” does not belong to product “${grant.productId}”.`,
      );
      error.statusCode = 400;
      throw error;
    }
    if (!CUSTOM_SETUP_ROLES_ENABLED && !isDefaultSetupRole(mapped.productId, mapped.name)) {
      const error = new Error(
        `Only default roles can be assigned right now. “${mapped.name}” is not a default role.`,
      );
      error.statusCode = 400;
      throw error;
    }
  }

  const teamId = body.teamId || null;
  if (teamId) {
    const team = await repo.getTeamById(pool, organizationId, teamId);
    if (!team) {
      const error = new Error("Selected team was not found.");
      error.statusCode = 400;
      throw error;
    }
  }

  const businessHoursId = body.businessHoursId || null;
  const shiftTypes = Array.isArray(body.shiftTypes)
    ? [...new Set(body.shiftTypes.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
  if (shiftTypes.length && !businessHoursId) {
    const error = new Error("Select a business hours schedule before assigning shift types.");
    error.statusCode = 400;
    throw error;
  }
  if (businessHoursId) {
    const allowed = await repo.listShiftTypesForBusinessHours(
      pool,
      organizationId,
      businessHoursId,
    );
    const allowedSet = new Set(allowed);
    for (const shiftType of shiftTypes) {
      if (!allowedSet.has(shiftType)) {
        const error = new Error(
          `Shift type “${shiftType}” is not part of the selected business hours.`,
        );
        error.statusCode = 400;
        throw error;
      }
    }
  }

  return { productAccess, teamId, businessHoursId, shiftTypes };
}

async function syncUserTeamMembership(
  organizationId,
  userId,
  previousTeamId,
  nextTeamId,
  runner = pool,
) {
  const teams = await repo.listTeams(runner, organizationId);
  for (const team of teams) {
    const members = teamMemberIds(team);
    if (team.id === nextTeamId) {
      if (!members.includes(userId)) {
        await repo.setTeamMemberIds(runner, organizationId, team.id, [...members, userId]);
      }
      continue;
    }
    if (members.includes(userId)) {
      await repo.setTeamMemberIds(
        runner,
        organizationId,
        team.id,
        members.filter((id) => id !== userId),
      );
    }
  }
}

export async function getUsers(organizationId) {
  return (await repo.listUsers(pool, organizationId)).map(mapUser);
}

export async function createUser(customerUser, body) {
  assertOrgAdmin(customerUser);
  if (!body?.firstName?.trim() || !body?.lastName?.trim() || !body?.workEmail?.trim()) {
    const error = new Error("First name, last name, and work email are required.");
    error.statusCode = 400;
    throw error;
  }
  const assignments = await assertUserAssignments(customerUser.organizationId, body);
  const row = await withTransaction(async (client) => {
    const created = await repo.insertUser(client, customerUser.organizationId, {
      employeeId: body.employeeId,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      workEmail: body.workEmail.trim(),
      mobileNumber: body.mobileNumber,
      teamId: assignments.teamId,
      businessHoursId: assignments.businessHoursId,
      shiftTypes: assignments.shiftTypes,
      productAccess: assignments.productAccess,
      primaryLanguage: body.primaryLanguage,
      secondaryLanguage: body.secondaryLanguage,
      skill: body.skill,
      locationId: body.locationId,
      status: body.status || "active",
    });
    await syncUserTeamMembership(
      customerUser.organizationId,
      created.id,
      null,
      assignments.teamId,
      client,
    );
    return created;
  });

  let invite = null;
  let inviteError = null;
  if (assignments.productAccess.length > 0) {
    try {
      const { issueSetupUserInvite } = await import("./setupUserInvite.js");
      invite = await issueSetupUserInvite(customerUser, row.id);
    } catch (err) {
      inviteError = err.message || "Failed to send invite email.";
    }
  }

  const mapped = mapUser(invite?.user || row);
  return { user: mapped, inviteSent: Boolean(invite?.invited), inviteError };
}

export async function patchUser(customerUser, id, body) {
  assertOrgAdmin(customerUser);
  const existing = await repo.getUserById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }
  const previousAccess = normalizeProductAccess(
    existing.product_access ||
      (await repo.listUserProductAccess(pool, customerUser.organizationId, id)),
  );
  const existingProductAccess =
    body.productAccess ??
    (await repo.listUserProductAccess(pool, customerUser.organizationId, id));
  const assignments = await assertUserAssignments(customerUser.organizationId, {
    productAccess: existingProductAccess,
    teamId: Object.prototype.hasOwnProperty.call(body, "teamId")
      ? body.teamId
      : existing.team_id,
    businessHoursId: Object.prototype.hasOwnProperty.call(body, "businessHoursId")
      ? body.businessHoursId
      : existing.business_hours_id,
    shiftTypes: body.shiftTypes ?? existing.shift_types,
  });
  const row = await withTransaction(async (client) => {
    const updated = await repo.updateUser(client, customerUser.organizationId, id, {
      employeeId: body.employeeId,
      firstName: body.firstName,
      lastName: body.lastName,
      workEmail: body.workEmail,
      mobileNumber: body.mobileNumber,
      teamId: assignments.teamId,
      businessHoursId: assignments.businessHoursId,
      shiftTypes: assignments.shiftTypes,
      productAccess: assignments.productAccess,
      primaryLanguage: body.primaryLanguage,
      secondaryLanguage: body.secondaryLanguage,
      skill: body.skill,
      locationId: body.locationId,
      status: body.status,
    });
    await syncUserTeamMembership(
      customerUser.organizationId,
      id,
      existing.team_id || null,
      assignments.teamId,
      client,
    );
    return updated;
  });

  let invite = null;
  let inviteError = null;
  let accessNotified = false;
  let accessNotifyError = null;

  const hadAccess = previousAccess.length > 0;
  const hasAccess = assignments.productAccess.length > 0;
  const inviteStatus = existing.invite_status || "pending";
  const accessDiff = diffProductAccess(previousAccess, assignments.productAccess);

  if (hasAccess && !hadAccess && (inviteStatus === "pending" || inviteStatus === "invited")) {
    try {
      const { issueSetupUserInvite } = await import("./setupUserInvite.js");
      invite = await issueSetupUserInvite(customerUser, id);
    } catch (err) {
      inviteError = err.message || "Failed to send invite email.";
    }
  } else if (inviteStatus === "active" && accessDiff.changed) {
    try {
      const { notifySetupUserAccessChanged } = await import("./notifications.js");
      const profile = await repo.selectBusinessProfile(pool, customerUser.organizationId);
      const result = await notifySetupUserAccessChanged({
        toEmail: (invite?.user || row).work_email || existing.work_email,
        firstName: (invite?.user || row).first_name || existing.first_name,
        orgName: profile?.company_name || "Your organization",
        addedNames: accessDiff.addedNames,
        removedNames: accessDiff.removedNames,
        currentNames: accessDiff.currentNames,
      });
      accessNotified = Boolean(result?.sent);
    } catch (err) {
      accessNotifyError = err.message || "Failed to send access notification email.";
    }
  }

  return {
    user: mapUser(invite?.user || row),
    inviteSent: Boolean(invite?.invited),
    inviteError,
    accessNotified,
    accessNotifyError,
  };
}

export async function resendUserInvite(customerUser, id) {
  const { issueSetupUserInvite } = await import("./setupUserInvite.js");
  const result = await issueSetupUserInvite(customerUser, id, {
    requirePendingOrInvited: true,
  });
  return {
    user: mapUser(result.user),
    inviteSent: true,
    email: result.email,
    expiresAt: result.expiresAt,
  };
}

export async function removeUser(customerUser, id) {
  assertOrgAdmin(customerUser);
  const existing = await repo.getUserById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }
  await syncUserTeamMembership(
    customerUser.organizationId,
    id,
    existing.team_id || null,
    null,
  );
  const ok = await repo.deleteUser(pool, customerUser.organizationId, id);
  if (!ok) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }
}
