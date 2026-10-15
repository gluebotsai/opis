import { chQuery, chQueryOne } from "../../plugins/clickhouse.js";
import { factAccountFilterSql, SCROLL_DEPTH_FROM_EXTRA, SCROLL_EVENT_TYPES_SQL, limitClause, } from "../../utils/clickhouseSql.js";
export const REPLAY_EVENT_NAMES = [
    "rrweb",
    "rrweb_event",
    "replay_event",
    "replay_chunk",
    "session_replay",
];
export const HEATMAP_EVENT_TYPES = ["click", "move", "scroll", "rage_click", "dead_click"];
export const MOVE_BIN_SIZE = 25;
export const REPLAY_API_HINT = {
    format: "rrweb",
    schema_version: 1,
    endpoint: "/api/analytics/replay/events",
    storage: "custom_events",
};
export const EVENT_TYPE_LABELS = {
    click: "Clicks",
    move: "Mouse movement",
    scroll: "Scroll reach",
    rage_click: "Rage clicks",
    dead_click: "Dead clicks",
    all: "All interactions",
};
const INTERACTION_TYPES_SQL = HEATMAP_EVENT_TYPES.map((t) => `'${t}'`).join(", ");
function scopeFilter(visitorId, sessionId, prefix = "ie", filterUserId, websiteId) {
    const clauses = [];
    const params = {};
    if (visitorId) {
        clauses.push(`AND ${prefix}.visitor_id = {visitorId:String}`);
        params.visitorId = visitorId;
    }
    if (sessionId) {
        clauses.push(`AND ${prefix}.session_id = {sessionId:String}`);
        params.sessionId = sessionId;
    }
    const uid = String(filterUserId ?? "").trim();
    if (uid && visitorId && websiteId) {
        params.filterUserId = uid;
        params.visitorIds = [visitorId];
        clauses.push(`AND ${factAccountFilterSql(prefix)}`);
    }
    return { sql: clauses.join(" "), params };
}
function eventTypeFilter(eventType) {
    if (!eventType || eventType === "all") {
        return { sql: `AND ie.event_type IN (${INTERACTION_TYPES_SQL}, 'scroll_depth')`, params: {} };
    }
    if (eventType === "scroll") {
        return { sql: `AND ie.event_type IN (${SCROLL_EVENT_TYPES_SQL})`, params: {} };
    }
    const resolved = HEATMAP_EVENT_TYPES.includes(eventType) ? eventType : "click";
    return { sql: "AND ie.event_type = {eventType:String}", params: { eventType: resolved } };
}
function dominantViewport(points) {
    if (!points.length)
        return [null, null];
    const counts = new Map();
    for (const p of points) {
        const w = p.viewport_w;
        const h = p.viewport_h;
        if (w && h) {
            const key = `${Number(w)}:${Number(h)}`;
            const weight = Number(p.event_count ?? p.click_count ?? 1);
            counts.set(key, (counts.get(key) ?? 0) + weight);
        }
    }
    if (!counts.size)
        return [null, null];
    let bestKey = "";
    let bestCount = -1;
    for (const [key, count] of counts) {
        if (count > bestCount) {
            bestKey = key;
            bestCount = count;
        }
    }
    const [w, h] = bestKey.split(":").map(Number);
    return [w, h];
}
function coordGroupSql(eventType) {
    if (eventType === "move") {
        const binSize = MOVE_BIN_SIZE;
        const xExpr = `toInt32(floor(ie.x_coord / ${binSize}) * ${binSize})`;
        const yExpr = `toInt32(floor(ie.y_coord / ${binSize}) * ${binSize})`;
        return [xExpr, yExpr];
    }
    if (eventType === "scroll") {
        const xExpr = "coalesce(ie.x_coord, toInt32(ie.viewport_w / 2))";
        const depthExpr = `greatest(toFloat64(ie.scroll_depth), ${SCROLL_DEPTH_FROM_EXTRA})`;
        const yExpr = `coalesce(ie.y_coord, toInt32(round((${depthExpr}) / 100.0 * nullIf(ie.viewport_h, 0))))`;
        return [xExpr, yExpr];
    }
    return ["ie.x_coord", "ie.y_coord"];
}
function coordWhereSql(eventType) {
    if (eventType === "scroll") {
        return `
          AND (
            (ie.x_coord != 0 AND ie.y_coord != 0)
            OR (greatest(toFloat64(ie.scroll_depth), ${SCROLL_DEPTH_FROM_EXTRA}) > 0 AND ie.viewport_h > 0)
          )
        `;
    }
    return "AND ie.x_coord != 0 AND ie.y_coord != 0";
}
export class HeatmapRepository {
    async fetchDomainEventTotals(client, websiteId, dateFilterSql) {
        const row = await chQueryOne(client, `
        SELECT
            countIf(event_type = 'click') AS click_count,
            countIf(event_type = 'move') AS move_count,
            countIf(event_type IN (${SCROLL_EVENT_TYPES_SQL})) AS scroll_count,
            countIf(event_type = 'rage_click') AS rage_click_count,
            countIf(event_type = 'dead_click') AS dead_click_count,
            count() AS interaction_count
        FROM fact_interaction_events
        WHERE website_id = {websiteId:UInt32}
          ${dateFilterSql}
        `, { websiteId });
        return row ?? {};
    }
    async fetchHeatmapPages(client, websiteId, interactionDateFilterSql, limit = 500) {
        return chQuery(client, `
        WITH interaction_counts AS (
            SELECT
                pv.page_path AS page_path,
                countIf(ie.event_type = 'click') AS click_count,
                countIf(ie.event_type = 'move') AS move_count,
                countIf(ie.event_type IN (${SCROLL_EVENT_TYPES_SQL})) AS scroll_count,
                countIf(ie.event_type = 'rage_click') AS rage_click_count,
                countIf(ie.event_type = 'dead_click') AS dead_click_count,
                count() AS interaction_count,
                uniqExact(ie.visitor_id) AS visitor_count
            FROM fact_interaction_events ie
            INNER JOIN fact_page_views pv
                ON pv.page_view_id = ie.page_view_id
               AND pv.website_id = ie.website_id
            WHERE ie.website_id = {websiteId:UInt32}
              ${interactionDateFilterSql}
            GROUP BY page_path
        ),
        viewed_pages AS (
            SELECT DISTINCT page_path
            FROM fact_page_views
            WHERE website_id = {websiteId:UInt32}
        )
        SELECT
            vp.page_path,
            coalesce(ic.click_count, 0) AS click_count,
            coalesce(ic.move_count, 0) AS move_count,
            coalesce(ic.scroll_count, 0) AS scroll_count,
            coalesce(ic.rage_click_count, 0) AS rage_click_count,
            coalesce(ic.dead_click_count, 0) AS dead_click_count,
            coalesce(ic.interaction_count, 0) AS interaction_count,
            coalesce(ic.visitor_count, 0) AS visitor_count
        FROM viewed_pages vp
        LEFT JOIN interaction_counts ic ON vp.page_path = ic.page_path
        ORDER BY interaction_count DESC, click_count DESC, page_path ASC
        ${limitClause(limit)}
        `, { websiteId });
    }
    async fetchScrollDistribution(client, websiteId, pagePath, dateFilterSql, visitorId, sessionId) {
        const pvDates = dateFilterSql.replace("ie.created_at", "pv.created_at");
        const { sql: scopeSql, params: scopeParams } = scopeFilter(visitorId, sessionId, "pv");
        return chQuery(client, `
        SELECT
            least(100, greatest(0, toInt32(ceil(depth / 10.0) * 10))) AS depth_pct,
            count() AS sessions,
            uniqExact(visitor_id) AS visitors
        FROM (
            SELECT
                pv.visitor_id,
                pv.session_id,
                greatest(
                    toFloat64(coalesce(pv.max_scroll_depth, 0)),
                    coalesce(sd.max_depth, 0)
                ) AS depth
            FROM fact_page_views pv
            LEFT JOIN (
                SELECT
                    page_view_id,
                    website_id,
                    max(greatest(
                        toFloat64(scroll_depth),
                        ${SCROLL_DEPTH_FROM_EXTRA}
                    )) AS max_depth
                FROM fact_interaction_events
                WHERE event_type IN (${SCROLL_EVENT_TYPES_SQL})
                GROUP BY page_view_id, website_id
            ) sd
              ON sd.page_view_id = pv.page_view_id
             AND sd.website_id = pv.website_id
            WHERE pv.website_id = {websiteId:UInt32}
              AND pv.page_path = {pagePath:String}
              ${pvDates}
              ${scopeSql}
        )
        WHERE depth > 0
        GROUP BY depth_pct
        ORDER BY depth_pct
        `, { websiteId, pagePath, ...scopeParams });
    }
    async fetchHeatmapData(client, websiteId, pagePath, dateFilterSql, eventType = "click", visitorId, sessionId, pointLimit = 5000, filterUserId) {
        const resolvedType = [...HEATMAP_EVENT_TYPES, "all"].includes(eventType)
            ? eventType
            : "click";
        const { sql: scopeSql, params: scopeParams } = scopeFilter(visitorId, sessionId, "ie", filterUserId, websiteId);
        const { sql: typeSql, params: typeParams } = eventTypeFilter(resolvedType);
        const baseParams = { websiteId, pagePath, ...typeParams, ...scopeParams };
        let xExpr;
        let yExpr;
        let groupDims;
        let selectType;
        let coordWhere;
        if (resolvedType === "all") {
            xExpr = "ie.x_coord";
            yExpr = "ie.y_coord";
            groupDims = "ie.x_coord, ie.y_coord, ie.viewport_w, ie.viewport_h, ie.event_type";
            selectType = "ie.event_type,";
            coordWhere = "AND ie.x_coord != 0 AND ie.y_coord != 0";
        }
        else {
            [xExpr, yExpr] = coordGroupSql(resolvedType);
            groupDims = `${xExpr}, ${yExpr}, ie.viewport_w, ie.viewport_h`;
            selectType = "";
            coordWhere = coordWhereSql(resolvedType);
        }
        const summary = await chQueryOne(client, `
        SELECT
            count() AS total_events,
            countIf(ie.event_type = 'click') AS total_clicks,
            countIf(ie.event_type = 'move') AS total_moves,
            countIf(ie.event_type IN (${SCROLL_EVENT_TYPES_SQL})) AS total_scrolls,
            countIf(ie.event_type = 'rage_click') AS total_rage_clicks,
            countIf(ie.event_type = 'dead_click') AS total_dead_clicks,
            uniqExact(ie.visitor_id) AS unique_visitors,
            uniqExact(ie.session_id) AS unique_sessions
        FROM fact_interaction_events ie
        INNER JOIN fact_page_views pv
            ON pv.page_view_id = ie.page_view_id
           AND pv.website_id = ie.website_id
        WHERE ie.website_id = {websiteId:UInt32}
          AND pv.page_path = {pagePath:String}
          ${typeSql}
          ${scopeSql}
          ${dateFilterSql}
        `, baseParams);
        const points = await chQuery(client, `
        SELECT
            ${xExpr} AS x,
            ${yExpr} AS y,
            ie.viewport_w,
            ie.viewport_h,
            ${selectType}
            count() AS event_count,
            uniqExact(ie.visitor_id) AS visitor_count,
            max(ie.element) AS element,
            max(ie.element_type) AS element_type,
            max(substring(ie.element_text, 1, 120)) AS element_text,
            max(ie.scroll_depth) AS scroll_depth,
            max(ie.click_count) AS rage_click_count,
            max(ie.reason) AS reason
        FROM fact_interaction_events ie
        INNER JOIN fact_page_views pv
            ON pv.page_view_id = ie.page_view_id
           AND pv.website_id = ie.website_id
        WHERE ie.website_id = {websiteId:UInt32}
          AND pv.page_path = {pagePath:String}
          ${typeSql}
          ${coordWhere}
          ${scopeSql}
          ${dateFilterSql}
        GROUP BY ${groupDims}
        ORDER BY event_count DESC
        LIMIT {pointLimit:UInt32}
        `, { ...baseParams, pointLimit });
        const [viewportW, viewportH] = dominantViewport(points);
        const scopeLabel = sessionId ? "session" : visitorId ? "visitor" : "all";
        let scrollDistribution = [];
        if (resolvedType === "scroll" || resolvedType === "all") {
            scrollDistribution = await this.fetchScrollDistribution(client, websiteId, pagePath, dateFilterSql, visitorId, sessionId);
        }
        const visualization = resolvedType === "scroll" ? "scroll_depth" : "coordinates";
        return {
            page_path: pagePath,
            event_type: resolvedType,
            event_type_label: EVENT_TYPE_LABELS[resolvedType] ?? resolvedType,
            visualization,
            scope: {
                mode: scopeLabel,
                visitor_id: visitorId ?? null,
                session_id: sessionId ?? null,
            },
            summary: {
                total_events: summary?.total_events ?? 0,
                total_clicks: summary?.total_clicks ?? 0,
                total_moves: summary?.total_moves ?? 0,
                total_scrolls: summary?.total_scrolls ?? 0,
                total_rage_clicks: summary?.total_rage_clicks ?? 0,
                total_dead_clicks: summary?.total_dead_clicks ?? 0,
                unique_visitors: summary?.unique_visitors ?? 0,
                unique_sessions: summary?.unique_sessions ?? 0,
                viewport_w: viewportW,
                viewport_h: viewportH,
            },
            points,
            scroll_distribution: scrollDistribution,
            replay: { ...REPLAY_API_HINT, available: false },
        };
    }
    async fetchHeatmapScopes(client, websiteId, pagePath, dateFilterSql, eventType = "click", limit = 200) {
        const { sql: typeSql, params: typeParams } = eventTypeFilter(eventType === "all" ? null : eventType);
        const params = { websiteId, pagePath, limit, ...typeParams };
        const visitors = await chQuery(client, `
        SELECT
            ie.visitor_id,
            count() AS event_count,
            uniqExact(ie.session_id) AS session_count
        FROM fact_interaction_events ie
        INNER JOIN fact_page_views pv
            ON pv.page_view_id = ie.page_view_id
           AND pv.website_id = ie.website_id
        WHERE ie.website_id = {websiteId:UInt32}
          AND pv.page_path = {pagePath:String}
          ${typeSql}
          ${dateFilterSql}
        GROUP BY ie.visitor_id
        ORDER BY event_count DESC
        ${limitClause(limit)}
        `, params);
        const sessions = await chQuery(client, `
        SELECT
            ie.session_id,
            ie.visitor_id,
            count() AS event_count
        FROM fact_interaction_events ie
        INNER JOIN fact_page_views pv
            ON pv.page_view_id = ie.page_view_id
           AND pv.website_id = ie.website_id
        WHERE ie.website_id = {websiteId:UInt32}
          AND pv.page_path = {pagePath:String}
          ${typeSql}
          ${dateFilterSql}
        GROUP BY ie.session_id, ie.visitor_id
        ORDER BY event_count DESC
        ${limitClause(limit)}
        `, params);
        return {
            page_path: pagePath,
            event_type: eventType,
            visitors,
            sessions,
        };
    }
}
export const heatmapRepository = new HeatmapRepository();
