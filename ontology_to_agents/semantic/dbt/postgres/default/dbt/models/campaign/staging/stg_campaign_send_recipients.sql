-- Per-recipient send outcome. This is the closest real table to a "campaign_touch" grain,
-- but it is NOT the campaign_touch entity from the metrics doc (that table does not exist
-- in this schema). Treat send_recipient_id as the touch proxy grain: one row per send attempt.
select
    id                  as send_recipient_id,
    organization_id,
    batch_id,
    campaign_id,
    contact_id,
    email               as recipient_email,
    destination         as recipient_destination,   -- push token / web-push url (non-email)
    platform            as recipient_platform,
    status              as send_status,              -- pending/sent/failed/skipped (no literal "delivered")
    skip_fail_reason,
    ab_variant,
    attempt_count,
    open_count,
    click_count,
    opened_at,
    clicked_at,
    created_at,
    updated_at,
    -- derived: own-table only
    (status = 'sent')                          as is_sent_flag,
    (status = 'failed')                        as is_failed_flag,
    (status = 'skipped')                       as is_skipped_flag,
    (opened_at is not null)                    as is_opened_flag,
    (clicked_at is not null)                   as is_clicked_flag,
    extract(epoch from (opened_at - created_at))  as seconds_to_open,
    extract(epoch from (clicked_at - opened_at))  as seconds_open_to_click
from {{ source('campaign', 'campaign_send_recipients') }}