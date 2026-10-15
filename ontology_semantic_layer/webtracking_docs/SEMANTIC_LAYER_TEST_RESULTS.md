# Semantic Layer Metric Test Results

- **Endpoint:** `http://192.168.11.25:8765/v1/semantic/query`
- **Organization:** `1003`
- **Product / agent:** `webtracking` / `wt.reporting_mas`
- **Users tested:** `1019`
- **ClickHouse website_id:** `1001`
- **Run date:** `2026-09-20`

## Summary

| Total cases | Passed | API fail | Value mismatch | No CH reference |
|-------------|--------|----------|----------------|-----------------|
| 107 | 51 | 19 | 37 | 11 |

## Details

| Wave | User | Metric | Case | HTTP | API OK | Match | API value | CH value | Note |
|------|------|--------|------|------|--------|-------|-----------|----------|------|
| wave1_no_time | 1019 | web_session_volume | no_time | 200 | yes | yes | 265 | 266 |  |
| wave1_no_time | 1019 | unique_visitors | no_time | 200 | yes | yes | 120 | 121 |  |
| wave1_no_time | 1019 | page_views | no_time | 200 | yes | no | 470 | 472 |  |
| wave1_no_time | 1019 | average_session_duration | no_time | 200 | yes | no | 3878.3433962264153 | 4018 |  |
| wave1_no_time | 1019 | bounce_rate | no_time | 200 | yes | no | 0.4075471698113208 | 42.35 |  |
| wave1_no_time | 1019 | bounce_count | no_time | 200 | yes | yes | 108 | 108 |  |
| wave1_no_time | 1019 | total_clicks | no_time | 200 | yes | yes | 2085 | 2086 |  |
| wave1_no_time | 1019 | total_conversions | no_time | 200 | yes | yes | 0 | 1 |  |
| wave1_no_time | 1019 | new_visitor_count | no_time | 200 | yes | yes | 77 | 78 |  |
| wave1_no_time | 1019 | returning_visitor_count | no_time | 200 | yes | yes | 43 | 43 |  |
| wave1_no_time | 1019 | pages_per_session | no_time | 200 | yes | yes | 1.7735849056603774 | 1.7744 |  |
| wave1_no_time | 1019 | events_per_session | no_time | 200 | yes | no | 12.067924528301887 | N/A | no_reference_sql |
| wave1_no_time | 1019 | avg_time_on_page_seconds | no_time | 200 | yes | no | 0.0 | 45 |  |
| wave1_no_time | 1019 | avg_scroll_depth | no_time | 200 | yes | yes | 0.0 | 0.78 |  |
| wave1_no_time | 1019 | scroll_engagement_rate | no_time | 200 | yes | no | 0.0 | N/A | no_reference_sql |
| wave1_no_time | 1019 | clicks_per_session | no_time | 200 | yes | yes | 7.867924528301887 | 7.8421 |  |
| wave1_no_time | 1019 | new_visitor_rate | no_time | 200 | yes | no | 0.6416666666666667 | 64.46 |  |
| wave1_no_time | 1019 | returning_visitor_rate | no_time | 200 | yes | no | 0.35833333333333334 | 35.54 |  |
| wave1_no_time | 1019 | identified_visitor_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | visitor_identification_rate | no_time | 200 | yes | yes | 0.0 | 0 |  |
| wave1_no_time | 1019 | identified_session_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | identified_session_rate | no_time | 200 | yes | yes | 0.0 | 0 |  |
| wave1_no_time | 1019 | campaign_attributed_sessions | no_time | 200 | yes | yes | 0 | 1 |  |
| wave1_no_time | 1019 | campaign_attributed_session_rate | no_time | 200 | yes | no | 0.0 | 0.38 |  |
| wave1_no_time | 1019 | landing_page_conversion_rate | no_time | 200 | yes | no | 0.0 | N/A | no_reference_sql |
| wave1_no_time | 1019 | rage_clicks | no_time | 200 | yes | yes | 59 | 59 |  |
| wave1_no_time | 1019 | rage_click_session_count | no_time | 200 | yes | yes | 11 | 11 |  |
| wave1_no_time | 1019 | rage_click_rate | no_time | 200 | yes | no | 0.04150943396226415 | 4.14 |  |
| wave1_no_time | 1019 | dead_clicks | no_time | 200 | yes | yes | 592 | 592 |  |
| wave1_no_time | 1019 | dead_click_rate | no_time | 200 | yes | no | 0.3320754716981132 | 33.08 |  |
| wave1_no_time | 1019 | form_views | no_time | 200 | yes | yes | 261 | 261 |  |
| wave1_no_time | 1019 | form_starts | no_time | 200 | yes | yes | 191 | 191 |  |
| wave1_no_time | 1019 | form_submits | no_time | 200 | yes | yes | 108 | 108 |  |
| wave1_no_time | 1019 | form_successes | no_time | 200 | yes | yes | 20 | 20 |  |
| wave1_no_time | 1019 | form_failures | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | form_abandons | no_time | 200 | yes | yes | 93 | 93 |  |
| wave1_no_time | 1019 | form_submit_rate | no_time | 200 | yes | no | 0.41379310344827586 | N/A | no_reference_sql |
| wave1_no_time | 1019 | form_success_rate | no_time | 200 | yes | no | 0.18518518518518517 | N/A | no_reference_sql |
| wave1_no_time | 1019 | form_abandon_rate | no_time | 200 | yes | no | 0.4869109947643979 | N/A | no_reference_sql |
| wave1_no_time | 1019 | conversion_rate | no_time | 200 | yes | no | 0.0 | 0.38 |  |
| wave1_no_time | 1019 | total_revenue | no_time | 200 | yes | no | 0.00 | 99 |  |
| wave1_no_time | 1019 | purchase_count | no_time | 200 | yes | yes | 0 | 1 |  |
| wave1_no_time | 1019 | average_order_value | no_time | 200 | yes | no | None | 99 |  |
| wave1_no_time | 1019 | signup_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | checkout_start_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | checkout_start_rate | no_time | 200 | yes | no | 0.0 | N/A | no_reference_sql |
| wave1_no_time | 1019 | checkout_conversion_rate | no_time | 200 | yes | no | 0 | N/A | no_reference_sql |
| wave1_no_time | 1019 | cart_add_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | cart_add_rate | no_time | 200 | yes | no | 0.0 | N/A | no_reference_sql |
| wave1_no_time | 1019 | product_interaction_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | product_view_rate | no_time | 200 | yes | no | 0.0 | N/A | no_reference_sql |
| wave1_no_time | 1019 | avg_lcp_ms | no_time | 200 | yes | yes | None | None |  |
| wave1_no_time | 1019 | avg_fcp_ms | no_time | 200 | yes | yes | None | None |  |
| wave1_no_time | 1019 | avg_cls | no_time | 200 | yes | yes | None | None |  |
| wave1_no_time | 1019 | avg_inp_ms | no_time | 200 | yes | yes | None | None |  |
| wave1_no_time | 1019 | avg_ttfb_ms | no_time | 200 | yes | yes | None | None |  |
| wave1_no_time | 1019 | poor_vitals_event_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | poor_vitals_rate | no_time | 200 | yes | no | 0 | N/A | no_reference_sql |
| wave1_no_time | 1019 | error_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | error_session_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | error_session_rate | no_time | 200 | yes | yes | 0.0 | 0 |  |
| wave1_no_time | 1019 | search_session_count | no_time | 200 | yes | yes | 0 | 0 |  |
| wave1_no_time | 1019 | search_usage_rate | no_time | 200 | yes | yes | 0.0 | 0 |  |
| wave2_time | 1019 | web_session_volume | period=today | 200 | yes | no | 265 | 0 |  |
| wave2_time | 1019 | web_session_volume | period=week | 200 | yes | no | 265 | 56 |  |
| wave2_time | 1019 | web_session_volume | period=month | 200 | yes | yes | 265 | 266 |  |
| wave2_time | 1019 | web_session_volume | period=overall | 200 | yes | yes | 265 | 266 |  |
| wave2_time | 1019 | unique_visitors | period=today | 200 | yes | no | 120 | 0 |  |
| wave2_time | 1019 | unique_visitors | period=week | 200 | yes | no | 120 | 39 |  |
| wave2_time | 1019 | unique_visitors | period=month | 200 | yes | yes | 120 | 121 |  |
| wave2_time | 1019 | unique_visitors | period=overall | 200 | yes | yes | 120 | 121 |  |
| wave2_time | 1019 | page_views | period=today | 200 | yes | no | 470 | 0 |  |
| wave2_time | 1019 | page_views | period=week | 200 | yes | no | 470 | 60 |  |
| wave2_time | 1019 | page_views | period=month | 200 | yes | no | 470 | 472 |  |
| wave2_time | 1019 | page_views | period=overall | 200 | yes | no | 470 | 472 |  |
| wave2_time | 1019 | bounce_rate | period=today | 200 | yes | no | 0.4075471698113208 | 0 |  |
| wave2_time | 1019 | bounce_rate | period=week | 200 | yes | no | 0.4075471698113208 | 47.17 |  |
| wave2_time | 1019 | bounce_rate | period=month | 200 | yes | no | 0.4075471698113208 | 42.35 |  |
| wave2_time | 1019 | bounce_rate | period=overall | 200 | yes | no | 0.4075471698113208 | 42.35 |  |
| wave2_time | 1019 | total_clicks | period=today | 200 | yes | no | 2085 | 0 |  |
| wave2_time | 1019 | total_clicks | period=week | 200 | yes | no | 2085 | 423 |  |
| wave2_time | 1019 | total_clicks | period=month | 200 | yes | yes | 2085 | 2086 |  |
| wave2_time | 1019 | total_clicks | period=overall | 200 | yes | yes | 2085 | 2086 |  |
| wave2_time | 1019 | total_conversions | period=today | 200 | yes | yes | 0 | 0 |  |
| wave2_time | 1019 | total_conversions | period=week | 200 | yes | yes | 0 | 0 |  |
| wave2_time | 1019 | total_conversions | period=month | 200 | yes | yes | 0 | 1 |  |
| wave2_time | 1019 | total_conversions | period=overall | 200 | yes | yes | 0 | 1 |  |
| wave2_time | 1019 | web_session_volume | range=2026-09-14..2026-09-20 | 200 | yes | yes | 56 | 56 |  |
| wave3_groupby | 1019 | web_session_volume | web_sessions__country | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__country' do |
| wave3_groupby | 1019 | web_session_volume | web_sessions__city | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__city' does  |
| wave3_groupby | 1019 | web_session_volume | web_sessions__device | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__device' doe |
| wave3_groupby | 1019 | web_session_volume | web_sessions__browser | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__browser' do |
| wave3_groupby | 1019 | web_session_volume | web_sessions__platform | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__platform' d |
| wave3_groupby | 1019 | web_session_volume | web_sessions__utm_source | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__utm_source' |
| wave3_groupby | 1019 | web_session_volume | web_sessions__utm_medium | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__utm_medium' |
| wave3_groupby | 1019 | web_session_volume | web_sessions__utm_campaign | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__utm_campaig |
| wave3_groupby | 1019 | web_session_volume | web_sessions__referrer_domain | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__referrer_do |
| wave3_groupby | 1019 | web_session_volume | web_sessions__entry_page | 400 | no | no |  |  | {'detail': {'message': "Dimension 'web_sessions__entry_page' |
| wave3_groupby | 1019 | page_views | page_views__page_path | 400 | no | no |  |  | {'detail': {'message': "Dimension 'page_views__page_path' do |
| wave3_groupby | 1019 | total_clicks | interaction_events__page_path | 400 | no | no |  |  | {'detail': {'message': "Dimension 'interaction_events__page_ |
| wave3_groupby | 1019 | form_submits | form_events__form_id | 400 | no | no |  |  | {'detail': {'message': "Dimension 'form_events__form_id' doe |
| wave3_groupby | 1019 | total_conversions | conversion_events__conversion_goal_type | 400 | no | no |  |  | {'detail': {'message': "Dimension(s) ['conversion_events__co |
| wave3_groupby | 1019 | product_interaction_count | product_interactions__product_id | 400 | no | no |  |  | {'detail': {'message': "Dimension 'product_interactions__pro |
| wave4_filter | 1019 | web_session_volume | filter web_sessions__device=mobile | 400 | no | no | None | N/A | {'detail': {'message': "Dimension 'web_sessions__device' doe |
| wave4_filter | 1019 | web_session_volume | filter web_sessions__country=India | 400 | no | no | None | N/A | {'detail': {'message': "Dimension 'web_sessions__country' do |
| wave4_filter | 1019 | page_views | filter page_views__page_path=/ | 400 | no | no | None | N/A | {'detail': {'message': "Dimension 'page_views__page_path' do |
| wave4_filter | 1019 | web_session_volume | week+mobile | 400 | no | no | None | N/A | {'detail': {'message': "Dimension 'web_sessions__device' doe |
