
  create view "worktual_bigint"."campaign_staging"."stg_campaign_audience__dbt_tmp"
    
    
  as (
    -- Frozen audience membership snapshot. Grain: campaign_id + contact_id (composite, no surrogate PK on source).
select
    campaign_id,
    contact_id,
    created_at as snapshotted_at
from "worktual_bigint"."campaign"."campaign_audience"
  );