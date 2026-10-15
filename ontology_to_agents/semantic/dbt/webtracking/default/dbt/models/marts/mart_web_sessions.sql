-- Session grain mart aligned to ClickHouse dashboard truth:
--   bounce / duration / pageview_count  → v_session_bounce
--   exit_page                           → argMax(page_path) from fact_page_views
--   engagement enrichment flags         → fact_* session rollups
-- Do NOT invent GA4 bounce or use dim_sessions.is_bounce / stale duration.

with pv_agg as (
    select
        website_id,
        session_id,
        count(*) as page_view_count,
        max(max_scroll_depth) as max_session_scroll_depth,
        argMax(page_path, created_at) as exit_page_derived,
        min(created_at) as first_pv_at,
        max(created_at) as last_pv_at
    from {{ ref('stg_page_views') }}
    group by website_id, session_id
),

int_agg as (
    select
        website_id,
        session_id,
        countIf(event_type = 'click') as total_clicks,
        countIf(event_type = 'rage_click') as rage_click_count,
        countIf(event_type = 'dead_click') as dead_click_count,
        maxIf(
            if(scroll_depth > 0 and scroll_depth <= 1.0000001, scroll_depth * 100.0, scroll_depth),
            event_type = 'scroll_depth'
        ) as max_scroll_depth_ie,
        min(created_at) as first_int_at,
        max(created_at) as last_int_at
    from {{ ref('stg_interaction_events') }}
    group by website_id, session_id
),

conv_agg as (
    select
        website_id,
        session_id,
        count(*) as conversion_count,
        sum(value) as total_revenue,
        countIf(conversion_type = 'purchase') as purchase_count,
        countIf(conversion_type = 'signup') as signup_count
    from {{ ref('stg_conversion_events') }}
    group by website_id, session_id
),

form_agg as (
    select
        website_id,
        session_id,
        countIf(event_type = 'form_view') as form_view_count,
        countIf(event_type = 'form_start') as form_start_count,
        countIf(event_type = 'form_submit') as form_submit_count,
        countIf(event_type = 'form_success') as form_success_count,
        countIf(event_type = 'form_failure') as form_failure_count,
        countIf(event_type = 'form_abandon') as form_abandon_count
    from {{ ref('stg_form_events') }}
    group by website_id, session_id
),

custom_agg as (
    select
        website_id,
        session_id,
        countIf(event_name = 'site_search') as search_count
    from {{ ref('stg_custom_events') }}
    group by website_id, session_id
),

err_agg as (
    select
        website_id,
        session_id,
        count(*) as error_count
    from {{ ref('stg_error_events') }}
    group by website_id, session_id
),

prod_agg as (
    select
        website_id,
        session_id,
        count(*) as product_interaction_count,
        countIf(section = 'product_view') as product_view_count,
        countIf(section = 'add_to_cart') as cart_add_count,
        countIf(section = 'begin_checkout') as checkout_start_count
    from {{ ref('stg_product_interactions') }}
    group by website_id, session_id
),

session_order as (
    -- Lifetime first-ever session flag (profile enrichment).
    -- Period new/returning (≤1 / >1 sessions in window) is computed at query time
    -- in SQL templates — not from this flag.
    select
        website_id,
        session_id,
        row_number() over (
            partition by website_id, visitor_id
            order by started_at asc, session_id asc
        ) as visitor_session_rank
    from {{ ref('stg_web_sessions') }}
)

select
    s.session_id as session_id,
    s.visitor_id as visitor_id,
    s.website_id as website_id,
    s.organization_id as organization_id,
    s.user_id as user_id,
    -- Prefer v_session_bounce.session_started_at so period pills match dashboard bounce grain.
    coalesce(b.session_started_at, s.started_at) as started_at,
    s.ended_at as ended_at,
    s.updated_at as updated_at,

    -- Tier-1 duration / pageviews / bounce from v_session_bounce
    coalesce(b.duration_seconds, toUInt32(0)) as duration_seconds,
    coalesce(b.pageview_count, p.page_view_count, toUInt64(0)) as page_view_count,
    coalesce(b.is_bounce_flag, toUInt8(0)) as is_bounce_flag,
    -- Engaged = inverse of dashboard bounce (not GA4 engaged-session)
    if(coalesce(b.is_bounce_flag, toUInt8(0)) = 1, 0, 1) as is_engaged_flag,

    -- Online: active in last 5 minutes (dashboard real-time card)
    if(
        greatest(s.updated_at, coalesce(s.ended_at, s.updated_at))
            >= now64(3) - toIntervalMinute(5),
        1,
        0
    ) as is_online_flag,

    if(so.visitor_session_rank = 1, 1, 0) as is_first_session_flag,

    coalesce(i.total_clicks, 0) as total_clicks,
    coalesce(i.rage_click_count, 0) as rage_click_count,
    if(coalesce(i.rage_click_count, 0) > 0, 1, 0) as has_rage_clicks,
    coalesce(i.dead_click_count, 0) as dead_click_count,
    if(coalesce(i.dead_click_count, 0) > 0, 1, 0) as has_dead_clicks,
    greatest(
        coalesce(p.max_session_scroll_depth, 0.0),
        coalesce(i.max_scroll_depth_ie, 0.0)
    ) as max_session_scroll_depth,
    if(
        greatest(
            coalesce(p.max_session_scroll_depth, 0.0),
            coalesce(i.max_scroll_depth_ie, 0.0)
        ) >= 50.0,
        1,
        0
    ) as has_deep_scroll,
    coalesce(c.conversion_count, 0) as conversion_count,
    if(coalesce(c.conversion_count, 0) > 0, 1, 0) as has_conversion,
    coalesce(c.total_revenue, 0.0) as total_revenue,
    coalesce(c.purchase_count, 0) as purchase_count,
    if(coalesce(c.purchase_count, 0) > 0, 1, 0) as has_purchase,
    coalesce(c.signup_count, 0) as signup_count,
    if(coalesce(c.signup_count, 0) > 0, 1, 0) as has_signup,
    coalesce(pr.checkout_start_count, 0) as checkout_start_count,
    if(coalesce(pr.checkout_start_count, 0) > 0, 1, 0) as has_checkout_start,
    coalesce(pr.cart_add_count, 0) as cart_add_count,
    if(coalesce(pr.cart_add_count, 0) > 0, 1, 0) as has_cart_add,
    coalesce(pr.product_interaction_count, 0) as product_interaction_count,
    if(coalesce(pr.product_view_count, 0) > 0, 1, 0) as has_product_view,
    coalesce(f.form_view_count, 0) as form_view_count,
    coalesce(f.form_start_count, 0) as form_start_count,
    if(coalesce(f.form_start_count, 0) > 0, 1, 0) as has_form_start,
    coalesce(f.form_submit_count, 0) as form_submit_count,
    if(coalesce(f.form_submit_count, 0) > 0, 1, 0) as has_form_submit,
    coalesce(f.form_success_count, 0) as form_success_count,
    if(coalesce(f.form_success_count, 0) > 0, 1, 0) as has_form_success,
    coalesce(f.form_failure_count, 0) as form_failure_count,
    if(coalesce(f.form_failure_count, 0) > 0, 1, 0) as has_form_failure,
    coalesce(f.form_abandon_count, 0) as form_abandon_count,
    if(coalesce(f.form_abandon_count, 0) > 0, 1, 0) as has_form_abandon,
    coalesce(cu.search_count, 0) as search_count,
    if(coalesce(cu.search_count, 0) > 0, 1, 0) as has_search,
    coalesce(e.error_count, 0) as error_count,
    if(coalesce(e.error_count, 0) > 0, 1, 0) as has_error,

    s.entry_page as entry_page,
    -- dim_sessions.exit_page is empty; derive from last page view
    coalesce(nullIf(p.exit_page_derived, ''), nullIf(s.exit_page, ''), '') as exit_page,
    s.referrer as referrer,
    s.referrer_domain as referrer_domain,
    s.utm_source as utm_source,
    s.utm_medium as utm_medium,
    s.utm_campaign as utm_campaign,
    s.utm_term as utm_term,
    s.utm_content as utm_content,
    s.wt_organization_id as wt_organization_id,
    s.wt_campaign_id as wt_campaign_id,
    s.wt_contact_id as wt_contact_id,
    s.device as device,
    s.browser as browser,
    s.browser_version as browser_version,
    s.platform as platform,
    s.country as country,
    s.city as city,
    s.region as region,
    s.latitude as latitude,
    s.longitude as longitude,
    s.is_campaign_attributed as is_campaign_attributed,
    s.is_identified as is_identified,
    s.created_at as created_at
from {{ ref('stg_web_sessions') }} s
left join {{ ref('stg_session_bounce') }} b
    on s.website_id = b.website_id and s.session_id = b.session_id
left join pv_agg p
    on s.website_id = p.website_id and s.session_id = p.session_id
left join int_agg i
    on s.website_id = i.website_id and s.session_id = i.session_id
left join conv_agg c
    on s.website_id = c.website_id and s.session_id = c.session_id
left join form_agg f
    on s.website_id = f.website_id and s.session_id = f.session_id
left join custom_agg cu
    on s.website_id = cu.website_id and s.session_id = cu.session_id
left join err_agg e
    on s.website_id = e.website_id and s.session_id = e.session_id
left join prod_agg pr
    on s.website_id = pr.website_id and s.session_id = pr.session_id
left join session_order so
    on s.website_id = so.website_id and s.session_id = so.session_id
