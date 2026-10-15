

-- One row per organization_id x day. Pre-aggregates funnel counts and
-- daily rates so `agg: average` measures can correctly average per-period
-- values (see mart_deal_daily_summary.sql for the same pattern/rationale).

select
    organization_id,
    business_type,
    date_trunc('day', created_at)                                          as day,
    count(contact_id)                                                       as contact_count,
    count(case when lifecycle_stage in ('lead','subscriber')
               then contact_id end)                                         as new_lead_count,
    count(case when is_mql_proxy then contact_id end)                       as mql_proxy_count,
    count(case when lifecycle_stage in ('lead','mql','prospect','customer')
               then contact_id end)                                         as eligible_lead_count,
    count(case when lifecycle_stage = 'customer' then contact_id end)       as customer_count,
    count(case when lifecycle_stage in ('lead','mql','prospect','customer','subscriber')
               then contact_id end)                                         as funnel_eligible_count,
    case when count(case when lifecycle_stage in ('lead','mql','prospect','customer')
                        then contact_id end) > 0
         then count(case when is_mql_proxy then contact_id end)::decimal
              / nullif(count(case when lifecycle_stage in ('lead','mql','prospect','customer')
                                  then contact_id end), 0)
    end                                                                     as daily_mql_rate,
    case when count(case when lifecycle_stage in ('lead','mql','prospect','customer','subscriber')
                        then contact_id end) > 0
         then count(case when lifecycle_stage = 'customer' then contact_id end)::decimal
              / nullif(count(case when lifecycle_stage in ('lead','mql','prospect','customer','subscriber')
                                  then contact_id end), 0)
    end                                                                     as daily_customer_conversion_rate
from "worktual_bigint"."crm_marts"."mart_contacts"
group by 1, 2, 3