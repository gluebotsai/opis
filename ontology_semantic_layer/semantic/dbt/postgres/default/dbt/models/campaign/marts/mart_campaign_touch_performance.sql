-- Grain: campaign_id. Proxy for campaign_touch_volume, delivery_rate, open_rate,
-- click_rate, failure_rate, frequency_per_contact.
-- CAVEAT: no literal "delivered" status exists on the source table — is_sent_flag
-- (status='sent') is used as the delivery proxy. No conversion field exists anywhere
-- in the schema, so conversion_rate / converted_touch_count are NOT built here.
with recipients as (
    select * from {{ ref('stg_campaign_send_recipients') }}
),

campaigns as (
    select campaign_id, organization_id, created_at as campaign_created_at
    from {{ ref('stg_campaigns') }}
),

per_campaign as (
    select
        campaign_id,
        count(*)                                   as touch_count,
        count(*) filter (where is_sent_flag)        as sent_touch_count,      -- delivery proxy
        count(*) filter (where is_failed_flag)       as failed_touch_count,
        count(*) filter (where is_skipped_flag)      as skipped_touch_count,
        count(*) filter (where is_opened_flag)       as opened_touch_count,
        count(*) filter (where is_clicked_flag)      as clicked_touch_count,
        count(distinct contact_id)                  as unique_contacts_touched,
        avg(attempt_count)                          as avg_attempt_count,
        avg(seconds_to_open)                        as avg_seconds_to_open,
        avg(seconds_open_to_click)                  as avg_seconds_open_to_click
    from recipients
    group by 1
)

select
    p.campaign_id,
    c.organization_id,
    c.campaign_created_at,
    touch_count,
    sent_touch_count,
    failed_touch_count,
    skipped_touch_count,
    opened_touch_count,
    clicked_touch_count,
    unique_contacts_touched,
    avg_attempt_count,
    avg_seconds_to_open,
    avg_seconds_open_to_click,
    -- ratio metrics computed here (mart layer) since they need cross-column division
    -- Postgres: guard divide-by-zero with nullif()
    sent_touch_count::numeric    / nullif(touch_count, 0)             as delivery_rate,      -- proxy: sent / total
    opened_touch_count::numeric  / nullif(sent_touch_count, 0)        as open_rate,
    clicked_touch_count::numeric / nullif(sent_touch_count, 0)        as click_rate,
    failed_touch_count::numeric  / nullif(touch_count, 0)             as failure_rate,
    touch_count::numeric         / nullif(unique_contacts_touched, 0) as frequency_per_contact
from per_campaign p
left join campaigns c on c.campaign_id = p.campaign_id