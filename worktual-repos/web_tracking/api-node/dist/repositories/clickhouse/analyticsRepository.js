import { chQuery, chQueryOne } from "../../plugins/clickhouse.js";
import { bounceRateByDayQuery, bounceRateScalarQuery, sessionBounceCte, } from "../../utils/bounceRate.js";
import { dateFilter, isUnboundedOverall, periodFilter, previousPeriodBounds, resolveHeavyQueryBounds, } from "../../utils/period.js";
import { limitClause, paginateClause, SCROLL_DEPTH_FROM_EXTRA, SCROLL_EVENT_TYPES_SQL } from "../../utils/clickhouseSql.js";
import { decodeReplayEventsData, mergeRrwebEvents } from "../../utils/replayDecode.js";
import { REPLAY_EVENT_NAMES } from "./heatmapRepository.js";
import { profileIdentificationJoinSql, replayListProfileJoinSqlFor, replayListProfileSelectSql, sessionProfileJoinSql, sessionProfileSelectSql, profileIdentitySelectSql, } from "../../utils/visitorIdentitySql.js";
import { buildVisitorCdpProfile, profileDisplayLabel } from "../../utils/visitorCdpProfile.js";
import { resolveSessionDisplayProfiles, sessionDisplayMapKey, } from "../../services/sessionDisplayIdentity.js";
import { CH_PRODUCT_NON_VIEW_COUNT_EXPR, CH_PRODUCT_VIEW_COUNT_EXPR, } from "../../utils/productInteractionSql.js";
/** List rows: chunk 0 present, no gaps — snapshot validity checked on replay/events only. */
function isReplayListSessionRow(row) {
    return Boolean(row.playable && !row.has_chunk_gaps);
}
/** Lightweight list row — do not decode events_data (multi-MB per session). */
function enrichReplaySessionRow(row, websiteId) {
    const minChunkIndex = Number(row.min_chunk_index ?? 0);
    const maxChunkIndex = Number(row.max_chunk_index ?? 0);
    const chunkCount = Number(row.chunk_count ?? 0);
    const eventCount = Number(row.event_count ?? 0);
    const hasChunkGaps = maxChunkIndex - minChunkIndex + 1 > chunkCount;
    const motionCount = Math.max(0, eventCount - 1);
    const isPlayable = minChunkIndex === 0 && chunkCount >= 1 && !hasChunkGaps;
    const visitorId = String(row.visitor_id ?? "");
    const cdpProfile = buildVisitorCdpProfile(row, visitorId);
    return {
        session_id: row.session_id,
        visitor_id: row.visitor_id,
        cdp_profile: cdpProfile,
        is_cdp_known: Boolean(cdpProfile),
        chunk_count: chunkCount,
        event_count: eventCount,
        record_count: eventCount,
        started_at: row.started_at,
        last_chunk_at: row.last_chunk_at,
        page_count: row.page_count,
        min_chunk_index: minChunkIndex,
        max_chunk_index: maxChunkIndex,
        has_chunk_gaps: hasChunkGaps,
        has_full_snapshot: isPlayable,
        recording_kind: motionCount < 3 ? "short" : motionCount < 10 ? "snapshot-idle" : "video",
        playable: isPlayable,
        format: "rrweb",
    };
}
/** Prior window for KPI growth. Failure returns null so the current overview still loads. */
async function loadPreviousOverview(client, websiteId, period, dateFrom, dateTo) {
    const bounds = previousPeriodBounds(period, dateFrom, dateTo);
    if (!bounds)
        return null;
    const [startExpr, endExpr] = bounds;
    const sessionFilter = dateFilter("started_at", startExpr, endExpr);
    const pageviewFilter = dateFilter("created_at", startExpr, endExpr);
    try {
        const [summary, bounce, sessionMetrics, visitorType] = await Promise.all([
            chQueryOne(client, `
            SELECT
                (SELECT uniqExact(visitor_id) FROM dim_sessions FINAL
                 WHERE website_id = {websiteId:UInt32}${sessionFilter}) AS total_visitors,
                (SELECT count() FROM fact_page_views
                 WHERE website_id = {websiteId:UInt32}${pageviewFilter}) AS total_pageviews,
                (SELECT uniqExact(session_id) FROM dim_sessions FINAL
                 WHERE website_id = {websiteId:UInt32}${sessionFilter}) AS total_sessions,
                (SELECT count() FROM fact_conversion_events
                 WHERE website_id = {websiteId:UInt32}${pageviewFilter}) AS total_conversions,
                (SELECT count() FROM fact_interaction_events
                 WHERE website_id = {websiteId:UInt32} AND event_type = 'click'${pageviewFilter}) AS total_clicks
            `, { websiteId }),
            chQueryOne(client, bounceRateScalarQuery(pageviewFilter, pageviewFilter), { websiteId }),
            chQueryOne(client, `
            WITH session_activity AS (
                SELECT
                    session_id,
                    min(event_ts) AS activity_started_at,
                    max(event_ts) AS activity_ended_at
                FROM (
                    SELECT session_id, created_at AS event_ts
                    FROM fact_page_views
                    WHERE website_id = {websiteId:UInt32}${pageviewFilter}
                    UNION ALL
                    SELECT session_id, created_at AS event_ts
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}${pageviewFilter}
                )
                GROUP BY session_id
            ),
            pageview_sessions AS (
                SELECT session_id, count() AS pageview_count
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${pageviewFilter}
                GROUP BY session_id
            )
            SELECT
                coalesce(
                    round(avg(greatest(0, dateDiff(
                        'second',
                        sa.activity_started_at,
                        sa.activity_ended_at
                    ))), 0),
                    0
                ) AS avg_session_duration_seconds,
                coalesce(round(avg(ps.pageview_count), 2), 0) AS avg_pages_per_session
            FROM session_activity sa
            INNER JOIN pageview_sessions ps ON ps.session_id = sa.session_id
            WHERE ps.pageview_count > 0
            `, { websiteId }),
            chQueryOne(client, `
            SELECT
                countIf(session_count <= 1) AS new_visitors,
                countIf(session_count > 1) AS returning_visitors
            FROM (
                SELECT visitor_id, uniqExact(session_id) AS session_count
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32}${sessionFilter}
                GROUP BY visitor_id
            )
            `, { websiteId }),
        ]);
        return {
            total_visitors: Number(summary?.total_visitors ?? 0),
            total_pageviews: Number(summary?.total_pageviews ?? 0),
            total_sessions: Number(summary?.total_sessions ?? 0),
            total_conversions: Number(summary?.total_conversions ?? 0),
            total_clicks: Number(summary?.total_clicks ?? 0),
            bounce_rate: Number(bounce?.bounce_rate ?? 0),
            avg_session_duration_seconds: Number(sessionMetrics?.avg_session_duration_seconds ?? 0),
            avg_pages_per_session: Number(sessionMetrics?.avg_pages_per_session ?? 0),
            new_visitors: Number(visitorType?.new_visitors ?? 0),
            returning_visitors: Number(visitorType?.returning_visitors ?? 0),
        };
    }
    catch (err) {
        console.error("Previous-period KPI comparison failed", err);
        return null;
    }
}
export class AnalyticsRepository {
    async getOverview(client, websiteId, period, dateFrom, dateTo) {
        const overallAllTime = isUnboundedOverall(period, dateFrom, dateTo);
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const [heavyStartExpr, heavyEndExpr] = resolveHeavyQueryBounds(period, dateFrom, dateTo);
        const sessionFilter = dateFilter("started_at", startExpr, endExpr);
        const heavySessionFilter = dateFilter("started_at", heavyStartExpr, heavyEndExpr);
        const pageviewFilter = dateFilter("created_at", startExpr, endExpr);
        const heavyPageviewFilter = dateFilter("created_at", heavyStartExpr, heavyEndExpr);
        const conversionFilter = dateFilter("created_at", startExpr, endExpr);
        const clickFilter = dateFilter("created_at", startExpr, endExpr);
        const visitorTypeFilter = overallAllTime ? heavySessionFilter : sessionFilter;
        const summary = await chQueryOne(client, `
            SELECT
                (SELECT uniqExact(visitor_id) FROM dim_sessions FINAL
                 WHERE website_id = {websiteId:UInt32}${sessionFilter}) AS total_visitors,
                (SELECT count() FROM fact_page_views
                 WHERE website_id = {websiteId:UInt32}${pageviewFilter}) AS total_pageviews,
                (SELECT uniqExact(session_id) FROM dim_sessions FINAL
                 WHERE website_id = {websiteId:UInt32}${sessionFilter}) AS total_sessions,
                (SELECT count() FROM fact_conversion_events
                 WHERE website_id = {websiteId:UInt32}${conversionFilter}) AS total_conversions,
                (SELECT count() FROM fact_interaction_events
                 WHERE website_id = {websiteId:UInt32} AND event_type = 'click'${clickFilter}) AS total_clicks
            `, { websiteId });
        const bounce = await chQueryOne(client, bounceRateScalarQuery(heavyPageviewFilter, heavyPageviewFilter), { websiteId });
        const sessionMetrics = await chQueryOne(client, `
            WITH session_activity AS (
                SELECT
                    session_id,
                    min(event_ts) AS activity_started_at,
                    max(event_ts) AS activity_ended_at
                FROM (
                    SELECT session_id, created_at AS event_ts
                    FROM fact_page_views
                    WHERE website_id = {websiteId:UInt32}${heavyPageviewFilter}
                    UNION ALL
                    SELECT session_id, created_at AS event_ts
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}${heavyPageviewFilter}
                )
                GROUP BY session_id
            ),
            pageview_sessions AS (
                SELECT session_id, count() AS pageview_count
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${heavyPageviewFilter}
                GROUP BY session_id
            )
            SELECT
                coalesce(
                    round(avg(greatest(0, dateDiff(
                        'second',
                        sa.activity_started_at,
                        sa.activity_ended_at
                    ))), 0),
                    0
                ) AS avg_session_duration_seconds,
                coalesce(round(avg(ps.pageview_count), 2), 0) AS avg_pages_per_session
            FROM session_activity sa
            INNER JOIN pageview_sessions ps ON ps.session_id = sa.session_id
            WHERE ps.pageview_count > 0
            `, { websiteId });
        const visitorType = await chQueryOne(client, `
            SELECT
                countIf(session_count <= 1) AS new_visitors,
                countIf(session_count > 1) AS returning_visitors
            FROM (
                SELECT visitor_id, uniqExact(session_id) AS session_count
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32}${visitorTypeFilter}
                GROUP BY visitor_id
            )
            `, { websiteId });
        const newVisitors = Number(visitorType?.new_visitors ?? 0);
        const returningVisitors = Number(visitorType?.returning_visitors ?? 0);
        const visitorTypeTotal = newVisitors + returningVisitors;
        const newVisitorPct = visitorTypeTotal > 0 ? Math.round((newVisitors / visitorTypeTotal) * 1000) / 10 : 0;
        const returningVisitorPct = visitorTypeTotal > 0 ? Math.round((returningVisitors / visitorTypeTotal) * 1000) / 10 : 0;
        const chart = await chQuery(client, `
                WITH
                    toDate(${heavyStartExpr}) AS chart_start,
                    toDate(${heavyEndExpr}) AS chart_end
                SELECT formatDateTime(d.day, '%b %d') AS label,
                       coalesce(pv.views, 0) AS pageviews,
                       coalesce(pv.visitors, 0) AS visitors,
                       coalesce(br.bounce_rate, 0) AS bounce_rate,
                       coalesce(ss.sessions, 0) AS sessions,
                       coalesce(ck.clicks, 0) AS clicks,
                       coalesce(cv.conversions, 0) AS conversions,
                       coalesce(dp.avg_pages, 0) AS avg_pages,
                       coalesce(dp.avg_duration, 0) AS avg_duration,
                       coalesce(vt.new_visitors, 0) AS new_visitors,
                       coalesce(vt.returning_visitors, 0) AS returning_visitors
                FROM (
                    SELECT arrayJoin(
                        arrayMap(
                            x -> chart_start + x,
                            range(toUInt32(greatest(1, dateDiff('day', chart_start, chart_end))))
                        )
                    ) AS day
                ) d
                LEFT JOIN (
                    SELECT toDate(created_at) AS day,
                           count() AS views,
                           uniqExact(visitor_id) AS visitors
                    FROM fact_page_views
                    WHERE website_id = {websiteId:UInt32}
                      AND created_at >= chart_start
                      AND created_at < chart_end
                    GROUP BY day
                ) pv ON pv.day = d.day
                LEFT JOIN (
                    ${bounceRateByDayQuery(heavyPageviewFilter, heavyPageviewFilter)}
                ) br ON br.day = d.day
                LEFT JOIN (
                    SELECT toDate(started_at) AS day,
                           uniqExact(session_id) AS sessions
                    FROM dim_sessions FINAL
                    WHERE website_id = {websiteId:UInt32}
                      AND started_at >= chart_start
                      AND started_at < chart_end
                    GROUP BY day
                ) ss ON ss.day = d.day
                LEFT JOIN (
                    SELECT toDate(created_at) AS day,
                           count() AS clicks
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}
                      AND event_type = 'click'
                      AND created_at >= chart_start
                      AND created_at < chart_end
                    GROUP BY day
                ) ck ON ck.day = d.day
                LEFT JOIN (
                    SELECT toDate(created_at) AS day,
                           count() AS conversions
                    FROM fact_conversion_events
                    WHERE website_id = {websiteId:UInt32}
                      AND created_at >= chart_start
                      AND created_at < chart_end
                    GROUP BY day
                ) cv ON cv.day = d.day
                LEFT JOIN (
                    SELECT toDate(ps.started_at) AS day,
                           coalesce(round(avg(ps.pageview_count), 2), 0) AS avg_pages,
                           coalesce(round(avg(greatest(0, dateDiff(
                               'second', sa.activity_started_at, sa.activity_ended_at
                           ))), 0), 0) AS avg_duration
                    FROM (
                        SELECT session_id,
                               count() AS pageview_count,
                               min(created_at) AS started_at
                        FROM fact_page_views
                        WHERE website_id = {websiteId:UInt32}
                          AND created_at >= chart_start
                          AND created_at < chart_end
                        GROUP BY session_id
                        HAVING pageview_count > 0
                    ) ps
                    INNER JOIN (
                        SELECT session_id,
                               min(event_ts) AS activity_started_at,
                               max(event_ts) AS activity_ended_at
                        FROM (
                            SELECT session_id, created_at AS event_ts
                            FROM fact_page_views
                            WHERE website_id = {websiteId:UInt32}
                              AND created_at >= chart_start
                              AND created_at < chart_end
                            UNION ALL
                            SELECT session_id, created_at AS event_ts
                            FROM fact_interaction_events
                            WHERE website_id = {websiteId:UInt32}
                              AND created_at >= chart_start
                              AND created_at < chart_end
                        )
                        GROUP BY session_id
                    ) sa ON sa.session_id = ps.session_id
                    GROUP BY day
                ) dp ON dp.day = d.day
                LEFT JOIN (
                    SELECT toDate(s.started_at) AS day,
                           uniqExactIf(s.visitor_id, c.session_count <= 1) AS new_visitors,
                           uniqExactIf(s.visitor_id, c.session_count > 1) AS returning_visitors
                    FROM dim_sessions AS s FINAL
                    INNER JOIN (
                        SELECT visitor_id, uniqExact(session_id) AS session_count
                        FROM dim_sessions FINAL
                        WHERE website_id = {websiteId:UInt32}
                          AND started_at >= chart_start
                          AND started_at < chart_end
                        GROUP BY visitor_id
                    ) c ON c.visitor_id = s.visitor_id
                    WHERE s.website_id = {websiteId:UInt32}
                      AND s.started_at >= chart_start
                      AND s.started_at < chart_end
                    GROUP BY day
                ) vt ON vt.day = d.day
                ORDER BY d.day
                `, { websiteId });
        return {
            period,
            website_id: websiteId,
            total_visitors: summary?.total_visitors ?? 0,
            total_pageviews: summary?.total_pageviews ?? 0,
            total_sessions: summary?.total_sessions ?? 0,
            total_conversions: summary?.total_conversions ?? 0,
            total_clicks: summary?.total_clicks ?? 0,
            bounce_rate: Number(bounce?.bounce_rate ?? 0),
            avg_session_duration_seconds: Number(sessionMetrics?.avg_session_duration_seconds ?? 0),
            avg_pages_per_session: Number(sessionMetrics?.avg_pages_per_session ?? 0),
            new_visitors: newVisitors,
            returning_visitors: returningVisitors,
            new_visitor_percentage: newVisitorPct,
            returning_visitor_percentage: returningVisitorPct,
            visitor_type_chart: [
                { source: "New visitors", visitors: newVisitors, percentage: newVisitorPct },
                { source: "Returning visitors", visitors: returningVisitors, percentage: returningVisitorPct },
            ],
            chart,
            previous: await loadPreviousOverview(client, websiteId, period, dateFrom, dateTo),
        };
    }
    async getEngagement(client, websiteId, period, limit = 10) {
        const [startExpr, endExpr] = resolveHeavyQueryBounds(period);
        const createdFilter = dateFilter("created_at", startExpr, endExpr);
        const ieCreatedFilter = dateFilter("ie.created_at", startExpr, endExpr);
        const summary = await chQueryOne(client, `
            SELECT
                (
                    SELECT count()
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}
                      AND event_type = 'rage_click'${createdFilter}
                ) AS total_rage_clicks,
                (
                    SELECT count()
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}
                      AND event_type = 'dead_click'${createdFilter}
                ) AS total_dead_clicks
            `, { websiteId });
        const pages = await chQuery(client, `
            SELECT
                pv.page_path AS page_path,
                countIf(ie.event_type = 'rage_click') AS rage_clicks,
                countIf(ie.event_type = 'dead_click') AS dead_clicks,
                countIf(ie.event_type IN ('rage_click', 'dead_click')) AS total_friction_events
            FROM fact_interaction_events ie
            JOIN fact_page_views pv
              ON pv.page_view_id = ie.page_view_id
             AND pv.website_id = ie.website_id
            WHERE ie.website_id = {websiteId:UInt32}
              AND ie.event_type IN ('rage_click', 'dead_click')${ieCreatedFilter}
            GROUP BY page_path
            ORDER BY total_friction_events DESC, rage_clicks DESC
            ${limitClause(limit)}
            `, { websiteId });
        return {
            period,
            website_id: websiteId,
            total_rage_clicks: summary?.total_rage_clicks ?? 0,
            total_dead_clicks: summary?.total_dead_clicks ?? 0,
            pages,
        };
    }
    async getLive(client, websiteId, organizationId) {
        const rows = await chQuery(client, `
            WITH recent_fact AS (
                SELECT session_id, max(event_ts) AS last_fact_at
                FROM (
                    SELECT session_id, created_at AS event_ts
                    FROM fact_page_views
                    WHERE website_id = {websiteId:UInt32}
                      AND created_at >= now() - INTERVAL 5 MINUTE
                    UNION ALL
                    SELECT session_id, created_at AS event_ts
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}
                      AND created_at >= now() - INTERVAL 5 MINUTE
                    UNION ALL
                    SELECT session_id, created_at AS event_ts
                    FROM fact_custom_events
                    WHERE website_id = {websiteId:UInt32}
                      AND created_at >= now() - INTERVAL 5 MINUTE
                    UNION ALL
                    SELECT session_id, created_at AS event_ts
                    FROM fact_product_interactions
                    WHERE website_id = {websiteId:UInt32}
                      AND created_at >= now() - INTERVAL 5 MINUTE
                    UNION ALL
                    SELECT session_id, received_at AS event_ts
                    FROM events_staging
                    WHERE website_id = {websiteId:UInt32}
                      AND received_at >= now() - INTERVAL 5 MINUTE
                )
                GROUP BY session_id
            ),
            page_view_rows AS (
                SELECT session_id, visitor_id, page_path, created_at AS event_ts
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}
                  AND page_path != ''
                UNION ALL
                SELECT session_id, visitor_id, page_path, event_ts
                FROM (
                    SELECT
                        session_id,
                        visitor_id,
                        coalesce(
                            nullIf(JSONExtractString(props_json, 'path'), ''),
                            nullIf(JSONExtractString(props_json, 'pagePath'), ''),
                            ''
                        ) AS page_path,
                        received_at AS event_ts
                    FROM events_staging
                    WHERE website_id = {websiteId:UInt32}
                      AND event_name = 'page_view'
                      AND received_at >= now() - INTERVAL 60 MINUTE
                )
                WHERE page_path != ''
            ),
            session_last_page AS (
                SELECT
                    session_id,
                    argMax(page_path, event_ts) AS current_page,
                    max(event_ts) AS last_page_at
                FROM page_view_rows
                GROUP BY session_id
            ),
            visitor_last_page AS (
                SELECT
                    visitor_id,
                    argMax(page_path, event_ts) AS current_page,
                    max(event_ts) AS last_page_at
                FROM page_view_rows
                WHERE visitor_id != ''
                GROUP BY visitor_id
            )
            SELECT
                s.session_id AS session_id,
                s.visitor_id AS visitor_id,
                coalesce(
                    nullIf(slp.current_page, ''),
                    nullIf(vlp.current_page, ''),
                    nullIf(s.exit_page, ''),
                    '/'
                ) AS current_page,
                toUnixTimestamp64Milli(
                    coalesce(
                        slp.last_page_at,
                        vlp.last_page_at,
                        toDateTime64('1970-01-01', 3, 'UTC')
                    )
                ) AS current_page_ts,
                s.country AS country,
                least(
                    greatest(
                        coalesce(s.ended_at, toDateTime64('1970-01-01', 3, 'UTC')),
                        coalesce(
                            slp.last_page_at,
                            vlp.last_page_at,
                            toDateTime64('1970-01-01', 3, 'UTC')
                        ),
                        coalesce(rf.last_fact_at, toDateTime64('1970-01-01', 3, 'UTC'))
                    ),
                    now64(3, 'UTC')
                ) AS last_activity
            FROM dim_sessions AS s FINAL
            LEFT JOIN session_last_page slp ON slp.session_id = s.session_id
            LEFT JOIN visitor_last_page vlp ON vlp.visitor_id = s.visitor_id
            LEFT JOIN recent_fact rf ON rf.session_id = s.session_id
            WHERE s.website_id = {websiteId:UInt32}
              AND least(
                    greatest(
                        coalesce(s.ended_at, toDateTime64('1970-01-01', 3, 'UTC')),
                        coalesce(
                            slp.last_page_at,
                            vlp.last_page_at,
                            toDateTime64('1970-01-01', 3, 'UTC')
                        ),
                        coalesce(rf.last_fact_at, toDateTime64('1970-01-01', 3, 'UTC'))
                    ),
                    now64(3, 'UTC')
                ) >= now() - INTERVAL 5 MINUTE
            ORDER BY last_activity DESC
            `, { websiteId });
        const keys = rows
            .map((row) => ({
            session_id: String(row.session_id ?? row["s.session_id"] ?? "").trim(),
            visitor_id: String(row.visitor_id ?? row["s.visitor_id"] ?? "").trim(),
        }))
            .filter((key) => key.session_id && key.visitor_id);
        const profileBySessionKey = await resolveSessionDisplayProfiles(client, websiteId, organizationId, keys);
        const sessions = rows.map((row) => {
            const visitorId = String(row.visitor_id ?? row["s.visitor_id"] ?? "").trim();
            const sessionId = String(row.session_id ?? row["s.session_id"] ?? "").trim();
            const cdpProfile = profileBySessionKey.get(sessionDisplayMapKey({ session_id: sessionId, visitor_id: visitorId })) ??
                null;
            return {
                session_id: row.session_id ?? row["s.session_id"],
                visitor_id: visitorId,
                current_page: row.current_page,
                current_page_ts: Number(row.current_page_ts ?? 0),
                country: row.country,
                last_activity: row.last_activity,
                cdp_profile: cdpProfile,
                last_active_profile_label: profileDisplayLabel(cdpProfile),
            };
        });
        const activeUsers = new Set(sessions.map((s) => String(s.visitor_id ?? "").trim()).filter((id) => id.length > 0)).size;
        return {
            active_users: activeUsers,
            active_sessions: sessions.length,
            sessions,
        };
    }
    async getPageDropoff(client, websiteId, period, limit = 5) {
        const [startExpr, endExpr] = resolveHeavyQueryBounds(period);
        const sessionFilter = dateFilter("s.started_at", startExpr, endExpr);
        const pageviewFilter = dateFilter("created_at", startExpr, endExpr);
        const totalRow = await chQueryOne(client, `
            WITH last_page AS (
                SELECT
                    session_id,
                    argMax(page_path, created_at) AS last_page_path
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}
                  AND length(page_path) > 0${pageviewFilter}
                GROUP BY session_id
            )
            SELECT count() AS total_exit_sessions
            FROM dim_sessions AS s FINAL
            LEFT JOIN last_page lp ON lp.session_id = s.session_id
            WHERE s.website_id = {websiteId:UInt32}${sessionFilter}
            `, { websiteId });
        const pages = await chQuery(client, `
            WITH last_page AS (
                SELECT
                    session_id,
                    argMax(page_path, created_at) AS last_page_path
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}
                  AND length(page_path) > 0${pageviewFilter}
                GROUP BY session_id
            ),
            exits AS (
                SELECT
                    coalesce(
                        nullIf(trim(s.exit_page), ''),
                        nullIf(trim(lp.last_page_path), ''),
                        nullIf(trim(s.entry_page), ''),
                        '/'
                    ) AS page_path
                FROM dim_sessions AS s FINAL
                LEFT JOIN last_page lp ON lp.session_id = s.session_id
                WHERE s.website_id = {websiteId:UInt32}${sessionFilter}
            ),
            totals AS (
                SELECT count() AS total_exits FROM exits
            )
            SELECT
                e.page_path AS page_path,
                count() AS exit_sessions,
                round(count() * 100.0 / greatest(t.total_exits, 1), 1) AS dropoff_pct
            FROM exits AS e
            CROSS JOIN totals AS t
            GROUP BY e.page_path, t.total_exits
            ORDER BY exit_sessions DESC
            ${limitClause(limit)}
            `, { websiteId });
        const totalExitSessions = Number(totalRow?.total_exit_sessions ?? 0);
        return {
            period,
            website_id: websiteId,
            total_exit_sessions: totalExitSessions,
            pages,
        };
    }
    async getTopPages(client, websiteId, period, limit = 10) {
        const [startExpr, endExpr] = resolveHeavyQueryBounds(period);
        const pageviewFilter = dateFilter("created_at", startExpr, endExpr);
        return chQuery(client, `
            SELECT page_path, count() AS views, uniqExact(visitor_id) AS unique_visitors
            FROM fact_page_views
            WHERE website_id = {websiteId:UInt32}${pageviewFilter}
            GROUP BY page_path
            ORDER BY views DESC
            ${limitClause(limit)}
            `, { websiteId });
    }
    async getScrollDepth(client, websiteId, period, limit = 10) {
        const [startExpr, endExpr] = resolveHeavyQueryBounds(period);
        const pageviewFilter = dateFilter("created_at", startExpr, endExpr);
        const interactionFilter = dateFilter("ie.created_at", startExpr, endExpr);
        const pages = await chQuery(client, `
            SELECT
                pv.page_path,
                count() AS page_views,
                round(avg(greatest(
                    toFloat64(coalesce(pv.max_scroll_depth, 0)),
                    coalesce(scroll_agg.max_depth, 0)
                )), 1) AS avg_scroll_depth,
                round(max(greatest(
                    toFloat64(coalesce(pv.max_scroll_depth, 0)),
                    coalesce(scroll_agg.max_depth, 0)
                )), 1) AS max_scroll_depth
            FROM fact_page_views pv
            LEFT JOIN (
                SELECT
                    page_view_id,
                    website_id,
                    max(greatest(
                        toFloat64(scroll_depth),
                        ${SCROLL_DEPTH_FROM_EXTRA}
                    )) AS max_depth
                FROM fact_interaction_events ie
                WHERE ie.website_id = {websiteId:UInt32}
                  AND ie.event_type IN (${SCROLL_EVENT_TYPES_SQL})${interactionFilter}
                GROUP BY page_view_id, website_id
            ) scroll_agg
              ON scroll_agg.page_view_id = pv.page_view_id
             AND scroll_agg.website_id = pv.website_id
            WHERE pv.website_id = {websiteId:UInt32}${pageviewFilter}
            GROUP BY pv.page_path
            HAVING max(greatest(
                toFloat64(coalesce(pv.max_scroll_depth, 0)),
                coalesce(scroll_agg.max_depth, 0)
            )) > 0
            ORDER BY max_scroll_depth DESC, page_views DESC
            ${limitClause(limit)}
            `, { websiteId });
        return { period, website_id: websiteId, pages };
    }
    async getTrafficSourceSessions(client, websiteId, period) {
        const [startExpr, endExpr] = resolveHeavyQueryBounds(period);
        const pageviewFilter = dateFilter("created_at", startExpr, endExpr);
        const sessionStartFilter = dateFilter("b.session_started_at", startExpr, endExpr);
        return chQuery(client, `
            WITH ${sessionBounceCte(pageviewFilter, pageviewFilter)}
            SELECT
                s.session_id,
                s.visitor_id,
                s.referrer,
                s.referrer_domain,
                s.utm_source,
                s.utm_medium,
                s.utm_campaign,
                b.pageview_count,
                b.duration_seconds,
                coalesce(c.conversions, 0) AS conversions
            FROM session_bounce b
            INNER JOIN dim_sessions AS s FINAL
                ON s.session_id = b.session_id AND s.website_id = {websiteId:UInt32}
            LEFT JOIN (
                SELECT session_id, count() AS conversions
                FROM fact_conversion_events
                WHERE website_id = {websiteId:UInt32}
                GROUP BY session_id
            ) c ON c.session_id = b.session_id
            WHERE 1 = 1${sessionStartFilter}
            `, { websiteId });
    }
    async getBrowserSessions(client, websiteId, period) {
        const [startExpr, endExpr] = resolveHeavyQueryBounds(period);
        const sessionFilter = dateFilter("started_at", startExpr, endExpr);
        return chQuery(client, `
            SELECT session_id, visitor_id, user_agent
            FROM dim_sessions FINAL
            WHERE website_id = {websiteId:UInt32}${sessionFilter}
            `, { websiteId });
    }
    async getGeographySessions(client, websiteId, period) {
        const [startExpr, endExpr] = resolveHeavyQueryBounds(period);
        const sessionFilter = dateFilter("started_at", startExpr, endExpr);
        return chQuery(client, `
            SELECT session_id, visitor_id, country, city, region
            FROM dim_sessions FINAL
            WHERE website_id = {websiteId:UInt32}${sessionFilter}
            `, { websiteId });
    }
    async getForms(client, websiteId, period, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const dateFilterSql = dateFilter("created_at", startExpr, endExpr);
        const funnel = await chQuery(client, `
            SELECT event_type, count() AS count
            FROM fact_form_events
            WHERE website_id = {websiteId:UInt32}${dateFilterSql}
            GROUP BY event_type
            ORDER BY count DESC
            `, { websiteId });
        const byForm = await chQuery(client, `
            SELECT form_id, form_name,
                   countIf(event_type = 'form_view') AS views,
                   countIf(event_type = 'form_submit') AS submits,
                   countIf(event_type = 'form_success') AS successes,
                   countIf(event_type = 'form_abandon') AS abandons
            FROM fact_form_events
            WHERE website_id = {websiteId:UInt32}${dateFilterSql}
            GROUP BY form_id, form_name
            ORDER BY views DESC
            LIMIT 50
            `, { websiteId });
        const leadSummary = await chQueryOne(client, `
            SELECT uniqExact(visitor_id) AS lead_captures
            FROM fact_form_events
            WHERE website_id = {websiteId:UInt32}${dateFilterSql}
              AND visitor_id != ''
              AND (
                (
                  event_type IN ('form_blur', 'form_change')
                  AND field_name IN ('email', 'mobileNo', 'mobile', 'phone', 'name', 'fullName', 'companyName', 'company')
                  AND field_value != ''
                )
                OR event_type = 'form_submit'
              )
            `, { websiteId });
        return {
            period,
            funnel,
            by_form: byForm,
            lead_captures: Number(leadSummary?.lead_captures ?? 0),
        };
    }
    async getFormSubmissions(client, websiteId, period, formId, limit, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const dateFilterSql = dateFilter("created_at", startExpr, endExpr);
        const safeLimit = Math.min(Math.max(limit, 1), 50);
        const rows = await chQuery(client, `
            SELECT
                event_id,
                created_at,
                form_id,
                form_name,
                page_path,
                visitor_id,
                session_id,
                coalesce(nullIf(JSONExtractRaw(extra_data, 'fields'), ''), '{}') AS fields_json
            FROM fact_form_events
            WHERE website_id = {websiteId:UInt32}
              AND event_type = 'form_submit'
              AND form_id = {formId:String}
              ${dateFilterSql}
            ORDER BY created_at DESC
            LIMIT {limit:UInt32}
            `, { websiteId, formId, limit: safeLimit });
        const submissions = rows.map((row) => {
            let fields = {};
            const raw = String(row.fields_json ?? "{}");
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    fields = parsed;
                }
            }
            catch {
                fields = {};
            }
            return {
                event_id: row.event_id,
                created_at: row.created_at,
                form_id: row.form_id,
                form_name: row.form_name,
                page_path: row.page_path,
                visitor_id: row.visitor_id,
                session_id: row.session_id,
                fields,
            };
        });
        return { period, form_id: formId, submissions };
    }
    async getFormLeads(client, websiteId, period, formId, limit, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const dateFilterSql = dateFilter("created_at", startExpr, endExpr);
        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const partialRows = await chQuery(client, `
            SELECT
                visitor_id,
                field_name,
                argMax(field_value, evt_time) AS latest_field_value,
                max(evt_time) AS last_seen_at
            FROM (
                SELECT
                    visitor_id,
                    field_name,
                    field_value,
                    created_at AS evt_time
                FROM fact_form_events
                WHERE website_id = {websiteId:UInt32}
                  AND form_id = {formId:String}
                  AND event_type IN ('form_blur', 'form_change')
                  AND field_name != ''
                  AND field_value != ''
                  AND visitor_id != ''
                  ${dateFilterSql}
            )
            GROUP BY visitor_id, field_name
            `, { websiteId, formId });
        const submitPayload = await this.getFormSubmissions(client, websiteId, period, formId, safeLimit, dateFrom, dateTo);
        const submissions = submitPayload.submissions ?? [];
        const leadsMap = new Map();
        for (const row of partialRows) {
            const visitorId = String(row.visitor_id ?? "");
            if (!visitorId)
                continue;
            const existing = leadsMap.get(visitorId) ?? {
                visitor_id: visitorId,
                fields: {},
                last_seen_at: null,
                submitted_at: null,
                status: "partial",
                page_path: "",
            };
            existing.fields[String(row.field_name)] = String(row.latest_field_value ?? row.field_value ?? "");
            const seenAt = row.last_seen_at ? String(row.last_seen_at) : null;
            if (seenAt && (!existing.last_seen_at || seenAt > existing.last_seen_at)) {
                existing.last_seen_at = seenAt;
            }
            leadsMap.set(visitorId, existing);
        }
        for (const submission of submissions) {
            const visitorId = String(submission.visitor_id ?? "");
            if (!visitorId)
                continue;
            const existing = leadsMap.get(visitorId) ?? {
                visitor_id: visitorId,
                fields: {},
                last_seen_at: null,
                submitted_at: null,
                status: "partial",
                page_path: "",
            };
            const submitFields = submission.fields;
            for (const [key, value] of Object.entries(submitFields ?? {})) {
                if (value !== null && value !== undefined && String(value).trim() !== "") {
                    existing.fields[key] = String(value);
                }
            }
            existing.status = "submitted";
            existing.submitted_at = submission.created_at ? String(submission.created_at) : existing.submitted_at;
            existing.last_seen_at = submission.created_at ? String(submission.created_at) : existing.last_seen_at;
            existing.page_path = submission.page_path ? String(submission.page_path) : existing.page_path;
            leadsMap.set(visitorId, existing);
        }
        const contactKeys = new Set([
            "email",
            "workEmail",
            "mobileNo",
            "mobile",
            "phone",
            "name",
            "fullName",
            "companyName",
            "company",
        ]);
        const leads = Array.from(leadsMap.values())
            .map((lead) => {
            const email = lead.fields.email ?? lead.fields.workEmail ?? "";
            const mobile = lead.fields.mobileNo ?? lead.fields.mobile ?? lead.fields.phone ?? "";
            const name = lead.fields.name ?? lead.fields.fullName ?? "";
            const other = {};
            for (const [key, value] of Object.entries(lead.fields)) {
                if (!contactKeys.has(key)) {
                    other[key] = value;
                }
            }
            return {
                visitor_id: lead.visitor_id,
                status: lead.status,
                last_seen_at: lead.last_seen_at,
                submitted_at: lead.submitted_at,
                page_path: lead.page_path,
                email,
                mobile,
                name,
                company: lead.fields.companyName ?? lead.fields.company ?? "",
                message: lead.fields.message ?? "",
                other_fields: other,
            };
        })
            .filter((lead) => lead.email || lead.mobile || lead.name || lead.company)
            .sort((a, b) => String(b.last_seen_at ?? "").localeCompare(String(a.last_seen_at ?? "")))
            .slice(0, safeLimit);
        return { period, form_id: formId, leads };
    }
    async getPerformance(client, websiteId, period, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const dateFilterSql = dateFilter("created_at", startExpr, endExpr);
        const metrics = await chQuery(client, `
            SELECT metric_name,
                   round(quantile(0.5)(metric_value), 2) AS p50,
                   round(quantile(0.75)(metric_value), 2) AS p75,
                   round(quantile(0.95)(metric_value), 2) AS p95,
                   count() AS samples
            FROM fact_performance_events
            WHERE website_id = {websiteId:UInt32} AND metric_value > 0${dateFilterSql}
            GROUP BY metric_name
            ORDER BY metric_name
            `, { websiteId });
        return { period, metrics };
    }
    async getErrors(client, websiteId, period, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const dateFilterSql = dateFilter("created_at", startExpr, endExpr);
        const errors = await chQuery(client, `
            SELECT error_type, message, count() AS count, max(created_at) AS last_seen
            FROM fact_error_events
            WHERE website_id = {websiteId:UInt32}${dateFilterSql}
            GROUP BY error_type, message
            ORDER BY count DESC
            LIMIT 100
            `, { websiteId });
        return { period, errors };
    }
    async getCustomEvents(client, websiteId, period, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const dateFilterSql = dateFilter("created_at", startExpr, endExpr);
        const events = await chQuery(client, `
            SELECT event_name, count() AS count, max(created_at) AS last_seen
            FROM fact_custom_events
            WHERE website_id = {websiteId:UInt32}${dateFilterSql}
            GROUP BY event_name
            ORDER BY count DESC
            LIMIT 100
            `, { websiteId });
        return { period, events };
    }
    async getProducts(client, websiteId, period, limit = 20) {
        const [startExpr, endExpr] = periodFilter(period);
        const productFilter = dateFilter("created_at", startExpr, endExpr);
        const products = await chQuery(client, `
            SELECT
                product_id,
                coalesce(max(product_name), product_id) AS product_name,
                max(product_category) AS product_category,
                max(product_brand) AS product_brand,
                max(product_price) AS product_price,
                max(currency) AS currency,
                ${CH_PRODUCT_VIEW_COUNT_EXPR} AS views,
                countIf(section = 'add_to_cart') AS cart_adds,
                ${CH_PRODUCT_NON_VIEW_COUNT_EXPR} AS interactions,
                count() AS engagement,
                uniqExact(visitor_id) AS unique_visitors,
                uniqExact(session_id) AS sessions
            FROM fact_product_interactions
            WHERE website_id = {websiteId:UInt32}${productFilter}
            GROUP BY product_id
            ORDER BY engagement DESC, views DESC, unique_visitors DESC
            ${limitClause(limit)}
            `, { websiteId });
        return { period, website_id: websiteId, products };
    }
    async getSessions(client, websiteId, period, dateFrom, dateTo, offset = 0, limit = 20) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const pageviewFilter = dateFilter("created_at", startExpr, endExpr);
        const sessionStartFilter = dateFilter("b.session_started_at", startExpr, endExpr);
        const sessions = await chQuery(client, `
            WITH ${sessionBounceCte(pageviewFilter, pageviewFilter)},
            session_activity_bounds AS (
                SELECT
                    session_id,
                    max(event_ts) AS activity_ended_at
                FROM (
                    SELECT session_id, created_at AS event_ts
                    FROM fact_page_views
                    WHERE website_id = {websiteId:UInt32}${pageviewFilter}
                    UNION ALL
                    SELECT session_id, created_at AS event_ts
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}${pageviewFilter}
                )
                GROUP BY session_id
            )
            SELECT
                s.session_id AS session_id,
                s.visitor_id AS visitor_id,
                s.user_id AS user_id,
                coalesce(s.entry_page, '') AS entry_page,
                coalesce(s.exit_page, '') AS exit_page,
                s.country AS country,
                s.city AS city,
                b.pageview_count,
                b.duration_seconds,
                b.is_bounce,
                b.session_started_at AS started_at,
                coalesce(ab.activity_ended_at, b.session_started_at) AS ended_at,
                ${sessionProfileSelectSql()}
            FROM session_bounce b
            INNER JOIN dim_sessions AS s FINAL
                ON s.session_id = b.session_id AND s.website_id = {websiteId:UInt32}
            LEFT JOIN session_activity_bounds ab ON ab.session_id = b.session_id
            ${sessionProfileJoinSql("s.session_id", "s.visitor_id")}
            WHERE 1 = 1${sessionStartFilter}
            ORDER BY b.session_started_at DESC
            ${paginateClause(offset, limit)}
            `, { websiteId, selectedUserId: "" });
        const totalRow = await chQueryOne(client, `
            WITH ${sessionBounceCte(pageviewFilter, pageviewFilter)}
            SELECT count() AS total FROM session_bounce b
            WHERE 1 = 1${sessionStartFilter}
            `, { websiteId });
        return { period, total: totalRow?.total ?? 0, sessions };
    }
    async sessionExists(client, websiteId, sessionId) {
        const row = await chQueryOne(client, `
            SELECT 1 AS ok FROM dim_sessions FINAL
            WHERE website_id = {websiteId:UInt32} AND session_id = {sessionId:String}
            LIMIT 1
            `, { websiteId, sessionId });
        return row !== null;
    }
    async sessionHasReplay(client, websiteId, sessionId) {
        const row = await chQueryOne(client, `
            SELECT 1 AS ok FROM fact_replay_chunks
            WHERE website_id = {websiteId:UInt32} AND session_id = {sessionId:String}
            LIMIT 1
            `, { websiteId, sessionId });
        if (row)
            return true;
        const legacy = await chQueryOne(client, `
            SELECT 1 AS ok FROM fact_custom_events
            WHERE website_id = {websiteId:UInt32} AND session_id = {sessionId:String}
              AND event_name IN ('rrweb', 'rrweb_event', 'replay_event', 'replay_chunk', 'session_replay')
            LIMIT 1
            `, { websiteId, sessionId });
        return legacy !== null;
    }
    async getReplaySessions(client, websiteId, organizationId, period, dateFrom, dateTo, offset = 0, limit = 20, sessionSearch, visitorSearch, filterUserId) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const dateFilterRc = dateFilter("rc.created_at", startExpr, endExpr);
        const sessionVal = String(sessionSearch ?? "").trim();
        const visitorVal = String(visitorSearch ?? "").trim();
        const sessionFilterRc = sessionVal
            ? " AND positionCaseInsensitive(rc.session_id, {sessionSearch:String}) > 0"
            : "";
        const visitorFilterRc = visitorVal
            ? " AND positionCaseInsensitive(rc.visitor_id, {visitorSearch:String}) > 0"
            : "";
        const idFiltersRc = `${sessionFilterRc}${visitorFilterRc}`;
        const params = {
            websiteId,
            offset,
            limit,
            organizationId,
            selectedUserId: "",
        };
        if (sessionVal)
            params.sessionSearch = sessionVal;
        if (visitorVal)
            params.visitorSearch = visitorVal;
        const profileJoin = organizationId > 0 ? replayListProfileJoinSqlFor("base.visitor_id") : "";
        const profileSelect = organizationId > 0 ? `,\n                ${replayListProfileSelectSql()}` : "";
        const orderBy = "ORDER BY base.last_chunk_at DESC, base.session_id DESC";
        const latestRecordingRow = await chQueryOne(client, `
            SELECT max(rc.created_at) AS latest_recording_at
            FROM fact_replay_chunks AS rc
            WHERE rc.website_id = {websiteId:UInt32}${dateFilterRc}${idFiltersRc}
            `, params);
        const latestRecordingAt = latestRecordingRow?.latest_recording_at ?? null;
        const playableHaving = `
                HAVING min(rc.chunk_index) = 0
                   AND count() >= 1
                   AND (max(rc.chunk_index) - min(rc.chunk_index) + 1) <= count()`;
        const rrwebTotalRow = await chQueryOne(client, `
            SELECT count() AS total
            FROM (
                SELECT rc.session_id
                FROM fact_replay_chunks AS rc
                WHERE rc.website_id = {websiteId:UInt32}${dateFilterRc}${idFiltersRc}
                GROUP BY rc.session_id
                ${playableHaving}
            )
            `, params);
        const rrwebTotal = Number(rrwebTotalRow?.total ?? 0);
        if (rrwebTotal === 0) {
            return {
                sessions: [],
                total: 0,
                format: "rrweb",
                offset,
                limit,
                latest_recording_at: latestRecordingAt,
            };
        }
        const safeOffset = Math.max(0, Math.floor(offset));
        const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
        params.listOffset = safeOffset;
        params.listLimit = safeLimit;
        const sessions = await chQuery(client, `
            SELECT
                base.session_id AS session_id,
                base.visitor_id AS visitor_id,
                base.chunk_count AS chunk_count,
                base.event_count AS event_count,
                base.started_at AS started_at,
                base.last_chunk_at AS last_chunk_at,
                base.page_count AS page_count,
                base.min_chunk_index AS min_chunk_index,
                base.max_chunk_index AS max_chunk_index,
                base.session_user_id AS session_user_id${profileSelect}
            FROM (
                SELECT
                    rc.session_id AS session_id,
                    any(rc.visitor_id) AS visitor_id,
                    count() AS chunk_count,
                    sum(rc.event_count) AS event_count,
                    min(rc.created_at) AS started_at,
                    max(rc.created_at) AS last_chunk_at,
                    uniqExact(rc.page_view_id) AS page_count,
                    min(rc.chunk_index) AS min_chunk_index,
                    max(rc.chunk_index) AS max_chunk_index,
                    argMax(rc.user_id, rc.created_at) AS session_user_id
                FROM fact_replay_chunks rc
                WHERE rc.website_id = {websiteId:UInt32}${dateFilterRc}${idFiltersRc}
                GROUP BY rc.session_id
                ${playableHaving}
            ) AS base
            ${profileJoin}
            ${orderBy}
            LIMIT {listLimit:UInt32} OFFSET {listOffset:UInt32}
            `, params);
        const listSessions = sessions
            .map((row) => enrichReplaySessionRow(row, websiteId))
            .filter(isReplayListSessionRow);
        return {
            sessions: listSessions,
            total: rrwebTotal,
            offset,
            limit,
            format: "rrweb",
            latest_recording_at: latestRecordingAt,
        };
    }
    async getReplayEvents(client, websiteId, sessionId, period, dateFrom, dateTo, pagePath, limit = 500) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const dateFilterSql = dateFilter("rc.created_at", startExpr, endExpr);
        let pageFilter = "";
        const params = { websiteId, sessionId };
        if (pagePath) {
            pageFilter = `
          AND rc.page_view_id IN (
            SELECT page_view_id FROM fact_page_views
            WHERE website_id = {websiteId:UInt32} AND page_path = {pagePath:String}
          )
        `;
            params.pagePath = pagePath;
        }
        const rrwebChunks = await chQuery(client, `
            SELECT
                rc.chunk_index,
                rc.encoding,
                rc.events_data,
                rc.event_count,
                rc.page_view_id,
                rc.created_at
            FROM fact_replay_chunks rc
            WHERE rc.website_id = {websiteId:UInt32}
              AND rc.session_id = {sessionId:String}
              ${pageFilter}
              ${dateFilterSql}
            ORDER BY rc.chunk_index ASC
            LIMIT 200
            `, params);
        if (rrwebChunks.length > 0) {
            const decoded = rrwebChunks.map((row) => decodeReplayEventsData(String(row.encoding ?? "gzip_b64"), String(row.events_data ?? "")));
            let events = mergeRrwebEvents(decoded);
            if (limit > 0 && events.length > limit)
                events = events.slice(0, limit);
            const minChunkIndex = Number(rrwebChunks[0]?.chunk_index ?? 0);
            return {
                format: "rrweb",
                events,
                chunkCount: rrwebChunks.length,
                storage: "fact_replay_chunks",
                minChunkIndex,
            };
        }
        const replayNamesSql = REPLAY_EVENT_NAMES.map((n) => `'${n}'`).join(", ");
        const legacyRows = await chQuery(client, `
            SELECT ce.event_data, ce.created_at
            FROM fact_custom_events ce
            WHERE ce.website_id = {websiteId:UInt32}
              AND ce.session_id = {sessionId:String}
              AND (
                ce.event_name IN (${replayNamesSql})
                OR coalesce(JSONExtractString(ce.event_data, 'source'), '') IN ('replay', 'rrweb', 'session_replay')
              )
              ${dateFilter("ce.created_at", startExpr, endExpr)}
            ORDER BY ce.created_at ASC
            ${limitClause(limit)}
            `, { websiteId, sessionId, limit });
        const legacyEvents = [];
        for (const row of legacyRows) {
            try {
                const data = JSON.parse(String(row.event_data ?? "{}"));
                if (Array.isArray(data.events))
                    legacyEvents.push(...data.events);
                else if (data.properties)
                    legacyEvents.push(data.properties);
            }
            catch {
                /* skip malformed */
            }
        }
        return { events: legacyEvents, chunkCount: 0, storage: "custom_events", minChunkIndex: 0 };
    }
    async getEcommerceOverview(client, websiteId, period, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const productFilter = dateFilter("created_at", startExpr, endExpr);
        const conversionFilter = dateFilter("created_at", startExpr, endExpr);
        const productStats = await chQueryOne(client, `
            SELECT
                countIf(section = 'product_view') AS product_views,
                countIf(section = 'add_to_cart') AS cart_adds,
                countIf(section = 'remove_from_cart') AS cart_removes,
                countIf(section = 'add_to_wishlist') AS wishlist_adds,
                countIf(section = 'remove_from_wishlist') AS wishlist_removes,
                countIf(section = 'begin_checkout') AS checkout_starts,
                uniqExact(visitor_id) AS product_engaged_visitors,
                uniqExact(product_id) AS unique_products_touched
            FROM fact_product_interactions
            WHERE website_id = {websiteId:UInt32}${productFilter}
            `, { websiteId });
        const conversionStats = await chQueryOne(client, `
            SELECT
                countIf(conversion_type = 'purchase') AS purchases,
                sumIf(value, conversion_type = 'purchase') AS purchase_revenue,
                countIf(conversion_type = 'refund') AS refunds,
                sumIf(value, conversion_type = 'refund') AS refund_value
            FROM fact_conversion_events
            WHERE website_id = {websiteId:UInt32}${conversionFilter}
            `, { websiteId });
        const views = Number(productStats?.product_views ?? 0);
        const cartAdds = Number(productStats?.cart_adds ?? 0);
        const purchaseRevenue = Number(conversionStats?.purchase_revenue ?? 0);
        const refundValue = Number(conversionStats?.refund_value ?? 0);
        return {
            period,
            website_id: websiteId,
            product_views: views,
            cart_adds: cartAdds,
            cart_removes: Number(productStats?.cart_removes ?? 0),
            wishlist_adds: Number(productStats?.wishlist_adds ?? 0),
            wishlist_removes: Number(productStats?.wishlist_removes ?? 0),
            checkout_starts: Number(productStats?.checkout_starts ?? 0),
            product_engaged_visitors: Number(productStats?.product_engaged_visitors ?? 0),
            unique_products_touched: Number(productStats?.unique_products_touched ?? 0),
            purchases: Number(conversionStats?.purchases ?? 0),
            purchase_revenue: purchaseRevenue,
            refunds: Number(conversionStats?.refunds ?? 0),
            refund_value: refundValue,
            net_revenue: purchaseRevenue - refundValue,
            add_to_cart_rate: views > 0 ? Math.round((cartAdds / views) * 1000) / 10 : 0,
        };
    }
    async getEcommerceProducts(client, websiteId, period, limit = 50, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const productFilter = dateFilter("created_at", startExpr, endExpr);
        const products = await chQuery(client, `
            SELECT
                product_id,
                coalesce(max(product_name), product_id) AS product_name,
                max(product_category) AS product_category,
                max(product_brand) AS product_brand,
                max(product_price) AS product_price,
                max(currency) AS currency,
                countIf(section = 'product_view') AS views,
                countIf(section = 'add_to_cart') AS cart_adds,
                countIf(section = 'remove_from_cart') AS cart_removes,
                countIf(section = 'add_to_wishlist') AS wishlist_adds,
                countIf(section = 'remove_from_wishlist') AS wishlist_removes,
                uniqExact(visitor_id) AS engaging_visitors,
                uniqExact(session_id) AS sessions
            FROM fact_product_interactions
            WHERE website_id = {websiteId:UInt32}${productFilter}
            GROUP BY product_id
            ORDER BY views DESC, cart_adds DESC, engaging_visitors DESC
            ${limitClause(limit)}
            `, { websiteId });
        return { period, website_id: websiteId, products };
    }
    async getEcommerceTrending(client, websiteId, period, limit = 10, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const productFilter = dateFilter("created_at", startExpr, endExpr);
        const products = await chQuery(client, `
            SELECT
                product_id,
                coalesce(max(product_name), product_id) AS product_name,
                max(product_category) AS product_category,
                countIf(section = 'product_view') AS views,
                countIf(section = 'add_to_cart') AS cart_adds,
                uniqExact(visitor_id) AS engaging_visitors,
                (countIf(section = 'add_to_cart') * 2 + countIf(section = 'product_view')) AS trend_score
            FROM fact_product_interactions
            WHERE website_id = {websiteId:UInt32}${productFilter}
            GROUP BY product_id
            HAVING views > 0 OR cart_adds > 0
            ORDER BY trend_score DESC, views DESC
            ${limitClause(limit)}
            `, { websiteId });
        return { period, website_id: websiteId, trending: products };
    }
    async getEcommerceEngagedVisitors(client, websiteId, organizationId, period, limit = 20, dateFrom, dateTo) {
        const [startExpr, endExpr] = periodFilter(period, dateFrom, dateTo);
        const productFilter = dateFilter("created_at", startExpr, endExpr);
        const profileJoin = organizationId > 0 ? profileIdentificationJoinSql("e.visitor_id") : "";
        const profileSelect = organizationId > 0
            ? `,
                ${profileIdentitySelectSql()}`
            : "";
        const visitors = await chQuery(client, `
            WITH engaged AS (
                SELECT
                    visitor_id,
                    count() AS interactions,
                    countIf(section = 'product_view') AS product_views,
                    countIf(section = 'add_to_cart') AS cart_adds,
                    countIf(section = 'remove_from_cart') AS cart_removes,
                    countIf(section = 'add_to_wishlist') AS wishlist_adds,
                    countIf(section = 'remove_from_wishlist') AS wishlist_removes,
                    uniqExact(product_id) AS products_touched,
                    max(created_at) AS last_engagement_at
                FROM fact_product_interactions
                WHERE website_id = {websiteId:UInt32}${productFilter}
                GROUP BY visitor_id
                ORDER BY interactions DESC, cart_adds DESC
                ${limitClause(limit)}
            )
            SELECT
                e.visitor_id AS visitor_id,
                e.interactions AS interactions,
                e.product_views AS product_views,
                e.cart_adds AS cart_adds,
                e.cart_removes AS cart_removes,
                e.wishlist_adds AS wishlist_adds,
                e.wishlist_removes AS wishlist_removes,
                e.products_touched AS products_touched,
                e.last_engagement_at AS last_engagement_at${profileSelect}
            FROM engaged AS e
            ${profileJoin}
            ORDER BY e.interactions DESC, e.cart_adds DESC
            `, { websiteId, organizationId, selectedUserId: "" });
        return { period, website_id: websiteId, visitors };
    }
}
export const analyticsRepository = new AnalyticsRepository();
