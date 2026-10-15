select
    chunk_id,
    website_id,
    coalesce(organization_id, 0) as organization_id,
    visitor_id,
    session_id,
    page_view_id,
    chunk_index,
    encoding,
    event_count,
    source,
    toString(chunk_id) as payload_id,
    created_at
from {{ source('web_tracking', 'fact_replay_chunks') }}
