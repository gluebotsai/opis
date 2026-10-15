-- Global (NOT per-campaign) do-not-send list. Grain: suppression_id.
select
    id          as suppression_id,
    organization_id,
    email       as suppressed_email,
    reason      as suppression_reason,   -- unsub / hard_bounce / complaint
    created_at
from "worktual_bigint"."campaign"."email_suppressions"