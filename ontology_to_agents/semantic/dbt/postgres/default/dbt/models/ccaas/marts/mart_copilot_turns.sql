{{ config(materialized='view') }}
-- Copilot suggestion turns (no channel column — SQL agent must not apply channel filter).
select
    suggestion_id,
    organization_id,
    session_id,
    conversation_id,
    skill_key,
    accepted,
    suggestion_text,
    final_text,
    status,
    created_at,
    suggestion_disposition
from {{ ref('stg_copilot_turns') }}
