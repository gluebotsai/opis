
  create view "worktual_bigint"."crm_marts"."mart_proposal_daily_summary__dbt_tmp"
    
    
  as (
    

-- One row per organization_id x day. Pre-aggregates proposal counts and
-- the daily acceptance rate for `agg: average` measures.

select
    organization_id,
    business_type,
    date_trunc('day', created_at)                            as day,
    count(case when is_sent then proposal_id end)               as proposal_sent_count,
    count(case when is_accepted then proposal_id end)           as proposal_accepted_count,
    case when count(case when is_sent then proposal_id end) > 0
         then count(case when is_accepted then proposal_id end)::decimal
              / nullif(count(case when is_sent then proposal_id end), 0)
    end                                                          as daily_proposal_acceptance_rate
from "worktual_bigint"."crm_marts"."mart_proposals"
group by 1, 2, 3
  );