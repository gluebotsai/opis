
  create view "worktual_bigint"."campaign_staging"."stg_regulated_channel_templates__dbt_tmp"
    
    
  as (
    -- SMS/WhatsApp templates requiring external approval. Grain: template_id.
select
    id                      as template_id,
    organization_id,
    channel                 as channel_name,      -- sms / whatsapp
    name                    as template_name,
    category                as template_category, -- MARKETING / UTILITY / ...
    language                as template_language,
    status                  as approval_status,    -- draft/pending/approved/rejected/paused/disabled
    rejected_reason,
    source_campaign_id      as campaign_id,
    created_by_user_id,
    submitted_at,
    last_status_checked_at,
    created_at,
    updated_at,
    -- derived: own-table only
    (status = 'approved')  as is_approved_flag,
    (status = 'rejected')  as is_rejected_flag,
    extract(epoch from (last_status_checked_at - submitted_at)) as seconds_in_review
from "worktual_bigint"."campaign"."regulated_channel_templates"
  );