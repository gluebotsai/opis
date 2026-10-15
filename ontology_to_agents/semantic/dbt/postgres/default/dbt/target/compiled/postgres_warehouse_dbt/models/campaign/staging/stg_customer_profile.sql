-- Canonical CDP contact. Grain: contact_id.
select
    contact_id,
    organization_id,
    first_name,
    last_name,
    company,
    city,
    acquisition_channel,
    created_at,
    updated_at,
    first_seen_at,
    last_seen_at
from "worktual_bigint"."shared_staging"."stg_cdp_customer_profile"