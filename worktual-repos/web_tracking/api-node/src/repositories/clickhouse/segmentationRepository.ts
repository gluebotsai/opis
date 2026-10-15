import { type ClickHouseClient, chQuery, chQueryOne, type Row } from "../../plugins/clickhouse.js";
import { dateFilter, resolveHeavyQueryBounds } from "../../utils/period.js";
import { SCROLL_EVENT_TYPES_SQL } from "../../utils/clickhouseSql.js";
import { buildEventSegments, buildVisitorSegments } from "../../utils/segmentationSegments.js";
import {
  clickhouseConsumerDomainInList,
  getSegmentationProfile,
  pageEngagementPathFilter,
  type SegmentationProfileDefinition,
} from "../../utils/businessSegmentationProfile.js";
import { B2B_PAGE_PATH_SQL, B2C_PAGE_PATH_SQL } from "../../utils/visitorAudienceClassifier.js";
import type { OrganizationBusinessType } from "../../utils/organizationBusinessType.js";

function clampThresholdPct(raw: number): number {
  if (!Number.isFinite(raw)) return 50;
  return Math.min(100, Math.max(1, Math.round(raw)));
}

async function fetchIntentLevelBa(
  client: ClickHouseClient,
  websiteId: number,
  pvFilter: string,
  sessionFilter: string,
  formFilter: string,
  conversionFilter: string,
  params: Record<string, unknown>,
  includeFormMetrics: boolean,
): Promise<ReturnType<typeof buildVisitorSegments>> {
  const includeForms = includeFormMetrics ? 1 : 0;
  const queryParams = { ...params, includeForms };
  const consumerDomains = clickhouseConsumerDomainInList();
  const rows = await chQuery(
    client,
    `
            WITH active_visitors AS (
                SELECT DISTINCT visitor_id
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${pvFilter}
            ),
            identity AS (
                SELECT
                    visitor_id,
                    argMax(email, last_identified_at) AS email,
                    argMax(traits_json, last_identified_at) AS traits_json
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                GROUP BY visitor_id
            ),
            email_domain AS (
                SELECT
                    visitor_id,
                    lower(arrayElement(splitByChar('@', lower(email)), 2)) AS domain
                FROM identity
                WHERE length(email) > 0 AND position(email, '@') > 0
            ),
            multi_domain AS (
                SELECT domain
                FROM email_domain
                WHERE length(domain) > 0
                  AND domain NOT IN (${consumerDomains})
                GROUP BY domain
                HAVING countDistinct(visitor_id) >= 2
            ),
            recent_session AS (
                SELECT
                    visitor_id,
                    argMax(nullIf(user_id, ''), started_at) AS last_session_user_id
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32}${sessionFilter}
                GROUP BY visitor_id
            ),
            page_signals AS (
                SELECT
                    visitor_id,
                    countIf(match(lower(page_path), '${B2B_PAGE_PATH_SQL}')) AS b2b_pages,
                    countIf(match(lower(page_path), '${B2C_PAGE_PATH_SQL}')) AS b2c_pages
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${pvFilter}
                GROUP BY visitor_id
            ),
            conversion_signals AS (
                SELECT
                    visitor_id,
                    countIf(conversion_type = 'add_to_cart') AS add_to_cart,
                    countIf(conversion_type = 'purchase') AS purchase
                FROM fact_conversion_events
                WHERE website_id = {websiteId:UInt32}${conversionFilter}
                GROUP BY visitor_id
            ),
            form_signals AS (
                SELECT visitor_id, count() AS form_count
                FROM fact_form_events
                WHERE website_id = {websiteId:UInt32}${formFilter}
                GROUP BY visitor_id
            ),
            session_stats AS (
                SELECT
                    visitor_id,
                    max(pageview_count) AS max_pageviews,
                    max(duration_seconds) AS max_duration_seconds,
                    max(is_bounce) AS had_bounce
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32}${sessionFilter}
                GROUP BY visitor_id
            ),
            scored AS (
                SELECT
                    av.visitor_id AS visitor_id,
                    toUInt16(
                        (if(length(coalesce(i.email, '')) > 0 AND position(i.email, '@') > 0
                          AND lower(arrayElement(splitByChar('@', lower(i.email)), 2)) NOT IN (${consumerDomains}), 2, 0))
                        + if(length(nullIf(JSONExtractString(coalesce(i.traits_json, ''), 'company'), '')) > 0, 2, 0)
                        + if(md.domain != '', 1, 0)
                        + if(length(coalesce(rs.last_session_user_id, '')) > 0, 1, 0)
                        + least(coalesce(ps.b2b_pages, toUInt64(0)), toUInt64(3))
                        + if({includeForms:UInt8} = 1 AND coalesce(fs.form_count, toUInt64(0)) > 0, 2, 0)
                    ) AS b2b_score,
                    toUInt16(
                        (if(length(coalesce(i.email, '')) > 0 AND position(i.email, '@') > 0
                          AND lower(arrayElement(splitByChar('@', lower(i.email)), 2)) IN (${consumerDomains}), 2, 0))
                        + if(length(coalesce(rs.last_session_user_id, '')) > 0, 1, 0)
                        + least(coalesce(ps.b2c_pages, toUInt64(0)), toUInt64(3))
                        + if(coalesce(cs.add_to_cart, toUInt64(0)) > 0, 2, 0)
                        + if(coalesce(cs.purchase, toUInt64(0)) > 0, 3, 0)
                    ) AS b2c_score,
                    multiIf(
                        coalesce(ss.max_pageviews, toUInt32(1)) <= 1 OR coalesce(ss.had_bounce, toUInt8(0)) = 1, 'low',
                        coalesce(ss.max_pageviews, toUInt32(1)) >= 5 AND coalesce(ss.max_duration_seconds, toUInt32(0)) >= 120, 'high',
                        'medium'
                    ) AS engagement_level,
                    coalesce(cs.purchase, toUInt64(0)) > 0 AS has_purchase,
                    ({includeForms:UInt8} = 1 AND coalesce(fs.form_count, toUInt64(0)) > 0) AS has_form
                FROM active_visitors av
                LEFT JOIN identity i ON i.visitor_id = av.visitor_id
                LEFT JOIN email_domain ed ON ed.visitor_id = av.visitor_id
                LEFT JOIN multi_domain md ON md.domain = ed.domain
                LEFT JOIN recent_session rs ON rs.visitor_id = av.visitor_id
                LEFT JOIN page_signals ps ON ps.visitor_id = av.visitor_id
                LEFT JOIN conversion_signals cs ON cs.visitor_id = av.visitor_id
                LEFT JOIN form_signals fs ON fs.visitor_id = av.visitor_id
                LEFT JOIN session_stats ss ON ss.visitor_id = av.visitor_id
            ),
            classified AS (
                SELECT
                    visitor_id,
                    b2b_score,
                    b2c_score,
                    engagement_level,
                    has_purchase,
                    has_form,
                    multiIf(
                        has_purchase OR has_form, 'High',
                        b2b_score = 0 AND b2c_score = 0 AND engagement_level = 'low', 'Low',
                        engagement_level = 'high', 'High',
                        b2b_score = 0 AND b2c_score = 0, 'Low',
                        b2b_score + b2c_score >= 4, 'High',
                        b2b_score + b2c_score >= 2, 'Medium',
                        'Low'
                    ) AS intent_level
                FROM scored
            )
            SELECT intent_level AS bucket, count() AS visitors
            FROM classified
            GROUP BY intent_level
            `,
    queryParams,
  );

  const intentOrder = ["Low", "Medium", "High"];
  const intentMap = new Map<string, number>();
  for (const row of rows) {
    const bucket = String(row.bucket);
    intentMap.set(bucket, Number(row.visitors ?? 0));
  }

  return buildVisitorSegments(
    intentOrder.map((label) => ({
      label: `${label} intent`,
      visitors: intentMap.get(label) ?? 0,
    })),
  );
}

export async function getVisitorSegmentation(
  client: ClickHouseClient,
  websiteId: number,
  period: string,
  pageEngagementThresholdPct = 50,
  organizationBusinessType: OrganizationBusinessType | null = null,
): Promise<Row> {
  const thresholdPct = clampThresholdPct(pageEngagementThresholdPct);
  const profile: SegmentationProfileDefinition = getSegmentationProfile(organizationBusinessType);
  const [startExpr, endExpr] = resolveHeavyQueryBounds(period);
  const pvFilter = dateFilter("created_at", startExpr, endExpr);
  const sessionFilter = dateFilter("started_at", startExpr, endExpr);
  const ieFilter = dateFilter("created_at", startExpr, endExpr);
  const formFilter = dateFilter("created_at", startExpr, endExpr);
  const conversionFilter = dateFilter("created_at", startExpr, endExpr);

  const params = { websiteId, thresholdPct };

  const accountRows = await chQuery(
    client,
    `
            WITH active_visitors AS (
                SELECT DISTINCT visitor_id
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${pvFilter}
            ),
            recent_session AS (
                SELECT
                    visitor_id,
                    argMax(nullIf(user_id, ''), started_at) AS last_session_user_id
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32}${sessionFilter}
                GROUP BY visitor_id
            ),
            known_visitors AS (
                SELECT DISTINCT visitor_id
                FROM dim_known_users FINAL
                WHERE website_id = {websiteId:UInt32}
                  AND length(user_id) > 0
            ),
            classified AS (
                SELECT
                    av.visitor_id AS visitor_id,
                    multiIf(
                        length(coalesce(rs.last_session_user_id, '')) > 0, 'logged_in',
                        kv.visitor_id != '', 'logged_out',
                        'anonymous'
                    ) AS account_state
                FROM active_visitors av
                LEFT JOIN recent_session rs ON rs.visitor_id = av.visitor_id
                LEFT JOIN known_visitors kv ON kv.visitor_id = av.visitor_id
            )
            SELECT account_state, count() AS visitors
            FROM classified
            GROUP BY account_state
            `,
    params,
  );

  const accountLabel: Record<string, string> = profile.account_behaviour_labels;
  const accountOrder = ["anonymous", "logged_in", "logged_out"];
  const accountByState = new Map(
    accountRows.map((row) => [String(row.account_state), Number(row.visitors ?? 0)]),
  );
  const account_behaviour = buildVisitorSegments(
    accountOrder.map((state) => ({
      label: accountLabel[state] ?? state,
      visitors: accountByState.get(state) ?? 0,
    })),
  );

  const conversionRow = await chQueryOne(
    client,
    `
            WITH active_visitors AS (
                SELECT DISTINCT visitor_id
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${pvFilter}
            ),
            purchasers AS (
                SELECT DISTINCT visitor_id
                FROM fact_conversion_events
                WHERE website_id = {websiteId:UInt32}
                  AND conversion_type = 'purchase'
            )
            SELECT
                countIf(purchasers.visitor_id != '') AS converted,
                countIf(purchasers.visitor_id = '') AS not_converted
            FROM active_visitors av
            LEFT JOIN purchasers ON purchasers.visitor_id = av.visitor_id
            `,
    params,
  );

  const conversion_status = buildVisitorSegments([
    { label: "Converted", visitors: Number(conversionRow?.converted ?? 0) },
    { label: "Non-converted", visitors: Number(conversionRow?.not_converted ?? 0) },
  ]);

  const interactionRow = await chQueryOne(
    client,
    `
            SELECT
                (
                    SELECT count()
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}
                      AND event_type = 'click'${ieFilter}
                ) AS clicks,
                (
                    SELECT count()
                    FROM fact_interaction_events
                    WHERE website_id = {websiteId:UInt32}
                      AND event_type IN (${SCROLL_EVENT_TYPES_SQL})${ieFilter}
                ) AS scrolls,
                (
                    SELECT count()
                    FROM fact_form_events
                    WHERE website_id = {websiteId:UInt32}${formFilter}
                ) AS form_interactions
            `,
    params,
  );

  const interactionRows = [
    { label: "Clicks", events: Number(interactionRow?.clicks ?? 0) },
    { label: "Scrolls", events: Number(interactionRow?.scrolls ?? 0) },
  ];
  if (profile.include_form_metrics) {
    interactionRows.push({
      label: "Form interactions",
      events: Number(interactionRow?.form_interactions ?? 0),
    });
  }
  const interaction_behaviour = buildEventSegments(interactionRows);

  const pagePathFilter = pageEngagementPathFilter(profile.site_profile);

  const pageEngagementRow = await chQueryOne(
    client,
    `
            WITH page_views_by_path AS (
                SELECT count() AS views
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${pvFilter}${pagePathFilter}
                GROUP BY page_path
            ),
            site_peak AS (
                SELECT coalesce(max(views), toUInt64(0)) AS max_views FROM page_views_by_path
            ),
            threshold AS (
                SELECT greatest(
                    toFloat64(max_views) * {thresholdPct:Float64} / 100.0,
                    toFloat64(1)
                ) AS page_view_threshold
                FROM site_peak
            ),
            visitor_peak AS (
                SELECT
                    visitor_id,
                    max(views_on_page) AS peak_views
                FROM (
                    SELECT visitor_id, page_path, count() AS views_on_page
                    FROM fact_page_views
                    WHERE website_id = {websiteId:UInt32}${pvFilter}${pagePathFilter}
                    GROUP BY visitor_id, page_path
                )
                GROUP BY visitor_id
            ),
            active_visitors AS (
                SELECT DISTINCT visitor_id
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${pvFilter}
            )
            SELECT
                (SELECT page_view_threshold FROM threshold) AS page_view_threshold,
                (SELECT max_views FROM site_peak) AS site_peak_page_views,
                countIf(coalesce(vp.peak_views, toUInt64(0)) >= (SELECT page_view_threshold FROM threshold)) AS high_viewed,
                countIf(coalesce(vp.peak_views, toUInt64(0)) < (SELECT page_view_threshold FROM threshold)) AS low_viewed
            FROM active_visitors av
            LEFT JOIN visitor_peak vp ON vp.visitor_id = av.visitor_id
            `,
    params,
  );

  const page_view_threshold = Number(pageEngagementRow?.page_view_threshold ?? 0);
  const page_engagement = buildVisitorSegments([
    { label: "High-viewed pages", visitors: Number(pageEngagementRow?.high_viewed ?? 0) },
    { label: "Low-viewed pages", visitors: Number(pageEngagementRow?.low_viewed ?? 0) },
  ]);

  const engagementRows = await chQuery(
    client,
    `
            WITH active_visitors AS (
                SELECT DISTINCT visitor_id
                FROM fact_page_views
                WHERE website_id = {websiteId:UInt32}${pvFilter}
            ),
            session_stats AS (
                SELECT
                    visitor_id,
                    max(pageview_count) AS max_pageviews,
                    max(duration_seconds) AS max_duration_seconds,
                    max(is_bounce) AS had_bounce
                FROM dim_sessions FINAL
                WHERE website_id = {websiteId:UInt32}${sessionFilter}
                GROUP BY visitor_id
            ),
            scored AS (
                SELECT
                    av.visitor_id AS visitor_id,
                    coalesce(ss.max_pageviews, toUInt32(1)) AS max_pageviews,
                    coalesce(ss.max_duration_seconds, toUInt32(0)) AS max_duration_seconds,
                    coalesce(ss.had_bounce, toUInt8(0)) AS had_bounce
                FROM active_visitors av
                LEFT JOIN session_stats ss ON ss.visitor_id = av.visitor_id
            ),
            classified AS (
                SELECT
                    visitor_id,
                    multiIf(
                        max_pageviews <= 1 OR had_bounce = 1, 'low',
                        max_pageviews >= 5 AND max_duration_seconds >= 120, 'high',
                        'medium'
                    ) AS engagement_level
                FROM scored
            )
            SELECT engagement_level, count() AS visitors
            FROM classified
            GROUP BY engagement_level
            `,
    params,
  );

  const engagementLabel: Record<string, string> = {
    low: "Low engagement",
    medium: "Medium engagement",
    high: "High engagement",
  };
  const engagementOrder = ["low", "medium", "high"];
  const engagementByLevel = new Map(
    engagementRows.map((row) => [String(row.engagement_level), Number(row.visitors ?? 0)]),
  );
  const engagement_level = buildVisitorSegments(
    engagementOrder.map((level) => ({
      label: engagementLabel[level] ?? level,
      visitors: engagementByLevel.get(level) ?? 0,
    })),
  );

  const intent_level_ba = await fetchIntentLevelBa(
    client,
    websiteId,
    pvFilter,
    sessionFilter,
    formFilter,
    conversionFilter,
    params,
    profile.include_form_metrics,
  );

  return {
    period,
    website_id: websiteId,
    organization_business_type: profile.organization_business_type,
    site_profile: profile.site_profile,
    panel_subtitle: profile.panel_subtitle,
    page_engagement_title: profile.page_engagement_title,
    interaction_behaviour_title: profile.interaction_behaviour_title,
    intent_level_hint: profile.intent_level_hint,
    page_engagement_hint: profile.page_engagement_hint,
    page_engagement_threshold_pct: thresholdPct,
    page_view_threshold,
    site_peak_page_views: Number(pageEngagementRow?.site_peak_page_views ?? 0),
    account_behaviour,
    conversion_status,
    interaction_behaviour,
    page_engagement,
    engagement_level,
    intent_level_ba,
  };
}
