-- One row per channel enabled on a campaign. Grain: campaign_channel_id.
select
    id              as campaign_channel_id,
    campaign_id,
    organization_id,
    channel         as channel_name,        -- email/sms/whatsapp/push/web/ppc
    template_id     as channel_template_id,
    status          as channel_status,
    planned_launch_at,
    created_at,
    updated_at
from "worktual_bigint"."campaign"."campaign_channels"