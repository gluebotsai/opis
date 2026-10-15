select
    id                          as engagement_id,
    organization_id,
    contact_id,
    email_unsubscribed,
    email_unsubscribed_at,
    email_unsubscribe_reason,
    last_email_opened_at,
    last_email_clicked_at,
    email_open_count            as lifetime_open_count,
    email_click_count           as lifetime_click_count,
    created_at,
    updated_at
from "worktual_bigint"."campaign"."campaign_contact_engagement"