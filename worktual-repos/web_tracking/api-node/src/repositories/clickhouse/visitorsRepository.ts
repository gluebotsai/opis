import { type ClickHouseClient, chQuery, chQueryOne, type Row } from "../../plugins/clickhouse.js";
import { BOUNCE_MAX_DURATION_SECONDS } from "../../utils/bounceRate.js";
import {
  DIM_SESSION_USER_OR_SKIP_WHEN_ACCOUNT_FILTER_SQL,
  factAccountFilterSql,
  limitClause,
  paginateClause,
  SCROLL_DEPTH_FROM_EXTRA,
  SCROLL_EVENT_TYPES_SQL,
  VISITOR_IDS_FILTER_SQL,
  type VisitorAnalyticsFilter,
  visitorAnalyticsParams,
  visitorIdsFilterFor,
} from "../../utils/clickhouseSql.js";
import {
  CH_PRODUCT_NON_VIEW_COUNT_EXPR,
  CH_PRODUCT_VIEW_COUNT_EXPR,
} from "../../utils/productInteractionSql.js";
import { knownUserProfilesForVisitorSelectSql } from "../../utils/knownUserIdentificationSql.js";
import {
  buildProfileLabelFromIdentityRow,
  buildVisitorCdpProfile,
  dedupeLinkedKnownProfiles,
  enrichWeakProfileFromKnownUserIdentity,
  profileDisplayLabel,
  type VisitorCdpProfile,
} from "../../utils/visitorCdpProfile.js";
import {
  parseKnownUserIdFromProfileKey,
  profileIdentificationJoinForSelectedSql,
  profileIdentificationJoinSql,
  profileIdentitySelectSql,
  profileLinkedCountSql,
  profileListIdentificationJoinSql,
  profileListIdentitySelectSql,
  profileListLinkedCountSql,
  sessionDisplayProfileJoinSql,
  sessionDisplayProfileSelectSql,
} from "../../utils/visitorIdentitySql.js";

/** ClickHouse LEFT JOIN fills missing DateTime64 as epoch; treat as unknown for coalesce. */
const CH_EPOCH_DT64 = "toDateTime64('1970-01-01', 3, 'UTC')";
const VISITOR_FIRST_SEEN_EXPR = `
                coalesce(
                    nullIf(act.first_seen_at, ${CH_EPOCH_DT64}),
                    nullIf(st.st_first, ${CH_EPOCH_DT64}),
                    nullIf(dv.first_seen_at, ${CH_EPOCH_DT64})
                )`;

/** Activity time from client events only — not raw_payloads.received_at or replay ingest time. */
const VISITOR_LAST_SEEN_EXPR = `
                least(
                    greatest(
                        coalesce(act.last_seen_at, ${CH_EPOCH_DT64}),
                        coalesce(st.st_last, ${CH_EPOCH_DT64}),
                        coalesce(dv.last_seen_at, ${CH_EPOCH_DT64})
                    ),
                    now64(3, 'UTC')
                )`;

export class VisitorsRepository {
  async resolveOrganizationId(
    client: ClickHouseClient,
    websiteId: number,
    organizationId: number | null,
  ): Promise<number> {
    if (organizationId != null && organizationId > 0) return organizationId;
    const row = await chQueryOne(
      client,
      `
            SELECT organization_id
            FROM dim_websites FINAL
            WHERE website_id = {websiteId:UInt32}
            LIMIT 1
            `,
      { websiteId },
    );
    return Number(row?.organization_id ?? 0);
  }

  async listVisitors(
    client: ClickHouseClient,
    websiteId: number,
    organizationId: number,
    offset = 0,
    limit = 10,
    search?: string | null,
  ): Promise<Row> {
    const searchVal = String(search ?? "").trim();
    const searchFilter = searchVal
      ? " AND positionCaseInsensitive(v.visitor_id, {search:String}) > 0"
      : "";
    const params: Record<string, unknown> = {
      websiteId,
      organizationId,
      selectedUserId: "",
    };
    if (searchVal) params.search = searchVal;

    const profileJoin = organizationId > 0 ? profileListIdentificationJoinSql() : "";

    const profileSelect =
      organizationId > 0
        ? `,
                ${profileListIdentitySelectSql()},
                ${profileListLinkedCountSql()} AS linked_cdp_profiles_count`
        : "";

    const visitorSpineSql = `
            SELECT visitor_id
            FROM (
                SELECT visitor_id FROM dim_visitors FINAL WHERE website_id = {websiteId:UInt32}
                UNION DISTINCT
                SELECT visitor_id FROM events_staging WHERE website_id = {websiteId:UInt32}
                UNION DISTINCT
                SELECT visitor_id FROM raw_payloads
                WHERE website_id = {websiteId:UInt32} AND length(visitor_id) > 0
            ) AS ids
            WHERE 1 = 1${searchFilter.replaceAll("v.visitor_id", "visitor_id")}
    `;

    const totalRow = await chQueryOne(
      client,
      `SELECT count() AS cnt FROM (${visitorSpineSql}) AS spine`,
      params,
    );

    const visitors = await chQuery(
      client,
      `
            WITH spine AS (${visitorSpineSql})
            SELECT
                v.visitor_id AS visitor_id,
                coalesce(nullIf(dv.country, ''), nullIf(st.st_country, ''), '') AS country,
                ${VISITOR_FIRST_SEEN_EXPR} AS first_seen_at,
                ${VISITOR_LAST_SEEN_EXPR} AS last_seen_at,
                coalesce(sc.cnt, 0) AS total_sessions,
                coalesce(pv.cnt, 0) AS total_pageviews${profileSelect}
            FROM spine AS v
            LEFT JOIN dim_visitors AS dv FINAL
                ON dv.website_id = {websiteId:UInt32} AND dv.visitor_id = v.visitor_id
            ${profileJoin}
            LEFT JOIN (
                SELECT
                    visitor_id,
                    min(created_at) AS first_seen_at,
                    max(created_at) AS last_seen_at
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}
                GROUP BY visitor_id
            ) act ON act.visitor_id = v.visitor_id
            LEFT JOIN (
                SELECT
                    visitor_id,
                    min(event_ts) AS st_first,
                    max(event_ts) AS st_last,
                    argMax(country, event_ts) AS st_country
                FROM events_staging
                WHERE website_id = {websiteId:UInt32}
                GROUP BY visitor_id
            ) st ON st.visitor_id = v.visitor_id
            LEFT JOIN (
                SELECT visitor_id, count() AS cnt
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32}
                GROUP BY visitor_id
            ) sc ON sc.visitor_id = v.visitor_id
            LEFT JOIN (
                SELECT visitor_id, count() AS cnt
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}
                GROUP BY visitor_id
            ) pv ON pv.visitor_id = v.visitor_id
            ORDER BY last_seen_at DESC
            ${paginateClause(offset, limit)}
            `,
      params,
    );

    return {
      total: Number(totalRow?.cnt ?? 0),
      offset,
      limit,
      visitors,
    };
  }

  async getVisitorCampaignAttribution(
    client: ClickHouseClient,
    websiteId: number,
    primaryVisitorId: string,
  ): Promise<string | null> {
    const row = await chQueryOne(
      client,
      `
            SELECT
                argMax(
                    JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'),
                    received_at
                ) AS campaign_json
            FROM raw_payloads
            WHERE website_id = {websiteId:UInt32}
              AND visitor_id = {primaryVisitorId:String}
              AND length(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign')) > 2
            `,
      { websiteId, primaryVisitorId },
    );
    const campaignJson = row?.campaign_json;
    if (campaignJson == null || campaignJson === "") return null;
    return String(campaignJson);
  }

  async listLinkedCdpProfilesForVisitor(
    client: ClickHouseClient,
    organizationId: number,
    visitorId: string,
    websiteId?: number,
  ): Promise<Row[]> {
    if (organizationId <= 0) return [];
    const wid = websiteId ?? 0;
    if (wid <= 0) return [];
    const fromIdentify = await chQuery(client, knownUserProfilesForVisitorSelectSql(), {
      websiteId: wid,
      visitorId,
      selectedUserId: "",
    });
    const sessionUsers = await chQuery(
      client,
      `
            SELECT DISTINCT user_id
            FROM dim_sessions FINAL
            WHERE website_id = {websiteId:UInt32}
              AND visitor_id = {visitorId:String}
              AND length(user_id) > 0
            `,
      { websiteId: wid, visitorId },
    );
    const haveUser = new Set(
      fromIdentify.map((r) => String(r.webtracking_user_id ?? "").trim()).filter(Boolean),
    );
    const missingUserIds = sessionUsers
      .map((row) => String(row.user_id ?? "").trim())
      .filter((uid) => uid && !haveUser.has(uid));

    const extras: Row[] = [];
    if (missingUserIds.length > 0) {
      const enriched = await chQuery(
        client,
        `
            SELECT
                user_id,
                argMax(first_name, last_identified_at) AS cdp_first_name,
                argMax(last_name, last_identified_at) AS cdp_last_name,
                argMax(email, last_identified_at) AS cdp_primary_email,
                argMax(phone, last_identified_at) AS cdp_primary_phone,
                argMax(method, last_identified_at) AS contact_type,
                argMax(traits_json, last_identified_at) AS traits_json
            FROM dim_known_users FINAL
            WHERE website_id = {websiteId:UInt32}
              AND user_id IN {userIds:Array(String)}
            GROUP BY user_id
            `,
        { websiteId: wid, userIds: missingUserIds },
      );
      const byUser = new Map(enriched.map((r) => [String(r.user_id ?? ""), r]));

      for (const uid of missingUserIds) {
        const ku = byUser.get(uid);
        extras.push({
          cdp_id: `wt:${wid}:${uid}`,
          contact_type: String(ku?.contact_type ?? ku?.method ?? ""),
          cdp_first_name: String(ku?.cdp_first_name ?? ku?.first_name ?? ""),
          cdp_last_name: String(ku?.cdp_last_name ?? ku?.last_name ?? ""),
          cdp_primary_email: String(ku?.cdp_primary_email ?? ku?.email ?? ""),
          cdp_primary_phone: String(ku?.cdp_primary_phone ?? ku?.phone ?? ""),
          traits_json: String(ku?.traits_json ?? ""),
          cdp_company: "",
          cdp_acquisition_channel: "",
          webtracking_user_id: uid,
          is_cdp_known: true,
          linked_visitor_ids_count: 1,
          linked_visitor_ids: [visitorId],
        });
      }
    }
    return [...fromIdentify, ...extras];
  }

  /** Enriched, deduped known accounts for visitor detail / account picker (excludes Anonymous). */
  async resolveLinkedKnownCdpProfiles(
    client: ClickHouseClient,
    organizationId: number,
    visitorId: string,
    websiteId: number,
  ): Promise<VisitorCdpProfile[]> {
    if (organizationId <= 0 || websiteId <= 0) return [];
    const linkedRows = await this.listLinkedCdpProfilesForVisitor(
      client,
      organizationId,
      visitorId,
      websiteId,
    );
    let profiles = linkedRows
      .map((row) => buildVisitorCdpProfile(row, visitorId))
      .filter((p): p is VisitorCdpProfile => Boolean(p?.cdp_id && p.is_cdp_known));

    const userIds = [
      ...new Set(
        profiles.map((p) => String(p.webtracking_user_id ?? "").trim()).filter(Boolean),
      ),
    ];
    if (userIds.length) {
      const identityByUserId = await this.fetchKnownUserIdentityByUserIds(
        client,
        websiteId,
        userIds,
      );
      profiles = profiles.map(
        (p) =>
          enrichWeakProfileFromKnownUserIdentity(
            p,
            visitorId,
            websiteId,
            identityByUserId.get(String(p.webtracking_user_id ?? "").trim()),
          ) ?? p,
      );
    }

    return dedupeLinkedKnownProfiles(profiles);
  }

  /** Names for tooltip: Anonymous + each login seen on this browser (visitor_id). */
  async getBrowserAccountLabelLists(
    client: ClickHouseClient,
    websiteId: number,
    visitorIds: string[],
  ): Promise<Record<string, string[]>> {
    const ids = [...new Set(visitorIds.map((id) => String(id).trim()).filter(Boolean))];
    if (!ids.length) return {};

    const [knownRows, anonRows, sessionUserRows] = await Promise.all([
      chQuery(
        client,
        `
            SELECT
                visitor_id,
                user_id,
                argMax(first_name, last_identified_at) AS first_name,
                argMax(last_name, last_identified_at) AS last_name,
                argMax(email, last_identified_at) AS email,
                argMax(phone, last_identified_at) AS phone,
                argMax(method, last_identified_at) AS method,
                argMax(traits_json, last_identified_at) AS traits_json
            FROM dim_known_users FINAL
            WHERE website_id = {websiteId:UInt32}
              AND visitor_id IN {visitorIds:Array(String)}
              AND length(user_id) > 0
            GROUP BY visitor_id, user_id
            `,
        { websiteId, visitorIds: ids },
      ),
      chQuery(
        client,
        `
            SELECT visitor_id
            FROM dim_sessions FINAL
            WHERE website_id = {websiteId:UInt32}
              AND visitor_id IN {visitorIds:Array(String)}
              AND length(user_id) = 0
            GROUP BY visitor_id
            `,
        { websiteId, visitorIds: ids },
      ),
      chQuery(
        client,
        `
            SELECT
                visitor_id,
                user_id
            FROM dim_sessions FINAL
            WHERE website_id = {websiteId:UInt32}
              AND visitor_id IN {visitorIds:Array(String)}
              AND length(user_id) > 0
            GROUP BY visitor_id, user_id
            `,
        { websiteId, visitorIds: ids },
      ),
    ]);

    const anonSet = new Set(anonRows.map((r) => String(r.visitor_id ?? "")));
    const byVisitor = new Map<string, Map<string, string>>();

    for (const vid of ids) {
      byVisitor.set(vid, new Map());
    }

    for (const row of knownRows) {
      const vid = String(row.visitor_id ?? "");
      const uid = String(row.user_id ?? "").trim();
      if (!vid || !uid) continue;
      const labels = byVisitor.get(vid) ?? new Map();
      labels.set(uid, buildProfileLabelFromIdentityRow(row, websiteId, vid));
      byVisitor.set(vid, labels);
    }

    for (const row of sessionUserRows) {
      const vid = String(row.visitor_id ?? "");
      const uid = String(row.user_id ?? "").trim();
      if (!vid || !uid) continue;
      const labels = byVisitor.get(vid) ?? new Map();
      if (!labels.has(uid)) {
        labels.set(uid, buildProfileLabelFromIdentityRow({ user_id: uid }, websiteId, vid));
      }
      byVisitor.set(vid, labels);
    }

    const allUserIds = [
      ...new Set(
        [...byVisitor.values()].flatMap((m) => [...m.keys()]).filter(Boolean),
      ),
    ];
    const identityByUserId = await this.fetchKnownUserIdentityByUserIds(
      client,
      websiteId,
      allUserIds,
    );
    for (const [vid, labelMap] of byVisitor) {
      for (const [uid, priorLabel] of [...labelMap.entries()]) {
        const ku = identityByUserId.get(uid);
        const merged = ku
          ? {
              user_id: uid,
              first_name: ku.first_name,
              last_name: ku.last_name,
              email: ku.email,
              phone: ku.phone,
              method: ku.method,
              traits_json: ku.traits_json,
            }
          : { user_id: uid };
        const next = buildProfileLabelFromIdentityRow(merged, websiteId, vid);
        labelMap.set(uid, next || priorLabel);
      }
    }

    const out: Record<string, string[]> = {};
    for (const [vid, labelMap] of byVisitor) {
      const list: string[] = [];
      if (anonSet.has(vid)) list.push("Anonymous");
      const names = [...labelMap.values()].sort((a, b) => a.localeCompare(b));
      list.push(...names);
      out[vid] = [...new Set(list)];
    }
    return out;
  }

  /** dim_known_users + list joins for many visitor IDs (Visitors list / cart abandon enrichment). */
  async getVisitorCdpProfileRowsByIds(
    client: ClickHouseClient,
    websiteId: number,
    organizationId: number,
    visitorIds: string[],
  ): Promise<Map<string, Row>> {
    const ids = [...new Set(visitorIds.map((id) => String(id).trim()).filter(Boolean))];
    const out = new Map<string, Row>();
    if (!ids.length || organizationId <= 0) return out;

    const rows = await chQuery(
      client,
      `
            SELECT
                v.visitor_id AS visitor_id,
                ${profileListIdentitySelectSql()}
            FROM (SELECT arrayJoin({visitorIds:Array(String)}) AS visitor_id) AS v
            ${profileListIdentificationJoinSql("v.visitor_id")}
            `,
      { websiteId, organizationId, visitorIds: ids, selectedUserId: "" },
    );

    for (const row of rows) {
      const visitorId = String(row.visitor_id ?? "").trim();
      if (visitorId) out.set(visitorId, row);
    }
    return out;
  }

  /**
   * Most recent identify/login row per visitor (Live Users label after logout).
   * Uses dim_known_users only — no session user_id required.
   */
  async getSessionDisplayProfileRowsByKeys(
    client: ClickHouseClient,
    websiteId: number,
    organizationId: number,
    keys: { session_id: string; visitor_id: string }[],
  ): Promise<Map<string, Row>> {
    const out = new Map<string, Row>();
    if (organizationId <= 0 || !keys.length) return out;

    const sessionIds = keys.map((k) => String(k.session_id).trim()).filter(Boolean);
    const visitorIds = keys.map((k) => String(k.visitor_id).trim()).filter(Boolean);
    if (!sessionIds.length || sessionIds.length !== visitorIds.length) return out;

    const rows = await chQuery(
      client,
      `
            SELECT
                base.session_id AS session_id,
                base.visitor_id AS visitor_id,
                ${sessionDisplayProfileSelectSql()}
            FROM (
                SELECT
                    z.1 AS session_id,
                    z.2 AS visitor_id
                FROM (
                    SELECT arrayJoin(
                        arrayZip({sessionIds:Array(String)}, {visitorIds:Array(String)})
                    ) AS z
                )
            ) AS base
            ${sessionDisplayProfileJoinSql("base.session_id", "base.visitor_id")}
            `,
      { websiteId, organizationId, sessionIds, visitorIds },
    );

    for (const row of rows) {
      const sessionId = String(row.session_id ?? "").trim();
      const visitorId = String(row.visitor_id ?? "").trim();
      if (!sessionId || !visitorId) continue;
      out.set(`${sessionId}\0${visitorId}`, row);
    }
    return out;
  }

  /** Most recently active session per visitor (same activity signal as list profile). */
  async getRecentSessionIdsByVisitorIds(
    client: ClickHouseClient,
    websiteId: number,
    visitorIds: string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(visitorIds.map((id) => String(id).trim()).filter(Boolean))];
    const out = new Map<string, string>();
    if (!ids.length) return out;

    const rows = await chQuery(
      client,
      `
            SELECT
                visitor_id,
                argMax(session_id, tuple(last_activity_at, session_id)) AS session_id
            FROM (
                SELECT
                    s.visitor_id AS visitor_id,
                    s.session_id AS session_id,
                    greatest(
                        s.updated_at,
                        coalesce(s.ended_at, s.updated_at),
                        coalesce(fact.last_fact_at, ${CH_EPOCH_DT64})
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
                  AND s.visitor_id IN {visitorIds:Array(String)}
            )
            GROUP BY visitor_id
            `,
      { websiteId, visitorIds: ids },
    );

    for (const row of rows) {
      const visitorId = String(row.visitor_id ?? "").trim();
      const sessionId = String(row.session_id ?? "").trim();
      if (visitorId && sessionId) out.set(visitorId, sessionId);
    }
    return out;
  }

  /** Active live window (5 min): one session_id per visitor for list ↔ live sync. */
  async getActiveLiveSessionIdsByVisitorIds(
    client: ClickHouseClient,
    websiteId: number,
    visitorIds: string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(visitorIds.map((id) => String(id).trim()).filter(Boolean))];
    const out = new Map<string, string>();
    if (!ids.length) return out;

    const rows = await chQuery(
      client,
      `
            WITH recent_fact AS (
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
                )
                GROUP BY session_id
            ),
            latest_pages AS (
                SELECT session_id, max(event_ts) AS last_page_at
                FROM (
                    SELECT session_id, created_at AS event_ts
                    FROM fact_page_views
                    WHERE website_id = {websiteId:UInt32}
                    UNION ALL
                    SELECT session_id, created_at AS event_ts
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}
                )
                GROUP BY session_id
            )
            SELECT
                s.visitor_id AS visitor_id,
                argMax(
                    s.session_id,
                    least(
                        greatest(
                            coalesce(s.ended_at, ${CH_EPOCH_DT64}),
                            coalesce(lp.last_page_at, ${CH_EPOCH_DT64}),
                            coalesce(rf.last_fact_at, ${CH_EPOCH_DT64})
                        ),
                        now64(3, 'UTC')
                    )
                ) AS session_id
            FROM dim_sessions AS s FINAL
            LEFT JOIN latest_pages lp ON lp.session_id = s.session_id
            LEFT JOIN recent_fact rf ON rf.session_id = s.session_id
            WHERE s.website_id = {websiteId:UInt32}
              AND s.visitor_id IN {visitorIds:Array(String)}
              AND least(
                    greatest(
                        coalesce(s.ended_at, ${CH_EPOCH_DT64}),
                        coalesce(lp.last_page_at, ${CH_EPOCH_DT64}),
                        coalesce(rf.last_fact_at, ${CH_EPOCH_DT64})
                    ),
                    now64(3, 'UTC')
                ) >= now() - INTERVAL 5 MINUTE
            GROUP BY s.visitor_id
            `,
      { websiteId, visitorIds: ids },
    );

    for (const row of rows) {
      const visitorId = String(row.visitor_id ?? "").trim();
      const sessionId = String(row.session_id ?? "").trim();
      if (visitorId && sessionId) out.set(visitorId, sessionId);
    }
    return out;
  }

  async getLatestKnownProfileRowsByVisitorIds(
    client: ClickHouseClient,
    websiteId: number,
    visitorIds: string[],
  ): Promise<Map<string, Row>> {
    const ids = [...new Set(visitorIds.map((id) => String(id).trim()).filter(Boolean))];
    const out = new Map<string, Row>();
    if (!ids.length) return out;

    const rows = await chQuery(
      client,
      `
            SELECT
                visitor_id,
                user_id AS latest_user_id,
                first_name,
                last_name,
                email,
                phone,
                method,
                traits_json
            FROM dim_known_users FINAL
            WHERE website_id = {websiteId:UInt32}
              AND visitor_id IN {visitorIds:Array(String)}
              AND user_id != ''
            ORDER BY last_identified_at DESC
            LIMIT 1 BY visitor_id
            `,
      { websiteId, visitorIds: ids },
    );

    for (const row of rows) {
      const visitorId = String(row.visitor_id ?? "").trim();
      const userId = String(row.latest_user_id ?? row.user_id ?? "").trim();
      if (!visitorId || !userId) continue;
      out.set(visitorId, {
        cdp_id: `wt:${websiteId}:${userId}`,
        contact_type: String(row.method ?? ""),
        cdp_first_name: String(row.first_name ?? ""),
        cdp_last_name: String(row.last_name ?? ""),
        cdp_primary_email: String(row.email ?? ""),
        cdp_primary_phone: String(row.phone ?? ""),
        traits_json: String(row.traits_json ?? ""),
        cdp_company: "",
        cdp_acquisition_channel: "",
        webtracking_user_id: userId,
        is_cdp_known: true,
        linked_visitor_ids_count: 1,
        linked_visitor_ids: [visitorId],
      });
    }
    return out;
  }

  /**
   * One display profile per visitor_id (recent session user + dim_known_users).
   * Used by Live Users, Visitors, Sessions, and Replay for consistent names.
   */
  async getUnifiedVisitorDisplayProfilesByVisitorIds(
    client: ClickHouseClient,
    websiteId: number,
    organizationId: number,
    visitorIds: string[],
  ): Promise<Map<string, ReturnType<typeof buildVisitorCdpProfile>>> {
    const rows = await this.getVisitorCdpProfileRowsByIds(
      client,
      websiteId,
      organizationId,
      visitorIds,
    );
    const out = new Map<string, ReturnType<typeof buildVisitorCdpProfile>>();
    for (const visitorId of visitorIds) {
      const id = String(visitorId).trim();
      if (!id) continue;
      out.set(id, buildVisitorCdpProfile(rows.get(id) ?? null, id));
    }
    return out;
  }

  /** Same profile label as Visitors list (recent session account), for a set of visitor IDs. */
  async getLastActiveProfileByVisitorIds(
    client: ClickHouseClient,
    websiteId: number,
    organizationId: number,
    visitorIds: string[],
  ): Promise<Record<string, { last_active_profile_label: string }>> {
    const ids = [...new Set(visitorIds.map((id) => String(id).trim()).filter(Boolean))];
    const out: Record<string, { last_active_profile_label: string }> = {};
    if (!ids.length || organizationId <= 0) return out;

    const rows = await chQuery(
      client,
      `
            SELECT
                v.visitor_id AS visitor_id,
                ${profileListIdentitySelectSql()}
            FROM (SELECT arrayJoin({visitorIds:Array(String)}) AS visitor_id) AS v
            ${profileListIdentificationJoinSql("v.visitor_id")}
            `,
      { websiteId, organizationId, visitorIds: ids, selectedUserId: "" },
    );

    for (const row of rows) {
      const visitorId = String(row.visitor_id ?? "").trim();
      if (!visitorId) continue;
      const cdp = buildVisitorCdpProfile(row, visitorId);
      out[visitorId] = { last_active_profile_label: profileDisplayLabel(cdp) };
    }
    return out;
  }

  /** Latest identify traits per store user_id (any visitor cookie on this site). */
  async fetchKnownUserIdentityByUserIds(
    client: ClickHouseClient,
    websiteId: number,
    userIds: string[],
  ): Promise<
    Map<
      string,
      {
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        method: string;
        traits_json: string;
      }
    >
  > {
    const ids = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
    const out = new Map<
      string,
      {
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        method: string;
        traits_json: string;
      }
    >();
    if (!ids.length) return out;

    const rows = await chQuery(
      client,
      `
            SELECT
                user_id,
                argMax(first_name, last_identified_at) AS first_name,
                argMax(last_name, last_identified_at) AS last_name,
                argMax(email, last_identified_at) AS email,
                argMax(phone, last_identified_at) AS phone,
                argMax(method, last_identified_at) AS method,
                argMax(traits_json, last_identified_at) AS traits_json
            FROM dim_known_users FINAL
            WHERE website_id = {websiteId:UInt32}
              AND user_id IN {userIds:Array(String)}
            GROUP BY user_id
            `,
      { websiteId, userIds: ids },
    );

    for (const row of rows) {
      const uid = String(row.user_id ?? "").trim();
      if (!uid) continue;
      out.set(uid, {
        first_name: String(row.first_name ?? ""),
        last_name: String(row.last_name ?? ""),
        email: String(row.email ?? ""),
        phone: String(row.phone ?? ""),
        method: String(row.method ?? ""),
        traits_json: String(row.traits_json ?? ""),
      });
    }
    return out;
  }

  async getVisitor(
    client: ClickHouseClient,
    websiteId: number,
    organizationId: number,
    visitorId: string,
    selectedCdpId?: string | null,
  ): Promise<Row | null> {
    const selected = String(selectedCdpId ?? "").trim();
    const selectedUserId = selected ? parseKnownUserIdFromProfileKey(selected) ?? "" : "";
    const profileJoin =
      organizationId > 0 ? profileIdentificationJoinForSelectedSql("v.visitor_id") : "";
    const profileSelect =
      organizationId > 0
        ? `,
                ${profileIdentitySelectSql()},
                ${profileLinkedCountSql()} AS linked_cdp_profiles_count`
        : "";

    const params: Record<string, unknown> = {
      websiteId,
      organizationId,
      visitorId,
      selectedUserId,
    };
    return chQueryOne(
      client,
      `
            WITH spine AS (
                SELECT visitor_id
                FROM (
                    SELECT visitor_id FROM dim_visitors FINAL
                    WHERE website_id = {websiteId:UInt32} AND visitor_id = {visitorId:String}
                    UNION DISTINCT
                    SELECT visitor_id FROM events_staging
                    WHERE website_id = {websiteId:UInt32} AND visitor_id = {visitorId:String}
                    UNION DISTINCT
                    SELECT visitor_id FROM raw_payloads
                    WHERE website_id = {websiteId:UInt32} AND visitor_id = {visitorId:String}
                )
            )
            SELECT
                v.visitor_id AS visitor_id,
                coalesce(nullIf(dv.country, ''), nullIf(st.st_country, ''), '') AS country,
                ${VISITOR_FIRST_SEEN_EXPR} AS first_seen_at,
                ${VISITOR_LAST_SEEN_EXPR} AS last_seen_at,
                coalesce(sc.cnt, 0) AS total_sessions,
                coalesce(pv.cnt, 0) AS total_pageviews${profileSelect}
            FROM spine AS v
            LEFT JOIN dim_visitors AS dv FINAL
                ON dv.website_id = {websiteId:UInt32} AND dv.visitor_id = v.visitor_id
            ${profileJoin}
            LEFT JOIN (
                SELECT visitor_id, min(created_at) AS first_seen_at, max(created_at) AS last_seen_at
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32} AND visitor_id = {visitorId:String}
                GROUP BY visitor_id
            ) act ON act.visitor_id = v.visitor_id
            LEFT JOIN (
                SELECT
                    visitor_id,
                    min(event_ts) AS st_first,
                    max(event_ts) AS st_last,
                    argMax(country, event_ts) AS st_country
                FROM events_staging
                WHERE website_id = {websiteId:UInt32} AND visitor_id = {visitorId:String}
                GROUP BY visitor_id
            ) st ON st.visitor_id = v.visitor_id
            LEFT JOIN (
                SELECT visitor_id, count() AS cnt
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32} AND visitor_id = {visitorId:String}
                GROUP BY visitor_id
            ) sc ON sc.visitor_id = v.visitor_id
            LEFT JOIN (
                SELECT visitor_id, count() AS cnt
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32} AND visitor_id = {visitorId:String}
                GROUP BY visitor_id
            ) pv ON pv.visitor_id = v.visitor_id
            LIMIT 1
            `,
      params,
    );
  }

  async getVisitorSessions(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row[]> {
    const sessionLimit = Math.min(80, 20 + filter.visitorIds.length * 25);
    const params = visitorAnalyticsParams(websiteId, filter);
    return chQuery(
      client,
      `
            WITH session_activity AS (
                SELECT
                    session_id,
                    website_id,
                    min(event_ts) AS activity_started_at,
                    max(event_ts) AS activity_ended_at
                FROM (
                    SELECT pv.session_id, pv.website_id, pv.created_at AS event_ts
                    FROM fact_page_views AS pv
                    WHERE pv.website_id = {websiteId:UInt32}
                      AND ${visitorIdsFilterFor("pv.visitor_id")}
                      AND ${factAccountFilterSql("pv")}
                    UNION ALL
                    SELECT ie.session_id, ie.website_id, ie.created_at AS event_ts
                    FROM fact_interaction_events AS ie
                    WHERE ie.website_id = {websiteId:UInt32}
                      AND ${visitorIdsFilterFor("ie.visitor_id")}
                      AND ${factAccountFilterSql("ie")}
                )
                GROUP BY session_id, website_id
            ),
            pageview_stats AS (
                SELECT
                    session_id,
                    website_id,
                    count() AS pageview_count,
                    argMin(page_path, created_at) AS entry_page,
                    argMax(page_path, created_at) AS exit_page
                FROM fact_page_views AS pv
                WHERE pv.website_id = {websiteId:UInt32}
                  AND ${visitorIdsFilterFor("pv.visitor_id")}
                  AND ${factAccountFilterSql("pv")}
                GROUP BY session_id, website_id
            )
            SELECT
                sa.session_id AS session_id,
                coalesce(s.visitor_id, '') AS visitor_id,
                sa.activity_started_at AS started_at,
                sa.activity_ended_at AS ended_at,
                toUInt32(greatest(0, dateDiff(
                    'second',
                    sa.activity_started_at,
                    sa.activity_ended_at
                ))) AS duration_seconds,
                coalesce(ps.entry_page, s.entry_page, '') AS entry_page,
                coalesce(ps.exit_page, s.exit_page, '') AS exit_page,
                coalesce(ps.pageview_count, 0) AS pageview_count,
                toUInt8(
                    coalesce(ps.pageview_count, 0) = 1
                    AND toUInt32(greatest(0, dateDiff(
                        'second',
                        sa.activity_started_at,
                        sa.activity_ended_at
                    ))) < ${BOUNCE_MAX_DURATION_SECONDS}
                ) AS is_bounce,
                coalesce(s.referrer, '') AS referrer,
                coalesce(s.referrer_domain, '') AS referrer_domain,
                coalesce(s.utm_source, '') AS utm_source,
                coalesce(s.utm_medium, '') AS utm_medium,
                coalesce(s.utm_campaign, '') AS utm_campaign,
                coalesce(s.user_agent, '') AS user_agent,
                coalesce(s.language, '') AS language,
                coalesce(s.platform, '') AS platform,
                coalesce(s.browser, '') AS browser,
                coalesce(s.browser_version, '') AS browser_version,
                coalesce(s.device, '') AS device,
                coalesce(s.country, '') AS country,
                coalesce(s.city, '') AS city,
                coalesce(s.region, '') AS region,
                coalesce(s.geo_data, '') AS geo_data
            FROM session_activity sa
            LEFT JOIN dim_sessions AS s FINAL
                ON s.session_id = sa.session_id AND s.website_id = sa.website_id
            LEFT JOIN pageview_stats ps
                ON ps.session_id = sa.session_id AND ps.website_id = sa.website_id
            WHERE ${DIM_SESSION_USER_OR_SKIP_WHEN_ACCOUNT_FILTER_SQL}
            ORDER BY sa.activity_started_at DESC
            ${limitClause(sessionLimit)}
            `,
      params,
    );
  }

  async getVisitorSessionAttribution(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row[]> {
    const params = visitorAnalyticsParams(websiteId, filter);
    return chQuery(
      client,
      `
            WITH session_activity AS (
                SELECT
                    session_id,
                    website_id,
                    min(event_ts) AS started_at
                FROM (
                    SELECT pv.session_id, pv.website_id, pv.created_at AS event_ts
                    FROM fact_page_views AS pv
                    WHERE pv.website_id = {websiteId:UInt32}
                      AND ${visitorIdsFilterFor("pv.visitor_id")}
                      AND ${factAccountFilterSql("pv")}
                    UNION ALL
                    SELECT ie.session_id, ie.website_id, ie.created_at AS event_ts
                    FROM fact_interaction_events AS ie
                    WHERE ie.website_id = {websiteId:UInt32}
                      AND ${visitorIdsFilterFor("ie.visitor_id")}
                      AND ${factAccountFilterSql("ie")}
                )
                GROUP BY session_id, website_id
            )
            SELECT
                sa.started_at AS started_at,
                coalesce(s.referrer, '') AS referrer,
                coalesce(s.referrer_domain, '') AS referrer_domain,
                coalesce(s.utm_source, '') AS utm_source,
                coalesce(s.utm_medium, '') AS utm_medium,
                coalesce(s.utm_campaign, '') AS utm_campaign,
                coalesce(s.utm_term, '') AS utm_term,
                coalesce(s.utm_content, '') AS utm_content
            FROM session_activity sa
            LEFT JOIN dim_sessions AS s FINAL
                ON s.session_id = sa.session_id AND s.website_id = sa.website_id
            WHERE ${DIM_SESSION_USER_OR_SKIP_WHEN_ACCOUNT_FILTER_SQL}
            ORDER BY sa.started_at ASC
            `,
      params,
    );
  }

  async getVisitorClickCount(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<number> {
    const params = visitorAnalyticsParams(websiteId, filter);
    const row = await chQueryOne(
      client,
      `
            SELECT count() AS cnt FROM fact_interaction_events AS ie
            WHERE ie.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("ie.visitor_id")}
              AND ${factAccountFilterSql("ie")}
              AND ie.event_type = 'click'
            `,
      params,
    );
    return Number(row?.cnt ?? 0);
  }

  async getVisitorInteractionCount(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<number> {
    const params = visitorAnalyticsParams(websiteId, filter);
    const row = await chQueryOne(
      client,
      `
            SELECT count() AS cnt FROM fact_interaction_events AS ie
            WHERE ie.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("ie.visitor_id")}
              AND ${factAccountFilterSql("ie")}
            `,
      params,
    );
    return Number(row?.cnt ?? 0);
  }

  async getVisitorTopPages(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row[]> {
    const params = visitorAnalyticsParams(websiteId, filter);
    return chQuery(
      client,
      `
            SELECT page_path, count() AS views
            FROM fact_page_views AS pv
            WHERE pv.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("pv.visitor_id")}
              AND ${factAccountFilterSql("pv")}
            GROUP BY page_path
            ORDER BY views DESC
            ${limitClause(5)}
            `,
      params,
    );
  }

  async getVisitorTopProducts(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row[]> {
    const params = visitorAnalyticsParams(websiteId, filter);
    return chQuery(
      client,
      `
            SELECT
                product_id,
                product_name,
                ${CH_PRODUCT_VIEW_COUNT_EXPR} AS views,
                countIf(section = 'add_to_cart') AS cart_adds,
                ${CH_PRODUCT_NON_VIEW_COUNT_EXPR} AS interactions,
                count() AS engagement
            FROM fact_product_interactions AS p
            WHERE p.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("p.visitor_id")}
              AND ${factAccountFilterSql("p")}
              AND length(trimBoth(coalesce(p.product_id, ''))) > 0
              AND lower(trimBoth(p.product_id)) NOT IN ('unknown', '/')
            GROUP BY product_id, product_name
            HAVING engagement > 0
            ORDER BY engagement DESC, views DESC
            ${limitClause(5)}
            `,
      params,
    );
  }

  async getVisitorConversions(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row[]> {
    const params = visitorAnalyticsParams(websiteId, filter);
    return chQuery(
      client,
      `
            SELECT conversion_type, product_id, value, currency, props, created_at
            FROM fact_conversion_events AS c
            WHERE c.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("c.visitor_id")}
              AND ${factAccountFilterSql("c")}
            ORDER BY created_at DESC
            ${limitClause(20)}
            `,
      params,
    );
  }

  async getVisitorConversionRevenue(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row> {
    const params = visitorAnalyticsParams(websiteId, filter);
    const row = await chQueryOne(
      client,
      `
            SELECT
                countIf(conversion_type = 'purchase') AS purchases,
                sumIf(value, conversion_type = 'purchase') AS purchase_revenue,
                countIf(conversion_type = 'refund') AS refunds,
                sumIf(value, conversion_type = 'refund') AS refund_value,
                argMaxIf(currency, created_at, conversion_type = 'purchase') AS currency
            FROM fact_conversion_events AS c
            WHERE c.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("c.visitor_id")}
              AND ${factAccountFilterSql("c")}
            `,
      params,
    );
    const purchaseRevenue = Number(row?.purchase_revenue ?? 0);
    const refundValue = Number(row?.refund_value ?? 0);
    const currencyRaw = row?.currency;
    const currency =
      currencyRaw != null && String(currencyRaw).trim() !== "" ? String(currencyRaw).trim() : null;

    return {
      purchases: Number(row?.purchases ?? 0),
      purchase_revenue: purchaseRevenue,
      refunds: Number(row?.refunds ?? 0),
      refund_value: refundValue,
      net_revenue: purchaseRevenue - refundValue,
      currency,
    };
  }

  async getVisitorJourney(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row[]> {
    const journeyLimit = Math.min(120, 50 + filter.visitorIds.length * 30);
    const params = visitorAnalyticsParams(websiteId, filter);
    return chQuery(
      client,
      `
            SELECT
              page_path,
              page_title,
              event_at AS created_at
            FROM (
              SELECT
                argMax(page_path, created_at) AS page_path,
                argMax(page_title, created_at) AS page_title,
                min(created_at) AS event_at
              FROM fact_page_views AS pv
              WHERE pv.website_id = {websiteId:UInt32}
                AND ${visitorIdsFilterFor("pv.visitor_id")}
                AND ${factAccountFilterSql("pv")}
                AND page_view_id != ''
              GROUP BY page_view_id
            )
            ORDER BY event_at ASC
            ${limitClause(journeyLimit)}
            `,
      params,
    );
  }

  async getVisitorTotalDuration(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<number> {
    const params = visitorAnalyticsParams(websiteId, filter);
    const row = await chQueryOne(
      client,
      `
            WITH session_activity AS (
                SELECT
                    session_id,
                    website_id,
                    min(event_ts) AS activity_started_at,
                    max(event_ts) AS activity_ended_at
                FROM (
                    SELECT pv.session_id, pv.website_id, pv.created_at AS event_ts
                    FROM fact_page_views AS pv
                    WHERE pv.website_id = {websiteId:UInt32}
                      AND ${visitorIdsFilterFor("pv.visitor_id")}
                      AND ${factAccountFilterSql("pv")}
                    UNION ALL
                    SELECT ie.session_id, ie.website_id, ie.created_at AS event_ts
                    FROM fact_interaction_events AS ie
                    WHERE ie.website_id = {websiteId:UInt32}
                      AND ${visitorIdsFilterFor("ie.visitor_id")}
                      AND ${factAccountFilterSql("ie")}
                )
                GROUP BY session_id, website_id
            ),
            scoped AS (
                SELECT sa.*
                FROM session_activity sa
                INNER JOIN dim_sessions AS s FINAL
                    ON s.session_id = sa.session_id AND s.website_id = sa.website_id
                WHERE ${DIM_SESSION_USER_OR_SKIP_WHEN_ACCOUNT_FILTER_SQL}
            )
            SELECT coalesce(
                sum(greatest(0, dateDiff('second', activity_started_at, activity_ended_at))),
                0
            ) AS total_session_duration_sec
            FROM scoped
            `,
      params,
    );
    return Number(row?.total_session_duration_sec ?? 0);
  }

  async getVisitorScrollDepth(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row[]> {
    const params = visitorAnalyticsParams(websiteId, filter);
    return chQuery(
      client,
      `
            WITH scroll_events AS (
                SELECT
                    pv.page_path AS page_path,
                    greatest(
                        toFloat64(ie.scroll_depth),
                        ${SCROLL_DEPTH_FROM_EXTRA}
                    ) AS depth
                FROM fact_interaction_events ie
                INNER JOIN fact_page_views pv
                    ON pv.page_view_id = ie.page_view_id
                   AND pv.website_id = ie.website_id
                WHERE ie.website_id = {websiteId:UInt32}
                  AND ${visitorIdsFilterFor("ie.visitor_id")}
                  AND ${factAccountFilterSql("ie")}
                  AND ie.event_type IN (${SCROLL_EVENT_TYPES_SQL})
            )
            SELECT
                page_path,
                count() AS scroll_events,
                round(avgIf(depth, depth > 0), 1) AS avg_scroll_depth,
                round(maxIf(depth, depth > 0), 1) AS max_scroll_depth
            FROM scroll_events
            GROUP BY page_path
            HAVING max_scroll_depth > 0
            ORDER BY max_scroll_depth DESC, scroll_events DESC, page_path ASC
            ${limitClause(20)}
            `,
      params,
    );
  }

  /** Net cart/wishlist qty from add/remove events; quantity defaults to 1 when omitted in extra_data. */
  private static readonly PRODUCT_QTY_EXPR = `
    toUInt32(greatest(1, round(coalesce(JSONExtractFloat(extra_data, 'quantity'), 1))))
  `;

  private static productInteractionWhere(): string {
    return `p.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("p.visitor_id")}
              AND ${factAccountFilterSql("p")}`;
  }

  private static stagingEventWhere(alias = "s"): string {
    return `${alias}.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor(`${alias}.visitor_id`)}
              AND ${factAccountFilterSql(alias)}`;
  }

  /** props.products[] / extra_data.products[] element (Booxoo begin_checkout & purchase). */
  private static readonly PRODUCTS_ARRAY_LINE_ID = `
    coalesce(
      nullIf(JSONExtractString(line, 'productId'), ''),
      nullIf(JSONExtractString(line, 'sku'), ''),
      nullIf(JSONExtractString(line, 'id'), '')
    )
  `;

  private static readonly PRODUCTS_ARRAY_LINE_NAME = `
    coalesce(
      nullIf(JSONExtractString(line, 'productName'), ''),
      nullIf(JSONExtractString(line, 'name'), '')
    )
  `;

  private static readonly PRODUCTS_ARRAY_LINE_QTY = `
    toUInt32(greatest(1, round(coalesce(JSONExtractFloat(line, 'quantity'), 1))))
  `;

  private static readonly PRODUCTS_ARRAY_LINE_PRICE = `
    toFloat64(coalesce(JSONExtractFloat(line, 'productPrice'), JSONExtractFloat(line, 'price'), 0))
  `;

  async getVisitorProductActivity(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row> {
    const productQty = VisitorsRepository.PRODUCT_QTY_EXPR;
    const params = visitorAnalyticsParams(websiteId, filter);
    const pWhere = VisitorsRepository.productInteractionWhere();

    const [
      summaryRow,
      productsViewed,
      cartItems,
      wishlistItems,
      productDwell,
      cartAdded,
      cartRemoved,
      wishlistAdded,
      wishlistRemoved,
      checkoutStarts,
      checkoutProductLines,
      purchaseCountRow,
      purchaseOrders,
      purchaseProductLines,
    ] = await Promise.all([
      chQueryOne(
        client,
        `
            SELECT
                countIf(section = 'product_view') AS product_views,
                countIf(section = 'add_to_cart') AS cart_add_events,
                countIf(section = 'remove_from_cart') AS cart_remove_events,
                countIf(section = 'add_to_wishlist') AS wishlist_add_events,
                countIf(section = 'remove_from_wishlist') AS wishlist_remove_events,
                countIf(section = 'begin_checkout') AS checkout_starts,
                uniqExact(product_id) AS products_touched
            FROM fact_product_interactions AS p
            WHERE ${pWhere}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                product_id,
                product_name,
                countIf(section = 'product_view') AS views,
                maxIf(created_at, section = 'product_view') AS last_viewed_at
            FROM fact_product_interactions AS p
            WHERE ${pWhere}
              AND section = 'product_view'
            GROUP BY product_id, product_name
            ORDER BY views DESC, last_viewed_at DESC
            ${limitClause(20)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                product_id,
                product_name,
                sumIf(${VisitorsRepository.PRODUCT_QTY_EXPR}, section = 'add_to_cart')
                  - sumIf(${VisitorsRepository.PRODUCT_QTY_EXPR}, section = 'remove_from_cart') AS quantity,
                maxIf(created_at, section = 'add_to_cart') AS last_added_at
            FROM fact_product_interactions AS p
            WHERE ${pWhere}
              AND section IN ('add_to_cart', 'remove_from_cart')
            GROUP BY product_id, product_name
            HAVING quantity > 0
            ORDER BY quantity DESC, last_added_at DESC
            ${limitClause(20)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                product_id,
                product_name,
                sumIf(${VisitorsRepository.PRODUCT_QTY_EXPR}, section = 'add_to_wishlist')
                  - sumIf(${VisitorsRepository.PRODUCT_QTY_EXPR}, section = 'remove_from_wishlist') AS quantity,
                maxIf(created_at, section = 'add_to_wishlist') AS last_added_at
            FROM fact_product_interactions AS p
            WHERE ${pWhere}
              AND section IN ('add_to_wishlist', 'remove_from_wishlist')
            GROUP BY product_id, product_name
            HAVING quantity > 0
            ORDER BY quantity DESC, last_added_at DESC
            ${limitClause(20)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                pv.page_path AS page_path,
                p.product_id AS product_id,
                p.product_name AS product_name,
                sum(pv.time_on_page_sec) AS total_time_sec,
                count() AS page_views
            FROM fact_product_interactions AS p
            INNER JOIN fact_page_views AS pv
                ON pv.page_view_id = p.page_view_id
               AND pv.website_id = p.website_id
            WHERE p.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("p.visitor_id")}
              AND ${factAccountFilterSql("p")}
              AND p.section = 'product_view'
              AND p.page_view_id != ''
            GROUP BY pv.page_path, p.product_id, p.product_name
            ORDER BY total_time_sec DESC, page_views DESC
            ${limitClause(15)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                product_id,
                product_name,
                sum(${productQty}) AS quantity,
                count() AS events,
                max(created_at) AS last_added_at
            FROM fact_product_interactions AS p
            WHERE ${pWhere}
              AND section = 'add_to_cart'
            GROUP BY product_id, product_name
            ORDER BY last_added_at DESC
            ${limitClause(30)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                product_id,
                product_name,
                sum(${productQty}) AS quantity,
                count() AS events,
                max(created_at) AS last_removed_at
            FROM fact_product_interactions AS p
            WHERE ${pWhere}
              AND section = 'remove_from_cart'
            GROUP BY product_id, product_name
            ORDER BY last_removed_at DESC
            ${limitClause(30)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                product_id,
                product_name,
                sum(${productQty}) AS quantity,
                count() AS events,
                max(created_at) AS last_added_at
            FROM fact_product_interactions AS p
            WHERE ${pWhere}
              AND section = 'add_to_wishlist'
            GROUP BY product_id, product_name
            ORDER BY last_added_at DESC
            ${limitClause(30)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                product_id,
                product_name,
                sum(${productQty}) AS quantity,
                count() AS events,
                max(created_at) AS last_removed_at
            FROM fact_product_interactions AS p
            WHERE ${pWhere}
              AND section = 'remove_from_wishlist'
            GROUP BY product_id, product_name
            ORDER BY last_removed_at DESC
            ${limitClause(30)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                c.conversion_id AS checkout_event_id,
                c.created_at AS checkout_at,
                toFloat64(coalesce(JSONExtractFloat(c.props, 'cartValue'), 0)) AS cart_value,
                coalesce(
                    nullIf(JSONExtractString(c.props, 'currency'), ''),
                    nullIf(c.currency, ''),
                    'USD'
                ) AS currency,
                toUInt32(coalesce(JSONExtractUInt(c.props, 'itemCount'), 0)) AS item_count,
                toUInt32(length(JSONExtractArrayRaw(c.props, 'products'))) AS product_line_count
            FROM fact_conversion_events AS c
            WHERE c.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("c.visitor_id")}
              AND ${factAccountFilterSql("c")}
              AND c.conversion_type = 'begin_checkout'
            ORDER BY c.created_at DESC
            ${limitClause(30)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                c.conversion_id AS checkout_event_id,
                c.created_at AS checkout_at,
                ${VisitorsRepository.PRODUCTS_ARRAY_LINE_ID} AS product_id,
                ${VisitorsRepository.PRODUCTS_ARRAY_LINE_NAME} AS product_name,
                coalesce(nullIf(JSONExtractString(line, 'sku'), ''), '') AS sku,
                ${VisitorsRepository.PRODUCTS_ARRAY_LINE_PRICE} AS unit_price,
                coalesce(
                    nullIf(JSONExtractString(line, 'currency'), ''),
                    nullIf(JSONExtractString(c.props, 'currency'), ''),
                    nullIf(c.currency, ''),
                    'USD'
                ) AS currency,
                ${VisitorsRepository.PRODUCTS_ARRAY_LINE_QTY} AS quantity
            FROM fact_conversion_events AS c
            ARRAY JOIN JSONExtractArrayRaw(c.props, 'products') AS line
            WHERE c.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("c.visitor_id")}
              AND ${factAccountFilterSql("c")}
              AND c.conversion_type = 'begin_checkout'
              AND length(JSONExtractArrayRaw(c.props, 'products')) > 0
            ORDER BY c.created_at DESC, product_name ASC
            ${limitClause(100)}
            `,
        params,
      ),
      chQueryOne(
        client,
        `
            SELECT countIf(conversion_type = 'purchase') AS purchases
            FROM fact_conversion_events AS c
            WHERE c.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("c.visitor_id")}
              AND ${factAccountFilterSql("c")}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                c.conversion_id AS purchase_event_id,
                coalesce(nullIf(JSONExtractString(c.props, 'orderId'), ''), c.product_id, '') AS order_id,
                toFloat64(c.value) AS revenue,
                c.currency,
                c.created_at AS purchased_at
            FROM fact_conversion_events AS c
            WHERE c.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("c.visitor_id")}
              AND ${factAccountFilterSql("c")}
              AND c.conversion_type = 'purchase'
            ORDER BY c.created_at DESC
            ${limitClause(30)}
            `,
        params,
      ),
      chQuery(
        client,
        `
            SELECT
                c.conversion_id AS purchase_event_id,
                coalesce(nullIf(JSONExtractString(c.props, 'orderId'), ''), '') AS order_id,
                c.created_at AS purchased_at,
                ${VisitorsRepository.PRODUCTS_ARRAY_LINE_ID} AS product_id,
                ${VisitorsRepository.PRODUCTS_ARRAY_LINE_NAME} AS product_name,
                coalesce(nullIf(JSONExtractString(line, 'sku'), ''), '') AS sku,
                ${VisitorsRepository.PRODUCTS_ARRAY_LINE_PRICE} AS unit_price,
                coalesce(
                    nullIf(JSONExtractString(line, 'currency'), ''),
                    nullIf(JSONExtractString(c.props, 'currency'), ''),
                    nullIf(c.currency, ''),
                    'USD'
                ) AS currency,
                ${VisitorsRepository.PRODUCTS_ARRAY_LINE_QTY} AS quantity,
                toFloat64(coalesce(JSONExtractFloat(c.props, 'revenue'), toFloat64(c.value), 0)) AS order_revenue
            FROM fact_conversion_events AS c
            ARRAY JOIN JSONExtractArrayRaw(c.props, 'products') AS line
            WHERE c.website_id = {websiteId:UInt32}
              AND ${visitorIdsFilterFor("c.visitor_id")}
              AND ${factAccountFilterSql("c")}
              AND c.conversion_type = 'purchase'
              AND length(JSONExtractArrayRaw(c.props, 'products')) > 0
            ORDER BY c.created_at DESC, product_name ASC
            ${limitClause(100)}
            `,
        params,
      ),
    ]);

    const cartQty = cartItems.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    const wishlistQty = wishlistItems.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);

    return {
      summary: {
        product_views: Number(summaryRow?.product_views ?? 0),
        cart_add_events: Number(summaryRow?.cart_add_events ?? 0),
        cart_remove_events: Number(summaryRow?.cart_remove_events ?? 0),
        cart_items: cartQty,
        cart_products: cartItems.length,
        wishlist_add_events: Number(summaryRow?.wishlist_add_events ?? 0),
        wishlist_remove_events: Number(summaryRow?.wishlist_remove_events ?? 0),
        wishlist_items: wishlistQty,
        wishlist_products: wishlistItems.length,
        checkout_starts: Number(summaryRow?.checkout_starts ?? 0),
        purchases: Number(purchaseCountRow?.purchases ?? 0),
        products_touched: Number(summaryRow?.products_touched ?? 0),
      },
      products_viewed: productsViewed,
      cart: cartItems,
      wishlist: wishlistItems,
      cart_added: cartAdded,
      cart_removed: cartRemoved,
      wishlist_added: wishlistAdded,
      wishlist_removed: wishlistRemoved,
      checkout_starts: checkoutStarts,
      checkout_product_lines: checkoutProductLines,
      purchase_orders: purchaseOrders,
      purchase_product_lines: purchaseProductLines,
      product_dwell: productDwell,
    };
  }

  async getVisitorRecentInteractions(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
    limit = 5,
  ): Promise<Row[]> {
    const qty = VisitorsRepository.PRODUCT_QTY_EXPR;
    const params = visitorAnalyticsParams(websiteId, filter);
    const pWhere = VisitorsRepository.productInteractionWhere();
    return chQuery(
      client,
      `
            SELECT
                event_type,
                product_id,
                product_name,
                quantity,
                value,
                currency,
                session_id,
                created_at
            FROM (
                SELECT
                    section AS event_type,
                    product_id,
                    product_name,
                    ${qty} AS quantity,
                    toFloat64(0) AS value,
                    currency,
                    session_id,
                    created_at
                FROM fact_product_interactions AS p
                WHERE ${pWhere}
                  AND section IN (
                    'product_view',
                    'add_to_cart',
                    'remove_from_cart',
                    'add_to_wishlist',
                    'remove_from_wishlist',
                    'begin_checkout'
                  )
                UNION ALL
                SELECT
                    conversion_type AS event_type,
                    product_id,
                    '' AS product_name,
                    toUInt32(1) AS quantity,
                    toFloat64(value) AS value,
                    currency,
                    session_id,
                    created_at
                FROM fact_conversion_events AS c
                WHERE c.website_id = {websiteId:UInt32}
                  AND ${visitorIdsFilterFor("c.visitor_id")}
                  AND ${factAccountFilterSql("c")}
                  AND conversion_type = 'purchase'
            )
            ORDER BY created_at DESC
            ${limitClause(limit)}
            `,
      params,
    );
  }

  async getVisitorDailyActivity(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row[]> {
    const params = visitorAnalyticsParams(websiteId, filter);
    return chQuery(
      client,
      `
            SELECT
                day,
                sum(pageviews) AS pageviews,
                sum(interactions) AS interactions
            FROM (
                SELECT toDate(created_at) AS day, count() AS pageviews, 0 AS interactions
                FROM fact_page_views AS pv
                WHERE pv.website_id = {websiteId:UInt32}
                  AND ${visitorIdsFilterFor("pv.visitor_id")}
                  AND ${factAccountFilterSql("pv")}
                GROUP BY day
                UNION ALL
                SELECT toDate(created_at) AS day, 0 AS pageviews, count() AS interactions
                FROM fact_interaction_events AS ie
                WHERE ie.website_id = {websiteId:UInt32}
                  AND ${visitorIdsFilterFor("ie.visitor_id")}
                  AND ${factAccountFilterSql("ie")}
                GROUP BY day
            )
            GROUP BY day
            ORDER BY day ASC
            `,
      params,
    );
  }

  async getVisitorCombinedRollup(
    client: ClickHouseClient,
    websiteId: number,
    visitorIds: string[],
  ): Promise<Row> {
    const row = await chQueryOne(
      client,
      `
            SELECT
                min(created_at) AS first_seen_at,
                max(created_at) AS last_seen_at,
                uniqExact(session_id) AS total_sessions,
                count() AS total_pageviews
            FROM fact_page_views
            WHERE website_id = {websiteId:UInt32} AND ${VISITOR_IDS_FILTER_SQL}
            `,
      { websiteId, visitorIds },
    );
    return row ?? {};
  }

  async getVisitorEngagement(
    client: ClickHouseClient,
    websiteId: number,
    filter: VisitorAnalyticsFilter,
  ): Promise<Row> {
    const params = visitorAnalyticsParams(websiteId, filter);
    const row = await chQueryOne(
      client,
      `
            SELECT
                (SELECT count() FROM fact_page_views AS pv
                 WHERE pv.website_id = {websiteId:UInt32}
                   AND ${visitorIdsFilterFor("pv.visitor_id")}
                   AND ${factAccountFilterSql("pv")}) AS total_pageviews,
                (SELECT countIf(event_type = 'rage_click') FROM fact_interaction_events AS ie
                 WHERE ie.website_id = {websiteId:UInt32}
                   AND ${visitorIdsFilterFor("ie.visitor_id")}
                   AND ${factAccountFilterSql("ie")}) AS rage_clicks,
                (SELECT countIf(event_type = 'dead_click') FROM fact_interaction_events AS ie
                 WHERE ie.website_id = {websiteId:UInt32}
                   AND ${visitorIdsFilterFor("ie.visitor_id")}
                   AND ${factAccountFilterSql("ie")}) AS dead_clicks,
                (SELECT countIf(event_type = 'scroll_depth') FROM fact_interaction_events AS ie
                 WHERE ie.website_id = {websiteId:UInt32}
                   AND ${visitorIdsFilterFor("ie.visitor_id")}
                   AND ${factAccountFilterSql("ie")}) AS scroll_events,
                (SELECT round(maxIf(depth, depth > 0), 1) FROM (
                    SELECT greatest(toFloat64(scroll_depth), ${SCROLL_DEPTH_FROM_EXTRA}) AS depth
                    FROM fact_interaction_events AS ie
                    WHERE ie.website_id = {websiteId:UInt32}
                      AND ${visitorIdsFilterFor("ie.visitor_id")}
                      AND ${factAccountFilterSql("ie")}
                      AND event_type IN (${SCROLL_EVENT_TYPES_SQL})
                )) AS max_scroll_depth
            `,
      params,
    );
    return row ?? {};
  }
}

export const visitorsRepository = new VisitorsRepository();
