-- Frozen audience membership snapshot. Grain: campaign_id + contact_id (composite, no surrogate PK on source).
select
    campaign_id,
    contact_id,
    created_at as snapshotted_at
from {{ source('campaign', 'campaign_audience') }}