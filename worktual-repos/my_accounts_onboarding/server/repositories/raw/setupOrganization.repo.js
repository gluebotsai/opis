function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectBusinessProfile(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, company_name, industry_type, business_type, country, company_size,
            website_url, contact_name, work_email, mobile_country_code, mobile_number
     FROM organizations WHERE id = $1`,
    [organizationId],
  );
  return rows[0] || null;
}

export async function updateBusinessProfile(runner, organizationId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE organizations SET
       company_name = $2,
       industry_type = $3,
       business_type = $4,
       country = $5,
       company_size = $6,
       website_url = $7,
       contact_name = $8,
       work_email = $9,
       mobile_number = $10,
       mobile_country_code = COALESCE($11, mobile_country_code),
       updated_at = NOW()
     WHERE id = $1
     RETURNING id, company_name, industry_type, business_type, country, company_size,
               website_url, contact_name, work_email, mobile_country_code, mobile_number`,
    [
      organizationId,
      fields.companyName,
      fields.industryType,
      fields.businessType,
      fields.country,
      fields.companySize,
      fields.websiteUrl,
      fields.contactName,
      fields.workEmail,
      fields.mobileNumber,
      fields.mobileCountryCode || null,
    ],
  );
  return rows[0] || null;
}

export async function listBranches(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, organization_id, label, address, city, country, timezone, is_primary, status
     FROM organization_locations
     WHERE organization_id = $1
     ORDER BY is_primary DESC, label`,
    [organizationId],
  );
  return rows;
}

export async function insertBranch(runner, organizationId, fields) {
  const id = fields.id || `loc-${Date.now()}`;
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO organization_locations (
       id, organization_id, label, address, city, country, timezone, is_primary, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
     RETURNING id, organization_id, label, address, city, country, timezone, is_primary, status`,
    [
      id,
      organizationId,
      fields.name,
      fields.address || null,
      fields.city || null,
      fields.country || null,
      fields.timezone || null,
      Boolean(fields.isPrimary),
    ],
  );
  return rows[0];
}

export async function updateBranch(runner, organizationId, branchId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE organization_locations SET
       label = COALESCE($3, label),
       address = COALESCE($4, address),
       city = COALESCE($5, city),
       country = COALESCE($6, country),
       timezone = COALESCE($7, timezone),
       is_primary = COALESCE($8, is_primary)
     WHERE organization_id = $1 AND id = $2
     RETURNING id, organization_id, label, address, city, country, timezone, is_primary, status`,
    [
      organizationId,
      branchId,
      fields.name ?? null,
      fields.address ?? null,
      fields.city ?? null,
      fields.country ?? null,
      fields.timezone ?? null,
      fields.isPrimary === undefined ? null : Boolean(fields.isPrimary),
    ],
  );
  return rows[0] || null;
}

export async function deleteBranch(runner, organizationId, branchId) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM organization_locations WHERE organization_id = $1 AND id = $2 AND is_primary = FALSE`,
    [organizationId, branchId],
  );
  return rowCount > 0;
}

export async function listHolidayCalendars(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT c.*, COALESCE(
       (SELECT json_agg(json_build_object(
          'id', h.id,
          'name', h.name,
          'holidayDate', to_char(h.holiday_date, 'YYYY-MM-DD')
        ) ORDER BY h.holiday_date)
        FROM setup_holidays h WHERE h.calendar_id = c.id),
       '[]'::json
     ) AS holidays
     FROM setup_holiday_calendars c
     WHERE c.organization_id = $1
     ORDER BY c.name`,
    [organizationId],
  );
  return rows;
}

export async function insertHolidayCalendar(runner, organizationId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_holiday_calendars (organization_id, name, country)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [organizationId, fields.name, fields.country || null],
  );
  return rows[0];
}

export async function insertHoliday(runner, calendarId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_holidays (calendar_id, name, holiday_date)
     VALUES ($1,$2,$3)
     RETURNING id, calendar_id, name, holiday_date`,
    [calendarId, fields.name, fields.holidayDate],
  );
  return rows[0];
}

export async function listBusinessHours(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT bh.*,
       COALESCE(
         (SELECT json_agg(json_build_object(
            'id', s.id,
            'shiftType', s.shift_type,
            'dayOfWeek', s.day_of_week,
            'startDayOfWeek', s.day_of_week,
            'endDayOfWeek', COALESCE(s.end_day_of_week, s.day_of_week),
            'startTime', s.start_time,
            'endTime', s.end_time,
            'breakStartTime', s.break_start_time,
            'breakEndTime', s.break_end_time,
            'breakStartTime2', s.break_start_time_2,
            'breakEndTime2', s.break_end_time_2,
            'crossesMidnight', s.crosses_midnight
          ) ORDER BY s.day_of_week, s.start_time)
          FROM setup_business_hour_shifts s WHERE s.business_hours_id = bh.id),
         '[]'::json
       ) AS shifts
     FROM setup_business_hours bh
     WHERE bh.organization_id = $1
     ORDER BY bh.name`,
    [organizationId],
  );
  return rows;
}

export async function insertBusinessHours(runner, organizationId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_business_hours (
       organization_id, name, description, timezone, open_time, close_time, working_days,
       holiday_calendar_id, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     RETURNING *`,
    [
      organizationId,
      fields.name,
      fields.description || null,
      fields.timezone || null,
      fields.openTime || "09:00",
      fields.closeTime || "22:00",
      JSON.stringify(fields.workingDays || []),
      fields.holidayCalendarId || null,
      fields.status || "active",
    ],
  );
  return rows[0];
}

export async function updateBusinessHours(runner, organizationId, id, fields) {
  const clearOrSetHoliday = Object.prototype.hasOwnProperty.call(fields, "holidayCalendarId");
  const { rows } = await runnerQuery(runner).query(
    `UPDATE setup_business_hours SET
       name = COALESCE($3, name),
       description = COALESCE($4, description),
       timezone = COALESCE($5, timezone),
       open_time = COALESCE($6::time, open_time),
       close_time = COALESCE($7::time, close_time),
       working_days = COALESCE($8::jsonb, working_days),
       holiday_calendar_id = CASE WHEN $11::boolean THEN $9::uuid ELSE holiday_calendar_id END,
       status = COALESCE($10, status),
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [
      organizationId,
      id,
      fields.name ?? null,
      fields.description ?? null,
      fields.timezone ?? null,
      fields.openTime ?? null,
      fields.closeTime ?? null,
      fields.workingDays === undefined ? null : JSON.stringify(fields.workingDays),
      fields.holidayCalendarId || null,
      fields.status ?? null,
      clearOrSetHoliday,
    ],
  );
  return rows[0] || null;
}

export async function deleteBusinessHours(runner, organizationId, id) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM setup_business_hours WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return rowCount > 0;
}

export async function replaceShifts(runner, businessHoursId, shifts) {
  await runnerQuery(runner).query(
    `DELETE FROM setup_business_hour_shifts WHERE business_hours_id = $1`,
    [businessHoursId],
  );
  const created = [];
  for (const shift of shifts || []) {
    const { rows } = await runnerQuery(runner).query(
      `INSERT INTO setup_business_hour_shifts (
         business_hours_id, shift_type, day_of_week, end_day_of_week, start_time, end_time,
         break_start_time, break_end_time, break_start_time_2, break_end_time_2, crosses_midnight
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, shift_type, day_of_week, end_day_of_week, start_time, end_time,
                 break_start_time, break_end_time, break_start_time_2, break_end_time_2, crosses_midnight`,
      [
        businessHoursId,
        shift.shiftType || "Regular",
        shift.startDayOfWeek || shift.dayOfWeek,
        shift.endDayOfWeek || shift.startDayOfWeek || shift.dayOfWeek,
        shift.startTime,
        shift.endTime,
        shift.breakStartTime || null,
        shift.breakEndTime || null,
        shift.breakStartTime2 || null,
        shift.breakEndTime2 || null,
        Boolean(shift.crossesMidnight),
      ],
    );
    created.push(rows[0]);
  }
  return created;
}

export async function listTeams(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM setup_teams WHERE organization_id = $1 ORDER BY name`,
    [organizationId],
  );
  return rows;
}

export async function insertTeam(runner, organizationId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_teams (
       organization_id, name, description, business_hours_id, member_ids, available_products, status
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
     RETURNING *`,
    [
      organizationId,
      fields.name,
      fields.description || null,
      fields.businessHoursId || null,
      JSON.stringify(fields.memberIds || []),
      JSON.stringify(fields.availableProducts || []),
      fields.status || "active",
    ],
  );
  return rows[0];
}

export async function updateTeam(runner, organizationId, id, fields) {
  const clearBusinessHours = Boolean(fields.clearBusinessHours);
  const { rows } = await runnerQuery(runner).query(
    `UPDATE setup_teams SET
       name = COALESCE($3, name),
       description = COALESCE($4, description),
       business_hours_id = CASE
         WHEN $8::boolean THEN NULL
         ELSE COALESCE($5::uuid, business_hours_id)
       END,
       member_ids = COALESCE($6::jsonb, member_ids),
       available_products = COALESCE($7::jsonb, available_products),
       status = COALESCE($9, status),
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [
      organizationId,
      id,
      fields.name ?? null,
      fields.description ?? null,
      fields.businessHoursId ?? null,
      fields.memberIds === undefined ? null : JSON.stringify(fields.memberIds),
      fields.availableProducts === undefined ? null : JSON.stringify(fields.availableProducts),
      clearBusinessHours,
      fields.status ?? null,
    ],
  );
  return rows[0] || null;
}

export async function deleteTeam(runner, organizationId, id) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM setup_teams WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return rowCount > 0;
}

export async function listRoles(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM setup_roles WHERE organization_id = $1 ORDER BY name`,
    [organizationId],
  );
  return rows;
}

export async function findRoleByProductAndName(
  runner,
  organizationId,
  productId,
  name,
  excludeId = null,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, name, product_id
     FROM setup_roles
     WHERE organization_id = $1
       AND product_id = $2
       AND lower(name) = lower($3)
       AND ($4::uuid IS NULL OR id <> $4)
     LIMIT 1`,
    [organizationId, productId, name, excludeId],
  );
  return rows[0] || null;
}

export async function insertRole(runner, organizationId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_roles (
       organization_id, name, description, product_id, accessible_products,
       can_view, can_create, can_edit, can_delete, can_export, module_permissions
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb)
     RETURNING *`,
    [
      organizationId,
      fields.name,
      fields.description || null,
      fields.productId || null,
      JSON.stringify(fields.productId ? [fields.productId] : []),
      fields.canView !== false,
      Boolean(fields.canCreate),
      Boolean(fields.canEdit),
      Boolean(fields.canDelete),
      Boolean(fields.canExport),
      JSON.stringify(Array.isArray(fields.modulePermissions) ? fields.modulePermissions : []),
    ],
  );
  return rows[0];
}

export async function updateRole(runner, organizationId, id, fields) {
  const accessibleProducts =
    fields.productId !== undefined
      ? JSON.stringify(fields.productId ? [fields.productId] : [])
      : null;
  const modulePermissions =
    fields.modulePermissions !== undefined
      ? JSON.stringify(Array.isArray(fields.modulePermissions) ? fields.modulePermissions : [])
      : null;
  const { rows } = await runnerQuery(runner).query(
    `UPDATE setup_roles SET
       name = COALESCE($3, name),
       description = COALESCE($4, description),
       product_id = COALESCE($5, product_id),
       accessible_products = COALESCE($6::jsonb, accessible_products),
       can_view = COALESCE($7, can_view),
       can_create = COALESCE($8, can_create),
       can_edit = COALESCE($9, can_edit),
       can_delete = COALESCE($10, can_delete),
       can_export = COALESCE($11, can_export),
       module_permissions = COALESCE($12::jsonb, module_permissions),
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [
      organizationId,
      id,
      fields.name ?? null,
      fields.description ?? null,
      fields.productId ?? null,
      accessibleProducts,
      fields.canView === undefined ? null : Boolean(fields.canView),
      fields.canCreate === undefined ? null : Boolean(fields.canCreate),
      fields.canEdit === undefined ? null : Boolean(fields.canEdit),
      fields.canDelete === undefined ? null : Boolean(fields.canDelete),
      fields.canExport === undefined ? null : Boolean(fields.canExport),
      modulePermissions,
    ],
  );
  return rows[0] || null;
}

export async function deleteRole(runner, organizationId, id) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM setup_roles WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return rowCount > 0;
}

const USER_SELECT_WITH_PRODUCT_ACCESS = `
  SELECT u.*,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('productId', upa.product_id, 'roleId', upa.role_id)
          ORDER BY upa.product_id
        )
        FROM setup_user_product_access upa
        WHERE upa.user_id = u.id
      ),
      '[]'::jsonb
    ) AS product_access
  FROM setup_users u
`;

export async function listUsers(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `${USER_SELECT_WITH_PRODUCT_ACCESS}
     WHERE u.organization_id = $1
     ORDER BY u.first_name, u.last_name`,
    [organizationId],
  );
  return rows;
}

export async function listUserProductAccess(runner, organizationId, userId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT product_id AS "productId", role_id AS "roleId"
     FROM setup_user_product_access
     WHERE organization_id = $1 AND user_id = $2
     ORDER BY product_id`,
    [organizationId, userId],
  );
  return rows;
}

export async function replaceUserProductAccess(runner, organizationId, userId, productAccess = []) {
  await runnerQuery(runner).query(
    `DELETE FROM setup_user_product_access
     WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId],
  );
  const grants = Array.isArray(productAccess) ? productAccess : [];
  for (const grant of grants) {
    const productId = String(grant?.productId || "").trim();
    const roleId = String(grant?.roleId || "").trim();
    if (!productId || !roleId) continue;
    await runnerQuery(runner).query(
      `INSERT INTO setup_user_product_access (organization_id, user_id, product_id, role_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, product_id) DO UPDATE
       SET role_id = EXCLUDED.role_id`,
      [organizationId, userId, productId, roleId],
    );
  }
}

export async function insertUser(runner, organizationId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_users (
       organization_id, employee_id, first_name, last_name, work_email, mobile_number,
       team_id, business_hours_id, shift_types,
       primary_language, secondary_language, skill, location_id, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      organizationId,
      fields.employeeId || null,
      fields.firstName,
      fields.lastName,
      fields.workEmail,
      fields.mobileNumber || null,
      fields.teamId || null,
      fields.businessHoursId || null,
      JSON.stringify(fields.shiftTypes || []),
      fields.primaryLanguage || null,
      fields.secondaryLanguage || null,
      fields.skill || null,
      fields.locationId || null,
      fields.status || "active",
    ],
  );
  const row = rows[0];
  if (row && fields.productAccess !== undefined) {
    await replaceUserProductAccess(runner, organizationId, row.id, fields.productAccess);
  }
  return getUserById(runner, organizationId, row.id);
}

export async function updateUser(runner, organizationId, id, fields) {
  const clearTeam = Object.prototype.hasOwnProperty.call(fields, "teamId");
  const clearBusinessHours = Object.prototype.hasOwnProperty.call(fields, "businessHoursId");
  const { rows } = await runnerQuery(runner).query(
    `UPDATE setup_users SET
       employee_id = COALESCE($3, employee_id),
       first_name = COALESCE($4, first_name),
       last_name = COALESCE($5, last_name),
       work_email = COALESCE($6, work_email),
       mobile_number = COALESCE($7, mobile_number),
       team_id = CASE WHEN $15::boolean THEN $8::uuid ELSE team_id END,
       business_hours_id = CASE WHEN $16::boolean THEN $9::uuid ELSE business_hours_id END,
       shift_types = COALESCE($10::jsonb, shift_types),
       primary_language = COALESCE($11, primary_language),
       secondary_language = COALESCE($12, secondary_language),
       skill = COALESCE($13, skill),
       location_id = COALESCE($14, location_id),
       status = COALESCE($17, status),
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [
      organizationId,
      id,
      fields.employeeId ?? null,
      fields.firstName ?? null,
      fields.lastName ?? null,
      fields.workEmail ?? null,
      fields.mobileNumber ?? null,
      fields.teamId || null,
      fields.businessHoursId || null,
      fields.shiftTypes === undefined ? null : JSON.stringify(fields.shiftTypes),
      fields.primaryLanguage ?? null,
      fields.secondaryLanguage ?? null,
      fields.skill ?? null,
      fields.locationId ?? null,
      clearTeam,
      clearBusinessHours,
      fields.status ?? null,
    ],
  );
  if (!rows[0]) return null;
  if (fields.productAccess !== undefined) {
    await replaceUserProductAccess(runner, organizationId, id, fields.productAccess);
  }
  return getUserById(runner, organizationId, id);
}

export async function deleteUser(runner, organizationId, id) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM setup_users WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return rowCount > 0;
}

export async function invalidateUnusedInviteTokens(runner, userId) {
  await runnerQuery(runner).query(
    `UPDATE setup_user_invite_tokens
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
}

export async function insertInviteToken(runner, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_user_invite_tokens (
       organization_id, user_id, token_hash, expires_at, created_by
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      fields.organizationId,
      fields.userId,
      fields.tokenHash,
      fields.expiresAt,
      fields.createdBy || null,
    ],
  );
  return rows[0];
}

export async function findInviteByTokenHash(runner, tokenHash) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT t.*,
            u.first_name, u.last_name, u.work_email, u.invite_status, u.status AS user_status,
            u.organization_id AS user_organization_id,
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object('productId', upa.product_id, 'roleId', upa.role_id)
                  ORDER BY upa.product_id
                )
                FROM setup_user_product_access upa
                WHERE upa.user_id = u.id
              ),
              '[]'::jsonb
            ) AS product_access,
            o.company_name
     FROM setup_user_invite_tokens t
     JOIN setup_users u ON u.id = t.user_id
     JOIN organizations o ON o.id = t.organization_id
     WHERE t.token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );
  return rows[0] || null;
}

export async function markInviteTokenUsed(runner, tokenId) {
  await runnerQuery(runner).query(
    `UPDATE setup_user_invite_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`,
    [tokenId],
  );
}

export async function setUserPasswordAndActivate(runner, organizationId, userId, passwordHash) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE setup_users SET
       password_hash = $3,
       invite_status = 'active',
       password_set_at = NOW(),
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [organizationId, userId, passwordHash],
  );
  return rows[0] || null;
}

export async function markUserInvited(runner, organizationId, userId) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE setup_users SET
       invite_status = 'invited',
       invited_at = NOW(),
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [organizationId, userId],
  );
  return rows[0] || null;
}

export async function getRoleById(runner, organizationId, id) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM setup_roles WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return rows[0] || null;
}

export async function getUserById(runner, organizationId, id) {
  const { rows } = await runnerQuery(runner).query(
    `${USER_SELECT_WITH_PRODUCT_ACCESS}
     WHERE u.organization_id = $1 AND u.id = $2`,
    [organizationId, id],
  );
  return rows[0] || null;
}

export async function getTeamById(runner, organizationId, id) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM setup_teams WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  return rows[0] || null;
}

export async function listShiftTypesForBusinessHours(runner, organizationId, businessHoursId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT DISTINCT s.shift_type
     FROM setup_business_hour_shifts s
     INNER JOIN setup_business_hours bh ON bh.id = s.business_hours_id
     WHERE bh.organization_id = $1 AND bh.id = $2
     ORDER BY s.shift_type`,
    [organizationId, businessHoursId],
  );
  return rows.map((row) => row.shift_type).filter(Boolean);
}

export async function setTeamMemberIds(runner, organizationId, teamId, memberIds) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE setup_teams
     SET member_ids = $3::jsonb, updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [organizationId, teamId, JSON.stringify(memberIds || [])],
  );
  return rows[0] || null;
}
