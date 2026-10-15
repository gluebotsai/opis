-- Canonical bounce / activity-span duration from ClickHouse view.
-- Never use dim_sessions.is_bounce or dim_sessions.duration_seconds for Tier-1 KPIs.
select
    website_id,
    session_id,
    pageview_count,
    duration_seconds,
    is_bounce as is_bounce_flag,
    session_started_at
from {{ source('web_tracking', 'v_session_bounce') }}
