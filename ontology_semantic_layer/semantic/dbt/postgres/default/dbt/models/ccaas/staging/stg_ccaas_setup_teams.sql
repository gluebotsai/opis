{{ config(materialized='view', alias='stg_setup_teams') }}

select
    id as team_id,
    organization_id,
    name as team_name,
    status,
    created_at
from {{ source('worktual', 'setup_teams') }}
