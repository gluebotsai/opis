{{ config(materialized='view') }}
select
    notification_id,
    organization_id,
    user_id,
    title,
    message,
    ticket_id,
    customer_name,
    is_read,
    notification_kind   as kind,
    created_at
from {{ ref('stg_notifications') }}
