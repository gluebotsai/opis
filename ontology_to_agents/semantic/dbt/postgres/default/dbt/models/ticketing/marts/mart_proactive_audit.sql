{{ config(materialized='view') }}
select
    proactive_audit_id,
    organization_id,
    agent_id,
    ticket_id,
    decision,
    created_at
from {{ ref('stg_proactive_audit') }}
