-- Grain: organization_id. Proxy for unsubscribe_rate and suppression_rate.
-- CAVEAT: both source tables are org-level, not per-campaign or per-touch — the metrics
-- doc defines these at campaign_touch grain, which doesn't exist. This mart answers
-- "what share of an org's known contacts/emails are unsubscribed or suppressed",
-- not "what share of touches on campaign X caused an unsubscribe".
with engagement as (
    select
        organization_id,
        min(created_at)                             as first_engagement_at,
        count(*)                                   as engaged_contact_count,
        count(*) filter (where email_unsubscribed)  as unsubscribed_contact_count
    from "worktual_bigint"."campaign_staging"."stg_campaign_contact_engagement"
    group by 1
),

suppressions as (
    select
        organization_id,
        count(*)                                       as suppressed_email_count,
        count(*) filter (where suppression_reason = 'unsub')       as unsub_suppressed_count,
        count(*) filter (where suppression_reason = 'hard_bounce') as bounce_suppressed_count,
        count(*) filter (where suppression_reason = 'complaint')   as complaint_suppressed_count
    from "worktual_bigint"."campaign_staging"."stg_email_suppressions"
    group by 1
)

select
    coalesce(e.organization_id, s.organization_id) as organization_id,
    e.first_engagement_at,
    e.engaged_contact_count,
    e.unsubscribed_contact_count,
    e.unsubscribed_contact_count::numeric / nullif(e.engaged_contact_count, 0) as unsubscribe_rate,
    s.suppressed_email_count,
    s.unsub_suppressed_count,
    s.bounce_suppressed_count,
    s.complaint_suppressed_count,
    -- rate proxies: share of an org's total suppressions attributable to each cause
    -- (NOT a bounce/complaint rate against total sends — no per-send bounce/complaint
    -- field exists anywhere in the schema, so "of everything sent" is not buildable)
    s.bounce_suppressed_count::numeric    / nullif(s.suppressed_email_count, 0) as bounce_share_of_suppressions,
    s.complaint_suppressed_count::numeric / nullif(s.suppressed_email_count, 0) as complaint_share_of_suppressions,
    s.suppressed_email_count::numeric     / nullif(e.engaged_contact_count, 0)  as suppression_rate
from engagement e
full outer join suppressions s using (organization_id)