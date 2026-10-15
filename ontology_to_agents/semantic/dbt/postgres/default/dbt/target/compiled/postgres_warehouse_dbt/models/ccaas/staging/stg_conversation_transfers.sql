select
    id as transfer_id,
    organization_id,
    conversation_id,
    from_queue_id,
    to_queue_id,
    state,
    disposition_code,
    resolution_code,
    requested_at,
    completed_at,
    cancelled_at
from "worktual_bigint"."ccass"."conversation_transfers"