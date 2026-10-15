{{ config(materialized='view') }}
select
    outbound_email_id,
    organization_id,
    ticket_id,
    ticket_number,
    email_kind          as kind,
    to_email,
    subject,
    body_preview,
    email_status        as status,
    error,
    created_at
from {{ ref('stg_outbound_email_log') }}
