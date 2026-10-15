
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_copilot_turns__dbt_tmp"
    
    
  as (
    -- Agent-assist suggestion proxy. Real schema only has a boolean `accepted`,
-- not a full accepted/modified/rejected enum, so we infer:
--   accepted = true  and final_text = suggestion_text  -> 'accepted'
--   accepted = true  and final_text != suggestion_text -> 'modified'
--   accepted = false                                    -> 'rejected'
--   accepted is null                                    -> 'pending'
select
    id as suggestion_id,
    organization_id,
    session_id,
    conversation_id,
    skill_key,
    accepted,
    suggestion_text,
    final_text,
    status,
    created_at,

    case
        when accepted is true and final_text is not distinct from suggestion_text then 'accepted'
        when accepted is true and final_text is distinct from suggestion_text then 'modified'
        when accepted is false then 'rejected'
        else 'pending'
    end as suggestion_disposition

from "worktual_bigint"."ccass"."copilot_turns"
  );