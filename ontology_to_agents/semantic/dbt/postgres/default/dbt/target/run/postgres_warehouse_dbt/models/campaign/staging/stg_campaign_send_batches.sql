
  create view "worktual_bigint"."campaign_staging"."stg_campaign_send_batches__dbt_tmp"
    
    
  as (
    -- One row per send batch (campaign x channel x seq). Grain: batch_id.
select
    id              as batch_id,
    campaign_id,
    organization_id,
    channel         as channel_name,
    seq             as batch_seq,
    status          as batch_status,     -- queued/processing/done/failed
    size            as expected_recipient_count,
    scheduled_for,
    created_at,
    updated_at,
    -- derived: own-table only
    extract(epoch from (updated_at - created_at)) as batch_processing_seconds
from "worktual_bigint"."campaign"."campaign_send_batches"
  );