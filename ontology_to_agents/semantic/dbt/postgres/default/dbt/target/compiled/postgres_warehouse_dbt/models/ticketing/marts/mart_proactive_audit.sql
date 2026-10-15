
select
    proactive_audit_id,
    organization_id,
    agent_id,
    ticket_id,
    decision,
    created_at
from "worktual_bigint"."ticketing_staging"."stg_proactive_audit"