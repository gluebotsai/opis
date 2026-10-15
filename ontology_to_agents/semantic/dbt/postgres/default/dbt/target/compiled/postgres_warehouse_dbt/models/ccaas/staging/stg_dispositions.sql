select
    id as disposition_id,
    organization_id,
    code,
    label,
    category,
    outcome,
    is_active
from "worktual_bigint"."ccass"."dispositions"