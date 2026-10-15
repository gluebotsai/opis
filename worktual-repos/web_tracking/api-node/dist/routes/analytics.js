import fp from "fastify-plugin";
import { abandonedCartRepository, } from "../repositories/clickhouse/abandonedCartRepository.js";
import { analyticsRepository } from "../repositories/clickhouse/analyticsRepository.js";
import { visitorsRepository } from "../repositories/clickhouse/visitorsRepository.js";
import { getVisitorSegmentation } from "../repositories/clickhouse/segmentationRepository.js";
import { getOrganizationBusinessType } from "../repositories/postgres/organizationBusinessType.js";
import { insightsRepository } from "../repositories/clickhouse/insightsRepository.js";
import { heatmapRepository, HEATMAP_EVENT_TYPES } from "../repositories/clickhouse/heatmapRepository.js";
import { aggregateBrowsers } from "../utils/browserUtils.js";
import { aggregateGeography } from "../utils/geographyUtils.js";
import { aggregateTrafficSources } from "../utils/trafficSource.js";
import { bouncePageForSession } from "../utils/bounceRate.js";
import { dateFilter, periodFilter } from "../utils/period.js";
import { cacheGet, cacheSet } from "../plugins/redis.js";
import { env } from "../config/env.js";
import { fetchInsightsNarrative } from "../services/insightsService.js";
import { mergeInsightsResponse } from "../services/insightsNarrative.js";
import { replayHasFullSnapshot, replayHasIncrementals } from "../utils/replayDecode.js";
import { buildVisitorCdpProfile, profileDisplayLabel } from "../utils/visitorCdpProfile.js";
import { filterUserIdFromCdpId } from "../utils/guestUserProfile.js";
import { useRedisLivePresence, isRedisLiveReady } from "../services/livePresenceRedis.js";
import { getLiveEcommerceSnapshot, sseChannel } from "../services/liveEcommerceRedis.js";
async function cached(app, key, fn, ttlSeconds = env.REDIS_CACHE_TTL_SECONDS) {
    const hit = await cacheGet(app.redis, key);
    if (hit)
        return JSON.parse(hit);
    const data = await fn();
    await cacheSet(app.redis, key, JSON.stringify(data), ttlSeconds);
    return data;
}
function periodParams(q) {
    return {
        period: String(q.period ?? "overall"),
        from: q.from ? String(q.from) : undefined,
        to: q.to ? String(q.to) : undefined,
    };
}
export const analyticsRoutes = fp(async function analyticsRoutes(app) {
    const auth = { preHandler: [app.authenticate] };
    app.get("/api/analytics/overview", auth, async (req) => {
        const { period, from, to } = periodParams(req.query);
        const websiteId = req.admin.website_id;
        const key = `overview:${websiteId}:${period}:${from ?? ""}:${to ?? ""}`;
        const overviewCacheTtl = Math.min(env.REDIS_CACHE_TTL_SECONDS, 30);
        return cached(app, key, () => analyticsRepository.getOverview(app.clickhouse, websiteId, period, from, to), overviewCacheTtl);
    });
    app.get("/api/analytics/engagement", auth, async (req) => {
        const period = String(req.query.period ?? "overall");
        const limit = Number(req.query.limit ?? 10);
        return analyticsRepository.getEngagement(app.clickhouse, req.admin.website_id, period, limit);
    });
    app.get("/api/analytics/segmentation", auth, async (req) => {
        const { period, from, to } = periodParams(req.query);
        const rawPct = Number(req.query.page_engagement_threshold_pct ?? 50);
        const pageEngagementThresholdPct = Number.isFinite(rawPct)
            ? Math.min(100, Math.max(1, Math.round(rawPct)))
            : 50;
        const websiteId = req.admin.website_id;
        const organizationId = await visitorsRepository.resolveOrganizationId(app.clickhouse, websiteId, req.admin.organization_id);
        const businessType = await getOrganizationBusinessType(app.prisma, organizationId);
        const key = `segmentation:${websiteId}:${period}:${from ?? ""}:${to ?? ""}:${pageEngagementThresholdPct}:${businessType ?? "none"}`;
        return cached(app, key, () => getVisitorSegmentation(app.clickhouse, websiteId, period, pageEngagementThresholdPct, businessType), Math.min(env.REDIS_CACHE_TTL_SECONDS, 60));
    });
    app.get("/api/analytics/live", auth, async (req) => {
        const websiteId = req.admin.website_id;
        const organizationId = await visitorsRepository.resolveOrganizationId(app.clickhouse, websiteId, req.admin.organization_id);
        const redis = app.redis;
        const redisLive = useRedisLivePresence(env.REDIS_URL, redis);
        // Live Users list + current_page always from ClickHouse (matches visitor journey).
        const payload = await analyticsRepository.getLive(app.clickhouse, websiteId, organizationId);
        return {
            ...payload,
            presence_source: "clickhouse",
            live_stream_available: redisLive,
        };
    });
    app.get("/api/analytics/live/stream", { preHandler: [app.authenticate] }, async (req, reply) => {
        const redis = app.redis;
        if (!isRedisLiveReady(redis)) {
            return reply.status(503).send({ detail: "Live stream unavailable (Redis not ready)" });
        }
        const websiteId = req.admin.website_id;
        const channel = sseChannel(websiteId);
        reply.hijack();
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        const writeEvent = (event, data) => {
            reply.raw.write(`event: ${event}\n`);
            reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        try {
            const snapshot = await getLiveEcommerceSnapshot(redis, websiteId);
            writeEvent("snapshot", snapshot);
        }
        catch (err) {
            app.log.warn({ err }, "live sse snapshot failed");
            writeEvent("snapshot", {
                type: "snapshot",
                counts: {},
                top_products: [],
                recent: [],
                live_sessions: { active_users: 0, active_sessions: 0, sessions: [] },
            });
        }
        const sub = redis.duplicate();
        sub.on("error", (err) => {
            app.log.warn({ err }, "live sse subscriber error");
        });
        try {
            if (sub.status !== "ready")
                await sub.connect();
            await sub.subscribe(channel);
        }
        catch (err) {
            app.log.warn({ err }, "live sse subscribe failed");
            reply.raw.end();
            return;
        }
        const onMessage = (_ch, message) => {
            try {
                writeEvent("tracking", JSON.parse(message));
            }
            catch {
                writeEvent("tracking", { type: "unknown" });
            }
        };
        sub.on("message", onMessage);
        const ping = setInterval(() => {
            try {
                reply.raw.write(`: ping ${Date.now()}\n\n`);
            }
            catch {
                /* closed */
            }
        }, 15_000);
        const cleanup = () => {
            clearInterval(ping);
            sub.off("message", onMessage);
            void sub.unsubscribe(channel).catch(() => undefined);
            void sub.quit().catch(() => undefined);
        };
        req.raw.on("close", cleanup);
    });
    app.get("/api/analytics/top-pages", auth, async (req) => {
        const q = req.query;
        return analyticsRepository.getTopPages(app.clickhouse, req.admin.website_id, String(q.period ?? "overall"), Number(q.limit ?? 10));
    });
    app.get("/api/analytics/page-dropoff", auth, async (req) => {
        const q = req.query;
        return analyticsRepository.getPageDropoff(app.clickhouse, req.admin.website_id, String(q.period ?? "overall"), Number(q.limit ?? 5));
    });
    app.get("/api/analytics/scroll-depth", auth, async (req) => {
        const q = req.query;
        return analyticsRepository.getScrollDepth(app.clickhouse, req.admin.website_id, String(q.period ?? "overall"), Number(q.limit ?? 10));
    });
    app.get("/api/analytics/traffic-sources", auth, async (req) => {
        const period = String(req.query.period ?? "overall");
        const rows = await analyticsRepository.getTrafficSourceSessions(app.clickhouse, req.admin.website_id, period);
        const aggregated = aggregateTrafficSources(rows);
        return { period, website_id: req.admin.website_id, ...aggregated };
    });
    app.get("/api/analytics/browsers", auth, async (req) => {
        const period = String(req.query.period ?? "overall");
        const rows = await analyticsRepository.getBrowserSessions(app.clickhouse, req.admin.website_id, period);
        const aggregated = aggregateBrowsers(rows);
        return { period, website_id: req.admin.website_id, ...aggregated };
    });
    app.get("/api/analytics/geography", auth, async (req) => {
        const period = String(req.query.period ?? "overall");
        const rows = await analyticsRepository.getGeographySessions(app.clickhouse, req.admin.website_id, period);
        const aggregated = aggregateGeography(rows);
        return { period, website_id: req.admin.website_id, ...aggregated };
    });
    app.get("/api/analytics/forms/leads", auth, async (req, reply) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        if (q.form_id === undefined || q.form_id === null) {
            return reply.status(400).send({ detail: "form_id query parameter is required" });
        }
        const formId = String(q.form_id);
        const limit = Number(q.limit ?? 50);
        return analyticsRepository.getFormLeads(app.clickhouse, req.admin.website_id, period, formId, limit, from, to);
    });
    app.get("/api/analytics/forms/submissions", auth, async (req, reply) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        if (q.form_id === undefined || q.form_id === null) {
            return reply.status(400).send({ detail: "form_id query parameter is required" });
        }
        const formId = String(q.form_id);
        const limit = Number(q.limit ?? 20);
        return analyticsRepository.getFormSubmissions(app.clickhouse, req.admin.website_id, period, formId, limit, from, to);
    });
    app.get("/api/analytics/forms", auth, async (req) => {
        const { period, from, to } = periodParams(req.query);
        return analyticsRepository.getForms(app.clickhouse, req.admin.website_id, period, from, to);
    });
    app.get("/api/analytics/performance", auth, async (req) => {
        const { period, from, to } = periodParams(req.query);
        return analyticsRepository.getPerformance(app.clickhouse, req.admin.website_id, period, from, to);
    });
    app.get("/api/analytics/errors", auth, async (req) => {
        const { period, from, to } = periodParams(req.query);
        return analyticsRepository.getErrors(app.clickhouse, req.admin.website_id, period, from, to);
    });
    app.get("/api/analytics/custom-events", auth, async (req) => {
        const { period, from, to } = periodParams(req.query);
        return analyticsRepository.getCustomEvents(app.clickhouse, req.admin.website_id, period, from, to);
    });
    app.get("/api/analytics/products", auth, async (req) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        return analyticsRepository.getEcommerceProducts(app.clickhouse, req.admin.website_id, period, Number(q.limit ?? 20), from, to);
    });
    app.get("/api/analytics/ecommerce/overview", auth, async (req) => {
        const { period, from, to } = periodParams(req.query);
        return analyticsRepository.getEcommerceOverview(app.clickhouse, req.admin.website_id, period, from, to);
    });
    app.get("/api/analytics/ecommerce/products", auth, async (req) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        return analyticsRepository.getEcommerceProducts(app.clickhouse, req.admin.website_id, period, Number(q.limit ?? 50), from, to);
    });
    app.get("/api/analytics/ecommerce/trending", auth, async (req) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        return analyticsRepository.getEcommerceTrending(app.clickhouse, req.admin.website_id, period, Number(q.limit ?? 10), from, to);
    });
    app.get("/api/analytics/ecommerce/engaged-visitors", auth, async (req) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        const websiteId = req.admin.website_id;
        const organizationId = await visitorsRepository.resolveOrganizationId(app.clickhouse, websiteId, req.admin.organization_id);
        const result = await analyticsRepository.getEcommerceEngagedVisitors(app.clickhouse, websiteId, organizationId, period, Number(q.limit ?? 50), from, to);
        const visitors = (result.visitors ?? []).map((row) => {
            const visitorId = String(row.visitor_id ?? "");
            const cdp = buildVisitorCdpProfile(row, visitorId);
            return {
                ...row,
                cdp_profile: cdp,
                identity_label: cdp?.identity_label ?? "Anonymous",
            };
        });
        return { ...result, visitors };
    });
    app.get("/api/analytics/ecommerce/abandoned-carts", auth, async (req) => {
        const q = req.query;
        const mode = String(q.mode ?? "operational");
        const thresholdMinutes = mode === "reporting"
            ? Math.min(24 * 60, Math.max(1, Number(q.threshold_minutes ?? 1440)))
            : Math.min(24 * 60, Math.max(1, Number(q.threshold_minutes ?? 60)));
        const websiteId = req.admin.website_id;
        const organizationId = await visitorsRepository.resolveOrganizationId(app.clickhouse, websiteId, req.admin.organization_id);
        const statusRaw = q.status ? String(q.status) : "cart_abandoned";
        const statuses = statusRaw === "all"
            ? ["active", "cart_abandoned", "recovered"]
            : statusRaw === "abandoned" || statusRaw === "cart_abandoned"
                ? ["cart_abandoned"]
                : [statusRaw];
        const limit = Math.min(100, Math.max(1, Number(q.limit ?? 10)));
        const offset = Math.max(0, Number(q.offset ?? 0));
        const { rows, summary, total } = await abandonedCartRepository.fetchAbandonedCarts(app.clickhouse, websiteId, {
            thresholdMinutes,
            limit,
            offset,
            statuses,
        });
        const visitorIds = rows.map((row) => String(row.visitor_id ?? "")).filter(Boolean);
        const userIdsFromRows = rows
            .map((row) => String(row.user_id ?? "").trim())
            .filter(Boolean);
        const [profileRowByVisitor, lastActiveByVisitor, knownByUserId] = await Promise.all([
            visitorsRepository.getVisitorCdpProfileRowsByIds(app.clickhouse, websiteId, organizationId, visitorIds),
            organizationId > 0
                ? visitorsRepository.getLastActiveProfileByVisitorIds(app.clickhouse, websiteId, organizationId, visitorIds)
                : Promise.resolve({}),
            visitorsRepository.fetchKnownUserIdentityByUserIds(app.clickhouse, websiteId, userIdsFromRows),
        ]);
        const carts = rows.map((row) => {
            const visitorId = String(row.visitor_id ?? "");
            const eventUserId = String(row.user_id ?? "").trim();
            let profileRow = profileRowByVisitor.get(visitorId);
            if (!String(profileRow?.cdp_id ?? "").trim() && eventUserId) {
                const known = knownByUserId.get(eventUserId);
                if (known) {
                    profileRow = {
                        cdp_id: `wt:${websiteId}:${eventUserId}`,
                        contact_type: known.method,
                        cdp_first_name: known.first_name,
                        cdp_last_name: known.last_name,
                        cdp_primary_email: known.email,
                        cdp_primary_phone: known.phone,
                        traits_json: known.traits_json,
                        webtracking_user_id: eventUserId,
                        is_cdp_known: true,
                        linked_visitor_ids_count: 1,
                        linked_visitor_ids: [visitorId],
                    };
                }
            }
            const cdp = buildVisitorCdpProfile(profileRow ?? null, visitorId);
            const lastActiveLabel = lastActiveByVisitor[visitorId]?.last_active_profile_label ?? "";
            const abandonment = row.abandonment;
            return {
                visitor_id: visitorId,
                user_id: eventUserId,
                cdp_profile: cdp,
                identity_label: cdp?.identity_label ?? "Anonymous",
                last_active_profile_label: lastActiveLabel || profileDisplayLabel(cdp),
                ...abandonment,
            };
        });
        return {
            website_id: websiteId,
            organization_id: organizationId,
            mode,
            threshold_minutes: thresholdMinutes,
            summary,
            total,
            limit,
            offset,
            carts,
        };
    });
    app.get("/api/analytics/sessions", auth, async (req) => {
        const q = req.query;
        const result = await analyticsRepository.getSessions(app.clickhouse, req.admin.website_id, String(q.period ?? "week"), q.from ? String(q.from) : undefined, q.to ? String(q.to) : undefined, Number(q.offset ?? 0), Number(q.limit ?? 10));
        const rawSessions = result.sessions ?? [];
        const organizationId = await visitorsRepository.resolveOrganizationId(app.clickhouse, req.admin.website_id, req.admin.organization_id);
        const visitorIds = rawSessions.map((row) => String(row.visitor_id ?? "")).filter(Boolean);
        const profileByVisitor = organizationId > 0 && visitorIds.length
            ? await visitorsRepository.getUnifiedVisitorDisplayProfilesByVisitorIds(app.clickhouse, req.admin.website_id, organizationId, visitorIds)
            : new Map();
        const sessions = rawSessions.map((row) => {
            const visitorId = String(row.visitor_id ?? "");
            const cdp = profileByVisitor.get(visitorId) ?? buildVisitorCdpProfile(row, visitorId);
            const label = profileDisplayLabel(cdp);
            return {
                ...row,
                cdp_profile: cdp,
                identity_label: label,
                last_active_profile_label: label,
                bounce_page: bouncePageForSession(row),
            };
        });
        return { ...result, sessions };
    });
    app.get("/api/analytics/replay/sessions", auth, async (req) => {
        const q = req.query;
        const period = String(q.period ?? "week");
        const limit = Math.max(1, Math.min(50, Number(q.limit ?? 10)));
        const sessionSearch = q.session_id ? String(q.session_id) : q.session_search ? String(q.session_search) : null;
        const visitorSearch = q.visitor_id ? String(q.visitor_id) : q.visitor_search ? String(q.visitor_search) : null;
        const organizationId = await visitorsRepository.resolveOrganizationId(app.clickhouse, req.admin.website_id, req.admin.organization_id);
        let filterUserId = q.user_id ? String(q.user_id) : q.userId ? String(q.userId) : "";
        const cdpId = q.cdp_id ? String(q.cdp_id) : "";
        if (!filterUserId && cdpId) {
            filterUserId = filterUserIdFromCdpId(cdpId, req.admin.website_id) ?? "";
        }
        const result = await analyticsRepository.getReplaySessions(app.clickhouse, req.admin.website_id, organizationId, period, q.from ? String(q.from) : null, q.to ? String(q.to) : null, Number(q.offset ?? 0), limit, sessionSearch, visitorSearch, filterUserId || null);
        const rawSessions = result.sessions ?? [];
        if (organizationId > 0 && rawSessions.length > 0) {
            const visitorIds = rawSessions.map((s) => String(s.visitor_id ?? "")).filter(Boolean);
            const [accountLabelsByVisitor, profileByVisitor] = await Promise.all([
                visitorsRepository.getBrowserAccountLabelLists(app.clickhouse, req.admin.website_id, visitorIds),
                visitorsRepository.getUnifiedVisitorDisplayProfilesByVisitorIds(app.clickhouse, req.admin.website_id, organizationId, visitorIds),
            ]);
            result.sessions = rawSessions.map((s) => {
                const vid = String(s.visitor_id ?? "");
                const cdp = profileByVisitor.get(vid) ?? null;
                const label = profileDisplayLabel(cdp);
                return {
                    ...s,
                    cdp_profile: cdp,
                    browser_account_labels: accountLabelsByVisitor[vid] ?? [],
                    last_active_profile_label: label,
                };
            });
        }
        return result;
    });
    app.get("/api/analytics/replay/events", auth, async (req, reply) => {
        const q = req.query;
        const sessionId = String(q.session_id ?? "");
        if (!sessionId)
            return reply.status(400).send({ detail: "session_id required" });
        const [exists, hasReplay] = await Promise.all([
            analyticsRepository.sessionExists(app.clickhouse, req.admin.website_id, sessionId),
            analyticsRepository.sessionHasReplay(app.clickhouse, req.admin.website_id, sessionId),
        ]);
        if (!exists && !hasReplay) {
            return reply.status(404).send({ detail: "Session not found" });
        }
        const { events, chunkCount, storage, minChunkIndex } = await analyticsRepository.getReplayEvents(app.clickhouse, req.admin.website_id, sessionId, String(q.period ?? "overall"), q.from ? String(q.from) : null, q.to ? String(q.to) : null, q.page_path ? String(q.page_path) : null, Number(q.limit ?? 5000));
        const hasSnapshot = replayHasFullSnapshot(events);
        const hasIncrementals = replayHasIncrementals(events);
        let minTs = Infinity;
        let maxTs = -Infinity;
        for (const event of events) {
            const ts = typeof event === "object" && event && "timestamp" in event
                ? Number(event.timestamp)
                : 0;
            if (Number.isFinite(ts) && ts > 0) {
                minTs = Math.min(minTs, ts);
                maxTs = Math.max(maxTs, ts);
            }
        }
        const durationSec = maxTs > minTs ? (maxTs - minTs) / 1000 : 0;
        return {
            format: "rrweb",
            schema_version: 1,
            storage,
            heatmap_source: "interaction_events",
            session_id: sessionId,
            page_path: q.page_path ?? null,
            period: String(q.period ?? "overall"),
            available: events.length > 0 && hasSnapshot && hasIncrementals,
            has_full_snapshot: hasSnapshot,
            has_incrementals: hasIncrementals,
            duration_sec: durationSec,
            min_chunk_index: minChunkIndex ?? 0,
            event_count: events.length,
            chunk_count: chunkCount,
            events,
            replay_note: !hasSnapshot
                ? "Recording is missing a DOM snapshot — playback may not render."
                : !hasIncrementals
                    ? "Static snapshot only — no mouse/scroll events were captured. Record again and interact for 15+ seconds on the demo page."
                    : durationSec < 5
                        ? "Short recording — use the player controls to play/scrub. Complex SPAs may show a static frame or client errors."
                        : null,
        };
    });
    const heatmapDateFilter = (period, from, to) => {
        const [start, end] = periodFilter(period, from, to);
        return dateFilter("ie.created_at", start, end);
    };
    app.get("/api/analytics/heatmap-pages", auth, async (req) => {
        const { period, from, to } = periodParams(req.query);
        const limit = Number(req.query.limit ?? 500);
        const interactionDates = heatmapDateFilter(period, from, to);
        const pages = await heatmapRepository.fetchHeatmapPages(app.clickhouse, req.admin.website_id, interactionDates, limit);
        const totals = await heatmapRepository.fetchDomainEventTotals(app.clickhouse, req.admin.website_id, interactionDates.replace("ie.created_at", "created_at"));
        return { period, pages, totals };
    });
    app.get("/api/analytics/heatmap-scopes", auth, async (req) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        const pagePath = String(q.page_path ?? "");
        const eventType = String(q.event_type ?? "click");
        const limit = Number(q.limit ?? 200);
        const scopes = await heatmapRepository.fetchHeatmapScopes(app.clickhouse, req.admin.website_id, pagePath, heatmapDateFilter(period, from, to), eventType, limit);
        return { period, ...scopes };
    });
    app.get("/api/analytics/heatmap", auth, async (req) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        let heatmapFilterUserId = q.user_id ? String(q.user_id) : q.userId ? String(q.userId) : "";
        const heatmapCdpId = q.cdp_id ? String(q.cdp_id) : "";
        if (!heatmapFilterUserId && heatmapCdpId) {
            heatmapFilterUserId = filterUserIdFromCdpId(heatmapCdpId, req.admin.website_id) ?? "";
        }
        const payload = await heatmapRepository.fetchHeatmapData(app.clickhouse, req.admin.website_id, String(q.page_path ?? ""), heatmapDateFilter(period, from, to), String(q.event_type ?? "click"), q.visitor_id ? String(q.visitor_id) : undefined, q.session_id ? String(q.session_id) : undefined, 5000, heatmapFilterUserId || null);
        return { period, ...payload };
    });
    app.get("/api/analytics/heatmaps", auth, async (req) => {
        const q = req.query;
        const { period, from, to } = periodParams(q);
        const pagePath = String(q.page_path ?? "/");
        let heatmapFilterUserId = q.user_id ? String(q.user_id) : q.userId ? String(q.userId) : "";
        const heatmapCdpId = q.cdp_id ? String(q.cdp_id) : "";
        if (!heatmapFilterUserId && heatmapCdpId) {
            heatmapFilterUserId = filterUserIdFromCdpId(heatmapCdpId, req.admin.website_id) ?? "";
        }
        const payload = await heatmapRepository.fetchHeatmapData(app.clickhouse, req.admin.website_id, pagePath, heatmapDateFilter(period, from, to), "click", q.visitor_id ? String(q.visitor_id) : undefined, q.session_id ? String(q.session_id) : undefined, 5000, heatmapFilterUserId || null);
        const clicks = payload.points.map((p) => ({
            x: p.x,
            y: p.y,
            viewport_w: p.viewport_w,
            viewport_h: p.viewport_h,
            count: p.event_count,
        }));
        return { page_path: pagePath, period, clicks };
    });
    app.get("/api/analytics/insights", auth, async (req) => {
        const period = String(req.query.period ?? "month");
        const websiteId = req.admin.website_id;
        const key = `insights:${websiteId}:${period}`;
        return cached(app, key, async () => {
            const snapshot = await insightsRepository.buildSnapshot(app.clickhouse, websiteId, period);
            const narrative = await fetchInsightsNarrative(snapshot, {
                organizationId: req.admin.organization_id,
                userId: req.admin.id,
            });
            return mergeInsightsResponse(snapshot, narrative);
        }, env.INSIGHTS_CACHE_TTL_SECONDS);
    });
});
export const heatmapEventPattern = `^(${[...HEATMAP_EVENT_TYPES, "all"].join("|")})$`;
