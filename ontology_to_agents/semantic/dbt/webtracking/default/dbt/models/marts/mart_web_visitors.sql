-- Visitor profile mart. Rollups come from staging (not mart_web_sessions)
-- so ClickHouse CREATE VIEW does not nest complex joins / window views.
with sess_rollup as (
    select
        visitor_id,
        website_id,
        count(*) as session_count,
        min(started_at) as first_session_at,
        max(started_at) as last_session_at
    from {{ ref('stg_web_sessions') }}
    group by visitor_id, website_id
),

pv_rollup as (
    select
        visitor_id,
        website_id,
        count(*) as lifetime_pageviews
    from {{ ref('stg_page_views') }}
    group by visitor_id, website_id
),

conv_rollup as (
    select
        visitor_id,
        website_id,
        count(*) as lifetime_conversions,
        sum(value) as lifetime_revenue
    from {{ ref('stg_conversion_events') }}
    group by visitor_id, website_id
)

select
    -- Explicit aliases: ClickHouse otherwise keeps names like `v.visitor_id`.
    v.visitor_id as visitor_id,
    v.website_id as website_id,
    v.organization_id as organization_id,
    v.user_id as user_id,
    v.anonymous_id as anonymous_id,
    coalesce(s.session_count, v.total_sessions, 1) as lifetime_sessions,
    coalesce(p.lifetime_pageviews, v.total_pageviews, 1) as lifetime_pageviews,
    if(coalesce(s.session_count, v.total_sessions, 1) > 1, 1, 0) as is_returning_visitor,
    coalesce(c.lifetime_conversions, 0) as lifetime_conversions,
    coalesce(c.lifetime_revenue, 0.0) as lifetime_revenue,
    v.country as country,
    v.is_identified_flag as is_identified_flag,
    coalesce(s.first_session_at, v.first_seen_at) as first_seen_at,
    coalesce(s.last_session_at, v.last_seen_at) as last_seen_at,
    v.created_at as created_at
from {{ ref('stg_web_visitors') }} v
left join sess_rollup s
    on v.visitor_id = s.visitor_id and v.website_id = s.website_id
left join pv_rollup p
    on v.visitor_id = p.visitor_id and v.website_id = p.website_id
left join conv_rollup c
    on v.visitor_id = c.visitor_id and v.website_id = c.website_id
