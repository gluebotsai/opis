-- Grain: campaign_id + channel_name. Batch-level send health — different from
-- per-recipient performance: measures how sending infrastructure/batches behaved,
-- not individual recipient outcomes.
with batches as (
    select * from {{ ref('stg_campaign_send_batches') }}
),

campaigns as (
    select campaign_id, organization_id
    from {{ ref('stg_campaigns') }}
)

select
    b.campaign_id,
    c.organization_id,
    b.channel_name,
    min(b.created_at)                              as first_batch_created_at,
    count(*)                                     as batch_count,
    count(*) filter (where b.batch_status = 'failed')   as failed_batch_count,
    count(*) filter (where b.batch_status = 'done')      as completed_batch_count,
    sum(b.expected_recipient_count)                as total_expected_recipients,
    avg(b.batch_processing_seconds)                as avg_batch_processing_seconds,
    count(*) filter (where b.batch_status = 'failed')::numeric
        / nullif(count(*), 0)                    as batch_failure_rate
from batches b
left join campaigns c on c.campaign_id = b.campaign_id
group by 1, 2, 3