

-- One row per organization_id x owner_user_id x created_at day.
-- Supports "average win rate of the agent" (per-agent, per-period average),
-- separate from the org-level mart_deal_daily_summary.

select
    organization_id,
    business_type,
    owner_user_id,
    owner_name,
    date_trunc('day', created_at)                            as day,
    count(case when is_closed then deal_id end)                as closed_deal_count,
    case when count(case when is_closed then deal_id end) > 0
         then count(case when is_won then deal_id end)::decimal
              / nullif(count(case when is_closed then deal_id end), 0)
    end                                                         as daily_agent_win_rate
from "worktual_bigint"."crm_marts"."mart_deals"
group by 1, 2, 3, 4, 5