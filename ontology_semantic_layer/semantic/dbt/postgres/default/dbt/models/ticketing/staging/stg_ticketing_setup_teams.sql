{{ config(materialized='view', alias='stg_setup_teams') }}

select
    team_id,
    organization_id,
    name                                            as myaccount_team_name,
    description                                     as team_description,
    status                                          as team_status,
    created_at,
    updated_at
from {{ ref('stg_accounts_setup_teams') }}
