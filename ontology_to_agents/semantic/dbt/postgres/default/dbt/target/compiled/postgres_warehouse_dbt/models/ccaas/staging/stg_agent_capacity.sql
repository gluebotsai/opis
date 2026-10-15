select
    id as capacity_id,
    organization_id,
    agent_id,
    channel,
    max_concurrency,
    reserved_count,
    active_count,
    updated_at
from "worktual_bigint"."ccass"."agent_capacity"