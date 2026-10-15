-- Grain: campaign_id + ab_variant + recipient_platform. Lets you compare open/click
-- performance across A/B variants and delivery platforms within a campaign.
-- Same proxy caveats as mart_campaign_touch_performance: is_sent_flag = 'sent' status
-- stands in for "delivered"; no conversion field exists in the source schema.
with recipients as (
    select * from "worktual_bigint"."campaign_staging"."stg_campaign_send_recipients"
),

campaigns as (
    select campaign_id, organization_id, created_at as campaign_created_at
    from "worktual_bigint"."campaign_staging"."stg_campaigns"
)

select
    r.campaign_id,
    c.organization_id,
    c.campaign_created_at,
    coalesce(r.ab_variant, 'none')            as ab_variant,
    coalesce(r.recipient_platform, 'unknown') as recipient_platform,
    count(*)                                as touch_count,
    count(*) filter (where r.is_sent_flag)     as sent_touch_count,
    count(*) filter (where r.is_failed_flag)    as failed_touch_count,
    count(*) filter (where r.is_opened_flag)    as opened_touch_count,
    count(*) filter (where r.is_clicked_flag)   as clicked_touch_count,
    count(*) filter (where r.is_opened_flag)::numeric
        / nullif(count(*) filter (where r.is_sent_flag), 0)  as open_rate,
    count(*) filter (where r.is_clicked_flag)::numeric
        / nullif(count(*) filter (where r.is_sent_flag), 0)  as click_rate
from recipients r
left join campaigns c on c.campaign_id = r.campaign_id
group by 1, 2, 3, 4, 5