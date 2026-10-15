

-- One row per organization_id x created_at day.
-- Pre-aggregates deal counts so `agg: average` measures in the semantic
-- layer can correctly average per-day (or rolled-up per-week/month/etc.)
-- values, instead of recomputing a ratio over the whole filtered range.

select
    organization_id,
    business_type,
    date_trunc('day', created_at)                          as day,
    count(deal_id)                                          as deal_count,
    sum(case when is_open then amount else 0 end)           as open_pipeline_amount,
    count(case when is_won then deal_id end)                as won_deal_count,
    count(case when is_lost then deal_id end)                as lost_deal_count,
    count(case when is_closed then deal_id end)               as closed_deal_count,
    -- daily win / loss rate, NULL (not 0) when nothing closed that day so
    -- AVG() correctly excludes no-activity days rather than dragging the
    -- average toward zero
    case when count(case when is_closed then deal_id end) > 0
         then count(case when is_won then deal_id end)::decimal
              / nullif(count(case when is_closed then deal_id end), 0)
    end                                                       as daily_win_rate,
    case when count(case when is_closed then deal_id end) > 0
         then count(case when is_lost then deal_id end)::decimal
              / nullif(count(case when is_closed then deal_id end), 0)
    end                                                       as daily_loss_rate
from "worktual_bigint"."crm_marts"."mart_deals"
group by 1, 2, 3