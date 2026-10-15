{{ config(materialized='view') }}
select
    macro_id,
    organization_id,
    title,
    body,
    created_by_id,
    created_by_name,
    created_at,
    updated_at
from {{ ref('stg_macros') }}
