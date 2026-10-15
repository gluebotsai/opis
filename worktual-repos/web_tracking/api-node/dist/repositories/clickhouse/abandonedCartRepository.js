import { chQuery } from "../../plugins/clickhouse.js";
import { paginateClause, visitorIdsFilterFor } from "../../utils/clickhouseSql.js";
const PRODUCT_QTY_EXPR = `
  toUInt32(greatest(1, round(coalesce(JSONExtractFloat(extra_data, 'quantity'), 1))))
`;
function parseLines(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.map((entry) => {
        const t = entry;
        if (Array.isArray(t)) {
            const [product_id, product_name, sku, quantity, unit_price, currency] = t;
            return {
                product_id: String(product_id ?? ""),
                product_name: String(product_name ?? ""),
                sku: String(sku ?? ""),
                quantity: Number(quantity ?? 0),
                unit_price: Number(unit_price ?? 0),
                currency: String(currency ?? ""),
            };
        }
        return {
            product_id: String(t.product_id ?? ""),
            product_name: String(t.product_name ?? ""),
            sku: String(t.sku ?? t.product_sku ?? ""),
            quantity: Number(t.quantity ?? 0),
            unit_price: Number(t.unit_price ?? t.product_price ?? 0),
            currency: String(t.currency ?? ""),
        };
    });
}
function parseClickHouseDate(value) {
    if (value == null || value === "")
        return null;
    const ms = new Date(String(value)).getTime();
    return Number.isFinite(ms) ? ms : null;
}
export function computeCartAbandonmentStatus(row, thresholdMinutes, nowMs = Date.now()) {
    const cutoff = nowMs - thresholdMinutes * 60 * 1000;
    const lastActivityMs = parseClickHouseDate(row.last_activity_at);
    const lastPurchaseMs = parseClickHouseDate(row.last_purchase_at);
    const netItems = Number(row.net_items ?? 0);
    if (netItems <= 0)
        return "empty";
    if (lastPurchaseMs != null && lastActivityMs != null && lastPurchaseMs >= lastActivityMs) {
        if (lastActivityMs < cutoff)
            return "recovered";
        return "idle";
    }
    const active = lastActivityMs != null && lastActivityMs >= cutoff;
    if (active)
        return "active";
    return "cart_abandoned";
}
function mapRowToState(row, thresholdMinutes, nowMs) {
    const products = parseLines(row.lines);
    const status = computeCartAbandonmentStatus(row, thresholdMinutes, nowMs);
    const lastActivityMs = parseClickHouseDate(row.last_activity_at);
    const idleMinutes = lastActivityMs != null ? Math.max(0, Math.round((nowMs - lastActivityMs) / 60_000)) : null;
    let estimated = 0;
    let currency = "";
    for (const p of products) {
        estimated += p.quantity * p.unit_price;
        if (!currency && p.currency)
            currency = p.currency;
    }
    return {
        status,
        threshold_minutes: thresholdMinutes,
        last_activity_at: row.last_activity_at != null ? String(row.last_activity_at) : null,
        last_activity_type: row.last_activity_type != null ? String(row.last_activity_type) : null,
        idle_minutes: idleMinutes,
        net_items: Number(row.net_items ?? 0),
        estimated_cart_value: Math.round(estimated * 100) / 100,
        currency: String(row.checkout_currency ?? currency ?? ""),
        checkout_value: row.checkout_value != null && row.checkout_value !== "" ? Number(row.checkout_value) : null,
        checkout_currency: row.checkout_currency != null && row.checkout_currency !== ""
            ? String(row.checkout_currency)
            : null,
        last_checkout_at: row.last_checkout_at != null ? String(row.last_checkout_at) : null,
        last_purchase_at: row.last_purchase_at != null ? String(row.last_purchase_at) : null,
        products,
    };
}
export class AbandonedCartRepository {
    baseSignalsQuery(visitorFilterSql) {
        return `
      WITH
        cart_events AS (
          SELECT
            visitor_id,
            anyLast(user_id) AS user_id,
            product_id,
            anyLast(product_name) AS product_name,
            anyLast(product_sku) AS sku,
            anyLast(product_price) AS unit_price,
            anyLast(currency) AS currency,
            sumIf(${PRODUCT_QTY_EXPR}, section = 'add_to_cart')
              - sumIf(${PRODUCT_QTY_EXPR}, section = 'remove_from_cart') AS qty
          FROM fact_product_interactions
          WHERE website_id = {websiteId:UInt32}
            AND section IN ('add_to_cart', 'remove_from_cart')
            AND created_at >= now64(3) - INTERVAL {windowDays:UInt32} DAY
            ${visitorFilterSql}
          GROUP BY visitor_id, product_id
          HAVING qty > 0
        ),
        cart_roll AS (
          SELECT
            visitor_id,
            anyLast(user_id) AS user_id,
            sum(qty) AS net_items,
            groupArray(
              tuple(product_id, product_name, sku, qty, toFloat64(unit_price), currency)
            ) AS lines
          FROM cart_events
          GROUP BY visitor_id
        ),
        last_pi AS (
          SELECT
            visitor_id,
            max(created_at) AS last_pi_at,
            argMax(section, created_at) AS last_pi_type
          FROM fact_product_interactions
          WHERE website_id = {websiteId:UInt32}
            AND section IN ('product_view', 'add_to_cart', 'remove_from_cart', 'begin_checkout')
            AND created_at >= now64(3) - INTERVAL {windowDays:UInt32} DAY
            ${visitorFilterSql}
          GROUP BY visitor_id
        ),
        last_pv AS (
          SELECT
            visitor_id,
            max(created_at) AS last_pv_at
          FROM fact_page_views
          WHERE website_id = {websiteId:UInt32}
            AND created_at >= now64(3) - INTERVAL {windowDays:UInt32} DAY
            ${visitorFilterSql}
          GROUP BY visitor_id
        ),
        checkout AS (
          SELECT
            visitor_id,
            max(created_at) AS last_checkout_at,
            argMax(value, created_at) AS checkout_value,
            argMax(currency, created_at) AS checkout_currency
          FROM fact_conversion_events
          WHERE website_id = {websiteId:UInt32}
            AND conversion_type = 'begin_checkout'
            AND created_at >= now64(3) - INTERVAL {windowDays:UInt32} DAY
            ${visitorFilterSql}
          GROUP BY visitor_id
        ),
        purchase AS (
          SELECT
            visitor_id,
            max(created_at) AS last_purchase_at
          FROM fact_conversion_events
          WHERE website_id = {websiteId:UInt32}
            AND conversion_type = 'purchase'
            AND created_at >= now64(3) - INTERVAL {windowDays:UInt32} DAY
            ${visitorFilterSql}
          GROUP BY visitor_id
        ),
        candidates AS (
          SELECT visitor_id FROM cart_roll WHERE net_items > 0
        ),
        merged AS (
          SELECT
            c.visitor_id AS visitor_id,
            coalesce(cr.user_id, '') AS user_id,
            coalesce(cr.net_items, 0) AS net_items,
            coalesce(cr.lines, []) AS lines,
            greatest(
              coalesce(pi.last_pi_at, toDateTime64(0, 3, 'UTC')),
              coalesce(pv.last_pv_at, toDateTime64(0, 3, 'UTC')),
              coalesce(pu.last_purchase_at, toDateTime64(0, 3, 'UTC'))
            ) AS last_activity_at,
            multiIf(
              coalesce(pu.last_purchase_at, toDateTime64(0, 3, 'UTC')) >= coalesce(pi.last_pi_at, toDateTime64(0, 3, 'UTC'))
                AND coalesce(pu.last_purchase_at, toDateTime64(0, 3, 'UTC')) >= coalesce(pv.last_pv_at, toDateTime64(0, 3, 'UTC')),
              'purchase',
              coalesce(pi.last_pi_at, toDateTime64(0, 3, 'UTC')) >= coalesce(pv.last_pv_at, toDateTime64(0, 3, 'UTC')),
              pi.last_pi_type,
              'page_view'
            ) AS last_activity_type,
            ch.last_checkout_at AS last_checkout_at,
            ch.checkout_value AS checkout_value,
            ch.checkout_currency AS checkout_currency,
            pu.last_purchase_at AS last_purchase_at
          FROM candidates AS c
          LEFT JOIN cart_roll AS cr ON cr.visitor_id = c.visitor_id
          LEFT JOIN last_pi AS pi ON pi.visitor_id = c.visitor_id
          LEFT JOIN last_pv AS pv ON pv.visitor_id = c.visitor_id
          LEFT JOIN checkout AS ch ON ch.visitor_id = c.visitor_id
          LEFT JOIN purchase AS pu ON pu.visitor_id = c.visitor_id
        )
      SELECT *
      FROM merged
      WHERE net_items > 0
    `;
    }
    async fetchAbandonedCarts(client, websiteId, options = {}) {
        const thresholdMinutes = Math.max(1, Math.min(24 * 60, options.thresholdMinutes ?? 60));
        const windowDays = Math.max(1, Math.min(90, options.windowDays ?? 30));
        const limit = options.limit ?? 50;
        const offset = options.offset ?? 0;
        const statusFilter = options.statuses?.length ? options.statuses : null;
        const visitorFilterSql = options.visitorIds?.length
            ? `AND ${visitorIdsFilterFor("visitor_id")}`
            : "";
        const params = {
            websiteId,
            windowDays,
        };
        if (options.visitorIds?.length) {
            params.visitorIds = options.visitorIds;
        }
        const scanCap = options.visitorIds?.length ? 500 : 5000;
        const raw = await chQuery(client, `${this.baseSignalsQuery(visitorFilterSql)}
      ORDER BY last_activity_at DESC
      ${paginateClause(0, scanCap)}`, params);
        const nowMs = Date.now();
        const mapped = raw.map((row) => {
            const state = mapRowToState(row, thresholdMinutes, nowMs);
            return { ...row, abandonment: state };
        });
        const filtered = statusFilter
            ? mapped.filter((r) => statusFilter.includes(r.abandonment.status))
            : mapped.filter((r) => r.abandonment.status === "cart_abandoned");
        const summary = {
            active_with_cart: 0,
            cart_abandoned: 0,
            recovered: 0,
        };
        for (const r of mapped) {
            const s = r.abandonment.status;
            if (s === "active")
                summary.active_with_cart += 1;
            else if (s === "cart_abandoned")
                summary.cart_abandoned += 1;
            else if (s === "recovered")
                summary.recovered += 1;
        }
        const safeOffset = Math.max(0, offset);
        const safeLimit = Math.max(1, limit);
        return {
            rows: filtered.slice(safeOffset, safeOffset + safeLimit),
            summary,
            total: filtered.length,
        };
    }
    async getVisitorCartAbandonment(client, websiteId, visitorIds, thresholdMinutes = 60, windowDays = 30) {
        if (!visitorIds.length) {
            return {
                status: "empty",
                threshold_minutes: thresholdMinutes,
                last_activity_at: null,
                last_activity_type: null,
                idle_minutes: null,
                net_items: 0,
                estimated_cart_value: 0,
                currency: "",
                checkout_value: null,
                checkout_currency: null,
                last_checkout_at: null,
                last_purchase_at: null,
                products: [],
            };
        }
        const { rows } = await this.fetchAbandonedCarts(client, websiteId, {
            thresholdMinutes,
            windowDays,
            visitorIds,
            limit: 1,
            statuses: ["active", "cart_abandoned", "recovered", "idle"],
        });
        const row = rows[0];
        if (!row?.abandonment) {
            return {
                status: "empty",
                threshold_minutes: thresholdMinutes,
                last_activity_at: null,
                last_activity_type: null,
                idle_minutes: null,
                net_items: 0,
                estimated_cart_value: 0,
                currency: "",
                checkout_value: null,
                checkout_currency: null,
                last_checkout_at: null,
                last_purchase_at: null,
                products: [],
            };
        }
        return row.abandonment;
    }
}
export const abandonedCartRepository = new AbandonedCartRepository();
