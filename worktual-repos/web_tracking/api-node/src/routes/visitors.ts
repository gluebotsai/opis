import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Row } from "../plugins/clickhouse.js";
import { abandonedCartRepository } from "../repositories/clickhouse/abandonedCartRepository.js";
import { visitorsRepository } from "../repositories/clickhouse/visitorsRepository.js";
import { bouncePageForSession, isSessionBounce } from "../utils/bounceRate.js";
import {
  buildSessionChannelMix,
  buildVisitorTouchAttribution,
  enrichSessionsWithTouch,
} from "../utils/attributionUtils.js";
import { buildDeviceSummary, buildLocationSummary, buildVisitorTrafficSource, collapseJourneySteps } from "../utils/visitorUtils.js";
import { buildVisitorCdpProfile, profileDisplayLabel } from "../utils/visitorCdpProfile.js";
import {
  resolveSessionDisplayProfiles,
  sessionDisplayMapKey,
} from "../services/sessionDisplayIdentity.js";
import { env } from "../config/env.js";
import { getLiveFromRedis, isRedisLiveReady } from "../services/livePresenceRedis.js";
import {
  analyticsFilterFromScope,
  resolveVisitorAnalyticsScope,
} from "../utils/visitorAnalyticsScope.js";
import { resolveSelectedCdpId } from "../utils/resolveSelectedCdpProfile.js";
import { buildAnonymousScopeProfile } from "../utils/guestUserProfile.js";

export const visitorsRoutes = fp(async function visitorsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.get("/api/visitors", auth, async (req) => {
    const q = req.query as Record<string, unknown>;
    const offset = Math.max(0, Number(q.offset ?? 0));
    const limit = Math.max(1, Math.min(100, Number(q.limit ?? 25)));
    const search = q.search ? String(q.search) : q.visitor_id ? String(q.visitor_id) : null;
    const organizationId = await visitorsRepository.resolveOrganizationId(
      app.clickhouse,
      req.admin.website_id,
      req.admin.organization_id,
    );
    const result = await visitorsRepository.listVisitors(
      app.clickhouse,
      req.admin.website_id,
      organizationId,
      offset,
      limit,
      search,
    );
    const rawVisitors = (result.visitors as Record<string, unknown>[]) ?? [];
    const visitorIds = rawVisitors.map((row) => String(row.visitor_id ?? "")).filter(Boolean);
    const websiteId = req.admin.website_id;
    const accountLabelsByVisitor =
      organizationId > 0
        ? await visitorsRepository.getBrowserAccountLabelLists(app.clickhouse, websiteId, visitorIds)
        : {};

    let liveSessionByVisitor = new Map<string, string>();
    if (isRedisLiveReady(app.redis)) {
      const live = await getLiveFromRedis(
        app.redis,
        websiteId,
        env.LIVE_PRESENCE_TTL_SECONDS,
      );
      for (const s of live.sessions) {
        const visitorId = String(s.visitor_id ?? "").trim();
        const sessionId = String(s.session_id ?? "").trim();
        if (visitorId && sessionId && !liveSessionByVisitor.has(visitorId)) {
          liveSessionByVisitor.set(visitorId, sessionId);
        }
      }
    } else {
      liveSessionByVisitor = await visitorsRepository.getActiveLiveSessionIdsByVisitorIds(
        app.clickhouse,
        websiteId,
        visitorIds,
      );
    }

    const recentSessionByVisitor = await visitorsRepository.getRecentSessionIdsByVisitorIds(
      app.clickhouse,
      websiteId,
      visitorIds,
    );

    const displayKeys = visitorIds.map((visitorId) => {
      const sessionId =
        liveSessionByVisitor.get(visitorId) ?? recentSessionByVisitor.get(visitorId) ?? "";
      return { session_id: sessionId, visitor_id: visitorId };
    });

    const profileBySessionKey = await resolveSessionDisplayProfiles(
      app.clickhouse,
      websiteId,
      organizationId,
      displayKeys.filter((key) => key.session_id),
    );

    const visitors = rawVisitors.map((row) => {
      const visitorId = String(row.visitor_id ?? "");
      const sessionId =
        liveSessionByVisitor.get(visitorId) ?? recentSessionByVisitor.get(visitorId) ?? "";
      const cdp = sessionId
        ? (profileBySessionKey.get(sessionDisplayMapKey({ session_id: sessionId, visitor_id: visitorId })) ??
          null)
        : null;
      const linkedProfileCount = Number(row.linked_cdp_profiles_count ?? 0);
      const browserAccountLabels = accountLabelsByVisitor[visitorId] ?? [];
      const lastActiveLabel = profileDisplayLabel(cdp);
      let identityLabel = lastActiveLabel;
      if (linkedProfileCount > 1) {
        identityLabel = `${lastActiveLabel} · ${linkedProfileCount} IDs`;
      }
      return {
        ...row,
        cdp_profile: cdp,
        linked_cdp_profiles_count: linkedProfileCount,
        browser_account_labels: browserAccountLabels,
        last_active_profile_label: lastActiveLabel,
        identity_label: identityLabel,
      };
    });
    return { ...result, visitors };
  });

  app.get("/api/visitors/:visitorId/accounts", auth, async (req) => {
    const { visitorId } = req.params as { visitorId: string };
    const websiteId = req.admin.website_id;
    const organizationId = await visitorsRepository.resolveOrganizationId(
      app.clickhouse,
      websiteId,
      req.admin.organization_id,
    );
    const knownCdpProfiles = await visitorsRepository.resolveLinkedKnownCdpProfiles(
      app.clickhouse,
      organizationId,
      visitorId,
      websiteId,
    );
    const profiles =
      knownCdpProfiles.length > 0
        ? [buildAnonymousScopeProfile(), ...knownCdpProfiles]
        : [];
    return {
      visitor_id: visitorId,
      linked_cdp_profiles: profiles,
      scope: profiles.length > 1 ? "multi_account_browser" : "single",
    };
  });

  app.get("/api/visitors/:visitorId", auth, async (req, reply) => {
    const { visitorId } = req.params as { visitorId: string };
    const q = req.query as Record<string, unknown>;
    const queryCdpId = q.cdp_id ? String(q.cdp_id) : null;
    const queryUserId = q.userId ? String(q.userId) : q.user_id ? String(q.user_id) : null;
    const websiteId = req.admin.website_id;
    const organizationId = await visitorsRepository.resolveOrganizationId(
      app.clickhouse,
      websiteId,
      req.admin.organization_id,
    );

    const knownCdpProfiles = await visitorsRepository.resolveLinkedKnownCdpProfiles(
      app.clickhouse,
      organizationId,
      visitorId,
      websiteId,
    );
    const linkedCdpProfiles =
      knownCdpProfiles.length > 0
        ? [buildAnonymousScopeProfile(), ...knownCdpProfiles]
        : [];

    const selectedCdpId = resolveSelectedCdpId(linkedCdpProfiles, {
      cdpId: queryCdpId,
      userId: queryUserId,
    });

    let visitor = await visitorsRepository.getVisitor(
      app.clickhouse,
      websiteId,
      organizationId,
      visitorId,
      selectedCdpId,
    );
    if (!visitor) {
      visitor = await visitorsRepository.getVisitor(
        app.clickhouse,
        websiteId,
        organizationId,
        visitorId,
      );
    }
    if (!visitor) return reply.status(404).send({ detail: "Visitor not found" });

    const cdpProfile =
      linkedCdpProfiles.find((p) => p.cdp_id === selectedCdpId) ??
      buildVisitorCdpProfile(visitor, visitorId);
    const analyticsScope = resolveVisitorAnalyticsScope(visitorId, cdpProfile, {
      linkedCdpProfiles,
      selectedCdpId,
    });
    const analyticsFilter = analyticsFilterFromScope(analyticsScope);

    const [
      sessions,
      sessionAttribution,
      campaignJson,
      clicks,
      interactions,
      topPages,
      topProducts,
      productActivity,
      cartAbandonment,
      conversions,
      conversionRevenue,
      journey,
      totalDuration,
      scrollDepth,
      engagement,
      recentInteractions,
      dailyActivity,
      combinedRollup,
    ] = await Promise.all([
      visitorsRepository.getVisitorSessions(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorSessionAttribution(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorCampaignAttribution(app.clickhouse, websiteId, visitorId),
      visitorsRepository.getVisitorClickCount(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorInteractionCount(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorTopPages(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorTopProducts(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorProductActivity(app.clickhouse, websiteId, analyticsFilter),
      abandonedCartRepository.getVisitorCartAbandonment(
        app.clickhouse,
        websiteId,
        analyticsFilter.visitorIds,
        60,
      ),
      visitorsRepository.getVisitorConversions(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorConversionRevenue(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorJourney(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorTotalDuration(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorScrollDepth(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorEngagement(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorRecentInteractions(app.clickhouse, websiteId, analyticsFilter),
      visitorsRepository.getVisitorDailyActivity(app.clickhouse, websiteId, analyticsFilter),
      analyticsScope.scope === "cdp_linked"
        ? visitorsRepository.getVisitorCombinedRollup(
            app.clickhouse,
            websiteId,
            analyticsFilter.visitorIds,
          )
        : Promise.resolve(null as Row | null),
    ]);

    const latestSession = sessions[0] ?? null;
    const device = buildDeviceSummary(latestSession);
    const location = buildLocationSummary(latestSession, visitor.country as string | undefined);
    const trafficSource = buildVisitorTrafficSource(sessions, journey, topPages);
    const touchAttribution = buildVisitorTouchAttribution(campaignJson, sessionAttribution);
    const sessionsWithTouch = enrichSessionsWithTouch(sessions as Record<string, unknown>[]);
    const sessionChannelMix = buildSessionChannelMix(sessions as Record<string, unknown>[]);
    const journeySteps = collapseJourneySteps(journey as Record<string, unknown>[]);

    const totalPageviews = Number(engagement.total_pageviews ?? visitor.total_pageviews ?? 0);
    const isBounce =
      sessions.length > 0
        ? sessions.every((s) =>
            isSessionBounce(Number(s.pageview_count ?? 0), Number(s.duration_seconds ?? 0)),
          )
        : false;
    const summaryBouncePage = isBounce
      ? sessions
          .map((s) => bouncePageForSession(s as Record<string, unknown>))
          .find((page) => page.length > 0) ?? ""
      : "";

    const combinedFirstSeen = combinedRollup?.first_seen_at;
    const combinedLastSeen = combinedRollup?.last_seen_at;
    const combinedSessions = Number(combinedRollup?.total_sessions ?? 0);
    const combinedPageviews = Number(combinedRollup?.total_pageviews ?? 0);
    const useCombinedRollup = analyticsScope.scope === "cdp_linked";
    const multiAccount = analyticsScope.scope === "multi_account_browser";

    const filteredSessionCount = sessions.length;
    const filteredPageviews = Number(engagement.total_pageviews ?? 0);
    const filteredFirstSeen =
      sessions.length > 0
        ? sessions.reduce((min, s) => {
            const t = String(s.started_at ?? "");
            return !min || (t && t < min) ? t : min;
          }, "")
        : null;
    const filteredLastSeen =
      sessions.length > 0
        ? sessions.reduce((max, s) => {
            const t = String(s.ended_at ?? s.started_at ?? "");
            return t > max ? t : max;
          }, "")
        : null;

    const displayVisitor = {
      ...visitor,
      first_seen_at: useCombinedRollup && combinedFirstSeen
        ? combinedFirstSeen
        : multiAccount && filteredFirstSeen
          ? filteredFirstSeen
          : visitor.first_seen_at,
      last_seen_at: useCombinedRollup && combinedLastSeen
        ? combinedLastSeen
        : multiAccount && filteredLastSeen
          ? filteredLastSeen
          : visitor.last_seen_at,
      total_sessions: useCombinedRollup && combinedSessions > 0
        ? combinedSessions
        : multiAccount
          ? filteredSessionCount
          : visitor.total_sessions,
      total_pageviews: useCombinedRollup && combinedPageviews > 0
        ? combinedPageviews
        : multiAccount
          ? filteredPageviews
          : visitor.total_pageviews,
      cdp_profile: cdpProfile,
      identity_label: cdpProfile?.identity_label ?? "Anonymous",
    };

    return {
      analytics_scope: analyticsScope,
      visitor: displayVisitor,
      cdp_profile: cdpProfile,
      summary: {
        total_clicks: clicks,
        total_interactions: interactions,
        total_pageviews: totalPageviews,
        total_session_duration_sec: totalDuration,
        session_span_note: useCombinedRollup
          ? "Combined metrics across all visitor IDs linked to this CDP customer."
          : multiAccount
            ? "All metrics on this page are scoped to the selected account only (Guest user, or a logged-in customer)."
            : "Elapsed time from first to last recorded activity in this visit.",
        rage_clicks: Number(engagement.rage_clicks ?? 0),
        dead_clicks: Number(engagement.dead_clicks ?? 0),
        scroll_events: Number(engagement.scroll_events ?? 0),
        max_scroll_depth: Number(engagement.max_scroll_depth ?? 0),
        is_bounce: isBounce,
        bounce_page: summaryBouncePage,
        browser: device.browser_label || device.os,
        user_agent: device.user_agent,
        device,
        location,
        traffic_source: trafficSource,
        touch_attribution: touchAttribution,
        session_channel_mix: sessionChannelMix,
      },
      sessions: sessionsWithTouch,
      recent_interactions: recentInteractions,
      daily_activity: dailyActivity,
      top_pages: topPages,
      top_products: topProducts,
      product_activity: {
        ...productActivity,
        cart_abandonment: cartAbandonment,
      },
      conversions,
      commerce_revenue: conversionRevenue,
      journey: journeySteps,
      scroll_depth: scrollDepth,
    };
  });
});
