-- Page views enriched for engagement KPIs:
--   max_scroll_depth  ← fact_page_views, else max scroll_depth interaction (0–100%)
--   time_on_page_sec  ← fact_page_views when >0, else gap to next pageview in session
--                     (capped 1–300s to match dashboard-style dwell; last PV → 0)

with base as (
    select
        page_view_id,
        session_id,
        visitor_id,
        website_id,
        coalesce(organization_id, 0) as organization_id,
        page_path,
        page_title,
        referrer,
        time_on_page_sec as raw_time_on_page_sec,
        max_scroll_depth as raw_max_scroll_depth,
        device,
        country,
        utm_source,
        utm_medium,
        utm_campaign,
        sdk_version,
        created_at
    from {{ source('web_tracking', 'fact_page_views') }}
),

scroll_by_pv as (
    select
        page_view_id,
        max(scroll_depth) as scroll_depth
    from {{ source('web_tracking', 'fact_interaction_events') }}
    where event_type = 'scroll_depth'
      and page_view_id != ''
    group by page_view_id
),

scroll_by_session_path as (
    select
        session_id,
        page_path,
        max(scroll_depth) as scroll_depth
    from {{ source('web_tracking', 'fact_interaction_events') }}
    where event_type = 'scroll_depth'
    group by session_id, page_path
),

with_next as (
    select
        b.page_view_id as page_view_id,
        b.session_id as session_id,
        b.visitor_id as visitor_id,
        b.website_id as website_id,
        b.organization_id as organization_id,
        b.page_path as page_path,
        b.page_title as page_title,
        b.referrer as referrer,
        b.raw_time_on_page_sec as raw_time_on_page_sec,
        b.device as device,
        b.country as country,
        b.utm_source as utm_source,
        b.utm_medium as utm_medium,
        b.utm_campaign as utm_campaign,
        b.sdk_version as sdk_version,
        b.created_at as created_at,
        leadInFrame(b.created_at) over (
            partition by b.website_id, b.session_id
            order by b.created_at
            rows between unbounded preceding and unbounded following
        ) as next_created_at,
        coalesce(
            nullIf(sp.scroll_depth, 0),
            nullIf(ss.scroll_depth, 0),
            b.raw_max_scroll_depth
        ) as scroll_merged
    from base as b
    left join scroll_by_pv as sp
        on b.page_view_id = sp.page_view_id
    left join scroll_by_session_path as ss
        on b.session_id = ss.session_id
       and b.page_path = ss.page_path
)

select
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    page_path,
    page_title,
    referrer,
    if(
        raw_time_on_page_sec > 0,
        raw_time_on_page_sec,
        if(
            next_created_at > created_at
            and dateDiff('second', created_at, next_created_at) between 1 and 300,
            toUInt32(dateDiff('second', created_at, next_created_at)),
            toUInt32(0)
        )
    ) as time_on_page_sec,
    if(
        scroll_merged > 0 and scroll_merged <= 1.0000001,
        scroll_merged * 100.0,
        coalesce(scroll_merged, 0.0)
    ) as max_scroll_depth,
    device,
    country,
    utm_source,
    utm_medium,
    utm_campaign,
    sdk_version,
    created_at
from with_next
