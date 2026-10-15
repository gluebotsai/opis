/**
 * ClickHouse-only identity: dim_known_users + dim_sessions.user_id.
 * Column aliases match CDP_IDENTITY_SELECT_SQL for buildVisitorCdpProfile().
 */
/** Pick user: explicit selectedUserId param, else latest known on visitor, else session. */
export const KNOWN_USER_PICK_USER_ID_SQL = `
  if(
    length({selectedUserId:String}) > 0,
    {selectedUserId:String},
    coalesce(nullIf(ku_pick.pick_user_id, ''), nullIf(wt_sess.session_user_id, ''))
  )`;
/** Resolved user_id on profile row (ku row, pick, or session). No scalar subqueries — CH cannot correlate ku_pick.pick_user_id inside SELECT subqueries. */
export const KNOWN_USER_RESOLVED_USER_ID_SQL = `
  coalesce(
    nullIf(ku.user_id, ''),
    nullIf(ku_pick.pick_user_id, ''),
    nullIf(wt_sess.session_user_id, '')
  )`;
export const KNOWN_USER_LINKED_VISITOR_IDS_ARRAY_SQL = `
  coalesce(ku_linked.linked_visitor_ids, emptyArrayString())`;
export const KNOWN_USER_LINKED_VISITOR_IDS_COUNT_SQL = `
  toUInt32(length(${KNOWN_USER_LINKED_VISITOR_IDS_ARRAY_SQL}))`;
export const KNOWN_USER_LINKED_PROFILES_COUNT_FOR_VISITOR_SQL = `
  toUInt32(
    greatest(
      coalesce(ku_pick.known_account_cnt, toUInt64(0)),
      toUInt64(length(${KNOWN_USER_LINKED_VISITOR_IDS_ARRAY_SQL})),
      if(length(${KNOWN_USER_RESOLVED_USER_ID_SQL}) > 0, toUInt64(1), toUInt64(0))
    )
  )`;
export const KNOWN_USER_IDENTITY_SELECT_SQL = `
  if(
    length(${KNOWN_USER_RESOLVED_USER_ID_SQL}) > 0,
    concat('wt:', toString({websiteId:UInt32}), ':', ${KNOWN_USER_RESOLVED_USER_ID_SQL}),
    ''
  ) AS cdp_id,
  coalesce(nullIf(ku.method, ''), if(length(${KNOWN_USER_RESOLVED_USER_ID_SQL}) > 0, 'User', '')) AS contact_type,
  coalesce(nullIf(ku.first_name, ''), '') AS cdp_first_name,
  coalesce(nullIf(ku.last_name, ''), '') AS cdp_last_name,
  coalesce(nullIf(ku.email, ''), '') AS cdp_primary_email,
  coalesce(nullIf(ku.phone, ''), '') AS cdp_primary_phone,
  '' AS cdp_company,
  '' AS cdp_acquisition_channel,
  ${KNOWN_USER_RESOLVED_USER_ID_SQL} AS webtracking_user_id,
  (length(${KNOWN_USER_RESOLVED_USER_ID_SQL}) > 0) AS is_cdp_known,
  ${KNOWN_USER_LINKED_VISITOR_IDS_COUNT_SQL} AS linked_visitor_ids_count,
  ${KNOWN_USER_LINKED_VISITOR_IDS_ARRAY_SQL} AS linked_visitor_ids
`;
const KNOWN_USER_PICK_AND_SESSION_JOINS = (visitorIdExpr) => `
            LEFT JOIN (
                SELECT
                    website_id,
                    visitor_id,
                    argMax(user_id, last_identified_at) AS pick_user_id,
                    uniqExact(user_id) AS known_account_cnt
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                GROUP BY website_id, visitor_id
            ) AS ku_pick
              ON ku_pick.website_id = {websiteId:UInt32}
             AND ku_pick.visitor_id = ${visitorIdExpr}
            LEFT JOIN (
                SELECT
                    visitor_id,
                    argMax(user_id, started_at) AS session_user_id
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                GROUP BY visitor_id
            ) AS wt_sess
              ON wt_sess.visitor_id = ${visitorIdExpr}
            LEFT JOIN dim_known_users AS ku FINAL
              ON ku.website_id = {websiteId:UInt32}
             AND ku.visitor_id = ${visitorIdExpr}
             AND ku.user_id = ${KNOWN_USER_PICK_USER_ID_SQL}
            LEFT JOIN (
                SELECT
                    website_id,
                    user_id,
                    groupUniqArray(visitor_id) AS linked_visitor_ids
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                  AND length(visitor_id) > 0
                GROUP BY website_id, user_id
            ) AS ku_linked
              ON ku_linked.website_id = {websiteId:UInt32}
             AND ku_linked.user_id = ${KNOWN_USER_RESOLVED_USER_ID_SQL}
`;
/** Join profile onto dim_visitors list/detail rows. */
export function knownUserIdentificationJoinSql(visitorIdExpr = "v.visitor_id") {
    return `${KNOWN_USER_PICK_AND_SESSION_JOINS(visitorIdExpr)}`;
}
/** Last session on this browser (includes empty user_id = anonymous). */
export const KNOWN_USER_LIST_LAST_SESSION_USER_ID_SQL = `nullIf(wt_last.last_session_user_id, '')`;
/**
 * Unified visitor profile user_id: account on the most recently active session
 * (dim_sessions + fact events). Does not use fact_replay_chunks.
 */
export const VISITOR_RECENT_SESSION_USER_SUBQUERY = `
            SELECT
                visitor_id,
                argMax(session_user_id, tuple(last_activity_at, session_id)) AS last_session_user_id
            FROM (
                SELECT
                    s.visitor_id AS visitor_id,
                    s.session_id AS session_id,
                    nullIf(s.user_id, '') AS session_user_id,
                    greatest(
                        s.updated_at,
                        coalesce(s.ended_at, s.updated_at),
                        coalesce(fact.last_fact_at, toDateTime64('1970-01-01', 3, 'UTC'))
                    ) AS last_activity_at
                FROM dim_sessions AS s FINAL
                LEFT JOIN (
                    SELECT session_id, max(event_ts) AS last_fact_at
                    FROM (
                        SELECT session_id, created_at AS event_ts
                        FROM fact_page_views
                        WHERE website_id = {websiteId:UInt32}
                        UNION ALL
                        SELECT session_id, created_at AS event_ts
                        FROM fact_interaction_events
                        WHERE website_id = {websiteId:UInt32}
                        UNION ALL
                        SELECT session_id, created_at AS event_ts
                        FROM fact_custom_events
                        WHERE website_id = {websiteId:UInt32}
                        UNION ALL
                        SELECT session_id, created_at AS event_ts
                        FROM fact_product_interactions
                        WHERE website_id = {websiteId:UInt32}
                    )
                    GROUP BY session_id
                ) AS fact ON fact.session_id = s.session_id
                WHERE s.website_id = {websiteId:UInt32}
            )
            GROUP BY visitor_id
`;
export const KNOWN_USER_LIST_RESOLVED_USER_ID_SQL = KNOWN_USER_LIST_LAST_SESSION_USER_ID_SQL;
const KNOWN_USER_LIST_JOINS = (visitorIdExpr) => `
            LEFT JOIN (
                SELECT
                    website_id,
                    visitor_id,
                    argMax(user_id, last_identified_at) AS pick_user_id,
                    uniqExact(user_id) AS known_account_cnt
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                GROUP BY website_id, visitor_id
            ) AS ku_pick
              ON ku_pick.website_id = {websiteId:UInt32}
             AND ku_pick.visitor_id = ${visitorIdExpr}
            LEFT JOIN (
                ${VISITOR_RECENT_SESSION_USER_SUBQUERY}
            ) AS wt_last
              ON wt_last.visitor_id = ${visitorIdExpr}
            LEFT JOIN dim_known_users AS ku FINAL
              ON ku.website_id = {websiteId:UInt32}
             AND ku.visitor_id = ${visitorIdExpr}
             AND ku.user_id = wt_last.last_session_user_id
             AND length(wt_last.last_session_user_id) > 0
            LEFT JOIN (
                SELECT
                    website_id,
                    user_id,
                    argMax(first_name, last_identified_at) AS first_name,
                    argMax(last_name, last_identified_at) AS last_name,
                    argMax(email, last_identified_at) AS email,
                    argMax(phone, last_identified_at) AS phone,
                    argMax(method, last_identified_at) AS method,
                    argMax(traits_json, last_identified_at) AS traits_json
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                GROUP BY website_id, user_id
            ) AS ku_uid
              ON ku_uid.website_id = {websiteId:UInt32}
             AND ku_uid.user_id = ${KNOWN_USER_LIST_RESOLVED_USER_ID_SQL}
             AND length(${KNOWN_USER_LIST_RESOLVED_USER_ID_SQL}) > 0
            LEFT JOIN (
                SELECT
                    website_id,
                    user_id,
                    groupUniqArray(visitor_id) AS linked_visitor_ids
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                  AND length(visitor_id) > 0
                GROUP BY website_id, user_id
            ) AS ku_linked
              ON ku_linked.website_id = {websiteId:UInt32}
             AND ku_linked.user_id = ${KNOWN_USER_LIST_RESOLVED_USER_ID_SQL}
`;
/** Visitors / Live / replay list: profile = user on most recent session (dim_sessions + facts). */
export function knownUserListIdentificationJoinSql(visitorIdExpr = "v.visitor_id") {
    return `${KNOWN_USER_LIST_JOINS(visitorIdExpr)}`;
}
export const KNOWN_USER_LIST_LINKED_PROFILES_COUNT_SQL = `
  toUInt32(
    greatest(
      coalesce(ku_pick.known_account_cnt, toUInt64(0)),
      toUInt64(length(coalesce(ku_linked.linked_visitor_ids, emptyArrayString()))),
      if(length(${KNOWN_USER_LIST_RESOLVED_USER_ID_SQL}) > 0, toUInt64(1), toUInt64(0))
    )
  )`;
export const KNOWN_USER_LIST_IDENTITY_SELECT_SQL = `
  if(
    length(${KNOWN_USER_LIST_RESOLVED_USER_ID_SQL}) > 0,
    concat('wt:', toString({websiteId:UInt32}), ':', ${KNOWN_USER_LIST_RESOLVED_USER_ID_SQL}),
    ''
  ) AS cdp_id,
  coalesce(nullIf(ku.method, ''), nullIf(ku_uid.method, ''), nullIf(ku.last_event_type, ''), '') AS contact_type,
  coalesce(nullIf(ku.first_name, ''), nullIf(ku_uid.first_name, ''), '') AS cdp_first_name,
  coalesce(nullIf(ku.last_name, ''), nullIf(ku_uid.last_name, ''), '') AS cdp_last_name,
  coalesce(nullIf(ku.email, ''), nullIf(ku_uid.email, ''), '') AS cdp_primary_email,
  coalesce(nullIf(ku.phone, ''), nullIf(ku_uid.phone, ''), '') AS cdp_primary_phone,
  coalesce(nullIf(ku.traits_json, ''), nullIf(ku_uid.traits_json, ''), '') AS traits_json,
  '' AS cdp_company,
  '' AS cdp_acquisition_channel,
  ${KNOWN_USER_LIST_RESOLVED_USER_ID_SQL} AS webtracking_user_id,
  (length(${KNOWN_USER_LIST_RESOLVED_USER_ID_SQL}) > 0) AS is_cdp_known,
  toUInt32(length(coalesce(ku_linked.linked_visitor_ids, emptyArrayString()))) AS linked_visitor_ids_count,
  coalesce(ku_linked.linked_visitor_ids, emptyArrayString()) AS linked_visitor_ids
`;
/**
 * Logged-in user for this session only: dim_sessions.user_id unless the latest auth event is logout.
 * Falls back to login/identify user_id when dim_sessions has not caught up yet.
 */
export const SESSION_EFFECTIVE_USER_ID_SQL = `
  multiIf(
    sa.last_auth_event = 'logout', '',
    length(nullIf(ds.user_id, '')) > 0, nullIf(ds.user_id, ''),
    sa.last_auth_event IN ('login', 'identify'), nullIf(sa.last_auth_user_id, ''),
    ''
  )`;
export function sessionAuthStateJoinSql(sessionIdExpr) {
    return `
            LEFT JOIN (
                SELECT
                    session_id,
                    argMax(event_name, created_at) AS last_auth_event,
                    argMaxIf(user_id, created_at, length(user_id) > 0) AS last_auth_user_id
                FROM fact_custom_events
                WHERE website_id = {websiteId:UInt32}
                  AND event_name IN ('login', 'logout', 'identify')
                  AND session_id IN {sessionIds:Array(String)}
                GROUP BY session_id
            ) AS sa
              ON sa.session_id = ${sessionIdExpr}`;
}
/** Live / Visitors list: session-scoped profile with logout-aware effective user_id. */
export function knownUserSessionDisplayIdentificationJoinSql(sessionIdExpr, visitorIdExpr) {
    const sessionProfileUserIdSql = SESSION_EFFECTIVE_USER_ID_SQL;
    return `
            LEFT JOIN dim_sessions AS ds FINAL
              ON ds.website_id = {websiteId:UInt32}
             AND ds.session_id = ${sessionIdExpr}
            ${sessionAuthStateJoinSql(sessionIdExpr)}
            LEFT JOIN dim_known_users AS ku FINAL
              ON ku.website_id = {websiteId:UInt32}
             AND ku.visitor_id = ${visitorIdExpr}
             AND ku.user_id = ${sessionProfileUserIdSql}
             AND length(${sessionProfileUserIdSql}) > 0
            LEFT JOIN (
                SELECT
                    website_id,
                    user_id,
                    argMax(first_name, last_identified_at) AS first_name,
                    argMax(last_name, last_identified_at) AS last_name,
                    argMax(email, last_identified_at) AS email,
                    argMax(phone, last_identified_at) AS phone,
                    argMax(method, last_identified_at) AS method,
                    argMax(traits_json, last_identified_at) AS traits_json
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                GROUP BY website_id, user_id
            ) AS ku_uid
              ON ku_uid.website_id = {websiteId:UInt32}
             AND ku_uid.user_id = ${sessionProfileUserIdSql}
             AND length(${sessionProfileUserIdSql}) > 0
`;
}
export const KNOWN_USER_SESSION_DISPLAY_IDENTITY_SELECT_SQL = `
  if(
    length(${SESSION_EFFECTIVE_USER_ID_SQL}) > 0,
    concat(
      'wt:',
      toString({websiteId:UInt32}),
      ':',
      ${SESSION_EFFECTIVE_USER_ID_SQL}
    ),
    ''
  ) AS cdp_id,
  coalesce(nullIf(ku.method, ''), nullIf(ku_uid.method, ''), if(length(${SESSION_EFFECTIVE_USER_ID_SQL}) > 0, 'User', '')) AS contact_type,
  coalesce(nullIf(ku.first_name, ''), nullIf(ku_uid.first_name, ''), '') AS cdp_first_name,
  coalesce(nullIf(ku.last_name, ''), nullIf(ku_uid.last_name, ''), '') AS cdp_last_name,
  coalesce(nullIf(ku.email, ''), nullIf(ku_uid.email, ''), '') AS cdp_primary_email,
  coalesce(nullIf(ku.phone, ''), nullIf(ku_uid.phone, ''), '') AS cdp_primary_phone,
  coalesce(nullIf(ku.traits_json, ''), nullIf(ku_uid.traits_json, ''), '') AS traits_json,
  '' AS cdp_company,
  '' AS cdp_acquisition_channel,
  ${SESSION_EFFECTIVE_USER_ID_SQL} AS webtracking_user_id,
  (length(${SESSION_EFFECTIVE_USER_ID_SQL}) > 0) AS is_cdp_known,
  toUInt32(0) AS linked_visitor_ids_count,
  emptyArrayString() AS linked_visitor_ids
`;
/** Session replay / sessions list: profile for the user active in that session. */
export function knownUserSessionIdentificationJoinSql(sessionIdExpr, visitorIdExpr) {
    /** dim_sessions.user_id only — no visitor-level fallback (multi-account same browser). */
    const sessionProfileUserIdSql = `nullIf(ds.user_id, '')`;
    return `
            LEFT JOIN dim_sessions AS ds FINAL
              ON ds.website_id = {websiteId:UInt32}
             AND ds.session_id = ${sessionIdExpr}
            LEFT JOIN dim_known_users AS ku FINAL
              ON ku.website_id = {websiteId:UInt32}
             AND ku.visitor_id = ${visitorIdExpr}
             AND ku.user_id = ${sessionProfileUserIdSql}
             AND length(${sessionProfileUserIdSql}) > 0
            LEFT JOIN (
                SELECT
                    website_id,
                    user_id,
                    argMax(first_name, last_identified_at) AS first_name,
                    argMax(last_name, last_identified_at) AS last_name,
                    argMax(email, last_identified_at) AS email,
                    argMax(phone, last_identified_at) AS phone,
                    argMax(method, last_identified_at) AS method,
                    argMax(traits_json, last_identified_at) AS traits_json
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                GROUP BY website_id, user_id
            ) AS ku_uid
              ON ku_uid.website_id = {websiteId:UInt32}
             AND ku_uid.user_id = ${sessionProfileUserIdSql}
             AND length(${sessionProfileUserIdSql}) > 0
`;
}
/** Resolved login for this session (replay chunks often have empty user_id). */
export const REPLAY_LIST_RESOLVED_USER_ID_SQL = `coalesce(
  nullIf(base.session_user_id, ''),
  nullIf(ds.user_id, '')
)`;
/** Replay list: session-scoped identity from chunks + dim_sessions. */
export function replayListProfileJoinSql(visitorIdExpr) {
    return `
            LEFT JOIN dim_sessions AS ds FINAL
              ON ds.website_id = {websiteId:UInt32}
             AND ds.session_id = base.session_id
            LEFT JOIN dim_known_users AS ku FINAL
              ON ku.website_id = {websiteId:UInt32}
             AND ku.visitor_id = ${visitorIdExpr}
             AND ku.user_id = ${REPLAY_LIST_RESOLVED_USER_ID_SQL}
             AND length(${REPLAY_LIST_RESOLVED_USER_ID_SQL}) > 0
            LEFT JOIN (
                SELECT
                    website_id,
                    user_id,
                    argMax(first_name, last_identified_at) AS first_name,
                    argMax(last_name, last_identified_at) AS last_name,
                    argMax(email, last_identified_at) AS email,
                    argMax(phone, last_identified_at) AS phone,
                    argMax(method, last_identified_at) AS method,
                    argMax(traits_json, last_identified_at) AS traits_json
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
                GROUP BY website_id, user_id
            ) AS ku_uid
              ON ku_uid.website_id = {websiteId:UInt32}
             AND ku_uid.user_id = ${REPLAY_LIST_RESOLVED_USER_ID_SQL}
             AND length(${REPLAY_LIST_RESOLVED_USER_ID_SQL}) > 0
`;
}
export const REPLAY_LIST_PROFILE_SELECT_SQL = `
  ${REPLAY_LIST_RESOLVED_USER_ID_SQL} AS resolved_session_user_id,
  if(
    length(${REPLAY_LIST_RESOLVED_USER_ID_SQL}) > 0,
    concat(
      'wt:',
      toString({websiteId:UInt32}),
      ':',
      ${REPLAY_LIST_RESOLVED_USER_ID_SQL}
    ),
    ''
  ) AS cdp_id,
  coalesce(nullIf(ku.method, ''), nullIf(ku_uid.method, ''), nullIf(ku.last_event_type, ''), '') AS contact_type,
  coalesce(nullIf(ku.first_name, ''), nullIf(ku_uid.first_name, ''), '') AS cdp_first_name,
  coalesce(nullIf(ku.last_name, ''), nullIf(ku_uid.last_name, ''), '') AS cdp_last_name,
  coalesce(nullIf(ku.email, ''), nullIf(ku_uid.email, ''), '') AS cdp_primary_email,
  coalesce(nullIf(ku.phone, ''), nullIf(ku_uid.phone, ''), '') AS cdp_primary_phone,
  coalesce(nullIf(ku.traits_json, ''), nullIf(ku_uid.traits_json, ''), '') AS traits_json,
  '' AS cdp_company,
  '' AS cdp_acquisition_channel,
  ${REPLAY_LIST_RESOLVED_USER_ID_SQL} AS webtracking_user_id,
  (
    length(${REPLAY_LIST_RESOLVED_USER_ID_SQL}) > 0
  ) AS is_cdp_known,
  toUInt32(0) AS linked_visitor_ids_count,
  emptyArrayString() AS linked_visitor_ids
`;
/** Per-row select when session user is set (ku matched on ds.user_id). */
export const KNOWN_USER_SESSION_IDENTITY_SELECT_SQL = `
  if(
    length(coalesce(nullIf(ku.user_id, ''), nullIf(ds.user_id, ''))) > 0,
    concat(
      'wt:',
      toString({websiteId:UInt32}),
      ':',
      coalesce(nullIf(ku.user_id, ''), nullIf(ds.user_id, ''))
    ),
    ''
  ) AS cdp_id,
  coalesce(nullIf(ku.method, ''), nullIf(ku_uid.method, ''), if(length(nullIf(ds.user_id, '')) > 0, 'User', '')) AS contact_type,
  coalesce(nullIf(ku.first_name, ''), nullIf(ku_uid.first_name, ''), '') AS cdp_first_name,
  coalesce(nullIf(ku.last_name, ''), nullIf(ku_uid.last_name, ''), '') AS cdp_last_name,
  coalesce(nullIf(ku.email, ''), nullIf(ku_uid.email, ''), '') AS cdp_primary_email,
  coalesce(nullIf(ku.phone, ''), nullIf(ku_uid.phone, ''), '') AS cdp_primary_phone,
  coalesce(nullIf(ku.traits_json, ''), nullIf(ku_uid.traits_json, ''), '') AS traits_json,
  '' AS cdp_company,
  '' AS cdp_acquisition_channel,
  coalesce(nullIf(ku.user_id, ''), nullIf(ds.user_id, '')) AS webtracking_user_id,
  (
    length(coalesce(nullIf(ku.user_id, ''), nullIf(ds.user_id, ''))) > 0
  ) AS is_cdp_known,
  toUInt32(0) AS linked_visitor_ids_count,
  emptyArrayString() AS linked_visitor_ids
`;
/** All accounts seen on this browser visitor (multi-login picker). */
export function knownUserProfilesForVisitorSelectSql() {
    return `
            SELECT
                concat('wt:', toString({websiteId:UInt32}), ':', ku.user_id) AS cdp_id,
                coalesce(nullIf(ku.method, ''), nullIf(ku.last_event_type, ''), '') AS contact_type,
                coalesce(nullIf(ku.first_name, ''), '') AS cdp_first_name,
                coalesce(nullIf(ku.last_name, ''), '') AS cdp_last_name,
                coalesce(nullIf(ku.email, ''), '') AS cdp_primary_email,
                coalesce(nullIf(ku.phone, ''), '') AS cdp_primary_phone,
                coalesce(nullIf(ku.traits_json, ''), '') AS traits_json,
                '' AS cdp_company,
                '' AS cdp_acquisition_channel,
                ku.user_id AS webtracking_user_id,
                true AS is_cdp_known,
                toUInt32(1) AS linked_visitor_ids_count,
                [ku.visitor_id] AS linked_visitor_ids
            FROM dim_known_users AS ku FINAL
            WHERE ku.website_id = {websiteId:UInt32}
              AND ku.visitor_id = {visitorId:String}
              AND length(ku.user_id) > 0
            ORDER BY ku.last_identified_at DESC
            LIMIT 1 BY ku.user_id
  `;
}
