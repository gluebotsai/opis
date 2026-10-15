select
    chunk_id,
    website_id,
    organization_id,
    visitor_id,
    session_id,
    page_view_id,
    chunk_index,
    encoding,
    event_count,
    source,
    payload_id,
    created_at
from {{ ref('stg_replay_chunks') }}
