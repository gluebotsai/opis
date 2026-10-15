select
    id as disposition_entry_id,
    organization_id,
    conversation_id,
    disposition_id,
    agent_id,
    resolution_code,
    is_final,
    applied_at
from {{ source('contact_center', 'conversation_dispositions') }}

